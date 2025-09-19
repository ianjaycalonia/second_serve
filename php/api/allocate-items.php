<?php
// Endpoint deprecated and removed.
require_once __DIR__ . '/../includes/config.php';

// CORS/preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

// Always return 410 Gone
http_response_code(410);
echo json_encode([
    'success' => false,
    'error' => 'This endpoint has been removed. Use allocations.php preview/finalize flow and inventory move-out APIs.',
]);
exit;
