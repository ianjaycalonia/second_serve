<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Donation.php';

// CORS / preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}
setCorsHeaders();
header('Content-Type: application/json');

try {
    requireRole(['admin']); // Only admins perform safety checks

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    $db = Database::getInstance();

    // Helpers
    $saveImage = function(array $file, string $subdir = 'food_safety') : string {
        if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) {
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
        $dir = __DIR__ . '/../../../images/uploads/' . $subdir;
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $filename = $subdir . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $allowed[$mime];
        $dest = $dir . '/' . $filename;
        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            throw new Exception('Failed to move uploaded file');
        }
        return 'images/uploads/' . $subdir . '/' . $filename;
    };

    // Extract fields
    $donationId = isset($_POST['donation_id']) && $_POST['donation_id'] !== '' ? (int)$_POST['donation_id'] : null;
    $batchId    = isset($_POST['batch_id']) && $_POST['batch_id'] !== '' ? sanitize($_POST['batch_id']) : null;
    $packagingOk = isset($_POST['packaging_ok']) ? (int)($_POST['packaging_ok'] ? 1 : 0) : null;
    $spoilageOk  = isset($_POST['spoilage_ok']) ? (int)($_POST['spoilage_ok'] ? 1 : 0) : null;
    // Accept either 'storage_temp' or 'storage' from the form
    $storageTemp = null;
    if (isset($_POST['storage_temp'])) {
        $storageTemp = sanitize($_POST['storage_temp']);
    } elseif (isset($_POST['storage'])) {
        $storageTemp = sanitize($_POST['storage']);
    }
    $expiryDate  = isset($_POST['expiry_date']) && $_POST['expiry_date'] !== '' ? sanitize($_POST['expiry_date']) : null;
    $result      = isset($_POST['result']) ? sanitize($_POST['result']) : '';
    $failReason  = isset($_POST['fail_reason']) && $_POST['fail_reason'] !== '' ? sanitize($_POST['fail_reason']) : null;

    if ($result !== 'passed' && $result !== 'failed') {
        sendJson(['success' => false, 'error' => 'Invalid result'], 400);
    }

    // Receipt image required
    if (empty($_FILES['receipt_image']) || !is_uploaded_file($_FILES['receipt_image']['tmp_name'])) {
        sendJson(['success' => false, 'error' => 'Receipt image is required'], 400);
    }

    // Save receipt
    try {
        $receiptUrl = $saveImage($_FILES['receipt_image'], 'food_safety');
    } catch (Exception $ex) {
        $msg = $ex->getMessage();
        if (preg_match('/exceeds 2 MB|Unsupported image type/i', $msg)) {
            sendJson(['success' => false, 'error' => $msg], 400);
        }
        throw $ex;
    }

    // Optional item photos (array) with related item_ids[]
    $itemIds = isset($_POST['item_ids']) ? (array)$_POST['item_ids'] : [];
    $hasItemPhotos = isset($_FILES['item_photos']) && is_array($_FILES['item_photos']['tmp_name']);

    $db->beginTransaction();

    // Insert main check
    $db->query(
        "INSERT INTO food_safety_checks (donation_id, batch_id, packaging_ok, spoilage_ok, storage_temp, expiry_date, receipt_image, result, fail_reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
        [
            $donationId,
            $batchId,
            $packagingOk,
            $spoilageOk,
            $storageTemp,
            $expiryDate,
            $receiptUrl,
            $result,
            $failReason,
            (int)currentUserId(),
        ]
    );
    $checkId = (int)$db->lastInsertId();

    // Insert per-item photos if provided
    if ($hasItemPhotos) {
        // Normalize the _FILES structure into a flat array of file structs
        $files = [];
        $fileField = $_FILES['item_photos'];
        $count = is_array($fileField['tmp_name']) ? count($fileField['tmp_name']) : 0;
        for ($i = 0; $i < $count; $i++) {
            if (!is_uploaded_file($fileField['tmp_name'][$i])) { continue; }
            $files[] = [
                'name' => $fileField['name'][$i],
                'type' => $fileField['type'][$i],
                'tmp_name' => $fileField['tmp_name'][$i],
                'error' => $fileField['error'][$i],
                'size' => $fileField['size'][$i],
            ];
        }
        for ($i = 0; $i < count($files); $i++) {
            try {
                $url = $saveImage($files[$i], 'food_safety');
            } catch (Exception $ex) {
                $msg = $ex->getMessage();
                if (preg_match('/exceeds 2 MB|Unsupported image type/i', $msg)) {
                    sendJson(['success' => false, 'error' => $msg], 400);
                }
                throw $ex;
            }
            $donationItemId = isset($itemIds[$i]) ? (int)$itemIds[$i] : null;
            $db->query(
                "INSERT INTO food_safety_item_photos (check_id, donation_item_id, photo_url, created_at) VALUES (?, ?, ?, NOW())",
                [$checkId, $donationItemId, $url]
            );
        }
    }

    // Update donation/batch status according to result
    $service = new Donation();
    if ($result === 'passed') {
        $newStatus = 'Picked Up';
    } else { // failed
        $newStatus = 'Failed Safety';
    }

    if ($batchId) {
        $service->updateStatusByBatch($batchId, $newStatus);
    } elseif ($donationId) {
        $service->updateStatus($donationId, $newStatus);
    }

    $db->commit();

    sendJson(['success' => true, 'check_id' => $checkId]);
} catch (Exception $e) {
    if (class_exists('Database')) {
        try { Database::getInstance()->rollBack(); } catch (Exception $e2) {}
    }
    error_log('Food safety create error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Internal server error'], 500);
}
