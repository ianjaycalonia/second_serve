<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Donation.php';

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

        // Handle image: base64 or uploaded file
        if (!empty($payload['image']) && is_string($payload['image'])) {
            $payload['image_url'] = saveDonationImageBase64($payload['image']);
        } elseif (!empty($_FILES['image']) && is_uploaded_file($_FILES['image']['tmp_name'])) {
            $payload['image_url'] = saveUploadedImage($_FILES['image']);
        }

        // Sanitize basic strings (not base64)
        $payload['type'] = sanitize($payload['type']);
        $payload['name'] = sanitize($payload['name']);
        $payload['packaging'] = null; // packaging removed from UI and ignored
        $payload['expiry_date'] = !empty($payload['expiry_date']) ? sanitize($payload['expiry_date']) : null;

        $newId = $service->create($payload);
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

        // Optional single receipt image for the whole donation submission
        $receiptImageUrl = null;
        if (!empty($_FILES['image']) && is_uploaded_file($_FILES['image']['tmp_name'])) {
            $receiptImageUrl = saveUploadedImage($_FILES['image']);
        }

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
                'image_url' => $receiptImageUrl,
            ];
            $ids[] = $service->create($payload);
        }
        sendJson(['success' => true, 'created_ids' => $ids, 'created_count' => count($ids)]);
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
        // Attach absolute image URL; if donation has no image, fall back to latest food safety receipt image
        $db = Database::getInstance();
        foreach ($items as &$it) {
            $imageUrl = $it['image_url'] ?? '';
            $full = buildImageFullUrl($imageUrl);
            if ($full === '' || $imageUrl === null || $imageUrl === '') {
                // Try to get the latest receipt from food safety checks by batch or donation
                if (!empty($it['batch_id'])) {
                    $row = $db->query(
                        "SELECT receipt_image FROM food_safety_checks WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1",
                        [$it['batch_id']]
                    )->fetch();
                    if ($row && !empty($row['receipt_image'])) {
                        $full = buildImageFullUrl($row['receipt_image']);
                    }
                } else if (!empty($it['id'])) {
                    $row = $db->query(
                        "SELECT receipt_image FROM food_safety_checks WHERE donation_id = ? ORDER BY created_at DESC LIMIT 1",
                        [(int)$it['id']]
                    )->fetch();
                    if ($row && !empty($row['receipt_image'])) {
                        $full = buildImageFullUrl($row['receipt_image']);
                    }
                }
            }
            $it['image_full_url'] = $full;
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

    // GET /api/donations/{id}
    if ($method === 'GET' && preg_match('#^/(\d+)\/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $row = $service->getById($id);
        if (!$row) {
            sendJson(['success' => false, 'error' => 'Not found'], 404);
        }
        $row['image_full_url'] = buildImageFullUrl($row['image_url'] ?? '');
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
        foreach ($items as &$it) {
            $it['image_full_url'] = buildImageFullUrl($it['image_url'] ?? '');
        }
        sendJson(['success' => true, 'data' => ['items' => $items]]);
    }

    // PUT /api/donations/batch/{batch_id}/status
    if ($method === 'PUT' && preg_match('#^/batch/([0-9a-fA-F-]{36})/status/?\z#', $sub, $m)) {
        requireRole(['admin']);
        $batchId = $m[1];
        $input = getJsonInput();
        $status = $input['status'] ?? '';
        $service->updateStatusByBatch($batchId, $status);
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
        'packaging' => $_POST['packaging'] ?? null,
    ];
    return $payload;
}

function saveUploadedImage(array $file): string {
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new Exception('Upload error');
    }
    // 2 MB size limit
    $maxBytes = 2 * 1024 * 1024; // 2 MB
    if (isset($file['size']) && $file['size'] > $maxBytes) {
        throw new Exception('Image exceeds 2 MB limit');
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
    $filename = 'donation_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $allowed[$mime];
    $dest = $dir . '/' . $filename;
    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        throw new Exception('Failed to move uploaded file');
    }
    return 'images/uploads/donations/' . $filename;
}

