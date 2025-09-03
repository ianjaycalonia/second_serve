<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../core/User.php';

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
        case 'getProfile':
            requireAuth();
            handleGetProfile();
            break;
        case 'updateProfile':
            requireAuth();
            handleUpdateProfile($payload);
            break;
        case 'listPending':
            requireRole(['admin']);
            handleList(['status' => 'pending']);
            break;
        case 'list':
            requireRole(['admin']);
            handleList([
                'status' => $payload['status'] ?? ($_GET['status'] ?? null),
                'role' => $payload['role'] ?? ($_GET['role'] ?? null),
                'q' => $payload['q'] ?? ($_GET['q'] ?? null),
            ]);
            break;
        case 'approve':
            requireRole(['admin']);
            handleApprove($payload);
            break;
        case 'reject':
            requireRole(['admin']);
            handleReject($payload);
            break;
        default:
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('User API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Server error'], 500);
}

function handleGetProfile() {
    $svc = new User();
    $user = $svc->getProfile((int)currentUserId());
    sendJson(['success' => true, 'data' => ['user' => $user]]);
}

function handleUpdateProfile(array $payload) {
    $svc = new User();
    $svc->updateProfile((int)currentUserId(), [
        'name' => $payload['name'] ?? null,
        'organization_name' => $payload['organization_name'] ?? null,
        'contact_number' => $payload['contact_number'] ?? null,
        'address' => $payload['address'] ?? null,
    ]);
    sendJson(['success' => true, 'message' => 'Profile updated']);
}

function handleList(array $filters) {
    $svc = new User();
    $list = $svc->listUsers($filters);
    sendJson(['success' => true, 'data' => ['items' => $list]]);
}

function handleApprove(array $payload) {
    if (empty($payload['user_id'])) {
        sendJson(['success' => false, 'error' => 'user_id is required'], 400);
    }
    $svc = new User();
    $svc->approveUser((int)$payload['user_id']);
    sendJson(['success' => true, 'message' => 'User approved']);
}

function handleReject(array $payload) {
    if (empty($payload['user_id'])) {
        sendJson(['success' => false, 'error' => 'user_id is required'], 400);
    }
    $svc = new User();
    $svc->rejectUser((int)$payload['user_id'], $payload['reason'] ?? null);
    sendJson(['success' => true, 'message' => 'User rejected']);
}
