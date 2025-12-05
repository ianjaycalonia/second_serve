<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/User.php';
require_once __DIR__ . '/../../core/Auth.php';

// Handle OPTIONS requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function handleSetStatus(array $payload) {
    if (empty($payload['user_id']) || empty($payload['status'])) {
        sendJson(['success' => false, 'error' => 'user_id and status are required'], 400);
    }
    $svc = new User();
    $svc->setStatus((int)$payload['user_id'], (string)$payload['status']);
    sendJson(['success' => true, 'message' => 'Status updated']);
}

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = sanitize(getJsonInput());

try {
    switch ($action) {
        case 'createDonor':
            requireRole(['admin']);
            handleCreateDonor($payload);
            break;
        case 'createRecipient':
            requireRole(['admin']);
            handleCreateRecipient($payload);
            break;
        case 'getProfile':
            requireAuth();
            handleGetProfile();
            break;
        case 'adminGetProfile':
            requireRole(['admin']);
            handleAdminGetProfile($payload);
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
        case 'adminUpdateProfile':
            requireRole(['admin']);
            handleAdminUpdateProfile($payload);
            break;
        case 'setStatus':
            requireRole(['admin']);
            handleSetStatus($payload);
            break;
        case 'deactivateSelf':
            requireRole(['admin']);
            handleDeactivateSelf();
            break;
        case 'deleteSelf':
            requireRole(['admin']);
            handleDeleteSelf();
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

function handleAdminGetProfile(array $payload) {
    if (empty($payload['user_id'])) {
        sendJson(['success' => false, 'error' => 'user_id is required'], 400);
    }
    $svc = new User();
    $user = $svc->getProfile((int)$payload['user_id']);
    sendJson(['success' => true, 'data' => ['user' => $user]]);
}

function handleUpdateProfile(array $payload) {
    $svc = new User();
    $svc->updateProfile((int)currentUserId(), [
        'name' => $payload['name'] ?? null,
        'contact_person' => $payload['contact_person'] ?? null,
        'email' => $payload['email'] ?? null,
        'organization_name' => $payload['organization_name'] ?? null,
        'contact_number' => $payload['contact_number'] ?? null,
        'address' => $payload['address'] ?? null,
        'position_designation' => $payload['position_designation'] ?? null,
    ]);
    sendJson(['success' => true, 'message' => 'Profile updated']);
}

function handleDeactivateSelf(): void {
    $userId = (int)(currentUserId() ?? 0);
    if ($userId <= 0) {
        sendJson(['success' => false, 'error' => 'Unauthorized'], 401);
    }
    $svc = new User();
    $svc->setStatus($userId, 'inactive');
    try {
        $auth = new Auth();
        $auth->logout();
    } catch (Exception $e) {
        // Ignore logout errors to avoid masking primary action
    }
    sendJson(['success' => true, 'message' => 'Account deactivated']);
}

function handleDeleteSelf(): void {
    $userId = (int)(currentUserId() ?? 0);
    if ($userId <= 0) {
        sendJson(['success' => false, 'error' => 'Unauthorized'], 401);
    }
    $svc = new User();
    $svc->deleteUser($userId);
    try {
        $auth = new Auth();
        $auth->logout();
    } catch (Exception $e) {
        // Ignore logout errors so deletion result is returned
    }
    sendJson(['success' => true, 'message' => 'Account deleted']);
}

function handleAdminUpdateProfile(array $payload) {
    if (empty($payload['user_id'])) {
        sendJson(['success' => false, 'error' => 'user_id is required'], 400);
    }
    $svc = new User();
    // Pass through only known fields; User::updateProfile will route per role
    $svc->updateProfile((int)$payload['user_id'], [
        'name' => $payload['name'] ?? null,
        'email' => $payload['email'] ?? null,
        'organization_name' => $payload['organization_name'] ?? null,
        'contact_number' => $payload['contact_number'] ?? null,
        'address' => $payload['address'] ?? null,
        'position_designation' => $payload['position_designation'] ?? null,
        'contact_person' => $payload['contact_person'] ?? null,
        'beneficiary_category_id' => $payload['beneficiary_category_id'] ?? null,
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

function handleCreateDonor(array $payload) {
    // Accept minimal fields: organization_name or name required
    $svc = new User();
    $res = $svc->adminCreateDonor([
        'organization_name' => $payload['organization_name'] ?? ($_POST['organization_name'] ?? null),
        'name' => $payload['name'] ?? ($_POST['name'] ?? null),
        'email' => $payload['email'] ?? ($_POST['email'] ?? null),
        'contact_number' => $payload['contact_number'] ?? ($_POST['contact_number'] ?? null),
        'address' => $payload['address'] ?? ($_POST['address'] ?? null),
        'donor_category_id' => isset($payload['donor_category_id']) ? $payload['donor_category_id'] : ($_POST['donor_category_id'] ?? null),
        'notes' => $payload['notes'] ?? ($_POST['notes'] ?? null),
    ]);
    sendJson(['success' => true, 'data' => $res]);
}

function handleCreateRecipient(array $payload) {
    // Accept minimal fields: organization_name or name required
    $svc = new User();
    $res = $svc->adminCreateRecipient([
        'organization_name' => $payload['organization_name'] ?? ($_POST['organization_name'] ?? null),
        'name' => $payload['name'] ?? ($_POST['name'] ?? null),
        'email' => $payload['email'] ?? ($_POST['email'] ?? null),
        'contact_person' => $payload['contact_person'] ?? ($_POST['contact_person'] ?? null),
        'position_designation' => $payload['position_designation'] ?? ($_POST['position_designation'] ?? null),
        'contact_number' => $payload['contact_number'] ?? ($_POST['contact_number'] ?? null),
        'address' => $payload['address'] ?? ($_POST['address'] ?? null),
        'beneficiary_category_id' => isset($payload['beneficiary_category_id']) ? $payload['beneficiary_category_id'] : ($_POST['beneficiary_category_id'] ?? null),
        'total_residents' => $payload['total_residents'] ?? ($_POST['total_residents'] ?? null),
        'age_group' => $payload['age_group'] ?? ($_POST['age_group'] ?? null),
        'male_count' => $payload['male_count'] ?? ($_POST['male_count'] ?? null),
        'female_count' => $payload['female_count'] ?? ($_POST['female_count'] ?? null),
        'external_id' => $payload['external_id'] ?? ($_POST['external_id'] ?? null),
        'tags' => $payload['tags'] ?? ($_POST['tags'] ?? null),
    ]);
    sendJson(['success' => true, 'data' => $res]);
}
