<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Donation.php';
require_once __DIR__ . '/../../core/Inventory.php';
require_once __DIR__ . '/../../core/Notification.php';
require_once __DIR__ . '/../../core/DonationNotifier.php';

// Handle OPTIONS requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
header('Content-Type: application/json');

if (in_array(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), ['POST','PUT','PATCH','DELETE'], true)) {
    requireCsrfToken();
}

try {
    requireRole(['admin']); // Only admins perform safety checks

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    $db = Database::getInstance();
    $txStarted = false; // disable overarching TX to avoid conflicts

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
        // Allow common mobile formats; we'll fall back to saving originals when GD can't process
        $allowed = [
            'image/png' => 'png',
            'image/jpeg' => 'jpg',
            'image/gif' => 'gif',
            'image/heic' => 'heic',
            'image/heif' => 'heif',
            'image/webp' => 'webp',
        ];
        if (!isset($allowed[$mime])) {
            // Try inferring from file extension as some mobiles provide generic MIME
            $extGuess = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
            $mapByExt = [
                'png' => 'image/png',
                'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
                'gif' => 'image/gif',
                'heic' => 'image/heic', 'heif' => 'image/heif',
                'webp' => 'image/webp',
            ];
            if (isset($mapByExt[$extGuess]) && isset($allowed[$mapByExt[$extGuess]])) {
                $mime = $mapByExt[$extGuess];
            } else {
                throw new Exception('Unsupported image type');
            }
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
        // Force fallback for formats GD typically can't decode (heic/heif/webp) to avoid internal errors
        if (in_array($mime, ['image/heic','image/heif','image/webp'], true)) {
            $gdAvailable = false;
        }
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
    // Deprecated: expiry_date (date). New: expiry_date_image (image path)
    $expiryDateImageUrl = null;
    $result      = isset($_POST['result']) ? sanitize($_POST['result']) : '';
    $failReason  = isset($_POST['fail_reason']) && $_POST['fail_reason'] !== '' ? sanitize($_POST['fail_reason']) : null;

    if ($result !== 'passed' && $result !== 'failed') {
        sendJson(['success' => false, 'error' => 'Invalid result'], 400);
    }

    // Validate required fields conditional to result
    if ($result === 'passed') {
        if (empty($_FILES['receipt_image']) || !is_uploaded_file($_FILES['receipt_image']['tmp_name'])) {
            sendJson(['success' => false, 'error' => 'Receipt image is required for Passed checks'], 400);
        }
    } else if ($result === 'failed') {
        if ($failReason === null || trim((string)$failReason) === '') {
            sendJson(['success' => false, 'error' => 'Failure reason is required for Failed checks'], 400);
        }
    }

    // Save receipt only if provided (always for passed, optional for failed)
    $receiptUrl = null;
    if (!empty($_FILES['receipt_image']) && is_uploaded_file($_FILES['receipt_image']['tmp_name'])) {
        try {
            $receiptUrl = $saveImage($_FILES['receipt_image'], 'food_safety');
        } catch (Exception $ex) {
            $msg = $ex->getMessage();
            if (preg_match('/(Upload error|exceeds 2 MB|Unsupported image type|Image too large|Failed to read image|Failed to save image|Image processing not available|not supported by GD)/i', $msg)) {
                sendJson(['success' => false, 'error' => $msg], 400);
            }
            throw $ex;
        }
    }

    // Optional: expiry_date_image (single file)
    if (!empty($_FILES['expiry_date_image']) && is_uploaded_file($_FILES['expiry_date_image']['tmp_name'])) {
        try {
            $expiryDateImageUrl = $saveImage($_FILES['expiry_date_image'], 'food_safety');
        } catch (Exception $ex) {
            $msg = $ex->getMessage();
            if (preg_match('/exceeds 2 MB|Unsupported image type|Image too large|Failed to read image|Failed to save image|Image processing not available|not supported by GD/i', $msg)) {
                sendJson(['success' => false, 'error' => $msg], 400);
            }
            throw $ex;
        }
    }

    // Do not start a transaction here; Donation service may manage its own
    $txStarted = false;

    // Ensure receipt_image is never NULL to satisfy NOT NULL schema
    if ($receiptUrl === null) { $receiptUrl = ''; }

    // Always create a batch-level check row (receipt only) when batch context is present
    // If only a single donation is provided (no batch), this row is also valid for that donation
    $db->query(
        "INSERT INTO food_safety_checks (donation_id, batch_id, packaging_ok, spoilage_ok, storage_temp, expiry_date_image, receipt_image, result, fail_reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
        [
            $donationId,
            $batchId,
            $packagingOk,
            $spoilageOk,
            $storageTemp,
            $expiryDateImageUrl, // may be null; we will add per-item rows below
            $receiptUrl,
            $result,
            $failReason,
            (int)currentUserId(),
        ]
    );
    $checkId = (int)$db->lastInsertId();

    // Per-item expiry: inputs are named expiry_item_photo[DONATION_ID]
    if (!empty($_FILES['expiry_item_photo']) && is_array($_FILES['expiry_item_photo']['tmp_name'])) {
        $byIdTmp = $_FILES['expiry_item_photo']['tmp_name'];
        $byIdErr = $_FILES['expiry_item_photo']['error'];
        $byIdName = $_FILES['expiry_item_photo']['name'];
        $byIdType = $_FILES['expiry_item_photo']['type'];
        $byIdSize = $_FILES['expiry_item_photo']['size'];

        foreach ($byIdTmp as $donId => $tmpPath) {
            if ($tmpPath === null || $tmpPath === '' || (isset($byIdErr[$donId]) && $byIdErr[$donId] !== UPLOAD_ERR_OK)) {
                continue; // no file for this item
            }
            // Build a file-like array to pass through $saveImage
            $fileArr = [
                'tmp_name' => $tmpPath,
                'error' => $byIdErr[$donId] ?? UPLOAD_ERR_OK,
                'name' => $byIdName[$donId] ?? ('expiry_' . $donId . '.jpg'),
                'type' => $byIdType[$donId] ?? 'image/jpeg',
                'size' => $byIdSize[$donId] ?? 0,
            ];
            try {
                $perItemUrl = $saveImage($fileArr, 'food_safety');
            } catch (Exception $ex) {
                $msg = $ex->getMessage();
                if (preg_match('/(Upload error|exceeds 2 MB|Unsupported image type|Image too large|Failed to read image|Failed to save image|Image processing not available|not supported by GD)/i', $msg)) {
                    sendJson(['success' => false, 'error' => $msg], 400);
                }
                throw $ex;
            }
            // Insert a row for this specific donation item with the same receipt reference
            $db->query(
                "INSERT INTO food_safety_checks (donation_id, batch_id, packaging_ok, spoilage_ok, storage_temp, expiry_date_image, receipt_image, result, fail_reason, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
                [
                    (int)$donId,
                    $batchId,
                    $packagingOk,
                    $spoilageOk,
                    $storageTemp,
                    $perItemUrl,
                    $receiptUrl,
                    $result,
                    $failReason,
                    (int)currentUserId(),
                ]
            );
        }
    }

    // Apply optional per-item quantity overrides before changing status/inventory
    if (!empty($_POST['quantity_override']) && is_array($_POST['quantity_override'])) {
        foreach ($_POST['quantity_override'] as $donIdStr => $qVal) {
            $donId = (int)$donIdStr;
            $qty = is_numeric($qVal) ? (int)$qVal : null;
            if ($donId > 0 && $qty !== null && $qty >= 0) {
                try {
                    // Update all donation_items under this donation header
                    $db->query(
                        "UPDATE donation_items SET quantity = ? WHERE donation_id = ?",
                        [ $qty, $donId ]
                    );
                } catch (Exception $e) {
                    // Non-fatal: continue other updates
                    error_log('FS quantity_override update failed for donation_id '.$donId.': '.$e->getMessage());
                }
            }
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
        // If passed, add all batch items to inventory
        if ($newStatus === 'Picked Up') {
            try { (new Inventory())->addFromBatchId($batchId); } catch (Exception $e) { error_log('Inventory add (batch) failed: '.$e->getMessage()); }
        }
        // Centralized notification for batch
        try { (new DonationNotifier())->notifyBatchStatus($batchId, $newStatus, ['reason' => ($result === 'failed' ? ($failReason ?? '') : '')]); } catch (Exception $e) { error_log('Batch donor notify fail: '.$e->getMessage()); }
    } elseif ($donationId) {
        $service->updateStatus($donationId, $newStatus);
        // If passed, add single item to inventory
        if ($newStatus === 'Picked Up') {
            try { (new Inventory())->addFromDonationId((int)$donationId); } catch (Exception $e) { error_log('Inventory add (single) failed: '.$e->getMessage()); }
        }
        // Centralized notification for single donation
        try { (new DonationNotifier())->notifyDonationStatus((int)$donationId, $newStatus, ['reason' => ($result === 'failed' ? ($failReason ?? '') : '')]); } catch (Exception $e) { error_log('Single donor notify fail: '.$e->getMessage()); }
    }

    // No outer transaction to commit

    sendJson(['success' => true, 'check_id' => $checkId]);
} catch (Exception $e) {
    // No outer transaction to roll back
    $msg = $e->getMessage();
    error_log('Food safety create error: ' . $msg);
    // Surface known validation/upload messages as 400 to the client instead of generic 500
    if (preg_match('/(Upload error|Receipt image is required|Invalid result|exceeds 2 MB|Unsupported image type|Image too large|Failed to read image|Failed to save image|Image processing not available|not supported by GD|Method not allowed|Only admins)/i', $msg)) {
        sendJson(['success' => false, 'error' => $msg], 400);
    }
    // Dev: include actual message to debug quickly
    sendJson(['success' => false, 'error' => 'Internal server error: ' . $msg], 500);
}
