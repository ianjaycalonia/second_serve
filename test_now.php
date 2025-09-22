<?php
// EMERGENCY TEST - Copy and paste this URL:
// http://localhost/Capstone%20Project/test_now.php

error_log("=== EMERGENCY TEST ===");

// Check if config.php exists
if (!file_exists(__DIR__ . '/php/includes/config.php')) {
    echo "❌ Config file not found at: " . __DIR__ . '/php/includes/config.php';
    exit;
}

// Include config
require_once __DIR__ . '/php/includes/config.php';
error_log("✅ Config loaded");

// Check database connection
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME, DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    error_log("✅ Database connected");
} catch (Exception $e) {
    echo "❌ Database connection failed: " . $e->getMessage() . "\n";
    echo "Check if:\n";
    echo "1. MySQL is running\n";
    echo "2. Database 'simply_share' exists\n";
    echo "3. Database credentials in config.php are correct\n";
    exit;
}

// Check if tables exist
$tables = ['allocation_runs', 'allocations', 'allocation_items', 'users', 'inventory'];
$missing = [];

foreach ($tables as $table) {
    try {
        $pdo->query("SELECT 1 FROM `$table` LIMIT 1");
        error_log("✅ Table '$table' exists");
    } catch (Exception $e) {
        $missing[] = $table;
        error_log("❌ Table '$table' missing");
    }
}

if (!empty($missing)) {
    echo "❌ Missing tables: " . implode(', ', $missing) . "\n";
    echo "Run this SQL command:\n";
    echo "mysql -u root -p < database/simply_share.sql\n";
    exit;
}

// Check for admin user
try {
    $stmt = $pdo->query("SELECT user_id, name FROM users WHERE role = 'admin' LIMIT 1");
    $admin = $stmt->fetch();
    if (!$admin) {
        echo "❌ No admin users found in database\n";
        echo "The allocation API requires an admin user to be logged in.\n";
        exit;
    }
    error_log("✅ Admin user found: {$admin['name']}");
} catch (Exception $e) {
    echo "❌ Admin user check failed: " . $e->getMessage();
    exit;
}

// Try creating allocation run
try {
    $periodKey = date('Y-m-d') . '-W' . date('W');
    $pdo->prepare("INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, ?, NOW())")->execute([$periodKey, $admin['user_id']]);
    $runId = $pdo->lastInsertId();

    echo "✅ ALLOCATION RUN CREATED SUCCESSFULLY!\n";
    echo "Run ID: $runId\n";
    echo "Period: $periodKey\n";
    echo "Admin: {$admin['name']}\n";
    echo "\n";
    echo "🎉 NOW TRY THE 'AUTO FOR ALL' BUTTON!\n";
    echo "The allocation system should work now.\n";

} catch (Exception $e) {
    echo "❌ Allocation run creation failed: " . $e->getMessage() . "\n";
    echo "Error Code: " . $e->getCode() . "\n";
    echo "Check server error logs for more details.\n";
}

error_log("=== EMERGENCY TEST END ===");
?>
