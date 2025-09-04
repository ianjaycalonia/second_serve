<?php
header('Content-Type: text/plain');
$hasGd = extension_loaded('gd');
$details = [
  'gd_loaded' => $hasGd,
  'imagecreatefromjpeg_exists' => function_exists('imagecreatefromjpeg'),
  'imagecreatefrompng_exists' => function_exists('imagecreatefrompng'),
  'imagecreatefromgif_exists' => function_exists('imagecreatefromgif'),
  'imagecreatetruecolor_exists' => function_exists('imagecreatetruecolor'),
  'imagecopyresampled_exists' => function_exists('imagecopyresampled'),
  'imagejpeg_exists' => function_exists('imagejpeg'),
  'php_version' => PHP_VERSION,
  'sapi' => php_sapi_name(),
  'loaded_ini' => php_ini_loaded_file(),
  'additional_inis' => php_ini_scanned_files(),
];
echo json_encode($details, JSON_PRETTY_PRINT);
