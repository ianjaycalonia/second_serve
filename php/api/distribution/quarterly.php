<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/QuarterlyDistribution.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = getJsonInput(); // do not sanitize to preserve numeric arrays; we'll validate fields

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
    error_log('QuarterlyDistribution API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => $e->getMessage()], 500);
}

function handleSuggest(array $payload): void {
    $qd = new QuarterlyDistribution();
    $quarterKey = isset($payload['quarter_key']) && is_string($payload['quarter_key']) && preg_match('/^\d{4}-Q[1-4]$/', $payload['quarter_key'])
        ? $payload['quarter_key']
        : QuarterlyDistribution::currentQuarterKey();
    $roundSize = isset($payload['round_size']) ? (int)$payload['round_size'] : 5;
    $roundSize = max(1, min(100, $roundSize));
    $ids = $qd->suggest($quarterKey, $roundSize);
    sendJson(['success' => true, 'data' => ['quarter_key' => $quarterKey, 'recipient_ids' => $ids]]);
}

function handleMarkResult(array $payload): void {
    $qd = new QuarterlyDistribution();
    $quarterKey = isset($payload['quarter_key']) && is_string($payload['quarter_key']) && preg_match('/^\d{4}-Q[1-4]$/', $payload['quarter_key'])
        ? $payload['quarter_key']
        : QuarterlyDistribution::currentQuarterKey();
    $served = isset($payload['served_ids']) && is_array($payload['served_ids']) ? array_map('intval', $payload['served_ids']) : [];
    $skipped = isset($payload['skipped_ids']) && is_array($payload['skipped_ids']) ? array_map('intval', $payload['skipped_ids']) : [];
    $qd->markResult($quarterKey, $served, $skipped);
    sendJson(['success' => true, 'data' => ['quarter_key' => $quarterKey, 'served' => $served, 'skipped' => $skipped]]);
}
