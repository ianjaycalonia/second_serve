<?php
// Shared helper functions

function sendJson($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($data);
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
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
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
    if (empty($_SESSION['user_id'])) {
        sendJson(['success' => false, 'error' => 'Authentication required'], 401);
    }
}

function requireRole($roles) {
    requireAuth();
    $roles = is_array($roles) ? $roles : [$roles];
    $role = $_SESSION['user_role'] ?? null;
    if (!$role || !in_array($role, $roles, true)) {
        sendJson(['success' => false, 'error' => 'Forbidden'], 403);
    }
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
