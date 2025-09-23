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

        // Validate required fields (expiry_date required)
        $required = ['type','name','quantity','expiry_date'];
        foreach ($required as $f) {
            if (!isset($payload[$f]) || $payload[$f] === '') {
                sendJson(['success' => false, 'error' => $f . ' is required'], 400);
            }
        }

        // Enforce policy: no images at donation creation (images are uploaded by admin during Food Safety)
        $payload['image_url'] = null;

        // Sanitize basic strings (not base64)
        $payload['type'] = sanitize($payload['type']);
        $payload['name'] = sanitize($payload['name']);
        $payload['expiry_date'] = sanitize($payload['expiry_date']);

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
        $typeSingle = isset($_POST['type']) && !is_array($_POST['type']) ? sanitize($_POST['type']) : null;
        $typeArr = isset($_POST['type']) && is_array($_POST['type']) ? array_map('sanitize', $_POST['type']) : [];

        $names = isset($_POST['name']) ? (array)$_POST['name'] : [];
        $quantities = isset($_POST['quantity']) ? (array)$_POST['quantity'] : [];
        $expiries = isset($_POST['expiry_date']) ? (array)$_POST['expiry_date'] : [];
        $weights = isset($_POST['total_weight']) ? (array)$_POST['total_weight'] : [];
        $costs = isset($_POST['total_cost']) ? (array)$_POST['total_cost'] : [];
        $remarksItems = isset($_POST['remarks']) && is_array($_POST['remarks']) ? (array)$_POST['remarks'] : [];
        $remarks = isset($_POST['remarks']) && !is_array($_POST['remarks']) ? sanitize((string)$_POST['remarks']) : null; // batch-level notes
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
            // If batch already exists, ignore; otherwise bubble up
            if (stripos($e->getMessage(), 'Duplicate') === false) { throw $e; }
        }

        // Insert items sequentially
        $ids = [];
        for ($i = 0; $i < $count; $i++) {
            $name = isset($names[$i]) ? sanitize($names[$i]) : null;
            $qty = isset($quantities[$i]) ? (int)$quantities[$i] : null;
            $expiryRaw = isset($expiries[$i]) ? $expiries[$i] : '';
            $expiry = ($expiryRaw === null || $expiryRaw === '') ? null : sanitize($expiryRaw);
            $typeVal = isset($typeArr[$i]) ? sanitize((string)$typeArr[$i]) : ($typeSingle ?? '');
            $wVal = isset($weights[$i]) && $weights[$i] !== '' ? (float)$weights[$i] : null;
            $cVal = isset($costs[$i]) && $costs[$i] !== '' ? (float)$costs[$i] : null;
            $remarksVal = isset($remarksItems[$i]) ? sanitize((string)$remarksItems[$i]) : null;
            if (!$name || !$qty || $qty < 1 || !$expiry || $typeVal === '') {
                sendJson(['success' => false, 'error' => 'Invalid item at index ' . $i . ': name, category, quantity (>=1), and expiry_date are required'], 400);
            }

            $payload = [
                'donor_id' => $donorId,
                'batch_id' => $batchId,
                'type' => $typeVal,
                'name' => $name,
                'quantity' => $qty,
                'expiry_date' => $expiry,
                'remarks' => $remarksVal,
                'total_weight' => $wVal,
                'total_cost' => $cVal,
            ];
            $ids[] = $service->create($payload);
        }

        // Notify all approved admins once for the batch submission
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
                $countItems = count($ids);
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

        sendJson(['success' => true, 'created_ids' => $ids, 'created_count' => count($ids), 'batch_id' => $batchId]);
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
                "SELECT donation_id AS id, product_name AS name, quantity, expiry_date FROM donations WHERE batch_id = ?",
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
        $q = isset($_GET['q']) ? sanitize($_GET['q']) : '';
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
        $category = isset($_GET['category']) ? sanitize((string)$_GET['category']) : null;
        $names = $service->searchItemNames($q, $limit, $category);
        // Simple list response; front-end maps to Select2 results
        sendJson(['success' => true, 'items' => $names]);
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
        // If moved to Picked Up or Completed, ensure inventory contains it
        if ($status === 'Picked Up' || $status === 'Completed') {
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

