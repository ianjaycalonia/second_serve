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
    $value = trim((string)$data);
    return strip_tags($value);
}

function getCsrfTokenFromRequest(): ?string {
    $headers = [];
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
    }
    $token = $headers['X-CSRF-Token'] ?? $headers['X-Csrf-Token'] ?? null;
    if ($token === null && isset($_SERVER['HTTP_X_CSRF_TOKEN'])) {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'];
    }
    if ($token === null && isset($_POST['csrf_token'])) {
        $token = (string)$_POST['csrf_token'];
    }
    if ($token === null && isset($_GET['csrf_token'])) {
        $token = (string)$_GET['csrf_token'];
    }
    return $token !== null ? trim((string)$token) : null;
}

function requireCsrfToken() {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (in_array(strtoupper($method), ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }

    $sessionToken = $_SESSION['csrf_token'] ?? null;
    if (empty($sessionToken)) {
        sendJson(['success' => false, 'error' => 'Session expired'], 419);
    }

    $requestToken = getCsrfTokenFromRequest();
    if (!$requestToken || !hash_equals((string)$sessionToken, (string)$requestToken)) {
        sendJson(['success' => false, 'error' => 'Invalid CSRF token'], 403);
    }
}

function getJsonInput(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
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

// CSRF helpers
function csrfSessionToken(): string {
    return isset($_SESSION['csrf_token']) && is_string($_SESSION['csrf_token']) ? $_SESSION['csrf_token'] : '';
}

function csrfRequestToken(): string {
    $hdr = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($hdr !== '') return (string)$hdr;
    $hdr2 = $_SERVER['HTTP_X_XSRF_TOKEN'] ?? '';
    if ($hdr2 !== '') return (string)$hdr2;
    $cookie = $_COOKIE['XSRF-TOKEN'] ?? '';
    if ($cookie !== '') return (string)$cookie;
    // Do NOT consume php://input here to avoid interfering with endpoint parsers
    $post = $_POST['csrf_token'] ?? '';
    return (string)$post;
}

function requireCsrf(): void {
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (in_array($method, ['GET','HEAD','OPTIONS'], true)) { return; }
    $sess = csrfSessionToken();
    $provided = csrfRequestToken();
    if ($sess === '' || $provided === '' || !hash_equals($sess, $provided)) {
        sendJson(['success' => false, 'error' => 'CSRF token mismatch'], 419);
    }
}
