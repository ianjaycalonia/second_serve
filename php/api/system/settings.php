<?php
require_once __DIR__ . '/../../includes/config.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');

const SUPPORTED_SETTINGS = [
    'week_start',
    'di_auto_open_alloc',
    'require_ack_checkbox',
    'inventory_soon_expire_lead_days',
    'expiry_lead_time_days',
    'distribution_distributable_percent',
    'recipient_cancellation_hours',
];

const DEFAULT_SETTING_VALUES = [
    'week_start' => 'sunday',
    'di_auto_open_alloc' => '0',
    'require_ack_checkbox' => '0',
    'inventory_soon_expire_lead_days' => '7',
    'expiry_lead_time_days' => '14',
    'distribution_distributable_percent' => '90',
    'recipient_cancellation_hours' => '24',
];

const SETTING_ROLE_OVERRIDES = [
    // Expiry lead time must be visible to donors/recipients so entry forms can enforce the rule client-side.
    'expiry_lead_time_days' => ['admin', 'donor', 'recipient']
];



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

function normalizeSettingValue(string $key, $value){
    switch ($key) {
        case 'week_start':
            $val = strtolower(trim((string)$value));
            if (!in_array($val, ['sunday','monday'], true)) {
                throw new InvalidArgumentException('invalid week_start');
            }
            return $val;

        case 'di_auto_open_alloc':
        case 'require_ack_checkbox':
            $val = strtolower(trim((string)$value));
            return in_array($val, ['1','true','yes','on'], true) ? '1' : '0';

        case 'inventory_soon_expire_lead_days':
            $days = (int)$value;
            if ($days < 0) { $days = 0; }
            return (string)$days;

        case 'expiry_lead_time_days':
            $days = (int)$value;
            if ($days < 0) { $days = 0; }
            return (string)$days;

        case 'distribution_distributable_percent':
            $percent = (int)$value;
            if ($percent < 0) { $percent = 0; }
            if ($percent > 100) { $percent = 100; }
            return (string)$percent;

        case 'recipient_cancellation_hours':
            $hours = (int)$value;
            if ($hours < 0) { $hours = 0; }
            return (string)$hours;

        default:
            throw new InvalidArgumentException('unsupported key');
    }
}

try {
    switch ($action) {
        case 'get':
            $key = isset($_GET['key']) ? trim((string)$_GET['key']) : '';
            if ($key === '') { sendJson(['success'=>false,'error'=>'key required'], 400); }
            if (!in_array($key, SUPPORTED_SETTINGS, true)){
                sendJson(['success'=>false,'error'=>'unsupported key'], 400);
            }
            $roles = SETTING_ROLE_OVERRIDES[$key] ?? ['admin'];
            requireRole($roles);
            $default = DEFAULT_SETTING_VALUES[$key] ?? null;
            $val = getSetting($key, $default);
            sendJson(['success'=>true, 'data'=>['key'=>$key,'value'=>$val]]);

        case 'all':
            requireRole(['admin']);
            $keys = SUPPORTED_SETTINGS;
            if (isset($_GET['keys']) && $_GET['keys'] !== ''){
                $requested = array_map('trim', explode(',', (string)$_GET['keys']));
                $keys = array_values(array_intersect($requested, SUPPORTED_SETTINGS));
                if (empty($keys)){
                    sendJson(['success'=>false,'error'=>'no supported keys requested'], 400);
                }
            }
            $data = [];
            foreach ($keys as $k){
                $data[$k] = getSetting($k, DEFAULT_SETTING_VALUES[$k] ?? null);
            }
            sendJson(['success'=>true,'data'=>$data]);

        case 'update':
            requireRole(['admin']);
            if ($_SERVER['REQUEST_METHOD'] !== 'POST'){
                sendJson(['success'=>false,'error'=>'Method Not Allowed'], 405);
            }
            $key = isset($payload['key']) ? trim((string)$payload['key']) : '';
            $value = isset($payload['value']) ? trim((string)$payload['value']) : '';
            if ($key === '') { sendJson(['success'=>false,'error'=>'key required'], 400); }
            if (!in_array($key, SUPPORTED_SETTINGS, true)) { sendJson(['success'=>false,'error'=>'unsupported key'], 400); }
            try {
                $value = normalizeSettingValue($key, $value);
            } catch (InvalidArgumentException $e) {
                sendJson(['success'=>false,'error'=>$e->getMessage()], 400);
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
                    sendJson(['success'=>false,'error'=>'DB error: ' . $e2->getMessage()], 500);
                }
            }
            sendJson(['success'=>true, 'message'=>'updated']);

        case 'bulk_update':
            requireRole(['admin']);
            if ($_SERVER['REQUEST_METHOD'] !== 'POST'){
                sendJson(['success'=>false,'error'=>'Method Not Allowed'], 405);
            }
            $incoming = $payload['settings'] ?? null;
            if (!is_array($incoming) || empty($incoming)){
                sendJson(['success'=>false,'error'=>'settings payload required'], 400);
            }
            $db = Database::getInstance();
            try {
                $db->beginTransaction();
                foreach ($incoming as $k => $v){
                    $key = is_string($k) ? trim($k) : '';
                    $valueRaw = $v;
                    if (is_array($v)){
                        $key = isset($v['key']) ? trim((string)$v['key']) : $key;
                        $valueRaw = $v['value'] ?? '';
                    }
                    if ($key === '' || !in_array($key, SUPPORTED_SETTINGS, true)){
                        throw new InvalidArgumentException('unsupported key');
                    }
                    $normalized = normalizeSettingValue($key, $valueRaw);
                    $db->query('INSERT INTO settings(`key`,`value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)', [$key, $normalized]);
                }
                $db->commit();
            } catch (Throwable $e){
                try { if ($db->inTransaction()) { $db->rollBack(); } } catch (Throwable $_){}
                $code = ($e instanceof InvalidArgumentException) ? 400 : 500;
                sendJson(['success'=>false,'error'=>$e->getMessage() ?: 'bulk update failed'], $code);
            }
            sendJson(['success'=>true,'message'=>'updated']);

        case 'bulk_get':
            requireRole(['admin']);
            if ($_SERVER['REQUEST_METHOD'] !== 'POST'){
                sendJson(['success'=>false,'error'=>'Method Not Allowed'], 405);
            }
            $incoming = $payload['keys'] ?? null;
            if (!is_array($incoming) || empty($incoming)){
                sendJson(['success'=>false,'error'=>'keys payload required'], 400);
            }
            $db = Database::getInstance();
            $data = [];
            try {
                foreach ($incoming as $k){
                    $key = trim($k);
                    if (!in_array($key, SUPPORTED_SETTINGS, true)){
                        throw new InvalidArgumentException('unsupported key');
                    }
                    $data[$key] = getSetting($key, DEFAULT_SETTING_VALUES[$key] ?? null);
                }
            } catch (Throwable $e){
                $code = ($e instanceof InvalidArgumentException) ? 400 : 500;
                sendJson(['success'=>false,'error'=>$e->getMessage() ?: 'bulk get failed'], $code);
            }
            sendJson(['success'=>true,'data'=>$data]);

        default:
            sendJson(['success'=>false, 'error'=>'unsupported action'], 400);
    }
} catch (Throwable $e){
    sendJson(['success'=>false, 'error'=>$e->getMessage()], 500);
}

