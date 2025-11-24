<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Donation.php';
require_once __DIR__ . '/../../core/Inventory.php';
require_once __DIR__ . '/../../core/Notification.php';
require_once __DIR__ . '/../../core/DonationNotifier.php';

// Handle CORS / preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

// Generate a UUID v4 string (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
function generateUuidV4(): string {
    $data = random_bytes(16);
    // Set version to 0100
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    // Set bits 6-7 to 10
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    $hex = bin2hex($data);
    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($hex, 0, 8),
        substr($hex, 8, 4),
        substr($hex, 12, 4),
        substr($hex, 16, 4),
        substr($hex, 20)
    );
}
setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
// Support method override (e.g., POST with ?_method=PUT or header) for servers blocking PUT
$override = $_GET['_method'] ?? $_POST['_method'] ?? ($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '');
if ($override) {
    $ov = strtoupper(trim($override));
    if (in_array($ov, ['PUT','PATCH','DELETE'])) { $method = $ov; }
}
$uri = $_SERVER['REQUEST_URI'] ?? '';

// Extract path after '/api/donations' and normalize optional '/index.php'
$path = parse_url($uri, PHP_URL_PATH);
$pos = strpos($path, '/api/donations');
$sub = $pos !== false ? substr($path, $pos + strlen('/api/donations')) : '/';
$sub = $sub === '' ? '/' : $sub; // normalize
// Allow routes like '/index.php/list' by stripping optional '/index.php'
if (strpos($sub, '/index.php') === 0) {
    $sub = substr($sub, strlen('/index.php'));
    if ($sub === '') { $sub = '/'; }
}

$service = new Donation();

// Normalize raw user input for storage: trim and decode HTML entities
function normalize_input($val) {
    return html_entity_decode(trim((string)$val), ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

try {
    // Routes
    // POST /api/donations (root) or /create
    if ($method === 'POST' && preg_match('#^/(|create|create/)\z#', $sub)) {
        requireRole(['donor','admin']); // donor creates, admin may create on behalf
        $payload = readCreatePayload();

        // Force donor_id from session unless admin explicitly provides one
        $role = currentUserRole();
        $payload['donor_id'] = ($role === 'admin' && !empty($payload['donor_id']))
            ? (int)$payload['donor_id']
            : (int)currentUserId();

        // Accept normalized IDs
        $catId = isset($_POST['category_id']) && $_POST['category_id'] !== '' ? (int)$_POST['category_id'] : (isset($payload['category_id']) ? (int)$payload['category_id'] : null);
        $unitId = isset($_POST['unit_id']) && $_POST['unit_id'] !== '' ? (int)$_POST['unit_id'] : (isset($payload['unit_id']) ? (int)$payload['unit_id'] : null);
        $payload['category_id'] = $catId;
        $payload['unit_id'] = $unitId;

        // Validate required fields (expiry_date required). Category/unit/weight are optional and inferred server-side.
        $required = ['name','quantity','expiry_date'];
        foreach ($required as $f) {
            if (!isset($payload[$f]) || $payload[$f] === '') {
                sendJson(['success' => false, 'error' => $f . ' is required'], 400);
            }
        }
        // Category/type no longer required

        // Enforce policy: no images at donation creation (images are uploaded by admin during Food Safety)
        $payload['image_url'] = null;

        // Normalize basic strings (do not HTML-encode for DB)
        if (isset($payload['type'])) { $payload['type'] = normalize_input($payload['type']); }
        $payload['name'] = normalize_input($payload['name']);
        $payload['expiry_date'] = normalize_input($payload['expiry_date']);

        $newId = $service->create($payload);

        // Notify all admins: new donation created
        try {
            $db = Database::getInstance();
            $admins = $db->query("SELECT user_id, name FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll();
            if ($admins) {
                $notif = new Notification();
                $donorName = '';
                // Try to get donor organization name (fallback to person name) for message context
                try {
                    $row = $db->query("SELECT organization_name, name FROM users WHERE user_id = ?", [(int)$payload['donor_id']])->fetch();
                    if ($row) {
                        $donorName = !empty($row['organization_name']) ? $row['organization_name'] : (!empty($row['name']) ? $row['name'] : '');
                    }
                } catch (Exception $e) { /* ignore */ }
                foreach ($admins as $admin) {
                    $notif->create([
                        'user_id' => (int)$admin['user_id'],
                        'type' => 'donation_created',
                        'reference_type' => 'donation',
                        'reference_id' => (int)$newId,
                        'message' => ($donorName ? ($donorName . ' ') : '') . 'submitted a new donation: ' . ($payload['name'] ?? 'item'),
                    ]);
                }
            }
        } catch (Exception $e) {
            error_log('Failed to create admin notifications for donation: ' . $e->getMessage());
        }

        sendJson(['success' => true, 'donation_id' => $newId]);
    }

    // POST /api/donations/batch - create multiple items in one request
    if ($method === 'POST' && preg_match('#^/(batch|batch/)\z#', $sub)) {
        requireRole(['donor','admin']);
        $role = currentUserRole();
        $donorId = ($role === 'admin' && isset($_POST['donor_id']) && $_POST['donor_id'] !== '')
            ? (int)$_POST['donor_id']
            : (int)currentUserId();

        // Accept per-item arrays; fallback to single value if provided
        $typeSingle = isset($_POST['type']) && !is_array($_POST['type']) ? normalize_input($_POST['type']) : null;
        $typeArr = isset($_POST['type']) && is_array($_POST['type']) ? array_map('normalize_input', $_POST['type']) : [];
        // New: accept stable category_id[] in addition to label type[]
        $catIdSingle = isset($_POST['category_id']) && !is_array($_POST['category_id']) ? (int)$_POST['category_id'] : null;
        $catIdArr = isset($_POST['category_id']) && is_array($_POST['category_id']) ? array_map('intval', $_POST['category_id']) : [];

        $names = isset($_POST['name']) ? (array)$_POST['name'] : [];
        $quantities = isset($_POST['quantity']) ? (array)$_POST['quantity'] : [];
        $expiries = isset($_POST['expiry_date']) ? (array)$_POST['expiry_date'] : [];
        $units = isset($_POST['unit']) ? (array)$_POST['unit'] : [];
        $weights = isset($_POST['total_weight']) ? (array)$_POST['total_weight'] : [];
        $costs = isset($_POST['total_cost']) ? (array)$_POST['total_cost'] : [];
        $remarksItems = isset($_POST['remarks']) && is_array($_POST['remarks']) ? (array)$_POST['remarks'] : [];
        $remarks = isset($_POST['remarks']) && !is_array($_POST['remarks']) ? normalize_input((string)$_POST['remarks']) : null; // batch-level notes
        $count = max(count($names), count($quantities), count($expiries));
        if ($count === 0) { sendJson(['success' => false, 'error' => 'items are required'], 400); }

        // Enforce policy: do not accept images at donation creation/batch
        $receiptImageUrl = null;

        // Create a single batch id for this submission
        $batchId = generateUuidV4();
        // Ensure a batches row exists to satisfy FK and track batch status/notes
        try {
            $db = Database::getInstance();
            $db->query(
                "INSERT INTO batches (batch_id, donor_id, status, notes, created_at) VALUES (?, ?, 'Pending', ?, NOW())",
                [$batchId, $donorId, ($remarks !== null && $remarks !== '') ? $remarks : null]
            );
        } catch (Exception $e) {
            if (stripos($e->getMessage(), 'Duplicate') === false) { throw $e; }
        }

        // Determine per-item procurement types if provided (via procurement_type[])
        $procRaw = $_POST['procurement_type'] ?? null; // can be scalar or array depending on client
        $procArray = [];
        if (is_array($procRaw)) {
            $procArray = array_map(function($v){
                $x = strtolower(trim((string)$v));
                return ($x === 'purchased') ? 'purchased' : 'donated';
            }, $procRaw);
        }

        // Build groups by mode: if no per-item array, fall back to single scalar or default donated
        $scalarProc = null;
        if (!is_array($procRaw)) {
            $scalarProc = isset($procRaw) ? strtolower(trim((string)$procRaw)) : 'donated';
            if ($scalarProc !== 'purchased') { $scalarProc = 'donated'; }
        }

        $groups = ['donated' => [], 'purchased' => []];
        for ($i = 0; $i < $count; $i++) {
            $mode = $scalarProc ?? ($procArray[$i] ?? 'donated');
            if ($mode !== 'purchased') { $mode = 'donated'; }
            $groups[$mode][] = $i;
        }

        $itemIds = [];
        $missingMetaAlerts = [];
        foreach ($groups as $mode => $indices) {
            if (empty($indices)) continue;
            // Create a header for this mode
            $donationId = $service->createHeader([
                'donor_id' => $donorId,
                'batch_id' => $batchId,
                'remarks' => $remarks,
                'procurement_type' => $mode,
            ]);
            // Insert this group's items
            foreach ($indices as $i) {
                $name = isset($names[$i]) ? normalize_input($names[$i]) : null;
                $qty = isset($quantities[$i]) ? (int)$quantities[$i] : null;
                $expiryRaw = isset($expiries[$i]) ? $expiries[$i] : '';
                $expiry = ($expiryRaw === null || $expiryRaw === '') ? null : normalize_input($expiryRaw);
                $typeVal = isset($typeArr[$i]) ? normalize_input((string)$typeArr[$i]) : ($typeSingle ?? '');
                $catIdVal = isset($catIdArr[$i]) ? (int)$catIdArr[$i] : ($catIdSingle ?? null);
                $wVal = isset($weights[$i]) && $weights[$i] !== '' ? (float)$weights[$i] : null;
                $cVal = isset($costs[$i]) && $costs[$i] !== '' ? (float)$costs[$i] : null;
                $remarksVal = isset($remarksItems[$i]) ? normalize_input((string)$remarksItems[$i]) : null;
                $unitVal = isset($units[$i]) ? normalize_input((string)$units[$i]) : (isset($_POST['unit']) && !is_array($_POST['unit']) ? normalize_input((string)$_POST['unit']) : '');
                // Accept unit_id[] in addition to unit label
                $unitIdSingle = isset($_POST['unit_id']) && !is_array($_POST['unit_id']) ? (int)$_POST['unit_id'] : null;
                $unitIdArr = isset($_POST['unit_id']) && is_array($_POST['unit_id']) ? array_map('intval', $_POST['unit_id']) : [];
                $unitIdVal = isset($unitIdArr[$i]) ? (int)$unitIdArr[$i] : ($unitIdSingle ?? null);
                // Derive unit label from unit_id if label missing
                if (($unitVal === '' || $unitVal === null) && $unitIdVal) {
                    try {
                        $ur = Database::getInstance()->query('SELECT COALESCE(NULLIF(label,\'\'), code) AS name FROM units WHERE unit_id = ?', [$unitIdVal])->fetch();
                        if ($ur && !empty($ur['name'])) { $unitVal = $ur['name']; }
                    } catch (Exception $e) { /* ignore */ }
                }
                // Allow either label (type) or stable id (category_id)
                if ($typeVal === '' && $catIdVal) {
                    try {
                        $row = Database::getInstance()->query('SELECT primary_name, secondary_name FROM categories WHERE category_id = ?', [$catIdVal])->fetch();
                        if ($row) {
                            $typeVal = ($row['secondary_name'] !== null && $row['secondary_name'] !== '')
                                ? ($row['primary_name'] . ' - ' . $row['secondary_name'])
                                : $row['primary_name'];
                        }
                    } catch (Exception $e) { /* ignore */ }
                }
                if (!$name || !$qty || $qty < 1 || !$expiry) {
                    sendJson(['success' => false, 'error' => 'Invalid item at index ' . $i . ': name, quantity (>=1), and expiry_date are required'], 400);
                }
                $donationItemId = $service->addItem($donationId, [
                    'product_category' => $typeVal,
                    'product_name' => $name,
                    'quantity' => $qty,
                    'unit' => ($unitVal !== '' ? $unitVal : null),
                    'expiry_date' => $expiry,
                    'total_weight' => $wVal,
                    'total_cost' => $cVal,
                    'tags' => $remarksVal,
                    'category_id' => $catIdVal ?: null,
                    'unit_id' => $unitIdVal ?: null,
                ]);
                $itemIds[] = $donationItemId;

                // Collect metadata gaps for admin notification
                try {
                    $rowMeta = Database::getInstance()->query(
                        'SELECT category_id, unit_id, total_weight FROM donation_items WHERE donation_item_id = ?',
                        [$donationItemId]
                    )->fetch();
                    $missingFields = [];
                    if (!$rowMeta || $rowMeta['category_id'] === null) { $missingFields[] = 'Category'; }
                    if (!$rowMeta || $rowMeta['unit_id'] === null) { $missingFields[] = 'Unit'; }
                    if (!$rowMeta || $rowMeta['total_weight'] === null) { $missingFields[] = 'Weight'; }
                    if (!empty($missingFields)) {
                        $missingMetaAlerts[] = [
                            'donation_item_id' => $donationItemId,
                            'donation_id' => $donationId,
                            'name' => $name,
                            'missing' => $missingFields,
                        ];
                    }
                } catch (Exception $e) {
                    error_log('Failed to inspect donation metadata: ' . $e->getMessage());
                }
            }
        }

        if (!empty($missingMetaAlerts)) {
            try {
                $dbNotify = Database::getInstance();
                $admins = $dbNotify->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll();
                if ($admins) {
                    $notif = new Notification();
                    foreach ($missingMetaAlerts as $alert) {
                        $label = ($alert['name'] !== null && $alert['name'] !== '')
                            ? $alert['name']
                            : ('Donation #' . (int)$alert['donation_id']);
                        $missingLabel = implode(', ', $alert['missing']);
                        foreach ($admins as $admin) {
                            if (empty($admin['user_id'])) { continue; }
                            try {
                                $notif->create([
                                    'user_id' => (int)$admin['user_id'],
                                    'type' => 'data_missing',
                                    'reference_type' => 'donation_item',
                                    'reference_id' => (int)$alert['donation_item_id'],
                                    'message' => sprintf('Donation item "%s" is missing: %s.', $label, $missingLabel),
                                ]);
                            } catch (Exception $eNotif) {
                                error_log('Failed to create metadata notification: ' . $eNotif->getMessage());
                            }
                        }
                    }
                }
            } catch (Exception $e) {
                error_log('Failed to enqueue metadata notifications: ' . $e->getMessage());
            }
        }

        // If an admin submitted this batch, immediately convert to inventory so movements appear
        if ($role === 'admin') {
            try {
                $inventorySvc = new Inventory();
                $inventorySvc->addFromBatchId($batchId);
            } catch (Exception $e) {
                error_log('Auto inventory add from batch failed: ' . $e->getMessage());
            }
        }

        // Do not add to inventory at creation time; inventory should reflect physical pickup events.

        // Admins may still choose to mark completed; inventory will only be recorded on 'Picked Up'.
        if ($role === 'admin') {
            try {
                $service->updateStatusByBatch($batchId, 'Completed');
            } catch (Exception $e) {
                error_log('Failed to auto-complete admin donation batch: ' . $e->getMessage());
            }
            try {
                Database::getInstance()->query("UPDATE batches SET status = 'Completed' WHERE batch_id = ?", [$batchId]);
            } catch (Exception $e) {
                /* ignore batch status update errors */
            }
        }

        // Notify all approved admins once for the batch submission (donor-submitted only)
        if ($role !== 'admin') {
            try {
                $db = Database::getInstance();
                $admins = $db->query("SELECT user_id, name FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll();
                if ($admins) {
                    $notif = new Notification();
                    // Try to get donor org name (fallback to person name) for message context
                    $donorName = '';
                    try {
                        $row = $db->query("SELECT organization_name, name FROM users WHERE user_id = ?", [$donorId])->fetch();
                        if ($row) {
                            $donorName = !empty($row['organization_name']) ? $row['organization_name'] : (!empty($row['name']) ? $row['name'] : '');
                        }
                    } catch (Exception $e) { /* ignore */ }
                    $countItems = count($itemIds);
                    foreach ($admins as $admin) {
                        $notif->create([
                            'user_id' => (int)$admin['user_id'],
                            'type' => 'donation_created',
                            'reference_type' => 'batch',
                            'reference_id' => null,
                            'message' => ($donorName ? ($donorName . ' ') : '') . 'submitted a new donation batch (' . $countItems . ' items)',
                        ]);
                    }
                }
            } catch (Exception $e) {
                error_log('Failed to create admin notifications for donation batch: ' . $e->getMessage());
            }
        }

        sendJson(['success' => true, 'donation_id' => (int)$donationId, 'item_ids' => $itemIds, 'created_count' => count($itemIds), 'batch_id' => $batchId]);
    }

    // GET /api/donations/list?status=pending&donor_id=12
    // Admin: can filter by status and/or donor_id; Donor: only own donations
    if ($method === 'GET' && preg_match('#^/(list|list/)\z#', $sub)) {
        $role = currentUserRole();
        if ($role === 'admin') {
            $status = $_GET['status'] ?? null;
            $donorId = isset($_GET['donor_id']) ? (int)$_GET['donor_id'] : null;
            $group = isset($_GET['group']) ? $_GET['group'] : null; // e.g., 'batch'
            $items = $service->list(['status' => $status, 'donor_id' => $donorId, 'group' => $group]);
        } elseif ($role === 'donor') {
            requireRole(['donor']);
            $items = $service->list(['donor_id' => (int)currentUserId()]);
        } else {
            sendJson(['success' => false, 'error' => 'Forbidden'], 403);
        }
        // Attach absolute image URL and always attach the latest food safety receipt URL (receipt_full_url)
        $db = Database::getInstance();
        foreach ($items as &$it) {
            // Latest food safety receipt (by batch or donation)
            $receiptFull = '';
            if (!empty($it['batch_id'])) {
                $row = $db->query(
                    "SELECT receipt_image FROM food_safety_checks WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1",
                    [$it['batch_id']]
                )->fetch();
                if ($row && !empty($row['receipt_image'])) {
                    $receiptFull = buildImageFullUrl($row['receipt_image']);
                }
            } else if (!empty($it['id'])) {
                $row = $db->query(
                    "SELECT receipt_image FROM food_safety_checks WHERE donation_id = ? ORDER BY created_at DESC LIMIT 1",
                    [(int)$it['id']]
                )->fetch();
                if ($row && !empty($row['receipt_image'])) {
                    $receiptFull = buildImageFullUrl($row['receipt_image']);
                }
            }

            // New behavior: image_full_url is the latest receipt for display purposes
            $it['image_full_url'] = $receiptFull;
            // Always include explicit receipt_full_url for front-end
            if ($receiptFull !== '') { $it['receipt_full_url'] = $receiptFull; }

            // Attach latest food safety result and fail reason (if any)
            $reason = null; $result = null;
            if (!empty($it['batch_id'])) {
                $row = $db->query(
                    "SELECT result, fail_reason FROM food_safety_checks WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1",
                    [$it['batch_id']]
                )->fetch();
                if ($row) { $result = $row['result'] ?? null; $reason = $row['fail_reason'] ?? null; }
            } else if (!empty($it['id'])) {
                $row = $db->query(
                    "SELECT result, fail_reason FROM food_safety_checks WHERE donation_id = ? ORDER BY created_at DESC LIMIT 1",
                    [(int)$it['id']]
                )->fetch();
                if ($row) { $result = $row['result'] ?? null; $reason = $row['fail_reason'] ?? null; }
            }
            if ($result !== null) { $it['safety_result'] = $result; }
            if ($reason !== null && $reason !== '') { $it['fail_reason'] = $reason; }

            // Attach cancellation reason if Cancelled
            if (($it['status'] ?? '') === 'Cancelled') {
                $row = $db->query(
                    "SELECT reason FROM donation_cancellations WHERE donation_id = ? ORDER BY created_at DESC LIMIT 1",
                    [(int)$it['id']]
                )->fetch();
                if ($row && !empty($row['reason'])) { $it['cancel_reason'] = $row['reason']; }
            }
        }
        sendJson(['success' => true, 'data' => ['items' => $items]]);
    }

    // PUT /api/donations/batch/{batch_id}/edit (method override via POST supported)
    // Accept both UUID and non-UUID batch ids (up to 64 chars, no slashes)
    if ($method === 'PUT' && preg_match('#^/batch/([^/]{1,64})/edit/?\z#', $sub, $m)) {
        // Only donors can edit donation content; admins cannot edit items
        requireRole(['donor']);
        $batchId = $m[1];
        $input = getJsonInput();
        $type = isset($input['type']) && $input['type'] !== '' ? sanitize($input['type']) : null; // nullable (keep if null)
        $items = isset($input['items']) && is_array($input['items']) ? $input['items'] : [];
        if (!$items) { sendJson(['success'=>false,'error'=>'items are required'],400); }
        // Validate each item fields (id is optional to allow new rows; backend will insert when id is 0/absent)
        foreach ($items as $idx => $it) {
            if (!isset($it['name']) || !isset($it['quantity']) || !isset($it['expiry_date']) || $it['name']==='' || (int)$it['quantity']<1 || $it['expiry_date']===''){
                sendJson(['success'=>false,'error'=>'Invalid item at index '.$idx],400);
            }
            // Normalize missing id to 0
            if (!isset($it['id'])) { $input['items'][$idx]['id'] = 0; }
        }
        $editor = new DonationEditor();
        $role = currentUserRole();
        $uid = (int)currentUserId();
        // Prepare diff details before update
        $diffSummary = '';
        try {
            $db = Database::getInstance();
            $before = $db->query(
                "SELECT di.donation_item_id AS id, di.product_name AS name, di.quantity, di.expiry_date
                   FROM donation_items di
                   INNER JOIN donations d ON d.donation_id = di.donation_id
                  WHERE d.batch_id = ?",
                [$batchId]
            )->fetchAll();
            $byId = [];
            foreach ($before as $b) { $byId[(int)$b['id']] = $b; }
            // Admin override disabled for content edits
            $editor->assertBatchEditable($batchId, $uid, false);
            $editor->updateBatchFields($batchId, $type, $input['items']);
            // Build diff summary (names/quantities changes and new items)
            $changes = [];
            foreach ($input['items'] as $it) {
                $iid = isset($it['id']) ? (int)$it['id'] : 0;
                $nm = isset($it['name']) ? trim((string)$it['name']) : '';
                $qt = isset($it['quantity']) ? (int)$it['quantity'] : null;
                if ($iid > 0 && isset($byId[$iid])) {
                    $prev = $byId[$iid];
                    if (isset($prev['name']) && $nm !== '' && $nm !== (string)$prev['name']) {
                        $changes[] = 'Name: ' . ($prev['name'] ?? '') . ' -> ' . $nm;
                    }
                    if ($qt !== null && $qt !== (int)$prev['quantity']) {
                        $changes[] = 'Quantity: ' . ((int)$prev['quantity']) . ' -> ' . $qt;
                    }
                } else if ($iid === 0) {
                    $label = $nm !== '' ? ($nm . ($qt ? (' x' . $qt) : '')) : 'New item';
                    $changes[] = 'New item added: ' . $label;
                }
            }
            if (!empty($changes)) { $diffSummary = implode('; ', array_slice($changes, 0, 5)); }
        } catch (Exception $e) {
            $msg = $e->getMessage();
            $code = ($msg === 'Not found') ? 404 : (($msg === 'Forbidden') ? 403 : 400);
            sendJson(['success'=>false,'error'=>$msg], $code);
        }
        // Notify admins if donor edited the batch
        if ($role === 'donor') {
            try { (new DonationNotifier())->notifyBatchEdited($batchId, $uid, count($items), $diffSummary); } catch (Exception $e) { error_log('Notify batch edited failed: '.$e->getMessage()); }
        }
        sendJson(['success'=>true,'message'=>'Batch updated']);
    }

    // GET /api/donations/items?q=apple&limit=20
    if ($method === 'GET' && preg_match('#^/(items|items/)\z#', $sub)) {
        // Donors and admins can search names
        requireRole(['donor','admin']);
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 20; // 1..100
        $category = isset($_GET['category']) ? trim((string)$_GET['category']) : '';
        $categoryId = isset($_GET['category_id']) && $_GET['category_id'] !== '' ? (int)$_GET['category_id'] : null;
        $items = [];
        try {
            $db = Database::getInstance();
            // Prefer normalized schema: inventory -> donation_items
            $params = [];
            $where = "WHERE di.product_name IS NOT NULL AND di.product_name <> ''";
            if ($categoryId !== null) {
                $where .= " AND di.category_id = ?";
                $params[] = $categoryId;
            } else if ($category !== '') { // legacy label filtering via categories join
                $catFull = preg_replace('/\s+/', ' ', trim($category));
                $hasSecondary = (strpos($catFull, ' - ') !== false);
                $where .= " AND (LOWER(CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), ''))) = LOWER(?)";
                $params[] = $catFull;
                if (!$hasSecondary) { // primary-only, include subcategories
                    $where .= " OR LOWER(CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), ''))) LIKE LOWER(?)";
                    $params[] = $catFull . ' - %';
                }
                $where .= ")";
            }
            if ($q !== '') { $where .= " AND di.product_name LIKE ?"; $params[] = ('%'.$q.'%'); }
            $sql = "SELECT DISTINCT di.product_name AS name
                      FROM inventory inv
                      INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                      LEFT JOIN categories c ON c.category_id = di.category_id
                      $where
                      ORDER BY name ASC
                      LIMIT $limit";
            $rows = $db->query($sql, $params)->fetchAll();
            foreach ($rows as $r) {
                $n = isset($r['name']) ? trim((string)$r['name']) : '';
                if ($n !== '') { $items[] = $n; }
            }
        } catch (Exception $e) {
            error_log('items endpoint inventory query failed: ' . $e->getMessage());
        }
        // Fallback to donations-based search if inventory is empty
        if (empty($items)) {
            try {
                // Fallback to donation_items directly when service is unavailable or returns none
                $db = Database::getInstance();
                $params = [];
                $where = "WHERE di.product_name IS NOT NULL AND di.product_name <> ''";
                if ($categoryId !== null) {
                    $where .= " AND di.category_id = ?";
                    $params[] = $categoryId;
                } else if ($category !== '') {
                    $catFull = preg_replace('/\s+/', ' ', trim($category));
                    $hasSecondary = (strpos($catFull, ' - ') !== false);
                    $where .= " AND (LOWER(CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), ''))) = LOWER(?)";
                    $params[] = $catFull;
                    if (!$hasSecondary) {
                        $where .= " OR LOWER(CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), ''))) LIKE LOWER(?)";
                        $params[] = $catFull . ' - %';
                    }
                    $where .= ")";
                }
                if ($q !== '') { $where .= " AND di.product_name LIKE ?"; $params[] = ('%'.$q.'%'); }
                $rows = $db->query("SELECT DISTINCT di.product_name AS name FROM donation_items di LEFT JOIN categories c ON c.category_id = di.category_id $where ORDER BY name ASC LIMIT $limit", $params)->fetchAll();
                $names = array_map(function($r){ return trim((string)($r['name'] ?? '')); }, $rows ?: []);
                if (is_array($names)) { $items = $names; }
            } catch (Exception $e) {
                error_log('items endpoint donations fallback failed: ' . $e->getMessage());
            }
        }
        // Simple list response; front-end maps to Select2 results
        sendJson(['success' => true, 'items' => $items]);
    }

    // GET /api/donations/categories - list distinct categories from normalized schema; fallback to donations
    if ($method === 'GET' && preg_match('#^/(categories|categories/)\z#', $sub)) {
        requireRole(['donor','admin']);
        $cats = [];
        try {
            $db = Database::getInstance();
            // Optional client search term (Select2 may send 'term' or we pass 'q')
            $term = isset($_GET['q']) ? trim((string)$_GET['q']) : (isset($_GET['term']) ? trim((string)$_GET['term']) : '');
            // Prefer categories from donation_items (normalized)
            if ($term !== '') {
                $like = '%' . $term . '%';
                $rows = $db->query("SELECT DISTINCT CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS category FROM donation_items di LEFT JOIN categories c ON c.category_id = di.category_id WHERE di.category_id IS NOT NULL AND CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) LIKE ? ORDER BY category ASC", [$like])->fetchAll();
            } else {
                $rows = $db->query("SELECT DISTINCT CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS category FROM donation_items di LEFT JOIN categories c ON c.category_id = di.category_id WHERE di.category_id IS NOT NULL ORDER BY category ASC")->fetchAll();
            }
            foreach ($rows as $r) {
                $t = isset($r['category']) ? trim((string)$r['category']) : '';
                if ($t !== '') { $cats[] = $t; }
            }
            // If none, fallback to donations.type
            if (empty($cats)) {
                if ($term !== '') {
                    $like = '%' . $term . '%';
                    $rows2 = $db->query("SELECT DISTINCT type FROM donations WHERE type IS NOT NULL AND type <> '' AND type LIKE ? ORDER BY type ASC", [$like])->fetchAll();
                } else {
                    $rows2 = $db->query("SELECT DISTINCT type FROM donations WHERE type IS NOT NULL AND type <> '' ORDER BY type ASC")->fetchAll();
                }
                foreach ($rows2 as $r) {
                    $t = isset($r['type']) ? trim((string)$r['type']) : '';
                    if ($t !== '') { $cats[] = $t; }
                }
            }
        } catch (Exception $e) {
            error_log('categories endpoint failed: ' . $e->getMessage());
            // fall through with empty list
        }
        sendJson(['success' => true, 'items' => $cats]);
    }

    // GET /api/donations/debug?id=123 OR /api/donations/debug?batch=<uuid>
    // Read-only diagnostics to verify how image URLs are resolved for a specific record
    if ($method === 'GET' && preg_match('#^/(debug|debug/)\z#', $sub)) {
        requireRole(['admin']);
        $db = Database::getInstance();
        $id = isset($_GET['id']) && $_GET['id'] !== '' ? (int)$_GET['id'] : null;
        $batch = isset($_GET['batch']) && $_GET['batch'] !== '' ? sanitize($_GET['batch']) : null;
        if (!$id && !$batch) {
            sendJson(['success' => false, 'error' => 'Provide id or batch'], 400);
        }
        $out = [
            'input' => ['id' => $id, 'batch' => $batch],
            'latest_receipt' => null,
            'receipt_full_url' => '',
            'fs' => [ 'receipt_image_exists' => null ],
        ];
        if ($id) {
            $row = $db->query(
                "SELECT receipt_image, created_at FROM food_safety_checks WHERE donation_id = ? ORDER BY created_at DESC LIMIT 1",
                [$id]
            )->fetch();
            if ($row) {
                $out['latest_receipt'] = $row;
                $out['receipt_full_url'] = buildImageFullUrl($row['receipt_image'] ?? '');
                if (!empty($row['receipt_image'])) {
                    $rel = ltrim($row['receipt_image'], '/');
                    $path = __DIR__ . '/../../../' . $rel;
                    $out['fs']['receipt_image_exists'] = file_exists($path);
                }
            }
            sendJson(['success' => true, 'data' => $out]);
        }
        if ($batch) {
            $row = $db->query(
                "SELECT receipt_image, created_at FROM food_safety_checks WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1",
                [$batch]
            )->fetch();
            if ($row) {
                $out['latest_receipt'] = $row;
                $out['receipt_full_url'] = buildImageFullUrl($row['receipt_image'] ?? '');
                if (!empty($row['receipt_image'])) {
                    $rel = ltrim($row['receipt_image'], '/');
                    $path = __DIR__ . '/../../../' . $rel;
                    $out['fs']['receipt_image_exists'] = file_exists($path);
                }
            }
            sendJson(['success' => true, 'data' => $out]);
        }
    }

    // GET /api/donations/{id}
    if ($method === 'GET' && preg_match('#^/(\d+)\/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $row = $service->getById($id);
        if (!$row) {
            sendJson(['success' => false, 'error' => 'Not found'], 404);
        }
        // Attach latest receipt URL for this donation id
        try {
            $db = Database::getInstance();
            $r = $db->query(
                "SELECT receipt_image FROM food_safety_checks WHERE donation_id = ? ORDER BY created_at DESC LIMIT 1",
                [$id]
            )->fetch();
            if ($r && !empty($r['receipt_image'])) {
                $row['image_full_url'] = buildImageFullUrl($r['receipt_image']);
                $row['receipt_full_url'] = $row['image_full_url'];
            }
            // Also attach latest food safety result and fail reason for this donation id
            $fs = $db->query(
                "SELECT result, fail_reason FROM food_safety_checks WHERE donation_id = ? ORDER BY created_at DESC LIMIT 1",
                [$id]
            )->fetch();
            if ($fs && isset($fs['result']) && $fs['result'] !== null) {
                $row['safety_result'] = $fs['result'];
            }
            if ($fs && isset($fs['fail_reason']) && $fs['fail_reason'] !== null && $fs['fail_reason'] !== '') {
                $row['fail_reason'] = $fs['fail_reason'];
            }
        } catch (Exception $e) { /* ignore */ }
        sendJson(['success' => true, 'data' => $row]);
    }

    // PUT /api/donations/{id}/status
    if ($method === 'PUT' && preg_match('#^/(\d+)/(status|status/)\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $input = getJsonInput();
        $status = isset($input['status']) ? sanitize($input['status']) : '';
        if ($status === '') { sendJson(['success' => false, 'error' => 'Status is required'], 400); }
        $service = new Donation();
        try {
            $service->updateStatus($id, $status);
        } catch (Exception $e) {
            $msg = $e->getMessage();
            $code = ($msg === 'Not found') ? 404 : 400;
            sendJson(['success' => false, 'error' => $msg], $code);
        }
        // Only when moved to 'Picked Up', ensure inventory contains it
        if ($status === 'Picked Up') {
            try { (new Inventory())->addFromDonationId($id); } catch (Exception $e) { error_log('Inventory add on status (single) failed: '.$e->getMessage()); }
        }
        // Stamp admin_in_charge on first admin action if not already set
        try {
            $db = Database::getInstance();
            $adminId = (int)currentUserId();
            $db->query("UPDATE donations SET admin_in_charge = COALESCE(admin_in_charge, ?) WHERE donation_id = ?", [$adminId, $id]);
        } catch (Exception $e) { /* ignore */ }
        // Centralized notification
        try { (new DonationNotifier())->notifyDonationStatus($id, $status); } catch (Exception $e) { error_log('Notify failed: '.$e->getMessage()); }

        sendJson(['success' => true, 'message' => 'Status updated']);
    }

    // PUT /api/donations/{id} - donor/admin can edit fields of a Pending donation
    if ($method === 'PUT' && preg_match('#^/(\d+)\/?\z#', $sub, $m)) {
        // Only donors can edit donation content; admins cannot edit items
        requireRole(['donor']);
        $id = (int)$m[1];
        $input = getJsonInput();
        $editor = new DonationEditor();
        $role = currentUserRole();
        $userId = (int)currentUserId();
        try {
            // Fetch before snapshot for diff
            $db = Database::getInstance();
            $prev = $db->query("SELECT product_name AS name, quantity, expiry_date FROM donations WHERE donation_id = ?", [$id])->fetch();
            // Admin override disabled for content edits
            $editor->assertEditable($id, $userId, false);
            $fields = [];
            foreach (['type','name','quantity','expiry_date'] as $k) {
                if (array_key_exists($k, $input)) { $fields[$k] = $input[$k]; }
            }
            // Require expiry_date
            if (!isset($fields['expiry_date']) || $fields['expiry_date'] === '' || $fields['expiry_date'] === null) {
                sendJson(['success' => false, 'error' => 'expiry_date is required'], 400);
            }
            $editor->updateFields($id, $fields);
            // Build change details
            $detailsParts = [];
            if ($prev) {
                if (isset($fields['name']) && trim((string)$fields['name']) !== (string)$prev['name']) {
                    $detailsParts[] = 'Name: ' . ($prev['name'] ?? '') . ' -> ' . trim((string)$fields['name']);
                }
                if (isset($fields['quantity'])) {
                    $newQ = (int)$fields['quantity'];
                    $oldQ = (int)$prev['quantity'];
                    if ($newQ !== $oldQ) { $detailsParts[] = 'Quantity: ' . $oldQ . ' -> ' . $newQ; }
                }
                // We typically don't notify on expiry date changes in detail, but could be added:
                // if (isset($fields['expiry_date']) && $fields['expiry_date'] !== $prev['expiry_date']) { ... }
            }
            $details = implode('; ', array_slice($detailsParts, 0, 5));
        } catch (Exception $e) {
            $msg = $e->getMessage();
            $code = ($msg === 'Not found') ? 404 : (($msg === 'Forbidden') ? 403 : 400);
            sendJson(['success' => false, 'error' => $msg], $code);
        }
        // Notify admins if donor edited a donation
        if ($role === 'donor') {
            try { (new DonationNotifier())->notifyDonationEdited($id, $userId, $details ?? ''); } catch (Exception $e) { error_log('Notify donation edited failed: '.$e->getMessage()); }
        }
        sendJson(['success' => true, 'message' => 'Donation updated']);
    }

    // POST /api/donations/{id}/cancel - donor/admin cancel a Pending donation with reason
    if ($method === 'POST' && preg_match('#^/(\d+)/cancel/?\z#', $sub, $m)) {
        requireRole(['donor','admin']);
        $id = (int)$m[1];
        $input = getJsonInput();
        $reason = isset($input['reason']) ? trim((string)$input['reason']) : '';
        if ($reason === '') { sendJson(['success' => false, 'error' => 'Reason is required'], 400); }
        $editor = new DonationEditor();
        $role = currentUserRole();
        $userId = (int)currentUserId();
        try {
            $editor->assertEditable($id, $userId, $role === 'admin');
            $editor->cancel($id, $userId, $reason);
        } catch (Exception $e) {
            $msg = $e->getMessage();
            $code = ($msg === 'Not found') ? 404 : (($msg === 'Forbidden') ? 403 : 400);
            sendJson(['success' => false, 'error' => $msg], $code);
        }
        // Centralized notification on cancellation
        try { (new DonationNotifier())->notifyDonationStatus($id, 'Cancelled', ['actor_role' => $role, 'reason' => $reason]); } catch (Exception $e) { error_log('Cancellation notify failed: '.$e->getMessage()); }
        sendJson(['success' => true, 'message' => 'Donation cancelled']);
    }

    // DELETE /api/donations/{id}
    if ($method === 'DELETE' && preg_match('#^/(\d+)\/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $service->delete($id);
        sendJson(['success' => true, 'message' => 'Donation archived']);
    }

    // GET /api/donations/batch/{batch_id}
    // Accept both UUID and non-UUID batch ids (up to 64 chars, no slashes)
    if ($method === 'GET' && preg_match('#^/batch/([^/]{1,64})/?\z#', $sub, $m)) {
        requireRole(['admin','donor']);
        $batchId = $m[1];
        $items = $service->listByBatch($batchId);
        // If donor, ensure they own this batch
        if (currentUserRole() === 'donor') {
            $uid = (int)currentUserId();
            foreach ($items as $it) {
                if ((int)$it['donor_id'] !== $uid) { sendJson(['success'=>false,'error'=>'Forbidden'],403); }
            }
        }
        // Attach latest receipt URL for the batch (same for each item for convenience)
        try {
            $db = Database::getInstance();
            $r = $db->query(
                "SELECT receipt_image FROM food_safety_checks WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1",
                [$batchId]
            )->fetch();
            $full = '';
            if ($r && !empty($r['receipt_image'])) { $full = buildImageFullUrl($r['receipt_image']); }
            if ($full !== '') {
                foreach ($items as &$it) { $it['image_full_url'] = $full; $it['receipt_full_url'] = $full; }
            }
        } catch (Exception $e) { /* ignore */ }
        // Attach cancellation reason for each Cancelled item
        try {
            $db = Database::getInstance();
            foreach ($items as &$it) {
                if (($it['status'] ?? '') === 'Cancelled') {
                    $row = $db->query(
                        "SELECT reason FROM donation_cancellations WHERE donation_id = ? ORDER BY created_at DESC LIMIT 1",
                        [(int)$it['id']]
                    )->fetch();
                    if ($row && !empty($row['reason'])) { $it['cancel_reason'] = $row['reason']; }
                }
            }
        } catch (Exception $e) { /* ignore */ }
        sendJson(['success' => true, 'data' => ['items' => $items]]);
    }

    // PUT /api/donations/batch/{batch_id}/status
    // Accept both UUID and non-UUID batch ids (up to 64 chars, no slashes)
    if ($method === 'PUT' && preg_match('#^/batch/([^/]{1,64})/status/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $batchId = $m[1];
        $input = getJsonInput();
        $status = $input['status'] ?? '';
        $service->updateStatusByBatch($batchId, $status);
        // Also reflect status in batches table
        try {
            $db = Database::getInstance();
            $db->query("UPDATE batches SET status = ? WHERE batch_id = ?", [$status, $batchId]);
        } catch (Exception $e) { /* ignore */ }
        // Stamp admin_in_charge for all items in this batch if not already set
        try {
            $db = Database::getInstance();
            $adminId = (int)currentUserId();
            $db->query("UPDATE donations SET admin_in_charge = COALESCE(admin_in_charge, ?) WHERE batch_id = ?", [$adminId, $batchId]);
        } catch (Exception $e) { /* ignore */ }
        // Centralized notification
        try { (new DonationNotifier())->notifyBatchStatus($batchId, $status); } catch (Exception $e) { error_log('Batch notify failed: '.$e->getMessage()); }

        sendJson(['success' => true]);
    }

    // DELETE /api/donations/batch/{batch_id}
    // Accept both UUID and non-UUID batch ids (up to 64 chars, no slashes)
    if ($method === 'DELETE' && preg_match('#^/batch/([^/]{1,64})/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $batchId = $m[1];
        $service->deleteByBatch($batchId);
        sendJson(['success' => true, 'message' => 'Batch archived']);
    }

    // POST /api/donations/ocr
    if ($method === 'POST' && preg_match('#^/ocr/?\z#', $sub, $m)) {
        requireRole(['admin', 'donor']);
        $input = getJsonInput();
        $file = $_FILES['file'] ?? null;
        if (!$file) {
            sendJson(['success' => false, 'error' => 'File is required'], 400);
        }
        if ($file['error'] !== UPLOAD_ERR_OK) {
            sendJson(['success' => false, 'error' => 'Upload error'], 400);
        }
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);
        if ($mime !== 'text/plain') {
            sendJson(['success' => false, 'error' => 'Only text files are supported for now'], 400);
        }
        $content = file_get_contents($file['tmp_name']);
        $items = [];
        $lines = explode("\n", $content);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line) {
                $items[] = $line;
            }
        }
        sendJson(['success' => true, 'data' => $items]);
    }

    // Fallback
    sendJson(['success' => false, 'error' => 'Endpoint not found'], 404);
}
 catch (Exception $e) {
    // Log detailed error server-side only
    error_log('Donations API error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    // Return a generic error message to clients
    sendJson(['success' => false, 'error' => 'Internal server error'], 500);
}
function readCreatePayload(): array {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
    if (stripos($contentType, 'application/json') !== false) {
        $in = getJsonInput();
        // Normalize optional remarks
        if (isset($in['remarks'])) { $in['remarks'] = sanitize((string)$in['remarks']); }
        return $in;
    }
    // multipart/form-data support
    $payload = [
        'donor_id' => $_POST['donor_id'] ?? null,
        'type' => $_POST['type'] ?? null,
        'name' => $_POST['name'] ?? null,
        'quantity' => $_POST['quantity'] ?? null,
        'expiry_date' => $_POST['expiry_date'] ?? null,
        'remarks' => isset($_POST['remarks']) ? sanitize((string)$_POST['remarks']) : null,
    ];
    return $payload;
}

function saveUploadedImage(array $file): string {
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new Exception('Upload error');
    }
    // Raise raw upload size limit (accept larger phone photos)
    $maxBytes = 15 * 1024 * 1024; // 15 MB
    if (isset($file['size']) && $file['size'] > $maxBytes) {
        throw new Exception('Image too large');
    }
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    $allowed = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/gif' => 'gif',
    ];
    if (!isset($allowed[$mime])) {
        throw new Exception('Unsupported image type');
    }
    $dir = __DIR__ . '/../../../images/uploads/donations';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }

    // Compress and resize on the server
    $maxDim = 1600; // cap larger side
    $quality = 80;  // JPEG quality

    // Load source image
    switch ($mime) {
        case 'image/jpeg':
            $src = imagecreatefromjpeg($file['tmp_name']);
            break;
        case 'image/png':
            $src = imagecreatefrompng($file['tmp_name']);
            break;
        case 'image/gif':
            $src = imagecreatefromgif($file['tmp_name']);
            break;
        default:
            $src = null;
    }
    if (!$src) {
        throw new Exception('Failed to read image');
    }
    $w = imagesx($src);
    $h = imagesy($src);
    $scale = 1.0;
    $maxSide = max($w, $h);
    if ($maxSide > $maxDim) {
        $scale = $maxDim / $maxSide;
    }
    $nw = max(1, (int)round($w * $scale));
    $nh = max(1, (int)round($h * $scale));
    $dst = imagecreatetruecolor($nw, $nh);
    // Fill white background for formats with transparency when converting to JPEG
    $white = imagecolorallocate($dst, 255, 255, 255);
    imagefill($dst, 0, 0, $white);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    imagedestroy($src);

    // Always save as JPEG to reduce size
    $filename = 'donation_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.jpg';
    $dest = $dir . '/' . $filename;
    if (!imagejpeg($dst, $dest, $quality)) {
        imagedestroy($dst);
        throw new Exception('Failed to save image');
    }
    imagedestroy($dst);
    return 'images/uploads/donations/' . $filename;
}

