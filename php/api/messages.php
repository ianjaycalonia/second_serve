<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../core/Conversation.php';
require_once __DIR__ . '/../core/Message.php';
require_once __DIR__ . '/../core/Notification.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$payload = getJsonInput();
$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';

$convSvc = new Conversation();
$msgSvc  = new Message();

try {
    switch ($method) {
        case 'GET':
            if ($action === 'list_conversations') {
                requireAuth();
                $userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : (int)(currentUserId() ?? 0);
                if ($userId <= 0) sendJson(['success' => false, 'error' => 'user_id is required'], 400);
                $currentId = (int)(currentUserId() ?? 0);
                $role = (string)(currentUserRole() ?? '');
                if ($currentId !== $userId && $role !== 'admin') {
                    sendJson(['success' => false, 'error' => 'Forbidden'], 403);
                }
                // Probe required tables to surface meaningful errors
                try {
                    $db = Database::getInstance();
                    $db->query('SELECT 1 FROM conversations LIMIT 1');
                    $db->query('SELECT 1 FROM conversation_participants LIMIT 1');
                    $db->query('SELECT 1 FROM messages LIMIT 1');
                } catch (Exception $e) {
                    error_log('Messages list probe failed: ' . $e->getMessage());
                    sendJson(['success' => false, 'error' => 'Messaging tables missing or inaccessible', 'detail' => ($role === 'admin' ? $e->getMessage() : null)], 500);
                }
                $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
                $offset = isset($_GET['offset']) ? (int)$_GET['offset'] : 0;
                $items = $convSvc->listForUser($userId, $limit, $offset);
                sendJson(['success' => true, 'data' => ['items' => $items]]);
            }

            if ($action === 'list_messages') {
                requireAuth();
                $conversationId = isset($_GET['conversation_id']) ? (int)$_GET['conversation_id'] : 0;
                if ($conversationId <= 0) sendJson(['success' => false, 'error' => 'conversation_id is required'], 400);
                $userId = (int)(currentUserId() ?? 0);
                $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
                $afterId = isset($_GET['after_id']) ? (int)$_GET['after_id'] : null;
                $rows = $msgSvc->list($conversationId, $userId, $limit, $afterId);
                sendJson(['success' => true, 'data' => ['items' => $rows]]);
            }

            sendJson(['success' => false, 'error' => 'Invalid action'], 400);

        case 'POST':
            if ($action === 'create_conversation') {
                requireAuth();
                $type = isset($payload['type']) ? trim((string)$payload['type']) : 'direct';
                $title = isset($payload['title']) ? trim((string)$payload['title']) : null;
                $participants = isset($payload['participant_ids']) && is_array($payload['participant_ids'])
                    ? array_values($payload['participant_ids']) : [];
                $createdBy = (int)(currentUserId() ?? 0);
                if ($createdBy <= 0) sendJson(['success' => false, 'error' => 'Authentication required'], 401);
                $conv = $convSvc->create($type, $createdBy, $participants, $title);
                sendJson(['success' => true, 'data' => ['conversation' => $conv]], 201);
            }

            if ($action === 'get_or_create_direct') {
                requireAuth();
                $me = (int)(currentUserId() ?? 0);
                $otherUserId = (int)($payload['other_user_id'] ?? 0);
                // If caller is non-admin and no other_user_id provided, default to an admin (food bank)
                $role = (string)(currentUserRole() ?? '');
                if ($otherUserId <= 0 && $role !== 'admin') {
                    $db = Database::getInstance();
                    $row = $db->query("SELECT user_id FROM users WHERE role = 'admin' ORDER BY user_id ASC LIMIT 1")->fetch();
                    if (!$row) sendJson(['success' => false, 'error' => 'Food bank account not found'], 500);
                    $otherUserId = (int)$row['user_id'];
                }
                if ($otherUserId <= 0) sendJson(['success' => false, 'error' => 'other_user_id is required'], 400);
                $conv = $convSvc->getOrCreateDirect($me, $otherUserId, $me);
                sendJson(['success' => true, 'data' => ['conversation' => $conv]], 201);
            }

            if ($action === 'send_message') {
                requireAuth();
                $conversationId = (int)($payload['conversation_id'] ?? 0);
                $body = (string)($payload['body'] ?? '');
                $attachmentUrl = isset($payload['attachment_url']) ? (string)$payload['attachment_url'] : null;
                $senderId = (int)(currentUserId() ?? 0);
                $msg = $msgSvc->send($conversationId, $senderId, $body, $attachmentUrl);
                sendJson(['success' => true, 'data' => ['message' => $msg]], 201);
            }

            sendJson(['success' => false, 'error' => 'Invalid action'], 400);

        case 'PATCH':
            if ($action === 'mark_read') {
                requireAuth();
                $conversationId = isset($_GET['conversation_id']) ? (int)$_GET['conversation_id'] : (int)($payload['conversation_id'] ?? 0);
                if ($conversationId <= 0) sendJson(['success' => false, 'error' => 'conversation_id is required'], 400);
                $userId = (int)(currentUserId() ?? 0);
                $ok = $convSvc->markRead($conversationId, $userId);
                if (!$ok) sendJson(['success' => false, 'error' => 'Not found or not a participant'], 404);
                sendJson(['success' => true, 'message' => 'Conversation marked read']);
            }
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);

        default:
            sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
    }
} catch (Exception $e) {
    error_log('Messages API error: ' . $e->getMessage());
    $role = (string)(currentUserRole() ?? '');
    $payload = ['success' => false, 'error' => 'Server error'];
    if ($role === 'admin') { $payload['detail'] = $e->getMessage(); }
    sendJson($payload, 500);
}

