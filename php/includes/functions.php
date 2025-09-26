<?php
// Shared helper functions

function sendJson($data, $statusCode = 200) {
    // Clean any accidental output (BOM, stray echoes, notices)
    if (function_exists('ob_get_level')) {
        // Drop ALL active buffers
        while (@ob_get_level() > 0) {
            @ob_end_clean();
        }
    }
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    // Force inline display in browsers (avoid download prompt)
    header('Content-Disposition: inline');
    // Prevent caching issues
    header('Cache-Control: no-cache, no-store, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit();
}

function sanitize($data) {
    if (is_array($data)) {
        return array_map('sanitize', $data);
    }
    return htmlspecialchars(trim((string)$data), ENT_QUOTES, 'UTF-8');
}

function getJsonInput(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function setCorsHeaders() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    } else {
        // Fallback for same-origin requests
        header('Access-Control-Allow-Origin: *');
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Credentials: true');
}

// RBAC helpers
function currentUserId() {
    return $_SESSION['user_id'] ?? null;
}

function currentUserRole() {
    return $_SESSION['user_role'] ?? null;
}

function requireAuth() {
    error_log("=== REQUIREAUTH DEBUG ===");
    error_log("requireAuth called");
    error_log("Session user_id: " . var_export($_SESSION['user_id'] ?? 'null', true));

    if (empty($_SESSION['user_id'])) {
        error_log("requireAuth: No user_id in session, sending 401");
        sendJson(['success' => false, 'error' => 'Authentication required'], 401);
    }

    error_log("requireAuth: Authentication passed for user_id: " . $_SESSION['user_id']);
}

function requireRole($roles) {
    error_log("=== REQUIREROLE DEBUG ===");
    error_log("requireRole called with roles: " . json_encode($roles));
    error_log("Session user_id: " . var_export($_SESSION['user_id'] ?? 'null', true));
    error_log("Session user_role: " . var_export($_SESSION['user_role'] ?? 'null', true));

    requireAuth();
    $roles = is_array($roles) ? $roles : [$roles];
    $role = $_SESSION['user_role'] ?? null;

    error_log("After requireAuth, role: " . var_export($role, true));
    error_log("Required roles: " . json_encode($roles));

    if (!$role || !in_array($role, $roles, true)) {
        error_log("requireRole: Access denied. User role '$role' not in required roles: " . json_encode($roles));
        sendJson(['success' => false, 'error' => 'Forbidden'], 403);
    }

    error_log("requireRole: Access granted for role '$role'");
}

// Build absolute URL for an image path relative to web root
function buildImageFullUrl(string $relative): string {
    if ($relative === '') return '';
    // Already absolute or data URI
    if (preg_match('#^https?://#i', $relative) || strncmp($relative, 'data:', 5) === 0) {
        return $relative;
    }
    $base = defined('APP_URL') ? rtrim(APP_URL, '/') : '';
    if ($base === '') {
        $scheme = (!empty($_SERVER['REQUEST_SCHEME']) ? $_SERVER['REQUEST_SCHEME'] : (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http'));
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $base = $scheme . '://' . $host;
    }
    return $base . '/' . ltrim($relative, '/');
}
