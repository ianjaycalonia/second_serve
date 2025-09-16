<?php
require_once __DIR__ . '/../includes/config.php';

// CORS / preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}
setCorsHeaders();
header('Content-Type: application/json');

try {
    $db = Database::getInstance();
    // Simple connection check + a tiny query
    $row = $db->query('SELECT COUNT(*) AS n FROM users')->fetch();
    $ok = is_array($row) && array_key_exists('n', $row);
    echo json_encode([
        'success' => $ok,
        'app' => APP_NAME,
        'db' => [
            'name' => DB_NAME,
            'connected' => $ok,
            'users' => (int)($row['n'] ?? 0)
        ]
    ]);
} catch (Exception $e) {
    // Include details to speed up debugging (only safe info)
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'DB connection failed',
        'detail' => $e->getMessage()
    ]);
}
