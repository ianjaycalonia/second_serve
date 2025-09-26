<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Auth.php';

// Handle preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

// Set CORS headers
setCorsHeaders();
header('Content-Type: application/json');

// Get request method and action
$method = $_SERVER['REQUEST_METHOD'];
$endpoint = isset($_GET['action']) ? sanitize($_GET['action']) : '';

// Get request data (do not sanitize to avoid altering passwords/emails)
$data = getJsonInput();

// Route the request
try {
    switch ($endpoint) {
        case 'login':
            if ($method === 'POST') {
                handleLogin($data);
            } else {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            break;
            
        case 'register':
            if ($method === 'POST') {
                handleRegister($data);
            } else {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            break;

        case 'logout':
            if ($method === 'POST') {
                handleLogout();
            } else {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            break;
            
        default:
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('API Error: ' . $e->getMessage());
    // Development: expose error message for easier debugging
    sendJson(['success' => false, 'error' => $e->getMessage()], 500);
}

/**
 * Handle user login
 */
function handleLogin($data) {
    try {
        $auth = new Auth();
        $result = $auth->loginWithRequest($data);
        sendJson([
            'success' => true,
            'message' => 'Login successful',
            'user' => $result['user'],
            'csrf_token' => $result['csrf_token'],
            'redirect' => $result['redirect']
        ]);
    } catch (Exception $e) {
        error_log('Login error: ' . $e->getMessage());
        // Development: surface exact message (e.g., not approved, invalid role)
        sendJson(['success' => false, 'error' => $e->getMessage()], 401);
    }
}

/**
 * Handle user registration
 */
function handleRegister($data) {
    try {
        $auth = new Auth();
        $result = $auth->registerWithRequest($data);
        sendJson([
            'success' => true,
            'message' => 'Registration successful. Redirecting to your dashboard...',
            'user' => $result['user'],
            'csrf_token' => $result['csrf_token'],
            'redirect' => $result['redirect']
        ]);
        
    } catch (Exception $e) {
        error_log('Registration error: ' . $e->getMessage());
        // Development: surface exact message
        sendJson(['success' => false, 'error' => $e->getMessage()], 400);
    }
}

/**
 * Handle logout
 */
function handleLogout() {
    $auth = new Auth();
    $auth->logout();
    sendJson(['success' => true, 'message' => 'Logged out successfully']);
}
?>
