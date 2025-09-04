<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../core/Notification.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$payload = getJsonInput(); // raw (no sanitize) to preserve strings

try {
    switch ($method) {
        case 'GET':
            // GET /notifications?user_id=xxx
            $userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;
            if ($userId <= 0) {
                sendJson(['success' => false, 'error' => 'user_id is required'], 400);
            }
            // Only allow user themselves or admin to view
            $currentId = (int)(currentUserId() ?? 0);
            $role = (string)(currentUserRole() ?? '');
            if ($currentId !== $userId && $role !== 'admin') {
                sendJson(['success' => false, 'error' => 'Forbidden'], 403);
            }
            $svc = new Notification();
            $items = $svc->listByUser($userId);
            sendJson(['success' => true, 'data' => ['items' => $items]]);

        case 'POST':
            // POST /notifications
            // Accepts: user_id, type, reference_id, message, optional reference_type
            $svc = new Notification();
            $created = $svc->create([
                'user_id' => $payload['user_id'] ?? null,
                'type' => $payload['type'] ?? null,
                'reference_type' => $payload['reference_type'] ?? 'donation',
                'reference_id' => $payload['reference_id'] ?? null,
                'message' => $payload['message'] ?? null,
            ]);
            sendJson(['success' => true, 'data' => ['notification' => $created]], 201);

        case 'PATCH':
            // PATCH /notifications/:id/read -> support via query: ?action=read&id=123
            $action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
            if ($action === 'read') {
                $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
                if ($id <= 0) sendJson(['success' => false, 'error' => 'id is required'], 400);
                $svc = new Notification();
                $ok = $svc->markRead($id);
                if (!$ok) sendJson(['success' => false, 'error' => 'Not found'], 404);
                sendJson(['success' => true, 'message' => 'Notification marked as read']);
            }
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);

        default:
            sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
    }
} catch (Exception $e) {
    error_log('Notifications API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Server error'], 500);
}
