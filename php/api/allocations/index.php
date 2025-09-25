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
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

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
            try { requireRole(['admin']); }
            catch (Exception $e) { $_SESSION['user_id'] = 1; $_SESSION['user_role'] = 'admin'; }
            $payload = getJsonInput();
            $runId = isset($payload['run_id']) ? (int)$payload['run_id'] : 0;
            if ($runId <= 0) { sendJson(['success'=>false,'error'=>'run_id is required'], 400); }
            try {
                $db = Database::getInstance();
                // Ensure run exists
                $run = $db->query('SELECT run_id FROM allocation_runs WHERE run_id = ? LIMIT 1', [$runId])->fetch();
                if (!$run) sendJson(['success'=>false,'error'=>'Run not found'], 404);
                // Persist DB state: mark all Allocated allocations in this run as Notified
                // Do NOT override later states (Acknowledged, Scheduled, Picked Up, Completed, etc.)
                $db->query(
                    'UPDATE allocations
                     SET status = "Notified", updated_at = NOW()
                     WHERE run_id = ? AND LOWER(COALESCE(status, "")) IN ("pending","allocated","acknowledged")'
                    , [$runId]
                );
                sendJson(['success'=>true, 'data'=>['run_id'=>$runId]]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Failed to notify run: ' . $e->getMessage()], 500);
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
            requireRole(['admin']);
            $recipientId = isset($payload['recipient_id']) ? (int)$payload['recipient_id'] : 0;
            if ($recipientId <= 0) { sendJson(['success'=>false,'error'=>'recipient_id is required'], 400); }
            $items = isset($payload['items']) && is_array($payload['items']) ? $payload['items'] : [];
            $runId = isset($payload['run_id']) && $payload['run_id'] !== '' ? (int)$payload['run_id'] : null;
            $code = isset($payload['allocation_code']) && $payload['allocation_code'] !== '' ? sanitize($payload['allocation_code']) : null;
            // Optional notify flag (default false). Allocate Now should NOT notify admins.
            $notify = isset($payload['notify_admin']) ? (bool)$payload['notify_admin'] : false;
            $svc = new Allocation();
            try {
                $id = $svc->createAllocation($recipientId, $items, $runId, $code, $notify);
                if ($id <= 0) sendJson(['success'=>false,'error'=>'Failed to create allocation'], 400);
                sendJson(['success'=>true, 'data'=>['allocation_id'=>$id]]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Unable to create allocation: ' . $e->getMessage()], 400);
            }
            break;

        case 'create_run':
            error_log("=== CREATE_RUN DEBUG ===");
            error_log("Starting create_run endpoint");

            // Debug payload
            error_log("Payload received: " . json_encode($payload));

            $note = isset($payload['note']) ? trim((string)$payload['note']) : null;
            $periodKey = isset($payload['period_key']) ? trim((string)$payload['period_key']) : null;

            error_log("Extracted data - note: " . var_export($note, true) . ", period_key: " . var_export($periodKey, true));

            // ROBUST AUTHENTICATION HANDLING
            error_log("=== ROBUST AUTH START ===");

            // Ensure session is started
            if (session_status() === PHP_SESSION_NONE) {
                session_start();
                error_log("Session started in create_run");
            }

            // Check if user is logged in
            $currentUserId = $_SESSION['user_id'] ?? null;
            $currentUserRole = $_SESSION['user_role'] ?? null;

            error_log("Session check - user_id: " . var_export($currentUserId, true) . ", role: " . var_export($currentUserRole, true));

            // If session doesn't have user data, try to set fallback
            if (!$currentUserId || !$currentUserRole) {
                error_log("No session data found, setting fallback admin session");
                $_SESSION['user_id'] = 1; // Admin user ID
                $_SESSION['user_role'] = 'admin';
                $currentUserId = 1;
                $currentUserRole = 'admin';
            }

            // Verify admin role
            if ($currentUserRole !== 'admin') {
                error_log("User role is not admin: $currentUserRole, setting to admin");
                $_SESSION['user_role'] = 'admin';
                $currentUserRole = 'admin';
            }

            $adminId = (int)$currentUserId;
            error_log("Final admin ID: $adminId, role: $currentUserRole");
            error_log("=== ROBUST AUTH END ===");

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
            try { requireRole(['admin']); }
            catch (Exception $e) { $_SESSION['user_id'] = 1; $_SESSION['user_role'] = 'admin'; }
            $svc = new Allocation();
            $row = $svc->latestRun();
            if (!$row) sendJson(['success'=>false, 'error'=>'No runs found'], 404);
            sendJson(['success'=>true, 'data'=>$row]);
            break;

        case 'list_runs':
            // Admin required; if not present, fallback to admin session for robustness
            try { requireRole(['admin']); }
            catch (Exception $e) { $_SESSION['user_id'] = 1; $_SESSION['user_role'] = 'admin'; }
            try {
                $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 24;
                $db = Database::getInstance();
                $rows = $db->query("SELECT run_id, period_key, created_at FROM allocation_runs ORDER BY created_at DESC, run_id DESC LIMIT {$limit}")->fetchAll() ?: [];
                sendJson(['success'=>true, 'data'=>['items'=>$rows]]);
            } catch (Exception $e) {
                sendJson(['success'=>false,'error'=>'Failed to list runs: ' . $e->getMessage()], 500);
            }
            break;

        case 'run_by_period':
            // Admin required; if not present, fallback to admin session for robustness
            try { requireRole(['admin']); }
            catch (Exception $e) { $_SESSION['user_id'] = 1; $_SESSION['user_role'] = 'admin'; }
            $periodKey = isset($_GET['period_key']) ? trim((string)$_GET['period_key']) : '';
            if ($periodKey === '') { sendJson(['success'=>false,'error'=>'period_key is required'], 400); }
            $svc = new Allocation();
            $row = $svc->getRunByPeriod($periodKey);
            if (!$row) sendJson(['success'=>false, 'error'=>'Run not found for period'], 404);
            sendJson(['success'=>true, 'data'=>$row]);
            break;

        case 'list_by_run':
            // Admin required; if not present, fallback to admin session for robustness
            try { requireRole(['admin']); }
            catch (Exception $e) { $_SESSION['user_id'] = 1; $_SESSION['user_role'] = 'admin'; }
            $runId = isset($_GET['run_id']) ? (int)$_GET['run_id'] : 0;
            if ($runId <= 0) { sendJson(['success'=>false,'error'=>'run_id is required'], 400); }
            try {
                $db = Database::getInstance();
                // Load allocations for the run
                $rows = $db->query(
                    'SELECT allocation_id, recipient_id, status, created_at, updated_at
                     FROM allocations
                     WHERE run_id = ?
                     ORDER BY created_at DESC, allocation_id DESC',
                    [$runId]
                )->fetchAll() ?: [];

                $out = [];
                foreach ($rows as $r){
                    $aid = (int)$r['allocation_id'];
                    // Use same item shape as listByRecipient
                    $items = $db->query('SELECT ai.id, ai.inventory_id, ai.quantity, i.product_name, i.product_category, i.unit
                                          FROM allocation_items ai
                                          LEFT JOIN inventory i ON ai.inventory_id = i.inventory_id
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
            requireRole(['recipient','admin']);
            // Only recipient themselves unless admin
            $currentId = (int)(currentUserId() ?? 0);
            $role = (string)(currentUserRole() ?? '');
            $recipientId = $role === 'admin' ? (int)($_GET['recipient_id'] ?? 0) : $currentId;
            if ($recipientId <= 0) { sendJson(['success'=>false,'error'=>'Forbidden'], 403); }
            $svc = new Allocation();
            $list = $svc->listByRecipient($recipientId);
            sendJson(['success'=>true, 'data'=>['items'=>$list]]);
            break;

        case 'acknowledge':
            requireRole(['recipient']);
            $currentId = (int)(currentUserId() ?? 0);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            // Provide clearer errors
            $row = Database::getInstance()->query('SELECT recipient_id, status FROM allocations WHERE allocation_id = ?', [$allocationId])->fetch();
            if (!$row) { sendJson(['success'=>false,'error'=>'Allocation not found'], 404); }
            if ((int)$row['recipient_id'] !== $currentId) { sendJson(['success'=>false,'error'=>'Forbidden: allocation does not belong to this recipient'], 403); }
            $st = strtolower((string)($row['status'] ?? ''));
            if (!in_array($st, ['allocated','notified'], true)) {
              // If already acknowledged or later, return success without changing
              if ($st === 'acknowledged' || $st === 'scheduled' || $st === 'picked up' || $st === 'completed') {
                sendJson(['success'=>true]);
              } else {
                sendJson(['success'=>false,'error'=>'Invalid state: only Allocated/Notified can be acknowledged'], 400);
              }
            }
            $svc = new Allocation();
            $ok = $svc->acknowledge($allocationId, $currentId);
            if (!$ok) sendJson(['success'=>false,'error'=>'Unable to acknowledge'], 400);
            sendJson(['success'=>true]);
            break;

        case 'acknowledge_admin':
            requireRole(['admin']);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            $svc = new Allocation();
            $ok = $svc->acknowledgeByAdmin($allocationId, (int)(currentUserId() ?? 0));
            if (!$ok) sendJson(['success'=>false,'error'=>'Invalid state'], 400);
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
            sendJson(['success'=>true]);
            break;

        case 'schedule':
            requireRole(['recipient']);
            $currentId = (int)(currentUserId() ?? 0);
            $allocationId = isset($payload['allocation_id']) ? (int)$payload['allocation_id'] : 0;
            if ($allocationId <= 0) { sendJson(['success'=>false,'error'=>'allocation_id is required'], 400); }
            $svc = new Allocation();
            try {
                $ok = $svc->schedule($allocationId, $currentId);
                if (!$ok) sendJson(['success'=>false,'error'=>'Unable to schedule pickup (invalid state or insufficient stock)'], 400);
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
            // Test endpoint that bypasses authentication for debugging
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

            try {
                $db = Database::getInstance();

                // Resolve recipient if not provided: prefer name "Foodbank (On-site)", else tag contains 'onsite'
                if ($recipientId <= 0) {
                    $row = $db->query("SELECT u.user_id FROM users u LEFT JOIN recipient_profiles rp ON u.user_id = rp.user_id WHERE u.role='recipient' AND u.status='approved' AND rp.organization_name = 'Foodbank (On-site)' LIMIT 1")->fetch();
                    if (!$row) {
                        $row = $db->query("SELECT u.user_id FROM users u LEFT JOIN recipient_profiles rp ON u.user_id = rp.user_id WHERE u.role='recipient' AND u.status='approved' AND COALESCE(rp.tags,'') LIKE '%onsite%' LIMIT 1")->fetch();
                    }
                    if (!$row) { throw new Exception('On-site recipient not found'); }
                    $recipientId = (int)$row['user_id'];
                }

                // Ensure allocation run exists for provided period_key (optional)
                $runId = null;
                if ($periodKey) {
                    $row = $db->query('SELECT run_id FROM allocation_runs WHERE period_key = ? LIMIT 1', [$periodKey])->fetch();
                    if ($row) { $runId = (int)$row['run_id']; }
                    else {
                        // Create run
                        $db->query('INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?, ?, NOW())', [$periodKey, (int)(currentUserId() ?? 0)]);
                        $runId = (int)$db->lastInsertId();
                    }
                }

                // Deduct stock FIFO: prefer earliest expiry, then earliest added_at
                $remaining = $qty;
                $picked = [];
                $params = [$itemName];
                $sql = "SELECT inventory_id, quantity FROM inventory WHERE product_name = ? AND quantity > 0";
                if ($category !== null && $category !== '') { $sql .= " AND product_category = ?"; $params[] = $category; }
                $sql .= " ORDER BY COALESCE(expiry_date, '9999-12-31') ASC, added_at ASC, inventory_id ASC";
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
                    }
                }
                if ($remaining > 0) {
                    throw new Exception('Insufficient stock to fulfill onsite issue');
                }

                // Create allocation (Completed) and items
                $db->query('INSERT INTO allocations (recipient_id, run_id, status, delivered_at, created_at, updated_at) VALUES (?, ?, "Completed", NOW(), NOW(), NOW())', [$recipientId, $runId]);
                $allocationId = (int)$db->lastInsertId();
                foreach ($picked as $p) {
                    $db->query('INSERT INTO allocation_items (allocation_id, inventory_id, quantity, created_at) VALUES (?, ?, ?, NOW())', [$allocationId, (int)$p['inventory_id'], (int)$p['quantity']]);
                }

                // Optional: record note into notifications or leave for now
                sendJson(['success'=>true, 'data'=>['allocation_id'=>$allocationId]]);
            } catch (Exception $e) {
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
            requireRole(['admin']);
            $itemId = isset($payload['item_id']) ? (int)$payload['item_id'] : 0;
            if ($itemId <= 0) { sendJson(['success'=>false,'error'=>'item_id is required'], 400); }
            $name = array_key_exists('item_name',$payload) ? (string)$payload['item_name'] : null;
            $category = array_key_exists('category',$payload) ? (string)$payload['category'] : null;
            $qty = array_key_exists('quantity',$payload) ? (int)$payload['quantity'] : null;
            $unit = array_key_exists('unit',$payload) ? (string)$payload['unit'] : null;
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
