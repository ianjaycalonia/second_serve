<?php
// Simple database connection test
error_log("=== SIMPLE DB CONNECTION TEST ===");

try {
    // Include config
    require_once __DIR__ . '/php/includes/config.php';
    error_log("✅ Config included");

    // Test direct PDO connection
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME, DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    error_log("✅ Direct PDO connection successful");

    // Test allocation_runs table
    $pdo->query("SELECT 1 FROM allocation_runs LIMIT 1")->fetch();
    error_log("✅ allocation_runs table exists");

    // Test a simple insert
    $periodKey = date('Y-m-d') . '-W' . date('W');
    $pdo->prepare("INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, 1, NOW())")->execute([$periodKey]);
    $runId = $pdo->lastInsertId();
    error_log("✅ Simple insert successful - Run ID: $runId");

    echo json_encode([
        'success' => true,
        'message' => 'All basic tests passed',
        'run_id' => $runId,
        'period_key' => $periodKey
    ]);

} catch (Exception $e) {
    error_log("❌ Test failed: " . $e->getMessage());
    error_log("Stack trace: " . $e->getTraceAsString());

    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
    ]);
}
?>
