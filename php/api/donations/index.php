<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Donation.php';
require_once __DIR__ . '/../../core/Notification.php';

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

        // Validate required fields
        $required = ['type','name','quantity'];
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
        $payload['expiry_date'] = !empty($payload['expiry_date']) ? sanitize($payload['expiry_date']) : null;

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

        $type = isset($_POST['type']) ? sanitize($_POST['type']) : null;
        if (!$type) { sendJson(['success' => false, 'error' => 'type is required'], 400); }

        $names = isset($_POST['name']) ? (array)$_POST['name'] : [];
        $quantities = isset($_POST['quantity']) ? (array)$_POST['quantity'] : [];
        $expiries = isset($_POST['expiry_date']) ? (array)$_POST['expiry_date'] : [];
        $count = max(count($names), count($quantities), count($expiries));
        if ($count === 0) { sendJson(['success' => false, 'error' => 'items are required'], 400); }

        // Enforce policy: do not accept images at donation creation/batch
        $receiptImageUrl = null;

        // Create a single batch id for this submission
        $batchId = generateUuidV4();

        // Insert items sequentially
        $ids = [];
        for ($i = 0; $i < $count; $i++) {
            $name = isset($names[$i]) ? sanitize($names[$i]) : null;
            $qty = isset($quantities[$i]) ? (int)$quantities[$i] : null;
            $expiry = isset($expiries[$i]) && $expiries[$i] !== '' ? sanitize($expiries[$i]) : null;
            if (!$name || !$qty || $qty < 1) {
                sendJson(['success' => false, 'error' => 'Invalid item at index ' . $i], 400);
            }

            $payload = [
                'donor_id' => $donorId,
                'batch_id' => $batchId,
                'type' => $type,
                'name' => $name,
                'quantity' => $qty,
                'expiry_date' => $expiry,
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
        }
        sendJson(['success' => true, 'data' => ['items' => $items]]);
    }

    // GET /api/donations/items?q=apple&limit=20
    if ($method === 'GET' && preg_match('#^/(items|items/)\z#', $sub)) {
        // Donors and admins can search names
        requireRole(['donor','admin']);
        $q = isset($_GET['q']) ? sanitize($_GET['q']) : '';
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
        $names = $service->searchItemNames($q, $limit);
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
        } catch (Exception $e) { /* ignore */ }
        sendJson(['success' => true, 'data' => $row]);
    }

    // PUT /api/donations/{id}/status
    if ($method === 'PUT' && preg_match('#^/(\d+)/status\/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $data = getJsonInput();
        $status = $data['status'] ?? '';
        if ($status === '') {
            sendJson(['success' => false, 'error' => 'status is required'], 400);
        }
        $service->updateStatus($id, $status);

        // Notify donor about status update
        try {
            $db = Database::getInstance();
            $row = $db->query("SELECT d.id, d.name, d.donor_id, u.name AS donor_name FROM donations d JOIN users u ON u.user_id = d.donor_id WHERE d.id = ?", [$id])->fetch();
            if ($row && !empty($row['donor_id'])) {
                $notif = new Notification();
                $notif->create([
                    'user_id' => (int)$row['donor_id'],
                    'type' => 'status_updated',
                    'reference_type' => 'donation',
                    'reference_id' => (int)$id,
                    'message' => 'Donation "' . ($row['name'] ?? ('#'.$id)) . '" status updated to ' . $status,
                ]);
            }
        } catch (Exception $e) {
            error_log('Failed to create donor status notification: ' . $e->getMessage());
        }

        sendJson(['success' => true, 'message' => 'Status updated']);
    }

    // DELETE /api/donations/{id}
    if ($method === 'DELETE' && preg_match('#^/(\d+)\/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $service->delete($id);
        sendJson(['success' => true, 'message' => 'Donation archived']);
    }

    // GET /api/donations/batch/{batch_id}
    if ($method === 'GET' && preg_match('#^/batch/([0-9a-fA-F-]{36})/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $batchId = $m[1];
        $items = $service->listByBatch($batchId);
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
        sendJson(['success' => true, 'data' => ['items' => $items]]);
    }

    // PUT /api/donations/batch/{batch_id}/status
    if ($method === 'PUT' && preg_match('#^/batch/([0-9a-fA-F-]{36})/status/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $batchId = $m[1];
        $input = getJsonInput();
        $status = $input['status'] ?? '';
        $service->updateStatusByBatch($batchId, $status);
        // Notify all donors in the batch about status change
        try {
            $db = Database::getInstance();
            $rows = $db->query(
                "SELECT DISTINCT d.donor_id, u.name AS donor_name
                 FROM donations d
                 JOIN users u ON u.user_id = d.donor_id
                 WHERE d.batch_id = ?",
                [$batchId]
            )->fetchAll();
            if ($rows) {
                $notif = new Notification();
                foreach ($rows as $r) {
                    if (empty($r['donor_id'])) continue;
                    $msg = 'Your batch donation status updated to ' . $status;
                    $notif->create([
                        'user_id' => (int)$r['donor_id'],
                        'type' => 'status_updated',
                        'reference_type' => 'batch',
                        'reference_id' => null,
                        'message' => $msg,
                    ]);
                }
            }
        } catch (Exception $e) { error_log('Batch donor notify fail: ' . $e->getMessage()); }

        sendJson(['success' => true]);
    }

    // DELETE /api/donations/batch/{batch_id}
    if ($method === 'DELETE' && preg_match('#^/batch/([0-9a-fA-F-]{36})/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $batchId = $m[1];
        $service->deleteByBatch($batchId);
        sendJson(['success' => true, 'message' => 'Batch archived']);
    }

    // Fallback
    sendJson(['success' => false, 'error' => 'Endpoint not found'], 404);
} catch (Exception $e) {
    // Log detailed error server-side only
    error_log('Donations API error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    // Return a generic error message to clients
    sendJson(['success' => false, 'error' => 'Internal server error'], 500);
}

function readCreatePayload(): array {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
    if (stripos($contentType, 'application/json') !== false) {
        return getJsonInput();
    }
    // multipart/form-data support
    $payload = [
        'donor_id' => $_POST['donor_id'] ?? null,
        'type' => $_POST['type'] ?? null,
        'name' => $_POST['name'] ?? null,
        'quantity' => $_POST['quantity'] ?? null,
        'expiry_date' => $_POST['expiry_date'] ?? null,
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

