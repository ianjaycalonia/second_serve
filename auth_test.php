<?php
// Authentication and session test
error_log("=== AUTHENTICATION DEBUG TEST ===");

try {
    require_once __DIR__ . '/php/includes/config.php';
    error_log("✅ Config included");

    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME, DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    error_log("✅ Database connected");

    // Check for admin user
    $stmt = $pdo->query("SELECT user_id, name, email, role FROM users WHERE role = 'admin' LIMIT 5");
    $admins = $stmt->fetchAll();

    if (empty($admins)) {
        error_log("❌ CRITICAL: No admin users found in database!");
        echo json_encode([
            'success' => false,
            'error' => 'No admin users found in database',
            'message' => 'This will cause authentication to fail'
        ]);
        exit;
    }

    error_log("✅ Found " . count($admins) . " admin users:");
    foreach ($admins as $admin) {
        error_log("- ID: {$admin['user_id']}, Name: {$admin['name']}, Email: {$admin['email']}");
    }

    // Test session functions
    session_start();
    error_log("✅ Session started, ID: " . session_id());

    // Test currentUserId function
    $_SESSION['user_id'] = $admins[0]['user_id'];
    $_SESSION['user_role'] = 'admin';

    error_log("✅ Set session: user_id={$admins[0]['user_id']}, user_role=admin");

    // Include functions to test currentUserId and currentUserRole
    require_once __DIR__ . '/php/includes/functions.php';

    $currentUserId = currentUserId();
    $currentUserRole = currentUserRole();

    error_log("✅ currentUserId(): $currentUserId");
    error_log("✅ currentUserRole(): $currentUserRole");

    if ($currentUserId <= 0) {
        error_log("❌ Session functions not working properly");
        echo json_encode([
            'success' => false,
            'error' => 'Session functions not working',
            'currentUserId' => $currentUserId,
            'currentUserRole' => $currentUserRole
        ]);
        exit;
    }

    // Test requireAuth
    try {
        error_log("Testing requireAuth...");
        requireAuth();
        error_log("✅ requireAuth passed");
    } catch (Exception $e) {
        error_log("❌ requireAuth failed: " . $e->getMessage());
        echo json_encode([
            'success' => false,
            'error' => 'requireAuth failed',
            'message' => $e->getMessage()
        ]);
        exit;
    }

    // Test requireRole
    try {
        error_log("Testing requireRole(['admin'])...");
        requireRole(['admin']);
        error_log("✅ requireRole passed");
    } catch (Exception $e) {
        error_log("❌ requireRole failed: " . $e->getMessage());
        echo json_encode([
            'success' => false,
            'error' => 'requireRole failed',
            'message' => $e->getMessage()
        ]);
        exit;
    }

    echo json_encode([
        'success' => true,
        'message' => 'All authentication tests passed',
        'admin_user' => $admins[0],
        'session_id' => session_id(),
        'currentUserId' => $currentUserId,
        'currentUserRole' => $currentUserRole
    ]);

} catch (Exception $e) {
    error_log("❌ Test failed: " . $e->getMessage());
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'trace' => $e->getTraceAsString()
    ]);
}
?>
