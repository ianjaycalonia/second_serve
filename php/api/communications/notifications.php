<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Notification.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (in_array(strtoupper($method), ['POST','PUT','PATCH','DELETE'], true)) {
    requireCsrfToken();
}

$override = $_GET['_method'] ?? $_POST['_method'] ?? ($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '');
if ($override) {
    $ov = strtoupper(trim((string)$override));
    if (in_array($ov, ['GET','POST','PUT','PATCH','DELETE'], true)) {
        $method = $ov;
    }
}

$payload = getJsonInput(); // raw (no sanitize) to preserve strings

function requestAction(): string {
    if (isset($_GET['action'])) { return sanitize($_GET['action']); }
    if (isset($_POST['action'])) { return sanitize($_POST['action']); }
    return '';
}

function requestInt(string $key): int {
    if (isset($_GET[$key])) { return (int)$_GET[$key]; }
    if (isset($_POST[$key])) { return (int)$_POST[$key]; }
    return 0;
}

try {
    switch ($method) {
        case 'GET':
            // GET /notifications (defaults to current session) or /notifications?user_id=xxx
            requireAuth();
            $userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : (int)(currentUserId() ?? 0);
            if ($userId <= 0) { sendJson(['success' => false, 'error' => 'Authentication required'], 401); }
            // Only allow user themselves or admin to view
            $currentId = (int)(currentUserId() ?? 0);
            $role = (string)(currentUserRole() ?? '');
            if ($currentId !== $userId && $role !== 'admin') {
                sendJson(['success' => false, 'error' => 'Forbidden'], 403);
            }
            // Lightweight probe to ensure table exists (avoid generic 500 if missing)
            try {
                Database::getInstance()->query('SELECT 1 FROM notifications LIMIT 1');
            } catch (Exception $e) {
                error_log('Notifications table probe failed: ' . $e->getMessage());
                sendJson(['success' => false, 'error' => 'Notifications table missing or inaccessible'], 500);
            }
            $svc = new Notification();
            $items = $svc->listByUser($userId);
            sendJson(['success' => true, 'data' => ['items' => $items]]);

        case 'POST':
            // POST /notifications
            $svc = new Notification();
            $actionName = requestAction();
            $data = [
                'user_id' => $payload['user_id'] ?? null,
                'type' => $payload['type'] ?? null,
                'reference_type' => $payload['reference_type'] ?? null,
                'reference_id' => $payload['reference_id'] ?? null,
                'message' => $payload['message'] ?? null,
            ];
            if ($actionName === 'replace_latest') {
                $updated = $svc->replaceLatest($data, false);
                sendJson(['success' => true, 'data' => ['notification' => $updated]]);
            }
            // Default: create new notification (legacy behaviour)
            if (!isset($data['reference_type']) || $data['reference_type'] === null) {
                $data['reference_type'] = 'donation';
            }
            $created = $svc->create($data);
            sendJson(['success' => true, 'data' => ['notification' => $created]], 201);

        case 'PATCH':
            // PATCH /notifications/:id/read -> support via query: ?action=read&id=123
            $action = requestAction();
            if ($action === 'read') {
                $id = requestInt('id');
                if ($id <= 0) sendJson(['success' => false, 'error' => 'id is required'], 400);
                $svc = new Notification();
                $ok = $svc->markRead($id);
                if (!$ok) sendJson(['success' => false, 'error' => 'Not found'], 404);
                sendJson(['success' => true, 'message' => 'Notification marked as read']);
            }
            if ($action === 'read_all') {
                $userId = requestInt('user_id');
                if ($userId <= 0) { $userId = (int)(currentUserId() ?? 0); }
                if ($userId <= 0) sendJson(['success' => false, 'error' => 'Authentication required'], 401);
                // Permission: user themselves or admin only
                $currentId = (int)(currentUserId() ?? 0);
                $role = (string)(currentUserRole() ?? '');
                if ($currentId !== $userId && $role !== 'admin') {
                    sendJson(['success' => false, 'error' => 'Forbidden'], 403);
                }
                $svc = new Notification();
                $count = $svc->markAllReadByUser($userId);
                sendJson(['success' => true, 'message' => 'All notifications marked as read', 'data' => ['updated' => $count]]);
            }
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);

        default:
            sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
    }
} catch (Exception $e) {
    error_log('Notifications API error: ' . $e->getMessage());
    // Expose message to admins to speed up debugging
    $role = (string)(currentUserRole() ?? '');
    $payload = ['success' => false, 'error' => 'Server error'];
    if ($role === 'admin') { $payload['detail'] = $e->getMessage(); }
    sendJson($payload, 500);
}

