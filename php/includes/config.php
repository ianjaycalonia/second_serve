<?php
// Application configuration
define('APP_NAME', 'Second Serve');
define('APP_URL', 'http://' . $_SERVER['HTTP_HOST']);

// Database configuration
define('DB_HOST', 'localhost');
define('DB_NAME', 'simply_share');
define('DB_USER', 'root');
define('DB_PASS', '');

// Session configuration
define('SESSION_LIFETIME', 86400); // 24 hours
ini_set('session.gc_maxlifetime', SESSION_LIFETIME);
ini_set('session.cookie_lifetime', SESSION_LIFETIME);
session_start();

// Error reporting (log errors, do not display in HTTP responses)
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('html_errors', 0);
// Enable output buffering so API helpers can clear any warnings/notices before emitting JSON
if (function_exists('ob_get_level') && @ob_get_level() === 0) { @ob_start(); }

// Set default timezone
date_default_timezone_set('Asia/Manila');

// Include required files
require_once __DIR__ . '/../core/Database.php';
require_once __DIR__ . '/functions.php';
