<?php
require_once __DIR__ . '/../includes/config.php';

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') { exit(0); }

$action = isset($_GET['action']) ? $_GET['action'] : 'get';
$payload = sanitize(getJsonInput());

function getSetting(string $key, $default = null){
    try {
        $db = Database::getInstance();
        $row = $db->query('SELECT `value` FROM settings WHERE `key` = ? LIMIT 1', [$key])->fetch();
        if ($row && array_key_exists('value', $row)) return $row['value'];
        return $default;
    } catch (Throwable $e){
        // Graceful fallback if table does not exist yet
        return $default;
    }
}

try {
    switch ($action) {
        case 'get':
            requireRole(['admin']);
            $key = isset($_GET['key']) ? trim((string)$_GET['key']) : '';
            if ($key === '') { echo json_encode(['success'=>false,'error'=>'key required']); exit; }
            $default = ($key === 'week_start') ? 'sunday' : null;
            $val = getSetting($key, $default);
            echo json_encode(['success'=>true, 'data'=>['key'=>$key,'value'=>$val]]);
            break;

        case 'update':
            requireRole(['admin']);
            if ($_SERVER['REQUEST_METHOD'] !== 'POST'){
                http_response_code(405);
                echo json_encode(['success'=>false,'error'=>'Method Not Allowed']);
                exit;
            }
            $key = isset($payload['key']) ? trim((string)$payload['key']) : '';
            $value = isset($payload['value']) ? trim((string)$payload['value']) : '';
            if ($key === '') { echo json_encode(['success'=>false,'error'=>'key required']); exit; }
            // Restrict known keys for now (security)
            $allowed = ['week_start'];
            if (!in_array($key, $allowed, true)) { echo json_encode(['success'=>false,'error'=>'unsupported key']); exit; }
            if ($key === 'week_start' && !in_array(strtolower($value), ['sunday','monday'], true)){
                echo json_encode(['success'=>false,'error'=>'invalid week_start']); exit;
            }
            $db = Database::getInstance();
            try {
                $db->query('INSERT INTO settings(`key`,`value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)', [$key, $value]);
            } catch (Throwable $e){
                // Attempt to auto-create the settings table if it does not exist, then retry once
                try {
                    $db->query("CREATE TABLE IF NOT EXISTS `settings` (
                        `key` varchar(64) NOT NULL,
                        `value` varchar(255) NOT NULL,
                        `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                        PRIMARY KEY (`key`)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");
                    // Retry insert after ensuring table exists
                    $db->query('INSERT INTO settings(`key`,`value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)', [$key, $value]);
                } catch (Throwable $e2){
                    http_response_code(500);
                    echo json_encode(['success'=>false,'error'=>'DB error: ' . $e2->getMessage()]);
                    exit;
                }
            }
            echo json_encode(['success'=>true, 'message'=>'updated']);
            break;

        default:
            echo json_encode(['success'=>false, 'error'=>'unsupported action']);
    }
} catch (Throwable $e){
    http_response_code(500);
    echo json_encode(['success'=>false, 'error'=>$e->getMessage()]);
}
