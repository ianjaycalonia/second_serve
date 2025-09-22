<?php
// Test Database class singleton
error_log("=== DATABASE CLASS TEST ===");

try {
    require_once __DIR__ . '/php/includes/config.php';
    error_log("✅ Config included");

    // Test the Database class
    require_once __DIR__ . '/php/core/Database.php';

    error_log("Testing Database::getInstance()...");
    $db = Database::getInstance();
    error_log("✅ Database instance created");

    // Test a simple query
    error_log("Testing simple query...");
    $result = $db->query("SELECT 1 as test")->fetch();
    error_log("✅ Query successful, result: " . json_encode($result));

    // Test allocation_runs table
    error_log("Testing allocation_runs table...");
    $result = $db->query("SELECT COUNT(*) as count FROM allocation_runs")->fetch();
    error_log("✅ allocation_runs count: " . $result['count']);

    // Test the specific queries used in createRun
    error_log("Testing createRun queries...");

    // INSERT test
    $periodKey = date('Y-m-d') . '-W' . date('W');
    $db->query('INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, 1, NOW())', [$periodKey]);
    error_log("✅ INSERT successful");

    $lastInsertId = $db->lastInsertId();
    error_log("✅ Last insert ID: $lastInsertId");

    // SELECT test
    $row = $db->query('SELECT run_id FROM allocation_runs WHERE run_id = ?', [$lastInsertId])->fetch();
    error_log("✅ SELECT successful, run_id: " . $row['run_id']);

    echo json_encode([
        'success' => true,
        'message' => 'Database class test completed successfully',
        'last_insert_id' => $lastInsertId,
        'period_key' => $periodKey
    ]);

} catch (Exception $e) {
    error_log("❌ Database class test failed: " . $e->getMessage());
    error_log("Stack trace: " . $e->getTraceAsString());

    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
    ]);
}
?>
