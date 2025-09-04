<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Donation.php';
require_once __DIR__ . '/../../core/Notification.php';

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
        // Allow larger raw uploads from phones; we'll compress server-side
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
        $dir = __DIR__ . '/../../../images/uploads/' . $subdir;
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        // If GD is unavailable, save the original file without processing as a safe fallback
        $gdAvailable = extension_loaded('gd')
            && function_exists('imagecreatetruecolor')
            && function_exists('imagecopyresampled')
            && function_exists('imagejpeg');
        if (!$gdAvailable) {
            $ext = $allowed[$mime];
            $filename = $subdir . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
            $dest = $dir . '/' . $filename;
            if (!move_uploaded_file($file['tmp_name'], $dest)) {
                throw new Exception('Failed to save image');
            }
            return 'images/uploads/' . $subdir . '/' . $filename;
        }

        // Load source
        switch ($mime) {
            case 'image/jpeg':
                if (!function_exists('imagecreatefromjpeg')) { throw new Exception('JPEG not supported by GD'); }
                $src = imagecreatefromjpeg($file['tmp_name']);
                break;
            case 'image/png':
                if (!function_exists('imagecreatefrompng')) { throw new Exception('PNG not supported by GD'); }
                $src = imagecreatefrompng($file['tmp_name']);
                break;
            case 'image/gif':
                if (!function_exists('imagecreatefromgif')) { throw new Exception('GIF not supported by GD'); }
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
        $maxDim = 1600; // cap long edge
        $scale = 1.0;
        $maxSide = max($w, $h);
        if ($maxSide > $maxDim) {
            $scale = $maxDim / $maxSide;
        }
        $nw = max(1, (int)round($w * $scale));
        $nh = max(1, (int)round($h * $scale));
        $dst = imagecreatetruecolor($nw, $nh);
        // Fill background white for formats with transparency when converting to JPEG
        $white = imagecolorallocate($dst, 255, 255, 255);
        imagefill($dst, 0, 0, $white);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
        imagedestroy($src);

        // Save as JPEG for size efficiency
        $filename = $subdir . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.jpg';
        $dest = $dir . '/' . $filename;
        if (!imagejpeg($dst, $dest, 80)) { // quality 80
            imagedestroy($dst);
            throw new Exception('Failed to save image');
        }
        imagedestroy($dst);
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
        if (preg_match('/exceeds 2 MB|Unsupported image type|Image too large|Failed to read image|Failed to save image|Image processing not available|not supported by GD/i', $msg)) {
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
                if (preg_match('/exceeds 2 MB|Unsupported image type|Image too large|Failed to read image|Failed to save image|Image processing not available|not supported by GD/i', $msg)) {
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
        // Notify all donors in the batch about status change
        try {
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
                    $msg = 'Your batch donation status updated to ' . $newStatus;
                    if ($result === 'failed' && !empty($failReason)) {
                        $msg .= '. Reason: ' . $failReason;
                    }
                    $notif->create([
                        'user_id' => (int)$r['donor_id'],
                        'type' => 'status_updated',
                        'reference_type' => 'batch',
                        'reference_id' => null,
                        'message' => $msg,
                    ]);
                }
            }
        } catch (Exception $e) { error_log('Batch donor notify fail: '.$e->getMessage()); }
    } elseif ($donationId) {
        $service->updateStatus($donationId, $newStatus);
        // Notify the donor of this donation
        try {
            $row = $db->query(
                "SELECT d.id, d.name, d.donor_id, u.name AS donor_name
                 FROM donations d JOIN users u ON u.user_id = d.donor_id
                 WHERE d.id = ?",
                [$donationId]
            )->fetch();
            if ($row && !empty($row['donor_id'])) {
                $notif = new Notification();
                $msg = 'Donation "' . ($row['name'] ?? ('#'.$donationId)) . '" status updated to ' . $newStatus;
                if ($result === 'failed' && !empty($failReason)) {
                    $msg .= '. Reason: ' . $failReason;
                }
                $notif->create([
                    'user_id' => (int)$row['donor_id'],
                    'type' => 'status_updated',
                    'reference_type' => 'donation',
                    'reference_id' => (int)$donationId,
                    'message' => $msg,
                ]);
            }
        } catch (Exception $e) { error_log('Single donor notify fail: '.$e->getMessage()); }
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
