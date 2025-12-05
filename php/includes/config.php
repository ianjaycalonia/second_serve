<?php
// Application configuration (environment overrides for hosted environments)
define('APP_NAME', getenv('APP_NAME') ?: 'Second Serve');
$hostHeader = $_SERVER['HTTP_HOST'] ?? '';
$hostName = null;
$explicitPort = null;
if ($hostHeader !== '') {
    $parsedHost = parse_url('//' . $hostHeader, PHP_URL_HOST);
    $parsedPort = parse_url('//' . $hostHeader, PHP_URL_PORT);
    if (is_string($parsedHost) && $parsedHost !== '') {
        $hostName = $parsedHost;
    }
    if (is_int($parsedPort)) {
        $explicitPort = $parsedPort;
    }
}
if ($hostName === null || $hostName === '') {
    $serverName = $_SERVER['SERVER_NAME'] ?? '';
    $hostName = $serverName !== '' ? $serverName : 'localhost';
}
// Detect HTTPS based solely on the actual PHP HTTPS flag to avoid
// misconfigured proxy headers on shared hosting breaking cookies.
$isHttps = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
$scheme = $isHttps ? 'https' : 'http';
$defaultPort = $isHttps ? 443 : 80;
$serverPort = isset($_SERVER['SERVER_PORT']) ? (int) $_SERVER['SERVER_PORT'] : null;
$hostForUrl = $hostHeader !== '' ? $hostHeader : $hostName;
if ($hostHeader === '' && $serverPort && $serverPort !== $defaultPort) {
    $hostForUrl .= ':' . $serverPort;
}
$envAppUrl = getenv('APP_URL');
define('APP_URL', $envAppUrl ?: ($scheme . '://' . $hostForUrl));
if (!defined('APP_COOKIE_DOMAIN')) {
    define('APP_COOKIE_DOMAIN', $hostName);
}
if (!defined('APP_COOKIE_SECURE')) {
    define('APP_COOKIE_SECURE', $isHttps);
}

// Database configuration (override via environment for hosting providers)
define('DB_HOST', getenv('DB_HOST') ?: 'mysql1001.site4now.net');
define('DB_NAME', getenv('DB_NAME') ?: 'db_ac1941_sshare');
define('DB_USER', getenv('DB_USER') ?: 'ac1941_sshare');
define('DB_PASS', getenv('DB_PASS') ?: 'NewSmart4sp!');

// Session configuration
define('SESSION_LIFETIME', 86400); // 24 hours
ini_set('session.gc_maxlifetime', SESSION_LIFETIME);
ini_set('session.cookie_lifetime', SESSION_LIFETIME);
ini_set('session.cookie_httponly', 1);
ini_set('session.use_strict_mode', 1);
ini_set('session.cookie_secure', $isHttps ? 1 : 0);

// Allow configuring approved origins for CORS via environment or fallback to same-origin
if (!defined('APP_ALLOWED_ORIGINS')) {
    $defaultOrigin = ($scheme . '://' . $hostForUrl);
    $envOrigins = getenv('APP_ALLOWED_ORIGINS');
    $origins = $envOrigins ? array_filter(array_map('trim', explode(',', $envOrigins))) : [$defaultOrigin];
    define('APP_ALLOWED_ORIGINS', $origins);
}

session_set_cookie_params([
    'lifetime' => SESSION_LIFETIME,
    'path' => '/',
    'domain' => $hostName,
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Lax',
]);

session_start();

// Error reporting (log errors, do not display in HTTP responses)
error_reporting(E_ALL);
ini_set('display_errors', 0);

define('APP_DEBUG', filter_var(getenv('APP_DEBUG') ?: '0', FILTER_VALIDATE_BOOLEAN));
ini_set('html_errors', 0);
// Enable output buffering so API helpers can clear any warnings/notices before emitting JSON
if (function_exists('ob_get_level') && @ob_get_level() === 0) { @ob_start(); }

// Set default timezone
date_default_timezone_set('Asia/Manila');

// Include required files
require_once __DIR__ . '/../core/Database.php';
require_once __DIR__ . '/functions.php';
