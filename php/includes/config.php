<?php
// Application configuration (environment overrides for hosted environments)
ini_set('date.timezone', 'Asia/Manila');
date_default_timezone_set('Asia/Manila');

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
// Default to hosting DB on SmarterASP, but use local MySQL when running on localhost.
$defaultDbHost = 'mysql1001.site4now.net';
$defaultDbName = 'db_ac1941_sshare';
$defaultDbUser = 'ac1941_sshare';
$defaultDbPass = 'NewSmart4sp!';

// On local XAMPP (localhost / 127.0.0.1), prefer the local database by default.
if (in_array($hostName, ['localhost', '127.0.0.1'], true)) {
    $defaultDbHost = '127.0.0.1';
    $defaultDbName = 'simply_share';
    $defaultDbUser = 'root';
    $defaultDbPass = '';
}

define('DB_HOST', getenv('DB_HOST') ?: $defaultDbHost);
define('DB_NAME', getenv('DB_NAME') ?: $defaultDbName);
define('DB_USER', getenv('DB_USER') ?: $defaultDbUser);
define('DB_PASS', getenv('DB_PASS') ?: $defaultDbPass);

// Session configuration
define('SESSION_LIFETIME', 86400); // 24 hours
ini_set('session.gc_maxlifetime', SESSION_LIFETIME);
ini_set('session.cookie_lifetime', SESSION_LIFETIME);
ini_set('session.cookie_httponly', 1);
ini_set('session.use_strict_mode', 1);
ini_set('session.cookie_secure', $isHttps ? 1 : 0);

// Ensure a stable, writable session storage directory (important on shared hosting)
$sessionPath = getenv('SESSION_SAVE_PATH');
if (!$sessionPath) {
    $sessionPath = __DIR__ . '/../sessions';
}
if (!is_dir($sessionPath)) {
    @mkdir($sessionPath, 0777, true);
}
ini_set('session.save_path', $sessionPath);

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

if (session_status() === PHP_SESSION_ACTIVE && !empty($_SESSION['user_id'] ?? null) && empty($_SESSION['csrf_token'] ?? null)) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// Error reporting (log errors, do not display in HTTP responses)
error_reporting(E_ALL);
ini_set('display_errors', 0);

define('APP_DEBUG', filter_var(getenv('APP_DEBUG') ?: '0', FILTER_VALIDATE_BOOLEAN));
ini_set('html_errors', 0);
// Enable output buffering so API helpers can clear any warnings/notices before emitting JSON
if (function_exists('ob_get_level') && @ob_get_level() === 0) { @ob_start(); }

// Include required files
require_once __DIR__ . '/../core/Database.php';
require_once __DIR__ . '/functions.php';
