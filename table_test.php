<?php
// Minimal table existence test
error_log("=== MINIMAL TABLE TEST ===");

try {
    require_once __DIR__ . '/php/includes/config.php';
    error_log("✅ Config included");

    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME, DB_USER, DB_PASS);
    error_log("✅ Database connected");

    // Just check if tables exist
    $tables = ['users', 'allocation_runs', 'allocations', 'allocation_items', 'inventory'];
    $results = [];

    foreach ($tables as $table) {
        try {
            $pdo->query("SELECT 1 FROM `$table` LIMIT 1");
            $results[$table] = '✅ EXISTS';
            error_log("✅ $table: EXISTS");
        } catch (Exception $e) {
            $results[$table] = '❌ MISSING - ' . $e->getMessage();
            error_log("❌ $table: MISSING - " . $e->getMessage());
        }
    }

    echo json_encode([
        'success' => true,
        'results' => $results,
        'message' => 'Table existence check completed'
    ]);

} catch (Exception $e) {
    error_log("❌ Connection failed: " . $e->getMessage());
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>
