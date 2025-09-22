<?php
// Comprehensive debugging test for allocation issues
error_log("=== COMPREHENSIVE ALLOCATION DEBUG TEST ===");

// Test 1: Database connection
try {
    $pdo = new PDO("mysql:host=localhost;dbname=simply_share", "root", "");
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    error_log("✅ Database connection: SUCCESS");
} catch (Exception $e) {
    error_log("❌ Database connection: FAILED - " . $e->getMessage());
}

// Test 2: Check if tables exist
$requiredTables = ['allocation_runs', 'allocations', 'allocation_items', 'users', 'inventory'];
foreach ($requiredTables as $table) {
    try {
        $pdo->query("SELECT 1 FROM `$table` LIMIT 1")->fetch();
        error_log("✅ Table '$table': EXISTS");
    } catch (Exception $e) {
        error_log("❌ Table '$table': MISSING - " . $e->getMessage());
    }
}

// Test 3: Check admin user
try {
    $stmt = $pdo->query("SELECT user_id, name, role FROM users WHERE role = 'admin' LIMIT 1");
    $admin = $stmt->fetch();
    if ($admin) {
        error_log("✅ Admin user found: ID={$admin['user_id']}, Name={$admin['name']}");
    } else {
        error_log("❌ No admin users found in database");
    }
} catch (Exception $e) {
    error_log("❌ Admin user check failed: " . $e->getMessage());
}

// Test 4: Test allocation_runs insert
try {
    $periodKey = date('Y-m-d') . '-W' . date('W');
    $stmt = $pdo->prepare("INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, 1, NOW())");
    $stmt->execute([$periodKey]);
    $runId = $pdo->lastInsertId();
    error_log("✅ Allocation run insert: SUCCESS - Run ID: $runId, Period: $periodKey");

    // Test select
    $stmt = $pdo->prepare("SELECT run_id FROM allocation_runs WHERE created_by = 1 ORDER BY run_id DESC LIMIT 1");
    $stmt->execute();
    $row = $stmt->fetch();
    error_log("✅ Allocation run select: SUCCESS - Retrieved Run ID: " . $row['run_id']);
} catch (Exception $e) {
    error_log("❌ Allocation run test: FAILED - " . $e->getMessage());
}

echo "Debug test completed. Check server error logs for detailed results.";
?>
