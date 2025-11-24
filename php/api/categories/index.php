<?php
// Simple Categories API: list only (import removed)
require_once __DIR__ . '/../../includes/config.php';

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// CORS and preflight
setCorsHeaders();
header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$debug  = isset($_GET['debug']) ? (int)$_GET['debug'] : 0;
if ($debug) { ini_set('display_errors', 1); ini_set('display_startup_errors', 1); error_reporting(E_ALL); }

try {
  switch ($action){
    case 'list': {
      $onlyActive = isset($_GET['active']) ? (int)$_GET['active'] : 1;
      $db = Database::getInstance();
      // Prefer new schema (primary_name / secondary_name). If it fails, try legacy schema.
      $items = [];
      try {
        $sql = 'SELECT category_id, primary_name, secondary_name, is_active,
                 CONCAT(primary_name, CASE WHEN secondary_name IS NULL OR secondary_name = "" THEN "" ELSE CONCAT(" - ", secondary_name) END) AS name
                FROM categories WHERE (?=0 OR is_active=1)
                ORDER BY primary_name ASC, secondary_name IS NULL ASC, secondary_name ASC';
        $items = $db->query($sql, [$onlyActive ? 1 : 0])->fetchAll() ?: [];
      } catch (Exception $eNew) {
        // Fallback: legacy flat schema (name/parent_id)
        try {
          $legacy = $db->query('SELECT category_id, name, parent_id, is_active FROM categories WHERE (?=0 OR is_active=1) ORDER BY name ASC', [$onlyActive ? 1 : 0])->fetchAll() ?: [];
          // Keep output consistent: ensure a 'name' field exists
          foreach ($legacy as $row) {
            $items[] = [
              'category_id' => $row['category_id'] ?? null,
              'name' => $row['name'] ?? '',
              'parent_id' => $row['parent_id'] ?? null,
              'is_active' => $row['is_active'] ?? 1,
            ];
          }
        } catch (Exception $eOld) {
          error_log('Categories list failed (both schemas): new=' . $eNew->getMessage() . '; old=' . $eOld->getMessage());
          // Do not block UI — return empty list on failure
          sendJson(['success'=>true,'data'=>['items'=>[]]], 200);
        }
      }
      sendJson(['success'=>true,'data'=>['items'=>$items]]);
      break;
    }
    default:
      sendJson(['success'=>false,'error'=>'Unknown action'], 400);
  }
} catch (Exception $e){ sendJson(['success'=>false,'error'=>$e->getMessage()], 500); }


