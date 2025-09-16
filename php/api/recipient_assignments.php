<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../core/RecipientAssignments.php';
require_once __DIR__ . '/../core/User.php';

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
        case 'list_recipients':
            requireRole(['admin']);
            handleListRecipients();
            break;
        case 'get_assignments':
            requireRole(['admin']);
            handleGetAssignments($payload);
            break;
        case 'save_assignments':
            requireRole(['admin']);
            handleSaveAssignments($payload);
            break;
        default:
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('RecipientAssignments API error: ' . $e->getMessage());
    // Surface the error message to aid debugging; adjust in production as needed
    sendJson(['success' => false, 'error' => $e->getMessage()], 500);
}

function handleListRecipients() {
    $svc = new User();
    $items = $svc->listUsers(['role' => 'recipient', 'status' => 'approved']);
    sendJson(['success' => true, 'data' => ['items' => $items]]);
}

function handleGetAssignments(array $payload) {
    $months = $payload['months'] ?? ($_GET['months'] ?? []);
    if (is_string($months)) {
        // allow CSV in query
        $months = array_filter(array_map('trim', explode(',', $months)));
    }
    if (!is_array($months) || empty($months)) {
        sendJson(['success' => true, 'data' => ['assignments' => []]]);
        return;
    }
    // Basic format hinting (YYYY-MM or YYYY-MM-01)
    $months = array_values(array_filter($months, function($m){
        return is_string($m) && preg_match('/^\d{4}-\d{2}(-\d{2})?$/', $m);
    }));
    if (empty($months)) {
        sendJson(['success' => true, 'data' => ['assignments' => []]]);
        return;
    }
    $svc = new RecipientAssignments();
    $map = $svc->getAssignments($months);
    sendJson(['success' => true, 'data' => ['assignments' => $map]]);
}

function handleSaveAssignments(array $payload) {
    $month = $payload['month'] ?? '';
    if (!$month) {
        sendJson(['success' => false, 'error' => 'month is required'], 400);
    }
    $ids = $payload['recipient_ids'] ?? [];
    if (!is_array($ids)) {
        sendJson(['success' => false, 'error' => 'recipient_ids must be array'], 400);
    }
    // Normalize to integers and filter out invalids early
    $ids = array_values(array_filter(array_map('intval', $ids), fn($v) => $v > 0));
    $adminId = (int)(currentUserId() ?? 0);
    $svc = new RecipientAssignments();
    $svc->saveAssignments($month, $ids, $adminId ?: null);
    sendJson(['success' => true, 'message' => 'Assignments saved']);
}
