<?php
require_once __DIR__ . '/../includes/config.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = sanitize(getJsonInput());

try {
    switch ($action) {
        case 'get_plan':
            requireRole(['admin']);
            $month = isset($_GET['month']) ? trim((string)$_GET['month']) : '';
            if ($month === '') {
                $month = (new DateTime('now'))->format('Y-m');
            }
            $db = Database::getInstance();
            $weeks = ['W1','W2','W3','W4'];
            $result = [];
            foreach ($weeks as $wk) {
                $key = $month . '-' . $wk; // custom period_key for storage
                $row = $db->query(
                    "SELECT selected_ids_json FROM distribution_selection_logs WHERE period_type='weekly' AND period_key = ? ORDER BY id DESC LIMIT 1",
                    [$key]
                )->fetch();
                $result[$wk] = ($row && !empty($row['selected_ids_json'])) ? json_decode($row['selected_ids_json'], true) : [];
            }
            sendJson(['success' => true, 'data' => ['month' => $month, 'weeks' => $result]]);
            break;

        case 'save_plan':
            requireRole(['admin']);
            $adminId = (int)(currentUserId() ?? 0);
            $month = isset($payload['month']) ? trim((string)$payload['month']) : '';
            if ($month === '' || !preg_match('/^\d{4}-\d{2}$/', $month)) {
                $month = (new DateTime('now'))->format('Y-m');
            }
            $weeksData = $payload['weeks'] ?? [];
            if (!is_array($weeksData)) { sendJson(['success' => false, 'error' => 'weeks must be an object'], 400); }
            $db = Database::getInstance();
            $weeks = ['W1','W2','W3','W4'];
            foreach ($weeks as $wk) {
                $ids = isset($weeksData[$wk]) && is_array($weeksData[$wk]) ? array_values(array_filter(array_map('intval', $weeksData[$wk]), fn($v)=>$v>0)) : [];
                $key = $month . '-' . $wk;
                $db->query(
                    "INSERT INTO distribution_selection_logs (period_key, period_type, pool_type, specialty_key, round_size, selected_ids_json, created_by, created_at)
                     VALUES (?, 'weekly', 'general', NULL, ?, ?, ?, NOW())",
                    [ $key, max(0, count($ids)), json_encode($ids), $adminId ]
                );
            }
            sendJson(['success' => true, 'message' => 'Plan saved']);
            break;

        default:
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('RecipientsList API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Server error'], 500);
}
