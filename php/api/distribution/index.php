<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Distribution.php';

// Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}
setCorsHeaders();
header('Content-Type: application/json');

$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = getJsonInput();

try {
    requireRole(['admin']);
    switch ($action) {
        case 'suggest':
            handleSuggest($payload);
            break;
        case 'mark_result':
            handleMarkResult($payload);
            break;
        default:
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('Distribution API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => $e->getMessage()], 500);
}

function handleSuggest(array $payload): void {
    $type = isset($payload['period_type']) && in_array($payload['period_type'], ['weekly','monthly','quarterly'], true)
        ? $payload['period_type']
        : 'monthly';
    $key = isset($payload['period_key']) && is_string($payload['period_key']) ? $payload['period_key'] : null;
    $roundSize = isset($payload['round_size']) ? (int)$payload['round_size'] : 5;
    $poolType = isset($payload['pool_type']) && $payload['pool_type'] === 'specialty' ? 'specialty' : 'general';
    $specialtyKey = isset($payload['specialty_key']) && is_string($payload['specialty_key']) ? trim($payload['specialty_key']) : null;
    $adminId = isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;
    $svc = new Distribution();
    $result = $svc->suggest($type, $key, $roundSize, $poolType, $specialtyKey, $adminId);
    sendJson(['success' => true, 'data' => $result]);
}

function handleMarkResult(array $payload): void {
    $type = isset($payload['period_type']) && in_array($payload['period_type'], ['weekly','monthly','quarterly'], true)
        ? $payload['period_type']
        : 'monthly';
    $key = isset($payload['period_key']) && is_string($payload['period_key']) ? $payload['period_key'] : null;
    // pool_type/specialty_key accepted for completeness though not used on mark
    $poolType = isset($payload['pool_type']) && $payload['pool_type'] === 'specialty' ? 'specialty' : 'general';
    $specialtyKey = isset($payload['specialty_key']) && is_string($payload['specialty_key']) ? trim($payload['specialty_key']) : null;
    $served = isset($payload['served_ids']) && is_array($payload['served_ids']) ? array_map('intval', $payload['served_ids']) : [];
    $skipped = isset($payload['skipped_ids']) && is_array($payload['skipped_ids']) ? array_map('intval', $payload['skipped_ids']) : [];
    $svc = new Distribution();
    $svc->markResult($type, $key, $served, $skipped);
    sendJson(['success' => true, 'data' => ['period_key' => Distribution::normalizePeriodKey($type, $key), 'served' => $served, 'skipped' => $skipped]]);
}
