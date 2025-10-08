<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/User.php';

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
        case 'importRecipients':
            requireRole(['admin']);
            handleImportRecipients($payload);
            break;
        case 'importDonors':
            requireRole(['admin']);
            handleImportDonors($payload);
            break;
        default:
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('User API error: ' . $e->getMessage());
    $debug = isset($_GET['debug']) ? (int)$_GET['debug'] : 0;
    $msg = $debug ? $e->getMessage() : 'Server error';
    sendJson(['success' => false, 'error' => $msg], 500);
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
    // Hide internal recipient from listings used by Distribute Items UI
    $role = strtolower((string)($filters['role'] ?? ''));
    if ($role === 'recipient') {
        $list = array_values(array_filter($list, function($u){
            $name = isset($u['organization_name']) && trim((string)$u['organization_name']) !== ''
                ? (string)$u['organization_name']
                : (string)($u['name'] ?? '');
            $nm = strtolower(trim($name));
            // Exclude any recipient that looks like the internal foodbank account
            return ($nm === '' || strpos($nm, 'foodbank') === false);
        }));
    }
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

function handleImportRecipients(array $payload) {
    $rows = $payload['rows'] ?? [];
    if (!is_array($rows)) {
        sendJson(['success' => false, 'error' => 'rows must be an array'], 400);
    }
    $svc = new User();
    $summary = $svc->importRecipients($rows);
    sendJson(['success' => true, 'data' => $summary]);
}

function handleImportDonors(array $payload) {
    $rows = $payload['rows'] ?? [];
    if (!is_array($rows)) {
        sendJson(['success' => false, 'error' => 'rows must be an array'], 400);
    }
    $svc = new User();
    $summary = $svc->importDonors($rows);
    sendJson(['success' => true, 'data' => $summary]);
}
