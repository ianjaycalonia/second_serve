// Simple test - just open this URL in browser
error_log("=== SIMPLE TEST START ===");

// Test 1: Check if we can include config
try {
    require_once __DIR__ . '/php/includes/config.php';
    error_log("✅ Config loaded");
} catch (Exception $e) {
    error_log("❌ Config failed: " . $e->getMessage());
    echo "Config failed: " . $e->getMessage();
    exit;
}

// Test 2: Check database connection
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME, DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    error_log("✅ Database connected");
} catch (Exception $e) {
    error_log("❌ Database failed: " . $e->getMessage());
    echo "Database failed: " . $e->getMessage();
    exit;
}

// Test 3: Check if allocation_runs table exists
try {
    $pdo->query("SELECT 1 FROM allocation_runs LIMIT 1");
    error_log("✅ allocation_runs table exists");
} catch (Exception $e) {
    error_log("❌ allocation_runs table missing: " . $e->getMessage());
    echo "Table missing: " . $e->getMessage();
    exit;
}

// Test 4: Try creating an allocation run
try {
    $periodKey = date('Y-m-d') . '-W' . date('W');
    $pdo->prepare("INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, 1, NOW())")->execute([$periodKey]);
    $runId = $pdo->lastInsertId();
    error_log("✅ Allocation run created: ID=$runId, Period=$periodKey");

    echo json_encode([
        'success' => true,
        'message' => 'All tests passed!',
        'run_id' => $runId,
        'period_key' => $periodKey,
        'instructions' => 'Now try the Auto for All feature in the browser'
    ]);

} catch (Exception $e) {
    error_log("❌ Allocation run creation failed: " . $e->getMessage());
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'instructions' => 'Check server error logs for more details'
    ]);
}

error_log("=== SIMPLE TEST END ===");
?>
