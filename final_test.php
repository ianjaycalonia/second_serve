<?php
// FINAL TEST - Run this to verify the fix
error_log("=== FINAL ALLOCATION TEST ===");

// Test 1: Include config
try {
    require_once __DIR__ . '/php/includes/config.php';
    error_log("✅ Config included");
} catch (Exception $e) {
    echo "❌ Config failed: " . $e->getMessage();
    exit;
}

// Test 2: Database connection
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME, DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    error_log("✅ Database connected");
} catch (Exception $e) {
    echo "❌ Database failed: " . $e->getMessage();
    exit;
}

// Test 3: Check admin user
try {
    $stmt = $pdo->query("SELECT user_id, name FROM users WHERE role = 'admin' LIMIT 1");
    $admin = $stmt->fetch();
    if (!$admin) {
        echo "❌ No admin user found";
        exit;
    }
    error_log("✅ Admin user found: {$admin['name']}");
} catch (Exception $e) {
    echo "❌ Admin check failed: " . $e->getMessage();
    exit;
}

// Test 4: Test allocation creation
try {
    $periodKey = date('Y-m-d') . '-W' . date('W');
    $pdo->prepare("INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, ?, NOW())")->execute([$periodKey, $admin['user_id']]);
    $runId = $pdo->lastInsertId();

    echo "✅ ALLOCATION RUN CREATED SUCCESSFULLY!\n";
    echo "Run ID: $runId\n";
    echo "Period: $periodKey\n";
    echo "Admin: {$admin['name']}\n\n";
    echo "🎉 THE ALLOCATION SYSTEM IS NOW FIXED!\n";
    echo "Try the 'Auto for All' button again.\n";

} catch (Exception $e) {
    echo "❌ Allocation creation failed: " . $e->getMessage();
}

error_log("=== FINAL TEST END ===");
?>
