<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../includes/utils.php';

setCorsHeaders();
header('Content-Type: application/json');

$action = isset($_GET['action']) ? $_GET['action'] : 'get';
$payload = getJsonInput();

function upref_send($ok, $dataOrErr=null, $status=200){
    http_response_code($status);
    if ($ok) echo json_encode(['success'=>true, 'data'=>$dataOrErr]);
    else echo json_encode(['success'=>false, 'error'=>($dataOrErr ?? 'error')]);
    exit;
}

try {
    switch ($action) {
        case 'get':
            requireRole(['admin','donor','recipient']);
            $key = isset($_GET['key']) ? trim((string)$_GET['key']) : '';
            if ($key === '') upref_send(false, 'key required', 400);
            $userId = (int)(currentUserId() ?? 0);
            if ($userId <= 0) upref_send(false, 'unauthorized', 401);
            $db = Database::getInstance();
            $row = $db->query('SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = ? LIMIT 1', [$userId, $key])->fetch();
            $val = $row ? ($row['pref_value'] ?? null) : null;
            upref_send(true, ['key'=>$key, 'value'=>$val]);
            break;
        case 'update':
            requireRole(['admin','donor','recipient']);
            $key = isset($payload['key']) ? trim((string)$payload['key']) : '';
            $value = isset($payload['value']) ? trim((string)$payload['value']) : '';
            if ($key === '') upref_send(false, 'key required', 400);
            $userId = (int)(currentUserId() ?? 0);
            if ($userId <= 0) upref_send(false, 'unauthorized', 401);
            // allowlist of prefs we store server-side
            $allowed = ['ackNextStepsDontShow'];
            if (!in_array($key, $allowed, true)) upref_send(false, 'unsupported key', 400);
            $db = Database::getInstance();
            $db->query('INSERT INTO user_preferences (user_id, pref_key, pref_value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE pref_value=VALUES(pref_value)', [$userId, $key, $value]);
            upref_send(true, ['message'=>'updated']);
            break;
        default:
            upref_send(false, 'unsupported action', 400);
    }
} catch (Throwable $e) {
    upref_send(false, $e->getMessage(), 500);
}
