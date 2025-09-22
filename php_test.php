<?php
echo "PHP is working!<br>";
echo "Current time: " . date('Y-m-d H:i:s') . "<br>";
echo "PHP Version: " . phpversion() . "<br>";

if (function_exists('error_log')) {
    error_log("PHP error_log test successful");
    echo "Error logging: ✅ Working<br>";
} else {
    echo "Error logging: ❌ Not working<br>";
}

try {
    $pdo = new PDO("mysql:host=localhost;dbname=simply_share", "root", "");
    echo "Database: ✅ Connected<br>";
} catch (Exception $e) {
    echo "Database: ❌ " . $e->getMessage() . "<br>";
}
?>
