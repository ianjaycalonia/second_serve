<?php
// Comprehensive 500 Error Debugger for Allocation System
error_log("=== 500 ERROR DEBUGGER STARTED ===");

// Step 1: Test basic PHP functionality
error_log("Step 1: Basic PHP Test");
error_log("PHP Version: " . phpversion());
error_log("Current working directory: " . getcwd());
error_log("Script filename: " . __FILE__);

// Step 2: Test config file inclusion
error_log("Step 2: Testing config.php inclusion");
try {
    require_once __DIR__ . '/../includes/config.php';
    error_log("✅ config.php included successfully");
    error_log("DB_HOST: " . DB_HOST);
    error_log("DB_NAME: " . DB_NAME);
    error_log("DB_USER: " . DB_USER);
} catch (Exception $e) {
    error_log("❌ config.php inclusion failed: " . $e->getMessage());
    die("Config inclusion failed");
}

// Step 3: Test database connection
error_log("Step 3: Testing database connection");
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4", DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    error_log("✅ Database connection successful");
} catch (PDOException $e) {
    error_log("❌ Database connection failed: " . $e->getMessage());
    error_log("Error Code: " . $e->getCode());
    die("Database connection failed");
}

// Step 4: Test required tables
error_log("Step 4: Testing required tables");
$requiredTables = ['users', 'allocation_runs', 'allocations', 'allocation_items', 'inventory'];
foreach ($requiredTables as $table) {
    try {
        $pdo->query("SELECT 1 FROM `$table` LIMIT 1")->fetch();
        error_log("✅ Table '$table' exists");
    } catch (PDOException $e) {
        error_log("❌ Table '$table' missing: " . $e->getMessage());
    }
}

// Step 5: Test admin user
error_log("Step 5: Testing admin user");
try {
    $stmt = $pdo->query("SELECT user_id, name, role FROM users WHERE role = 'admin' LIMIT 1");
    $admin = $stmt->fetch();
    if ($admin) {
        error_log("✅ Admin user found: ID={$admin['user_id']}, Name={$admin['name']}");
        $adminId = $admin['user_id'];
    } else {
        error_log("❌ No admin users found - this will cause authentication issues");
        $adminId = 1; // fallback
    }
} catch (PDOException $e) {
    error_log("❌ Admin user check failed: " . $e->getMessage());
    $adminId = 1; // fallback
}

// Step 6: Test allocation_runs table
error_log("Step 6: Testing allocation_runs table");
try {
    // Test INSERT
    $periodKey = date('Y-m-d') . '-W' . date('W');
    $stmt = $pdo->prepare("INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, ?, NOW())");
    $stmt->execute([$periodKey, $adminId]);
    $runId = $pdo->lastInsertId();
    error_log("✅ Allocation run INSERT successful - Run ID: $runId");

    // Test SELECT
    $stmt = $pdo->prepare("SELECT run_id, period_key FROM allocation_runs WHERE run_id = ?");
    $stmt->execute([$runId]);
    $row = $stmt->fetch();
    if ($row) {
        error_log("✅ Allocation run SELECT successful - Found: ID={$row['run_id']}, Period={$row['period_key']}");
    } else {
        error_log("❌ Allocation run SELECT failed - run_id not found");
    }

} catch (PDOException $e) {
    error_log("❌ Allocation run test failed: " . $e->getMessage());
    error_log("SQL State: " . $e->getCode());
}

// Step 7: Test session functionality
error_log("Step 7: Testing session functionality");
session_start();
$_SESSION['debug_test'] = 'session_works';
error_log("✅ Session test: session_id=" . session_id());
error_log("✅ Session test: session data=" . json_encode($_SESSION));

// Step 8: Test Allocation class
error_log("Step 8: Testing Allocation class");
try {
    require_once __DIR__ . '/../core/Allocation.php';
    $allocation = new Allocation();
    error_log("✅ Allocation class instantiated successfully");
} catch (Exception $e) {
    error_log("❌ Allocation class instantiation failed: " . $e->getMessage());
    error_log("Stack trace: " . $e->getTraceAsString());
}

// Step 9: Test createRun method directly
error_log("Step 9: Testing createRun method");
try {
    $result = $allocation->createRun($adminId, null, $periodKey);
    error_log("✅ createRun method successful - Result: $result");
} catch (Exception $e) {
    error_log("❌ createRun method failed: " . $e->getMessage());
    error_log("Stack trace: " . $e->getTraceAsString());
}

error_log("=== 500 ERROR DEBUGGER COMPLETED ===");

echo json_encode([
    'success' => true,
    'message' => 'Debug test completed. Check server error logs for detailed results.',
    'timestamp' => date('Y-m-d H:i:s'),
    'php_version' => phpversion(),
    'session_id' => session_id()
]);
?>
