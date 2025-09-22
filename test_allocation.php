<?php
require_once __DIR__ . '/php/includes/config.php';
require_once __DIR__ . '/php/core/Allocation.php';

echo "Testing createRun method...\n";

try {
    $alloc = new Allocation();
    $runId = $alloc->createRun(1, 'Test API run', '2025-01-W1');
    echo "✅ createRun successful, run_id: $runId\n";

    // Test the API endpoint
    echo "\nTesting API endpoint...\n";

    // Set up session for authentication
    session_start();
    $_SESSION['user_id'] = 1;
    $_SESSION['role'] = 'admin';

    // Test the allocations API directly
    $payload = json_encode(['note' => 'Test API run', 'period_key' => '2025-01-W1']);
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => 'Content-Type: application/json',
            'content' => $payload,
            'ignore_errors' => true
        ]
    ]);

    $response = file_get_contents('http://localhost/Capstone%20Project/php/api/allocations.php?action=create_run', false, $context);

    if ($response !== false) {
        $result = json_decode($response, true);
        if ($result && isset($result['success']) && $result['success']) {
            echo "✅ API endpoint successful, run_id: " . $result['data']['run_id'] . "\n";
        } else {
            echo "❌ API endpoint failed: " . ($result['error'] ?? 'Unknown error') . "\n";
            echo "Response: $response\n";
        }
    } else {
        echo "❌ Could not connect to API endpoint\n";
    }

} catch (Exception $e) {
    echo "❌ Error: " . $e->getMessage() . "\n";
}
?>
