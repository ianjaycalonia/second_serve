<?php
// Test authentication without session_start issues
error_log("=== AUTH TEST NO SESSION ===");

try {
    // Include config
    require_once __DIR__ . '/php/includes/config.php';
    error_log("✅ Config included");

    // Test database connection
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME, DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    error_log("✅ Database connected");

    // Check for admin user
    $stmt = $pdo->query("SELECT user_id, name, email, role FROM users WHERE role = 'admin' LIMIT 1");
    $admin = $stmt->fetch();

    if (!$admin) {
        error_log("❌ No admin user found");
        echo json_encode(['success' => false, 'error' => 'No admin user found']);
        exit;
    }

    error_log("✅ Admin user found: ID={$admin['user_id']}, Name={$admin['name']}");

    // Test session functions without starting session
    $_SESSION['user_id'] = $admin['user_id'];
    $_SESSION['user_role'] = 'admin';

    error_log("✅ Session data set: user_id={$admin['user_id']}, user_role=admin");

    // Include functions and test
    require_once __DIR__ . '/php/includes/functions.php';

    $userId = currentUserId();
    $userRole = currentUserRole();

    error_log("✅ currentUserId(): $userId");
    error_log("✅ currentUserRole(): $userRole");

    if ($userId <= 0) {
        error_log("❌ currentUserId() returned invalid value: $userId");
        echo json_encode(['success' => false, 'error' => 'currentUserId() failed', 'userId' => $userId]);
        exit;
    }

    echo json_encode([
        'success' => true,
        'message' => 'Authentication test passed',
        'admin_user' => $admin,
        'userId' => $userId,
        'userRole' => $userRole
    ]);

} catch (Exception $e) {
    error_log("❌ Test failed: " . $e->getMessage());
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
