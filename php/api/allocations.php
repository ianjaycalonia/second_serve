<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../core/Allocation.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = sanitize(getJsonInput());

try {
    switch ($action) {
        case 'preview_allocation':
            requireRole(['admin']);
            // Accept period_key from GET or JSON body
            $periodKey = isset($_GET['period_key']) ? trim((string)$_GET['period_key']) : '';
            if ($periodKey === '' && isset($payload['period_key'])) {
                $periodKey = trim((string)$payload['period_key']);
            }
            if ($periodKey === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $periodKey)) {
                sendJson(['success'=>false,'error'=>'Invalid or missing period_key'], 400);
            }
            // Require current selection to be provided to avoid using a broader pool
            if (!isset($payload['recipient_ids']) || !is_array($payload['recipient_ids']) || count($payload['recipient_ids']) === 0) {
                sendJson(['success'=>false,'error'=>'recipient_ids (current selection) is required and cannot be empty'], 400);
            }
            $limitIds = array_map('intval', $payload['recipient_ids']);
            $svc = new Allocation();
            $data = $svc->previewAllocation($periodKey, $limitIds);
            sendJson(['success'=>true, 'data'=>$data]);
            break;

        case 'allocate_week':
            requireRole(['admin']);
            $periodKey = isset($payload['period_key']) ? trim((string)$payload['period_key']) : '';
            if ($periodKey === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $periodKey)) {
                sendJson(['success'=>false,'error'=>'Invalid or missing period_key'], 400);
            }
            $adminId = (int)(currentUserId() ?? 0);
            $svc = new Allocation();
            $res = $svc->allocateWeek($periodKey, $adminId);
            sendJson(['success'=>true, 'data'=>$res]);
            break;

        default:
            sendJson(['success'=>false, 'error'=>'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('Allocations API error: ' . $e->getMessage());
    sendJson(['success'=>false, 'error'=>'Server error'], 500);
}
