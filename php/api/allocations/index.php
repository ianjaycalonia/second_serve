<?php
// Start output buffering at the very beginning to catch any BOM/whitespace
if (function_exists('ob_start')) { ob_start(); }

require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Allocation.php';
// Notification is referenced later for admin notifications on completion
// Include explicitly in case autoload is not configured
require_once __DIR__ . '/../../core/Notification.php';

// Error handling: log errors, do NOT display in API responses
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);
ini_set('log_errors', 1);

// Debug: Log all requests
error_log("=== NEW REQUEST ===");
error_log("Request Method: " . $_SERVER['REQUEST_METHOD']);
error_log("Request URI: " . $_SERVER['REQUEST_URI']);
error_log("Action: " . ($_GET['action'] ?? 'none'));
error_log("Session ID: " . session_id());
error_log("Session Status: " . session_status());
error_log("Session Data: " . json_encode($_SESSION ?? []));
error_log("Current time: " . date('Y-m-d H:i:s'));

// Check if database constants are defined
error_log("DB Constants Check:");
error_log("DB_HOST: " . (defined('DB_HOST') ? DB_HOST : 'NOT DEFINED'));
error_log("DB_NAME: " . (defined('DB_NAME') ? DB_NAME : 'NOT DEFINED'));
error_log("DB_USER: " . (defined('DB_USER') ? DB_USER : 'NOT DEFINED'));
error_log("DB_PASS: " . (defined('DB_PASS') ? '[HIDDEN]' : 'NOT DEFINED'));

// Session should already be started by config.php
// Don't call session_start() here to avoid conflicts

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');

// CSRF protection for non-GET methods
requireCsrf();

$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = getJsonInput(); // accept raw then sanitize per field

try {
    switch ($action) {
        case 'preview_allocation':
            requireRole(['admin']);
            // Accept period_key from GET or JSON body
            $periodKey = isset($_GET['period_key']) ? trim((string)$_GET['period_key']) : '';
            if ($periodKey === '' && isset($payload['period_key'])) {
                $periodKey = trim((string)$payload['period_key']);
            }
            if ($periodKey === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $periodKey)) {
                sendJson(['success'=>false,'error'=>'Invalid or missing period_key'], 400);
            }
            // Accept recipient_ids from JSON body or from GET (comma-separated)
            $limitIds = [];
            if (isset($payload['recipient_ids']) && is_array($payload['recipient_ids'])) {
                $limitIds = array_map('intval', $payload['recipient_ids']);
            } elseif (isset($_GET['recipient_ids'])) {
                $parts = preg_split('/[,\s]+/', (string)$_GET['recipient_ids']);
                $limitIds = array_map('intval', array_filter($parts, fn($v)=>$v!==''));
            }
            // Require current selection to be provided to avoid using a broader pool
            if (empty($limitIds)) {
                sendJson(['success'=>false,'error'=>'recipient_ids (current selection) is required and cannot be empty'], 400);
            }
            $svc = new Allocation();
            try {
                $data = $svc->previewAllocation($periodKey, $limitIds);
                sendJson(['success'=>true, 'data'=>$data]);
            } catch (Exception $e) {
                error_log("preview_allocation error: " . $e->getMessage());
                sendJson(['success'=>false,'error'=>'Preview allocation failed: ' . $e->getMessage()], 500);
            }
            break;

        case 'notify_run':
            // Admin required; if not present, fallback to admin session for robustness
            requireRole(['admin']);
            $payload = getJsonInput();
            $runId = isset($payload['run_id']) ? (int)$payload['run_id'] : 0;
            if ($runId <= 0) { sendJson(['success'=>false,'error'=>'run_id is required'], 400); }
            try {
                $db = Database::getInstance();
                $inTxn = false;
                if (!$db->inTransaction()) {
                    $db->beginTransaction();
                    $inTxn = true;
                }
                // Ensure run exists
                $run = $db->query('SELECT run_id FROM allocation_runs WHERE run_id = ? LIMIT 1', [$runId])->fetch();
                if (!$run) sendJson(['success'=>false,'error'=>'Run not found'], 404);
                // Persist DB state: mark all Allocated allocations in this run as Notified
                // Do NOT override later states (Acknowledged, Scheduled, Picked Up, Completed, etc.)
                $db->query(
                    'UPDATE allocations
                     SET status = "Notified", updated_at = NOW()
                     WHERE run_id = ? AND LOWER(COALESCE(status, "")) IN ("pending","allocated","updated")'
                    , [$runId]
                );
                // Do not insert a generic notification here; upstream callers may add
                // a richer, de-duplicated notification.
                sendJson(['success'=>true, 'data'=>['run_id'=>$runId]]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Failed to notify run: ' . $e->getMessage()], 500);
            }
            break;

        case 'notify_recipient':
            // Admin required; if not present, fallback to admin session for robustness
            requireRole(['admin']);
            $payload = getJsonInput();
            $runId = isset($payload['run_id']) ? (int)$payload['run_id'] : 0;
            $recipientId = isset($payload['recipient_id']) ? (int)$payload['recipient_id'] : 0;
            if ($runId <= 0 || $recipientId <= 0) { sendJson(['success'=>false,'error'=>'run_id and recipient_id are required'], 400); }
            try {
                $db = Database::getInstance();
                // Ensure run exists
                $run = $db->query('SELECT run_id FROM allocation_runs WHERE run_id = ? LIMIT 1', [$runId])->fetch();
                if (!$run) sendJson(['success'=>false,'error'=>'Run not found'], 404);
                // Persist DB state: mark allocations for this recipient in this run as Notified
                $db->query(
                    'UPDATE allocations
                     SET status = "Notified", updated_at = NOW()
                     WHERE run_id = ? AND recipient_id = ? AND LOWER(COALESCE(status, "")) IN ("pending","allocated","updated")'
                    , [$runId, $recipientId]
                );
                // Do not insert a generic notification here; upstream may handle messaging.
                sendJson(['success'=>true, 'data'=>['run_id'=>$runId, 'recipient_id'=>$recipientId]]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Failed to notify recipient: ' . $e->getMessage()], 500);
            }
            break;

        case 'allocate_week':
            requireRole(['admin']);
            $periodKey = isset($payload['period_key']) ? trim((string)$payload['period_key']) : '';
            if ($periodKey === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $periodKey)) {
                sendJson(['success'=>false,'error'=>'Invalid or missing period_key'], 400);
            }
            $adminId = (int)(currentUserId() ?? 0);
            $svc = new Allocation();
            $res = $svc->allocateWeek($periodKey, $adminId);
            sendJson(['success'=>true, 'data'=>$res]);
            break;

        case 'create_result':
            // Admin required; if not present, fallback to admin session for robustness (consistent with other endpoints)
            requireRole(['admin']);
            $recipientId = isset($payload['recipient_id']) ? (int)$payload['recipient_id'] : 0;
            if ($recipientId <= 0) { sendJson(['success'=>false,'error'=>'recipient_id is required'], 400); }
            $items = isset($payload['items']) && is_array($payload['items']) ? $payload['items'] : [];
            $runId = isset($payload['run_id']) && $payload['run_id'] !== '' ? (int)$payload['run_id'] : null;
            $code = isset($payload['allocation_code']) && $payload['allocation_code'] !== '' ? sanitize($payload['allocation_code']) : null;
            // Optional notify flag (default false). Allocate Now should NOT notify admins.
            $notify = isset($payload['notify_admin']) ? (bool)$payload['notify_admin'] : false;
            try {
                $db = Database::getInstance();
                // If run is provided, check for an existing allocation for this recipient in this run
                $existing = null;
                if ($runId !== null){
                    $existing = $db->query('SELECT allocation_id FROM allocations WHERE recipient_id = ? AND run_id = ? ORDER BY allocation_id DESC LIMIT 1', [$recipientId, $runId])->fetch();
                }
                if ($existing && isset($existing['allocation_id'])){
                    $allocId = (int)$existing['allocation_id'];
                    // Replace items
                    $db->query('DELETE FROM allocation_items WHERE allocation_id = ?', [$allocId]);
                    $inserted = 0;
                    foreach ($items as $it){
                        $name = isset($it['item_name']) ? (string)$it['item_name'] : '';
                        $qty  = isset($it['quantity']) ? (int)$it['quantity'] : 0;
                        $invId = isset($it['inventory_id']) ? (int)$it['inventory_id'] : 0;
                        if ($qty <= 0 || $name === '') continue;
                        if ($invId > 0){
                            $db->query('INSERT INTO allocation_items (allocation_id, inventory_id, quantity, created_at) VALUES (?, ?, ?, NOW())', [$allocId, $invId, $qty]);
                            $inserted++;
                        } else {
                            // Resolve inventory record by joining donation_items under normalized schema
                            $cat = isset($it['category']) ? (string)$it['category'] : null;
                            // 1) Try exact by name + category (if provided)
                            $row = $db->query(
                                'SELECT inv.inventory_id
                                   FROM inventory inv
                                   INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                                   LEFT JOIN categories c ON c.category_id = di.category_id
                                  WHERE di.product_name = ?
                                    AND (CONCAT(c.primary_name, COALESCE(CONCAT(" - ", c.secondary_name), "")) = ? OR ? IS NULL)
                                  ORDER BY COALESCE(di.expiry_date, "9999-12-31") ASC, inv.added_at ASC
                                  LIMIT 1',
                                [$name, $cat, $cat]
                            )->fetch();
                            // 2) Fallback: exact by name only
                            if (!$row){
                                $row = $db->query(
                                    'SELECT inv.inventory_id
                                       FROM inventory inv
                                       INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                                       LEFT JOIN categories c ON c.category_id = di.category_id
                                      WHERE di.product_name = ?
                                      ORDER BY COALESCE(di.expiry_date, "9999-12-31") ASC, inv.added_at ASC
                                      LIMIT 1',
                                    [$name]
                                )->fetch();
                            }
                            // 3) Fallback: LIKE by name if name is long enough
                            if (!$row && strlen($name) >= 3){
                                $pattern = '%' . $name . '%';
                                $row = $db->query(
                                    'SELECT inv.inventory_id
                                       FROM inventory inv
                                       INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                                       LEFT JOIN categories c ON c.category_id = di.category_id
                                      WHERE di.product_name LIKE ?
                                      ORDER BY COALESCE(di.expiry_date, "9999-12-31") ASC, inv.added_at ASC
                                      LIMIT 1',
                                    [$pattern]
                                )->fetch();
                            }
                            $rid = $row ? (int)$row['inventory_id'] : 0;
                            if ($rid > 0){ $db->query('INSERT INTO allocation_items (allocation_id, inventory_id, quantity, created_at) VALUES (?, ?, ?, NOW())', [$allocId, $rid, $qty]); $inserted++; }
                        }
                    }
                    // If no items were inserted, remove the now-empty allocation to avoid dangling recipients
                    if ($inserted === 0){
                        $db->query('DELETE FROM allocations WHERE allocation_id = ?', [$allocId]);
                        sendJson(['success'=>true, 'data'=>['allocation_id'=>null, 'deleted_allocation'=>$allocId, 'updated'=>false]]);
                    }
                    // Mark as Updated (fallback to Pending if enum lacks Updated)
                    try {
                        $db->query('UPDATE allocations SET status = "Updated", updated_at = NOW() WHERE allocation_id = ?', [$allocId]);
                    } catch (Exception $e) {
                        $db->query('UPDATE allocations SET status = "Pending", updated_at = NOW() WHERE allocation_id = ?', [$allocId]);
                    }
                    // Notify recipient that allocation contents were updated (include item summary)
                    try {
                        $rowR = $db->query('SELECT recipient_id FROM allocations WHERE allocation_id = ? LIMIT 1', [$allocId])->fetch();
                        $rid = $rowR ? (int)$rowR['recipient_id'] : 0;
                        if ($rid>0){
                            $rowsIt = $db->query('SELECT ai.quantity,
                                                          di.product_name,
                                                          COALESCE(u.label, u.code) AS unit_label
                                                  FROM allocation_items ai
                                                  LEFT JOIN inventory inv ON ai.inventory_id = inv.inventory_id
                                                  LEFT JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                                                  LEFT JOIN units u ON u.unit_id = di.unit_id
                                                  WHERE ai.allocation_id = ?
                                                  ORDER BY ai.id ASC', [$allocId])->fetchAll() ?: [];
                            $parts = [];
                            foreach ($rowsIt as $rIt){
                                $q = (int)($rIt['quantity'] ?? 0);
                                $nm = trim((string)($rIt['product_name'] ?? ''));
                                if ($q>0 && $nm !== ''){
                                    $unit = trim((string)($rIt['unit_label'] ?? ''));
                                    if ($unit !== '') {
                                        $parts[] = $q.' '.$unit.' '.$nm;
                                    } else {
                                        $parts[] = $q.'x '.$nm;
                                    }
                                }
                                if (count($parts) >= 6) break;
                            }
                            $msg = 'Your allocation has been updated.';
                            if (!empty($parts)){
                                $msg .= ' Items: ' . implode(', ', $parts);
                            }
                            $notif = new Notification();
                            $notif->replaceLatest([
                                'user_id' => $rid,
                                'type' => 'allocation_ready',
                                'reference_type' => 'allocation',
                                'reference_id' => $allocId,
                                'message' => $msg,
                            ]);
                        }
                    } catch (Exception $e) { /* ignore */ }
                    sendJson(['success'=>true, 'data'=>['allocation_id'=>$allocId, 'updated'=>true]]);
                } else {
                    // No existing allocation in this run: create new one
                    // Require at least one valid item to prevent empty allocations
                    $hasValid = false;
                    foreach ($items as $it){
                        $name = isset($it['item_name']) ? (string)$it['item_name'] : '';
                        $qty  = isset($it['quantity']) ? (int)$it['quantity'] : 0;
                        $invId = isset($it['inventory_id']) ? (int)$it['inventory_id'] : 0;
                        if ($qty > 0 && ($name !== '' || $invId > 0)) { $hasValid = true; break; }
                    }
                    if (!$hasValid) { sendJson(['success'=>false,'error'=>'At least one item is required to create an allocation'], 400); }
                    $svc = new Allocation();
                    $id = $svc->createAllocation($recipientId, $items, $runId, $code, $notify);
                    if ($id <= 0) sendJson(['success'=>false,'error'=>'Failed to create allocation'], 400);
                    sendJson(['success'=>true, 'data'=>['allocation_id'=>$id, 'updated'=>false]]);
                }
            } catch (Exception $e) {
                $msg = $e->getMessage();
                $extra = [
                    'recipient_id' => $recipientId,
                    'run_id' => $runId,
                    'items_len' => is_array($items)? count($items): 0,
                ];
                // Improve FK error clarity
                if (stripos($msg, 'foreign key') !== false || stripos($msg, 'constraint') !== false){
                    if (stripos($msg, 'alloc_recipient_fk') !== false){
                        $msg = 'Recipient not found (FK alloc_recipient_fk). Check users.user_id exists: ' . $recipientId;
                    }
                    if (stripos($msg, 'ai_inventory_fk') !== false){
                        $msg = 'Inventory not found for one of the items (FK ai_inventory_fk). Ensure inventory lots exist.';
                    }
                }
                sendJson(['success'=>false,'error'=>'Unable to create/overwrite allocation: ' . $msg, 'debug'=>$extra], 400);
            }
            break;

        case 'create_run':
            requireRole(['admin']);
            error_log("=== CREATE_RUN DEBUG ===");
            error_log("Starting create_run endpoint");

            // Debug payload
            error_log("Payload received: " . json_encode($payload));

            $note = isset($payload['note']) ? trim((string)$payload['note']) : null;
            $periodKey = isset($payload['period_key']) ? trim((string)$payload['period_key']) : null;

            error_log("Extracted data - note: " . var_export($note, true) . ", period_key: " . var_export($periodKey, true));

            $adminId = (int)(currentUserId() ?? 0);
            if ($adminId <= 0) { sendJson(['success'=>false,'error'=>'Unauthorized'], 401); }

            // Create allocation service
            error_log("Creating Allocation service");
            try {
                $svc = new Allocation();
                error_log("Allocation service created successfully");
            } catch (Exception $e) {
                error_log("Failed to create Allocation service: " . $e->getMessage());
                sendJson(['success' => false, 'error' => 'Failed to initialize allocation service: ' . $e->getMessage()], 500);
            }

            // Create allocation run
            try {
                error_log("Calling createRun with adminId=$adminId, note=" . var_export($note, true) . ", periodKey=" . var_export($periodKey, true));
                $runId = $svc->createRun($adminId, $note, $periodKey);
                error_log("createRun returned runId: " . var_export($runId, true));

                if ($runId <= 0) {
                    error_log("createRun returned invalid run_id: $runId for admin_id: $adminId, period_key: $periodKey");
                    sendJson(['success'=>false,'error'=>'Failed to create allocation run'], 500);
                }

                error_log("create_run successful, returning runId: $runId");
                sendJson(['success'=>true, 'data'=>['run_id'=>$runId]]);
            } catch (Exception $e) {
                error_log("createRun exception: " . $e->getMessage());
                error_log("createRun stack trace: " . $e->getTraceAsString());
                sendJson(['success'=>false,'error'=>'Failed to create allocation run: ' . $e->getMessage()], 500);
            }
            break;

        case 'ping':
            // Simple ping endpoint - no authentication required
            error_log("=== PING ENDPOINT CALLED ===");
            sendJson(['success' => true, 'message' => 'API is working', 'session_id' => session_id(), 'action' => 'ping']);
            break;

        case 'latest_run':
            // Admin required; if not present, fallback to admin session for robustness
            requireRole(['admin']);
            $svc = new Allocation();
            $row = $svc->latestRun();
            if (!$row) sendJson(['success'=>false, 'error'=>'No runs found'], 404);
            sendJson(['success'=>true, 'data'=>$row]);
            break;

        case 'list_runs':
            // Admin required; if not present, fallback to admin session for robustness
            requireRole(['admin']);
            try {
                $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 24;
                $db = Database::getInstance();
                $rows = $db->query("SELECT run_id, period_key, created_at FROM allocation_runs ORDER BY created_at DESC, run_id DESC LIMIT {$limit}")->fetchAll() ?: [];
                sendJson(['success'=>true, 'data'=>['items'=>$rows]]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Failed to list runs: ' . $e->getMessage()], 500);
            }
            break;

        case 'ensure_run':
            // Ensure a run exists for the given period_key, return the run row
            requireRole(['admin']);
            $periodKey = isset($payload['period_key']) ? trim((string)$payload['period_key']) : (isset($_GET['period_key']) ? trim((string)$_GET['period_key']) : '');
            if ($periodKey === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $periodKey)) { sendJson(['success'=>false,'error'=>'Invalid or missing period_key'], 400); }
            $adminId = (int)(currentUserId() ?? 0);
            if ($adminId <= 0) { sendJson(['success'=>false,'error'=>'Unauthorized'], 401); }
            $svc = new Allocation();
            $row = $svc->ensureRun($periodKey, $adminId);
            if (!$row) sendJson(['success'=>false, 'error'=>'Failed to ensure run for period'], 500);
            sendJson(['success'=>true, 'data'=>$row]);
            break;

        case 'list_by_period':
            // Return allocations for a given period_key, ensuring the run exists
            requireRole(['admin']);
            $periodKey = isset($_GET['period_key']) ? trim((string)$_GET['period_key']) : '';
            if ($periodKey === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $periodKey)) { sendJson(['success'=>false,'error'=>'Invalid or missing period_key'], 400); }
            $adminId = (int)(currentUserId() ?? 0);
            if ($adminId <= 0) { sendJson(['success'=>false,'error'=>'Unauthorized'], 401); }
            $svc = new Allocation();
            $run = $svc->ensureRun($periodKey, $adminId);
            if (!$run || (int)($run['run_id'] ?? 0) <= 0) { sendJson(['success'=>false, 'error'=>'Failed to resolve run for period'], 500); }
            // Reuse existing list_by_run logic via direct DB query to keep consistent output
            $runId = (int)$run['run_id'];
            try {
                $db = Database::getInstance();
                $rows = $db->query(
                    'SELECT allocation_id, recipient_id, status, created_at, updated_at FROM allocations WHERE run_id = ? ORDER BY created_at DESC, allocation_id DESC',
                    [$runId]
                )->fetchAll() ?: [];
                $out = [];
                foreach ($rows as $r){
                    $aid = (int)$r['allocation_id'];
                    $items = $db->query('SELECT ai.id, ai.inventory_id, ai.quantity,
                                                 di.product_name,
                                                 CONCAT(c.primary_name, COALESCE(CONCAT(" - ", c.secondary_name), "")) AS product_category,
                                                 COALESCE(u.label, u.code) AS unit
                                           FROM allocation_items ai
                                           LEFT JOIN inventory inv ON ai.inventory_id = inv.inventory_id
                                           LEFT JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                                           LEFT JOIN categories c ON c.category_id = di.category_id
                                           LEFT JOIN units u ON u.unit_id = di.unit_id
                                          WHERE ai.allocation_id = ?
                                          ORDER BY ai.id ASC', [$aid])->fetchAll() ?: [];
                    $out[] = [
                        'allocation_id' => $aid,
                        'recipient_id'  => (int)$r['recipient_id'],
                        'status'        => $r['status'] ?? 'Allocated',
                        'created_at'    => $r['created_at'] ?? null,
                        'updated_at'    => $r['updated_at'] ?? null,
                        'items'         => array_map(function($it){
                            return [
                                'item_id'   => (int)$it['id'],
                                'inventory_id' => (int)$it['inventory_id'],
                                'item_name' => $it['product_name'] ?? 'Unknown Item',
                                'category'  => $it['product_category'] ?? null,
                                'quantity'  => (int)$it['quantity'],
                                'unit'      => $it['unit'] ?? null,
                                'expiry_date' => $it['expiry_date'] ?? null,
                            ];
                        }, $items)
                    ];
                }
                sendJson(['success'=>true, 'data'=>['run_id'=>$runId, 'items'=>$out]]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Failed to list allocations by period: ' . $e->getMessage()], 500);
            }
            break;

        case 'run_by_period':
            // Admin required; if not present, fallback to admin session for robustness
            requireRole(['admin']);
            $periodKey = isset($_GET['period_key']) ? trim((string)$_GET['period_key']) : '';
            if ($periodKey === '') { sendJson(['success'=>false,'error'=>'period_key is required'], 400); }
            $svc = new Allocation();
            $row = $svc->getRunByPeriod($periodKey);
            if (!$row) {
                // Auto-create run to make period_key the single source of truth
                $adminId = (int)(currentUserId() ?? 0);
                if ($adminId <= 0) { sendJson(['success'=>false,'error'=>'Unauthorized'], 401); }
                $row = $svc->ensureRun($periodKey, $adminId);
                if (!$row) sendJson(['success'=>false, 'error'=>'Failed to ensure run for period'], 500);
            }
            sendJson(['success'=>true, 'data'=>$row]);
            break;

        case 'list_by_run':
            // Admin required; if not present, fallback to admin session for robustness
            requireRole(['admin']);
            $runId = isset($_GET['run_id']) ? (int)$_GET['run_id'] : 0;
            if ($runId <= 0) { sendJson(['success'=>false,'error'=>'run_id is required'], 400); }
            try {
                // Auto-complete any stale pickups (Picked Up > 24h) before listing
                try {
                    $svcAuto = new Allocation();
                    $svcAuto->autoCompleteStalePickups(24);
                } catch (Exception $e) { /* best-effort; ignore auto-complete errors */ }

                $db = Database::getInstance();
                // Load allocations for the run
                $rows = $db->query(
                    'SELECT allocation_id,
                            recipient_id,
                            status,
                            created_at,
                            updated_at,
                            pickup_photo_path,
                            pickup_signature_path
                     FROM allocations
                     WHERE run_id = ?
                     ORDER BY created_at DESC, allocation_id DESC',
                    [$runId]
                )->fetchAll() ?: [];

                $out = [];
                foreach ($rows as $r){
                    $aid = (int)$r['allocation_id'];
                    // Use normalized join via donation_items to fetch product fields
                    $items = $db->query('SELECT ai.id, ai.inventory_id, ai.quantity,
                                                 di.product_name,
                                                 CONCAT(c.primary_name, COALESCE(CONCAT(" - ", c.secondary_name), "")) AS product_category,
                                                 COALESCE(u.label, u.code) AS unit,
                                                 di.expiry_date
                                          FROM allocation_items ai
                                          LEFT JOIN inventory inv ON ai.inventory_id = inv.inventory_id
                                          LEFT JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                                          LEFT JOIN categories c ON c.category_id = di.category_id
                                          LEFT JOIN units u ON u.unit_id = di.unit_id
                                          WHERE ai.allocation_id = ?
                                          ORDER BY ai.id ASC', [$aid])->fetchAll() ?: [];
                    $itemCount = is_array($items) ? count($items) : 0;
                    $out[] = [
                        'allocation_id' => $aid,
                        'recipient_id'  => (int)$r['recipient_id'],
                        'status'        => $r['status'] ?? 'Allocated',
                        'created_at'    => $r['created_at'] ?? null,
                        'updated_at'    => $r['updated_at'] ?? null,
                        'pickup_photo_path' => $r['pickup_photo_path'] ?? null,
                        'pickup_signature_path' => $r['pickup_signature_path'] ?? null,
                        'item_count'    => $itemCount,
                        'items'         => array_map(function($it){
                            return [
                                'item_id'   => (int)$it['id'],
                                'inventory_id' => (int)$it['inventory_id'],
                                'item_name' => $it['product_name'] ?? 'Unknown Item',
                                'category'  => $it['product_category'] ?? null,
                                'quantity'  => (int)$it['quantity'],
                                'unit'      => $it['unit'] ?? null,
                            ];
                        }, $items)
                    ];
                }
                sendJson(['success'=>true, 'data'=>['items'=>$out]]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Failed to list allocations by run: ' . $e->getMessage()], 500);
            }
            break;

        case 'list_by_recipient':
            // Require proper auth; do NOT mutate session on failure (prevents role flip that breaks first pickup)
            requireRole(['recipient','admin']);
            // Only recipient themselves unless admin
            $currentId = (int)(currentUserId() ?? 0);
            $role = (string)(currentUserRole() ?? '');
            $recipientId = $role === 'admin' ? (int)($_GET['recipient_id'] ?? 0) : $currentId;
            if ($recipientId <= 0) { sendJson(['success'=>false,'error'=>'Forbidden'], 403); }
            $runId = isset($_GET['run_id']) ? (int)$_GET['run_id'] : null;
            if ($runId !== null && $runId <= 0) { $runId = null; }
            $forcedLatestRunId = null;
            // If caller is a recipient and did not specify run_id, prefer the latest run but fall back if empty
            if ($role !== 'admin' && ($runId === null)) {
                try {
                    $svcTmp = new Allocation();
                    $latest = $svcTmp->latestRun();
                    if ($latest && isset($latest['run_id']) && (int)$latest['run_id'] > 0) {
                        $runId = $forcedLatestRunId = (int)$latest['run_id'];
                    }
                } catch (Exception $e) { /* ignore; fallback handled below */ }
            }
            $svc = new Allocation();
            // Auto-complete any stale pickups (Picked Up > 24h) before listing
            try {
                $svc->autoCompleteStalePickups(24);
            } catch (Exception $e) { /* best-effort; ignore auto-complete errors */ }

            $list = $svc->listByRecipient($recipientId, $runId);
            if ($forcedLatestRunId !== null && empty($list)) {
                $list = $svc->listByRecipient($recipientId, null);
            }
            sendJson(['success'=>true, 'data'=>['items'=>$list]]);
            break;

        case 'pickup': // alias for schedule (Pick Up)
        case 'schedule':
            requireRole(['recipient']);
            $currentId = (int)(currentUserId() ?? 0);
            // Accept allocation_id from JSON or GET fallback
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0 && isset($_GET['allocation_id'])) {
                $allocationId = (int)$_GET['allocation_id'];
            }
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            // Ownership/state pre-checks and clearer errors
            try {
                $db = Database::getInstance();
                $hdr = $db->query('SELECT recipient_id, status FROM allocations WHERE allocation_id = ? LIMIT 1', [$allocationId])->fetch();
                if (!$hdr) { sendJson(['success'=>false,'error'=>'Allocation not found'], 404); }
                if ((int)($hdr['recipient_id'] ?? 0) !== $currentId) { sendJson(['success'=>false,'error'=>'Forbidden: allocation does not belong to this recipient'], 403); }
                $st = strtolower((string)($hdr['status'] ?? ''));
                if (!in_array($st, ['pending','allocated','notified','acknowledged','updated'], true)) {
                    // If already picked up/completed, return success
                    if (in_array($st, ['scheduled','picked up','completed'], true)) {
                        sendJson(['success'=>true]);
                    }
                    sendJson(['success'=>false,'error'=>'Invalid state: allocation must be Pending/Allocated/Notified/Acknowledged/Updated to pick up'], 400);
                }
            } catch (Exception $e) { /* continue to service */ }

            // Perform pickup (deduct inventory and mark Picked Up). Auto-ack happens in service if needed
            $svc = new Allocation();
            try {
                $ok = $svc->schedule($allocationId, $currentId);
                if (!$ok) {
                    sendJson(['success'=>false,'error'=>'Unable to pick up (invalid state or insufficient stock)'], 400);
                }
                // Notify admins of pickup
                try {
                    $db = Database::getInstance();
                    $admins = $db->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll() ?: [];
                    foreach ($admins as $ad){
                        $aid = (int)($ad['user_id'] ?? 0);
                        if ($aid>0){
                            // Legacy notification removed per UX request
                        }
                    }
                } catch (Exception $e) { /* ignore notification errors */ }
                sendJson(['success'=>true]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Unable to pick up: ' . $e->getMessage()], 400);
            }
            break;

        case 'acknowledge':
            requireRole(['recipient']);
            $currentId = (int)(currentUserId() ?? 0);
            // Accept allocation_id from JSON or GET fallback
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0 && isset($_GET['allocation_id'])) {
                $allocationId = (int)$_GET['allocation_id'];
            }
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            // Provide clearer errors and allow idempotency
            $db = Database::getInstance();
            $row = $db->query('SELECT recipient_id, status FROM allocations WHERE allocation_id = ? LIMIT 1', [$allocationId])->fetch();
            if (!$row) { sendJson(['success'=>false,'error'=>'Allocation not found'], 404); }
            if ((int)$row['recipient_id'] !== $currentId) { sendJson(['success'=>false,'error'=>'Forbidden: allocation does not belong to this recipient'], 403); }
            $st = strtolower((string)($row['status'] ?? ''));
            // If already acknowledged or later, return success (idempotent)
            if (in_array($st, ['acknowledged','scheduled','picked up','completed'], true)) {
                sendJson(['success'=>true]);
            }
            // Only allow acknowledge from Pending/Allocated/Notified/Updated
            if (!in_array($st, ['pending','allocated','notified','updated'], true)) {
                sendJson(['success'=>false,'error'=>'Invalid state: only Pending/Allocated/Notified/Updated can be acknowledged'], 400);
            }
            $svc = new Allocation();
            $ok = $svc->acknowledge($allocationId, $currentId);
            if (!$ok) {
                // Fallback direct update
                try {
                    $db->query(
                        'UPDATE allocations SET status = "Acknowledged", acknowledged_at = NOW(), updated_at = NOW()
                         WHERE allocation_id = ? AND recipient_id = ?
                           AND LOWER(COALESCE(status, "")) IN ("pending","allocated","notified","updated")',
                        [$allocationId, $currentId]
                    );
                } catch (Exception $e) {
                    sendJson(['success'=>false,'error'=>'Unable to acknowledge'], 400);
                }
            }
            sendJson(['success'=>true]);
            break;

        case 'confirm_pickup':
            requireRole(['admin']);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0) {
                // Malformed request; log but still return success=false with HTTP 200 to avoid frontend hard-fail
                error_log('confirm_pickup called without valid allocation_id: ' . json_encode($payload));
                sendJson(['success'=>false,'error'=>'allocation_id is required'], 200);
            }

            // Images are optional here; service will keep existing proof paths if base64 is empty
            $photoBase64 = isset($payload['photo_base64']) ? trim((string)$payload['photo_base64']) : null;
            $signatureBase64 = isset($payload['signature_base64']) ? trim((string)$payload['signature_base64']) : null;
            $note = isset($payload['confirm_text']) ? trim((string)$payload['confirm_text']) : null;

            $svc = new Allocation();
            $paths = null;
            try {
                $paths = $svc->confirmPickup($allocationId, (int)(currentUserId() ?? 0), $photoBase64, $signatureBase64, $note);
            } catch (Exception $e) {
                // Log but do NOT propagate as HTTP 400 to keep UI flow smooth; backend has already done best-effort work
                error_log('confirm_pickup exception for allocation_id=' . $allocationId . ': ' . $e->getMessage());
                if ($paths === null) {
                    $paths = ['error' => $e->getMessage()];
                }
            }
            sendJson(['success'=>true, 'data'=>$paths ?? []]);
            break;

        case 'acknowledge_admin':
            requireRole(['admin']);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            $svc = new Allocation();
            $ok = $svc->acknowledgeByAdmin($allocationId, (int)(currentUserId() ?? 0));
            if (!$ok) sendJson(['success'=>false,'error'=>'Invalid state'], 400);
            // Notify recipient that allocation was acknowledged by admin
            try {
                $db = Database::getInstance();
                $row = $db->query('SELECT recipient_id FROM allocations WHERE allocation_id = ? LIMIT 1', [$allocationId])->fetch();
                $rid = $row ? (int)$row['recipient_id'] : 0;
                if ($rid>0){
                    $db->query('INSERT INTO notifications (user_id, type, message, created_at) VALUES (?, "allocation_acknowledged", ?, NOW())', [
                        $rid,
                        'Your allocation has been acknowledged.'
                    ]);
                }
            } catch (Exception $e) { /* ignore */ }
            sendJson(['success'=>true]);
            break;

        case 'cancel':
            requireRole(['recipient']);
            $currentId = (int)(currentUserId() ?? 0);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            $reason = isset($payload['reason']) ? sanitize($payload['reason']) : '';
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            if ($reason === '') { sendJson(['success'=>false,'error'=>'reason is required'], 400); }
            $svc = new Allocation();
            $ok = $svc->cancel($allocationId, $currentId, $reason);
            if (!$ok) sendJson(['success'=>false,'error'=>'Not allowed or invalid state'], 400);
            // Notify admins of cancellation
            try {
                $db = Database::getInstance();
                $admins = $db->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll() ?: [];
                foreach ($admins as $ad){
                    $aid = (int)($ad['user_id'] ?? 0);
                    if ($aid>0){
                        $db->query('INSERT INTO notifications (user_id, type, message, created_at) VALUES (?, "allocation_cancelled", ?, NOW())', [
                            $aid,
                            'Recipient cancelled an allocation: '.$reason
                        ]);
                    }
                }
            } catch (Exception $e) { /* ignore */ }
            sendJson(['success'=>true]);
            break;

        case 'cancel_and_replace':
            // Recipient cancelling their own OR admin doing it on behalf
            requireRole(['recipient','admin']);
            $role = (string)(currentUserRole() ?? '');
            $actorId = (int)(currentUserId() ?? 0);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            $reason = isset($payload['reason']) ? sanitize($payload['reason']) : '';
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            if ($reason === '') { sendJson(['success'=>false,'error'=>'reason is required'], 400); }

            $db = Database::getInstance();
            // Load allocation details
            $row = $db->query('SELECT allocation_id, recipient_id, run_id FROM allocations WHERE allocation_id = ? LIMIT 1', [$allocationId])->fetch();
            if (!$row) { sendJson(['success'=>false,'error'=>'Allocation not found'], 404); }
            $recId = (int)$row['recipient_id'];
            $runId = (int)($row['run_id'] ?? 0);
            if ($role !== 'admin' && $recId !== $actorId) { sendJson(['success'=>false,'error'=>'Forbidden'], 403); }

            // Cancel first (uses same validation as recipient cancel)
            $svc = new Allocation();
            $ok = $svc->cancel($allocationId, $recId, $reason);
            if (!$ok) sendJson(['success'=>false,'error'=>'Not allowed or invalid state'], 400);

            // If no run attached, nothing to replace in current week
            if ($runId <= 0) { sendJson(['success'=>true, 'data'=>['cancelled_allocation_id'=>$allocationId, 'run_id'=>null, 'replacement'=>null]]); }

            // Resolve period_key for run
            $run = $db->query('SELECT period_key FROM allocation_runs WHERE run_id = ? LIMIT 1', [$runId])->fetch();
            $periodKey = $run ? (string)$run['period_key'] : '';
            // Derive monthly key used by Distribution for status tracking (YYYY-MM)
            $monthlyKey = '';
            if (preg_match('/^(\d{4})-(\d{2})-W[1-4]$/', $periodKey, $m)) {
                $monthlyKey = sprintf('%04d-%02d', (int)$m[1], (int)$m[2]);
            } else if (preg_match('/^(\d{4})-(\d{2})$/', $periodKey, $m)) {
                $monthlyKey = sprintf('%04d-%02d', (int)$m[1], (int)$m[2]);
            }

            // Ensure distribution_period_status exists to avoid 500s on fresh DBs
            try {
                $db->query(<<<SQL
CREATE TABLE IF NOT EXISTS `distribution_period_status` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_key` varchar(12) NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `served_count` int(11) NOT NULL DEFAULT 0,
  `last_served_at` timestamp NULL DEFAULT NULL,
  `skipped_pending` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_period_recipient` (`period_key`,`recipient_id`),
  KEY `dps_recipient_idx` (`recipient_id`),
  CONSTRAINT `dps_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
SQL);
            } catch (Exception $e) { /* ignore; next queries may still succeed if table exists */ }

            // Mark cancelled recipient as skipped_pending for this month so they carry over
            if ($monthlyKey !== ''){
                try {
                    // Ensure status row exists
                    $db->query('INSERT INTO distribution_period_status (period_key, recipient_id, served_count, last_served_at, skipped_pending) VALUES (?,?,0,NULL,0) ON DUPLICATE KEY UPDATE period_key = period_key', [$monthlyKey, $recId]);
                    $db->query('UPDATE distribution_period_status SET skipped_pending = 1 WHERE period_key = ? AND recipient_id = ?', [$monthlyKey, $recId]);
                } catch (Exception $e) { /* best-effort */ }
            }

            // Determine specialty (organization_type) for better matching
            $spec = null;
            try {
                $rpro = $db->query('SELECT organization_type FROM recipient_profiles WHERE user_id = ? LIMIT 1', [$recId])->fetch();
                if ($rpro && isset($rpro['organization_type'])){ $spec = trim((string)$rpro['organization_type']); if ($spec==='') $spec = null; }
            } catch (Exception $e) { $spec = null; }

            // Build candidate list: approved recipients not already in this run, optional same specialty
            $whereSpec = '';
            $params = [];
            if ($spec !== null) { $whereSpec = ' AND rp.organization_type = ?'; $params[] = $spec; }
            $sql = 'SELECT u.user_id AS id, COALESCE(dps.served_count,0) AS served_count, COALESCE(dps.skipped_pending,0) AS skipped_pending, dps.last_served_at
                    FROM users u
                    LEFT JOIN recipient_profiles rp ON rp.user_id = u.user_id
                    LEFT JOIN distribution_period_status dps ON dps.recipient_id = u.user_id AND dps.period_key = ?
                    WHERE u.role = "recipient" AND u.status = "approved"'.$whereSpec.'
                      AND u.user_id NOT IN (SELECT recipient_id FROM allocations WHERE run_id = ?)';
            // monthlyKey may be empty; if so, approximate with current Y-m
            $keyForQuery = $monthlyKey !== '' ? $monthlyKey : date('Y-m');
            // Order of params must match SQL placeholders: [period_key, (spec?), run_id]
            $params = array_merge([$keyForQuery], $params, [$runId]);
            $rows = $db->query($sql, $params)->fetchAll() ?: [];
            if (!$rows) {
                sendJson(['success'=>true, 'data'=>['cancelled_allocation_id'=>$allocationId, 'run_id'=>$runId, 'replacement'=>null]]);
            }
            // Order by skipped_pending desc, served_count asc, last_served_at asc, id asc
            usort($rows, function($a,$b){
                $sa = (int)($a['skipped_pending']??0); $sb=(int)($b['skipped_pending']??0);
                if ($sa !== $sb) return $sb - $sa;
                $ca = (int)($a['served_count']??0); $cb=(int)($b['served_count']??0);
                if ($ca !== $cb) return $ca - $cb;
                $la = (string)($a['last_served_at']??''); $lb=(string)($b['last_served_at']??'');
                $cmp = strcmp($la,$lb); if ($cmp!==0) return $cmp;
                return ((int)$a['id']) <=> ((int)$b['id']);
            });
            $rep = $rows[0];
            $repId = (int)$rep['id'];

            // Insert replacement allocation with a valid enum status (Pending)
            $db->query('INSERT INTO allocations (recipient_id, run_id, status, created_at, updated_at) VALUES (?, ?, "Pending", NOW(), NOW())', [$repId, $runId]);
            $newAllocId = (int)$db->lastInsertId();

            // Remove replacement from next week pool (clear skipped_pending)
            if ($monthlyKey !== ''){
                try {
                    $db->query('INSERT INTO distribution_period_status (period_key, recipient_id, served_count, last_served_at, skipped_pending) VALUES (?,?,0,NULL,0) ON DUPLICATE KEY UPDATE period_key = period_key', [$monthlyKey, $repId]);
                    $db->query('UPDATE distribution_period_status SET skipped_pending = 0 WHERE period_key = ? AND recipient_id = ?', [$monthlyKey, $repId]);
                } catch (Exception $e) { /* best-effort */ }
            }

            // Do not send a second generic notification here.
            // The call to $svc->cancel(...) above already inserts a detailed
            // notification with actor and reason. Keeping only that prevents duplicates.
            sendJson(['success'=>true, 'data'=>[
                'cancelled_allocation_id'=>$allocationId,
                'cancelled_recipient_id'=>$recId,
                'run_id'=>$runId,
                'replacement'=>[ 'recipient_id'=>$repId, 'allocation_id'=>$newAllocId ]
            ]]);
            break;

        case 'schedule':
            requireRole(['recipient']);
            $currentId = (int)(currentUserId() ?? 0);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            // Pre-checks for clearer errors
            try {
                $db = Database::getInstance();
                $hdr = $db->query('SELECT recipient_id, status FROM allocations WHERE allocation_id = ? LIMIT 1', [$allocationId])->fetch();
                if (!$hdr) { sendJson(['success'=>false,'error'=>'Allocation not found'], 404); }
                if ((int)($hdr['recipient_id'] ?? 0) !== $currentId) { sendJson(['success'=>false,'error'=>'Forbidden: allocation does not belong to this recipient'], 403); }
                $st = strtolower((string)($hdr['status'] ?? ''));
                if (!in_array($st, ['allocated','notified','acknowledged'], true)) {
                    sendJson(['success'=>false,'error'=>'Invalid state: allocation must be Allocated/Notified/Acknowledged to schedule'], 400);
                }
                $items = $db->query('SELECT inventory_id, quantity FROM allocation_items WHERE allocation_id = ? ORDER BY id ASC', [$allocationId])->fetchAll() ?: [];
                if (!count($items)) { sendJson(['success'=>false,'error'=>'No items in allocation to schedule'], 400); }
                // If inventory exists, check availability to provide clearer message
                $invOk = true; $invErr = '';
                try { $db->query('SELECT 1 FROM inventory LIMIT 1')->fetch(); } catch (Exception $e) { $invOk = false; }
                if ($invOk) {
                    foreach ($items as $it){
                        $iid = (int)($it['inventory_id'] ?? 0); $need = (int)($it['quantity'] ?? 0);
                        if ($iid <= 0 || $need <= 0) continue;
                        $row = $db->query('SELECT quantity FROM inventory WHERE inventory_id = ? LIMIT 1', [$iid])->fetch();
                        if (!$row) { $invErr = 'Inventory item not found for one or more allocation items'; break; }
                        if ((int)($row['quantity'] ?? 0) < $need) { $invErr = 'Insufficient stock for one or more items'; break; }
                    }
                    if ($invErr !== '') { sendJson(['success'=>false,'error'=>$invErr], 400); }
                }
            } catch (Exception $e) { /* fall through to service call */ }
            $svc = new Allocation();
            try {
                $ok = $svc->schedule($allocationId, $currentId);
                if (!$ok) sendJson(['success'=>false,'error'=>'Unable to schedule pickup (invalid state or insufficient stock)'], 400);
                // Notify admins that recipient scheduled a pickup
                try {
                    $db = Database::getInstance();
                    $admins = $db->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll() ?: [];
                    foreach ($admins as $ad){
                        $aid = (int)($ad['user_id'] ?? 0);
                        if ($aid>0){
                            $db->query('INSERT INTO notifications (user_id, type, message, created_at) VALUES (?, "status_updated", ?, NOW())', [
                                $aid,
                                'Recipient scheduled a pickup.'
                            ]);
                        }
                    }
                } catch (Exception $e) { /* ignore */ }
                sendJson(['success'=>true]);
            } catch (Exception $e) {
                // Check if it's an inventory table issue
                $errorMsg = $e->getMessage();
                if (strpos($errorMsg, 'inventory') !== false || strpos($errorMsg, 'Table') !== false || strpos($errorMsg, 'Column not found') !== false) {
                    sendJson(['success'=>false,'error'=>'Unable to schedule pickup: Inventory system not available. Contact administrator.'], 400);
                } else {
                    sendJson(['success'=>false,'error'=>'Unable to schedule pickup: ' . $errorMsg], 400);
                }
            }
            break;

        // ==== New editing and run management actions ====
        case 'update_item_quantity':
            requireRole(['admin']);
            $itemId = isset($payload['item_id']) ? (int)$payload['item_id'] : 0;
            $qty = isset($payload['quantity']) ? (int)$payload['quantity'] : -1;
            if ($itemId <= 0 || $qty < 0) { sendJson(['success'=>false,'error'=>'item_id and non-negative quantity required'], 400); }
            $svc = new Allocation();
            $ok = $svc->updateItemQuantity($itemId, $qty);
            sendJson(['success'=>$ok]);
            break;

        case 'test_create_run':
            requireRole(['admin']);
            error_log("=== TEST CREATE_RUN ENDPOINT ===");

            try {
                // Generate period_key if not provided
                $periodKey = isset($payload['period_key']) ? $payload['period_key'] : null;
                if (empty($periodKey)) {
                    $now = new DateTime();
                    $year = $now->format('Y');
                    $month = $now->format('m');
                    $week = $now->format('W');
                    $periodKey = sprintf('%s-%s-W%s', $year, $month, $week);
                }

                error_log("Using period_key: $periodKey");

                // Test database connection
                $db = Database::getInstance();
                error_log("Database instance obtained");

                // Test the actual SQL queries
                error_log("Testing INSERT query...");
                $db->query(
                    'INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, ?, NOW())',
                    [$periodKey, 1]  // Using admin ID 1
                );
                error_log("INSERT query successful");

                $lastInsertId = $db->lastInsertId();
                error_log("Last insert ID: $lastInsertId");

                $row = $db->query('SELECT run_id FROM allocation_runs WHERE created_by = ? ORDER BY run_id DESC LIMIT 1', [1])->fetch();
                $runId = (int)($row['run_id'] ?? 0);
                error_log("SELECT query result: " . json_encode($row));

                if ($runId <= 0) {
                    throw new Exception('Failed to retrieve run_id after insert');
                }

                error_log("Test successful - Run ID: $runId");
                sendJson(['success' => true, 'run_id' => $runId, 'period_key' => $periodKey]);

            } catch (Exception $e) {
                error_log("Test create_run failed: " . $e->getMessage());
                error_log("Stack trace: " . $e->getTraceAsString());
                sendJson(['success' => false, 'error' => $e->getMessage(), 'trace' => $e->getTraceAsString()], 500);
            }
            break;

        case 'cancel_run':
            requireRole(['admin']);
            $runId = isset($payload['run_id']) ? (int)$payload['run_id'] : (int)($_GET['run_id'] ?? 0);
            if ($runId <= 0) { sendJson(['success'=>false,'error'=>'run_id is required'], 400); }
            $svc = new Allocation();
            $ok = $svc->cancelRun($runId);
            sendJson(['success'=>$ok]);
            break;

        case 'finalize':
            requireRole(['admin']);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            $svc = new Allocation();
            $ok = $svc->finalizeAllocation($allocationId, (int)(currentUserId() ?? 0));
            if (!$ok) sendJson(['success'=>false,'error'=>'Unable to finalize (insufficient stock or invalid state)'], 400);
            sendJson(['success'=>true]);
            break;

        case 'finalize_bulk':
            requireRole(['admin']);
            $ids = isset($payload['allocation_ids']) && is_array($payload['allocation_ids']) ? array_map('intval', $payload['allocation_ids']) : [];
            if (empty($ids)) { sendJson(['success'=>false,'error'=>'allocation_ids required'], 400); }
            $svc = new Allocation();
            $res = $svc->finalizeBulk($ids, (int)(currentUserId() ?? 0));
            sendJson(['success'=>true, 'data'=>$res]);
            break;

        case 'onsite_issue':
            // Admin-only endpoint to handle on-site giveaway in one atomic operation
            requireRole(['admin']);
            $itemName = isset($payload['item_name']) ? trim((string)$payload['item_name']) : '';
            $category = array_key_exists('category', $payload) ? (string)$payload['category'] : null;
            $qty      = isset($payload['quantity']) ? (int)$payload['quantity'] : 0;
            $note     = isset($payload['note']) ? trim((string)$payload['note']) : null;
            $periodKey = isset($payload['period_key']) ? trim((string)$payload['period_key']) : null;
            $recipientId = isset($payload['recipient_id']) ? (int)$payload['recipient_id'] : 0;
            if ($itemName === '' || $qty <= 0) { sendJson(['success'=>false,'error'=>'item_name and positive quantity are required'], 400); }

            $db = Database::getInstance();
            $inTxn = false;
            
            try {
                // Start transaction
                if (!$db->inTransaction()) {
                    $db->beginTransaction();
                    $inTxn = true;
                }

                // Resolve recipient if not provided: prefer name "Foodbank (On-site)", else tag contains 'onsite'
                if ($recipientId <= 0) {
                    $row = $db->query("SELECT u.user_id FROM users u LEFT JOIN recipient_profiles rp ON u.user_id = rp.user_id WHERE u.role='recipient' AND u.status='approved' AND rp.organization_name = 'Foodbank (On-site)' LIMIT 1")->fetch();
                    if (!$row) {
                        $row = $db->query("SELECT u.user_id FROM users u LEFT JOIN recipient_profiles rp ON u.user_id = rp.user_id WHERE u.role='recipient' AND u.status='approved' AND COALESCE(rp.tags,'') LIKE '%onsite%' LIMIT 1")->fetch();
                    }
                    if (!$row) { throw new Exception('On-site recipient not found'); }
                    $recipientId = (int)$row['user_id'];
                }

                // On-site issuances should never be attached to weekly runs
                $runId = null;

                // Deduct stock FIFO by item name (and optional category):
                // Join donation_items to resolve product_name/product_category and expiry_date
                $remaining = $qty;
                $picked = [];
                $params = [$itemName];
                $sql = "SELECT inv.inventory_id, inv.quantity
                          FROM inventory inv
                          INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                          LEFT JOIN categories c ON c.category_id = di.category_id
                         WHERE di.product_name = ? AND inv.quantity > 0";
                if ($category !== null && $category !== '') { $sql .= " AND CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) = ?"; $params[] = $category; }
                $sql .= " ORDER BY COALESCE(di.expiry_date, '9999-12-31') ASC, inv.added_at ASC, inv.inventory_id ASC";
                $rows = $db->query($sql, $params)->fetchAll();
                foreach ($rows as $r) {
                    if ($remaining <= 0) break;
                    $invId = (int)$r['inventory_id'];
                    $have  = (int)$r['quantity'];
                    if ($have <= 0) continue;
                    $take = min($have, $remaining);
                    // update inventory quantity guarded by available stock
                    $db->query('UPDATE inventory SET quantity = quantity - ? WHERE inventory_id = ? AND quantity >= ?', [$take, $invId, $take]);
                    // Verify by re-reading the row
                    $chk = $db->query('SELECT quantity FROM inventory WHERE inventory_id = ? LIMIT 1', [$invId])->fetch();
                    $newQty = isset($chk['quantity']) ? (int)$chk['quantity'] : null;
                    if ($newQty !== null && $newQty === ($have - $take)) {
                        $picked[] = ['inventory_id' => $invId, 'quantity' => $take];
                        $remaining -= $take;
                        try {
                            $uid = (int)(currentUserId() ?? 0);
                            $db->query(
                                'INSERT INTO inventory_movements (inventory_id, direction, quantity, mode, recipient_id, performed_by, note, created_at)
                                 VALUES (?, "out", ?, "onsite", ?, ?, ?, NOW())',
                                [ $invId, (int)$take, (int)$recipientId, $uid, ($note !== null && $note !== '' ? $note : 'On-site Giveaway') ]
                            );
                        } catch (Exception $e) { /* ignore movement insert errors to not block issuance */ }
                    }
                }
                if ($remaining > 0) {
                    throw new Exception('Insufficient stock to fulfill onsite issue');
                }

                // Create allocation (Completed) and items; ensure run_id is NULL
                $db->query('INSERT INTO allocations (recipient_id, run_id, status, delivered_at, created_at, updated_at) VALUES (?, NULL, "Completed", NOW(), NOW(), NOW())', [$recipientId]);
                $allocationId = (int)$db->lastInsertId();
                foreach ($picked as $p) {
                    $db->query('INSERT INTO allocation_items (allocation_id, inventory_id, quantity, created_at) VALUES (?, ?, ?, NOW())', [$allocationId, (int)$p['inventory_id'], (int)$p['quantity']]);
                }

                // Commit transaction if we started it
                if ($inTxn) {
                    $db->commit();
                }

                // Optional: record note into notifications or leave for now
                sendJson(['success'=>true, 'data'=>['allocation_id'=>$allocationId]]);
            } catch (Exception $e) {
                // Rollback transaction if we started it
                if (isset($inTxn) && $inTxn) {
                    try { 
                        $db->rollBack(); 
                    } catch (Exception $rollbackErr) { 
                        error_log("Rollback failed: " . $rollbackErr->getMessage());
                    }
                }
                error_log("Onsite issue failed: " . $e->getMessage());
                sendJson(['success'=>false,'error'=>$e->getMessage()], 400);
            }
            break;

        case 'complete':
            requireRole(['recipient','admin']);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            // Permission: recipient owns it or admin
            $row = Database::getInstance()->query('SELECT recipient_id, status FROM allocations WHERE allocation_id = ?', [$allocationId])->fetch();
            $currentId = (int)(currentUserId() ?? 0);
            $role = (string)(currentUserRole() ?? '');
            if (!$row || ($role !== 'admin' && (int)$row['recipient_id'] !== $currentId)) { sendJson(['success'=>false,'error'=>'Forbidden'], 403); }
            $st = strtolower((string)($row['status'] ?? ''));
            if ($st !== 'picked up') { sendJson(['success'=>false,'error'=>'Only picked up allocations can be completed'], 400); }
            Database::getInstance()->query('UPDATE allocations SET status = "Completed", delivered_at = NOW(), updated_at = NOW() WHERE allocation_id = ?', [$allocationId]);
            // Notify admins about completion
            try {
                $rec = Database::getInstance()->query('SELECT u.name, rp.organization_name FROM users u LEFT JOIN recipient_profiles rp ON u.user_id = rp.user_id WHERE u.user_id = ?', [$currentId])->fetch();
                $rname = $rec && $rec['organization_name'] ? $rec['organization_name'] : ($rec ? ($rec['name'] ?? 'User') : 'User');
                $msg = "Allocation #{$allocationId} completed by {$rname}.";
                $rows = Database::getInstance()->query("SELECT user_id FROM users WHERE role = 'admin'")->fetchAll();
                if ($rows) {
                    $notif = new Notification();
                    foreach ($rows as $r){
                        $uid = (int)($r['user_id'] ?? 0);
                        if ($uid <= 0) continue;
                        try { $notif->create([ 'user_id'=>$uid, 'type'=>'allocation_completed', 'reference_type'=>'allocation', 'reference_id'=>$allocationId, 'message'=>$msg ]); } catch (Exception $e) { /* per-user ignore */ }
                    }
                }
            } catch (Exception $e) { /* ignore notification errors */ }
            sendJson(['success'=>true]);
            break;

        // === Allocation item CRUD ===
        case 'add_item':
            requireRole(['admin']);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            $name = isset($payload['item_name']) ? trim((string)$payload['item_name']) : '';
            $category = isset($payload['category']) ? (string)$payload['category'] : null;
            $qty = isset($payload['quantity']) ? (int)$payload['quantity'] : 0;
            $unit = isset($payload['unit']) ? (string)$payload['unit'] : null;
            if ($allocationId <= 0 || $name === '' || $qty <= 0) { sendJson(['success'=>false,'error'=>'allocation_id, item_name and positive quantity are required'], 400); }
            $svc = new Allocation();
            $id = $svc->addItem($allocationId, $name, $category, $qty, $unit);
            if ($id <= 0) sendJson(['success'=>false,'error'=>'Failed to add item'], 400);
            sendJson(['success'=>true,'data'=>['item_id'=>$id]]);
            break;

        case 'update_item':
            // Admin required; if not present, fallback to admin session for robustness
            requireRole(['admin']);
            // Accept either JSON body or query params (for accidental GET submissions)
            $itemId = isset($payload['item_id']) ? (int)$payload['item_id'] : (int)($_GET['item_id'] ?? 0);
            if ($itemId <= 0) { sendJson(['success'=>false,'error'=>'item_id is required'], 400); }
            $name = array_key_exists('item_name',$payload) ? (string)$payload['item_name'] : (isset($_GET['item_name']) ? (string)$_GET['item_name'] : null);
            $category = array_key_exists('category',$payload) ? (string)$payload['category'] : (isset($_GET['category']) ? (string)$_GET['category'] : null);
            $qty = array_key_exists('quantity',$payload) ? (int)$payload['quantity'] : (isset($_GET['quantity']) ? (int)$_GET['quantity'] : null);
            $unit = array_key_exists('unit',$payload) ? (string)$payload['unit'] : (isset($_GET['unit']) ? (string)$_GET['unit'] : null);
            $svc = new Allocation();
            $ok = $svc->updateItem($itemId, $name, $category, $qty, $unit);
            sendJson(['success'=>$ok]);
            break;

        case 'delete_item':
            requireRole(['admin']);
            $itemId = isset($payload['item_id']) ? (int)$payload['item_id'] : 0;
            if ($itemId <= 0) { sendJson(['success'=>false,'error'=>'item_id is required'], 400); }
            $svc = new Allocation();
            $ok = $svc->deleteItem($itemId);
            sendJson(['success'=>$ok]);
            break;

        case 'debug_test':
            // Bypass authentication for debugging
            requireRole(['admin']);
            error_log("=== DEBUG TEST ENDPOINT ===");

            try {
                $svc = new Allocation();
                error_log("Allocation service created successfully");

                // Test database connection through the service
                $db = \Database::getInstance();
                $db->query('SELECT 1')->fetch();
                error_log("Database connection test passed");

                // Test createRun
                $runId = $svc->createRun(1, null, null);
                error_log("createRun test successful, runId: $runId");

                sendJson(['success' => true, 'message' => 'Debug test completed', 'run_id' => $runId]);
            } catch (Exception $e) {
                error_log("Debug test failed: " . $e->getMessage());
                error_log("Stack trace: " . $e->getTraceAsString());
                sendJson(['success' => false, 'error' => $e->getMessage(), 'trace' => $e->getTraceAsString()], 500);
            }
            break;

    }
} catch (Exception $e) {
    error_log('Allocations API error: ' . $e->getMessage());
    sendJson(['success'=>false, 'error'=>'Server error'], 500);
}
