<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Inventory.php';

// CORS / preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}
setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$uri = $_SERVER['REQUEST_URI'] ?? '';
$path = parse_url($uri, PHP_URL_PATH);
$pos = strpos($path, '/api/inventory');
$sub = $pos !== false ? substr($path, $pos + strlen('/api/inventory')) : '/';
$sub = $sub === '' ? '/' : $sub;
if (strpos($sub, '/index.php') === 0) {
    $sub = substr($sub, strlen('/index.php'));
    if ($sub === '') { $sub = '/'; }
}

try {
    // Only admins can view inventory for now
    requireRole(['admin']);

    // GET /api/inventory/backfill-in?days=14
    // Admin-only: backfill missing 'in' movements for inventory lots created within the window
    if ($method === 'GET' && preg_match('#^/(backfill-in|backfill-in/)\z#', $sub)) {
        $days = isset($_GET['days']) ? max(1, min(90, (int)$_GET['days'])) : 14;
        $db = Database::getInstance();
        // Ensure table exists (best effort)
        try {
            $db->query(
                "CREATE TABLE IF NOT EXISTS `inventory_movements` (
                    `id` int(11) NOT NULL AUTO_INCREMENT,
                    `inventory_id` int(11) NOT NULL,
                    `donation_item_id` int(11) DEFAULT NULL,
                    `direction` enum('in','out') NOT NULL,
                    `quantity` int(11) NOT NULL,
                    `mode` varchar(32) NOT NULL,
                    `recipient_id` int(11) DEFAULT NULL,
                    `note` text DEFAULT NULL,
                    `performed_by` int(11) NOT NULL,
                    `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
                    PRIMARY KEY (`id`),
                    KEY `im_inventory_idx` (`inventory_id`),
                    KEY `im_recipient_idx` (`recipient_id`),
                    KEY `im_performed_by_idx` (`performed_by`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci"
            );
        } catch (Exception $e) { /* ignore */ }
        // Select lots with no existing 'in' movement
        $sql = "SELECT inv.inventory_id, inv.added_at, di.donation_item_id, di.quantity AS initial_qty, d.procurement_type, d.donor_id, d.admin_in_charge
                FROM inventory inv
                INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                INNER JOIN donations d ON d.donation_id = di.donation_id
                LEFT JOIN inventory_movements im ON im.inventory_id = inv.inventory_id AND im.direction='in'
                WHERE inv.added_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND im.id IS NULL";
        $rows = $db->query($sql, [$days])->fetchAll();
        $inserted = 0;
        foreach ($rows as $r) {
            try {
                $inventoryId = (int)($r['inventory_id'] ?? 0);
                $donationItemId = isset($r['donation_item_id']) ? (int)$r['donation_item_id'] : null;
                $qty = (int)($r['initial_qty'] ?? 0);
                if ($inventoryId <= 0 || $qty <= 0) { continue; }
                $mode = ($r['procurement_type'] ?? '') === 'purchased' ? 'purchased' : 'donated';
                // performed_by fallback: admin_in_charge -> first approved admin
                $performedBy = 0;
                if (!empty($r['admin_in_charge'])) { $performedBy = (int)$r['admin_in_charge']; }
                if ($performedBy <= 0) {
                    try {
                        $ar = $db->query("SELECT user_id FROM users WHERE role='admin' AND status='approved' ORDER BY last_login DESC, created_at DESC LIMIT 1")->fetch();
                        if ($ar && isset($ar['user_id'])) { $performedBy = (int)$ar['user_id']; }
                    } catch (Exception $e2) { /* ignore */ }
                }
                if ($performedBy <= 0) { continue; }
                // Insert backfilled movement with created_at = inv.added_at
                if ($donationItemId) {
                    $db->query(
                        "INSERT INTO inventory_movements (inventory_id, donation_item_id, direction, quantity, mode, recipient_id, note, performed_by, created_at)
                         VALUES (?, ?, 'in', ?, ?, NULL, NULL, ?, ?)",
                        [$inventoryId, $donationItemId, $qty, $mode, $performedBy, $r['added_at']]
                    );
                } else {
                    $db->query(
                        "INSERT INTO inventory_movements (inventory_id, direction, quantity, mode, recipient_id, note, performed_by, created_at)
                         VALUES (?, 'in', ?, ?, NULL, NULL, ?, ?)",
                        [$inventoryId, $qty, $mode, $performedBy, $r['added_at']]
                    );
                }
                $inserted++;
            } catch (Exception $ie) {
                error_log('Backfill-in insert failed for inventory_id '.$r['inventory_id'].': '.$ie->getMessage());
            }
        }
        sendJson(['success'=>true,'data'=>['scanned'=>count($rows),'inserted'=>$inserted,'days'=>$days]]);
    }

    // GET /api/inventory/report-in - JSON rows shaped like Product In sample (one row per movement-in)
    if ($method === 'GET' && preg_match('#^/(report-in|report-in/)\z#', $sub)) {
        $db = Database::getInstance();
        $start = isset($_GET['start']) ? trim($_GET['start']) : '';
        $end   = isset($_GET['end']) ? trim($_GET['end']) : '';
        $now = new DateTime('now');
        if ($start === '') { $start = $now->format('Y-m-01'); }
        if ($end === '') { $end = $now->format('Y-m-t'); }
        $startTs = strtotime($start . ' 00:00:00');
        $endTs   = strtotime($end . ' 23:59:59');
        if ($startTs === false || $endTs === false) { sendJson(['success'=>false,'error'=>'Invalid start or end date'], 400); }
        $startDt = date('Y-m-d H:i:s', $startTs);
        $endDt   = date('Y-m-d H:i:s', $endTs);

        $sql = "SELECT 
                    DATE(im.created_at) AS entry_date,
                    COALESCE(NULLIF(d.procurement_type, ''), NULLIF(im.mode, '')) AS donated_or_purchased,
                    COALESCE(dp.organization_name, du.name) AS donor_name,
                    dc.name AS donor_category,
                    di.product_name,
                    CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS product_category,
                    im.quantity,
                    COALESCE(u.label, u.code) AS packed_by,
                    di.total_weight,
                    di.total_cost,
                    di.expiry_date,
                    up.name AS entry_by
                FROM inventory_movements im
                LEFT JOIN inventory inv ON inv.inventory_id = im.inventory_id
                LEFT JOIN donation_items di ON di.donation_item_id = COALESCE(im.donation_item_id, inv.donation_item_id)
                LEFT JOIN categories c ON c.category_id = di.category_id
                LEFT JOIN units u ON u.unit_id = di.unit_id
                LEFT JOIN donations d ON d.donation_id = di.donation_id
                LEFT JOIN users du ON du.user_id = d.donor_id
                LEFT JOIN donor_profiles dprof ON dprof.user_id = du.user_id
                LEFT JOIN donor_categories dc ON dc.id = dprof.donor_category_id
                LEFT JOIN users up ON up.user_id = im.performed_by
                WHERE im.direction = 'in' AND im.created_at BETWEEN ? AND ?
                ORDER BY im.created_at ASC, im.id ASC";
        $rows = $db->query($sql, [$startDt, $endDt])->fetchAll();
        // Fallback: use current admin's name when entry_by is missing
        $currentAdminName = '';
        try {
            $me = $db->query('SELECT name FROM users WHERE user_id = ?', [(int)currentUserId()])->fetch();
            if ($me && isset($me['name'])) { $currentAdminName = (string)$me['name']; }
        } catch (Exception $e) { /* ignore */ }
        $data = [];
        foreach ($rows as $r) {
            $data[] = [
                'ENTRY DATE' => $r['entry_date'] ?? '',
                'DONATED/PURCHASED' => ($r['donated_or_purchased'] ?? 'donated'),
                'DONOR NAME' => $r['donor_name'] ?? '',
                'DONOR CATEGORY' => $r['donor_category'] ?? '',
                'PRODUCT NAME' => $r['product_name'] ?? '',
                'PRODUCT CATEGORY' => $r['product_category'] ?? '',
                'QUANTITY' => (int)($r['quantity'] ?? 0),
                'PACKED BY' => $r['packed_by'] ?? '',
                'TOTAL WEIGHT(KG)' => ($r['total_weight'] !== null ? (float)$r['total_weight'] : null),
                'TOTAL COST(P)' => ($r['total_cost'] !== null ? (float)$r['total_cost'] : null),
                'EXPIRY DATE' => $r['expiry_date'] ?? '',
                'ENTRY BY' => (isset($r['entry_by']) && $r['entry_by'] !== '' ? $r['entry_by'] : $currentAdminName),
            ];
        }
        sendJson(['success'=>true,'data'=>['rows'=>$data,'start'=>$start,'end'=>$end]]);
    }

    // GET /api/inventory/report-out - JSON rows for Product Out (one row per movement)
    if ($method === 'GET' && preg_match('#^/(report-out|report-out/)\z#', $sub)) {
        $db = Database::getInstance();
        $start = isset($_GET['start']) ? trim($_GET['start']) : '';
        $end   = isset($_GET['end']) ? trim($_GET['end']) : '';
        $now = new DateTime('now');
        if ($start === '') { $start = $now->format('Y-m-01'); }
        if ($end === '') { $end = $now->format('Y-m-t'); }
        $startTs = strtotime($start . ' 00:00:00');
        $endTs   = strtotime($end . ' 23:59:59');
        if ($startTs === false || $endTs === false) { sendJson(['success'=>false,'error'=>'Invalid start or end date'], 400); }
        $startDt = date('Y-m-d H:i:s', $startTs);
        $endDt   = date('Y-m-d H:i:s', $endTs);

        $sql = "SELECT 
                    im.created_at AS date_out,
                    di.product_name AS item,
                    CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS category,
                    im.quantity,
                    im.mode,
                    im.note,
                    up.name AS performed_by
                FROM inventory_movements im
                LEFT JOIN inventory inv ON inv.inventory_id = im.inventory_id
                LEFT JOIN donation_items di ON di.donation_item_id = COALESCE(im.donation_item_id, inv.donation_item_id)
                LEFT JOIN categories c ON c.category_id = di.category_id
                LEFT JOIN users up ON up.user_id = im.performed_by
                WHERE im.direction = 'out' AND im.created_at BETWEEN ? AND ?
                ORDER BY im.created_at ASC, im.id ASC";
        $rows = $db->query($sql, [$startDt, $endDt])->fetchAll();
        $data = [];
        foreach ($rows as $r) {
            $data[] = [
                'DATE OUT' => $r['date_out'] ?? '',
                'ITEM' => $r['item'] ?? '',
                'CATEGORY' => $r['category'] ?? '',
                'QUANTITY' => (int)($r['quantity'] ?? 0),
                'MODE' => $r['mode'] ?? '',
                'NOTE' => $r['note'] ?? '',
                'PERFORMED BY' => $r['performed_by'] ?? '',
            ];
        }
        sendJson(['success'=>true,'data'=>['rows'=>$data,'start'=>$start,'end'=>$end]]);
    }

    // POST /api/inventory/import - bulk import rows parsed client-side (placed before GET list)
    if ($method === 'POST' && preg_match('#^/(import|import/)\z#', $sub)) {
        $data = getJsonInput();
        $rows = isset($data['rows']) && is_array($data['rows']) ? $data['rows'] : [];
        if (!$rows) { sendJson(['success'=>false,'error'=>'rows array is required'], 400); }
        $inv = new Inventory();
        $summary = $inv->importRows($rows, (int)currentUserId());
        sendJson(['success'=>true, 'data'=> $summary]);
    }

    // POST /api/inventory/update-tags - update tags for a grouped item (by name+category)
    if ($method === 'POST' && preg_match('#^/(update-tags|update-tags/)\z#', $sub)) {
        $data = getJsonInput();
        $scope = isset($data['scope']) ? trim((string)$data['scope']) : 'group';
        $itemName = isset($data['item_name']) ? trim((string)$data['item_name']) : '';
        $category = isset($data['category']) ? trim((string)$data['category']) : '';
        $tags = isset($data['tags']) ? (string)$data['tags'] : '';

        if ($scope !== 'group') { sendJson(['success'=>false,'error'=>'Only group scope is supported'], 400); }
        if ($itemName === '' || $category === '') { sendJson(['success'=>false,'error'=>'item_name and category are required'], 400); }

        try {
            $db = Database::getInstance();
            // Update tags by joining categories to match full label
            $db->query(
                'UPDATE donation_items di
                 LEFT JOIN categories c ON c.category_id = di.category_id
                 SET di.tags = ?
                 WHERE di.product_name = ?
                   AND CONCAT(c.primary_name, COALESCE(CONCAT(" - ", c.secondary_name), "")) = ?',
                [ $tags, $itemName, $category ]
            );
            // Report how many rows affected
            $row = $db->query(
                'SELECT COUNT(*) AS n FROM donation_items di
                 LEFT JOIN categories c ON c.category_id = di.category_id
                 WHERE di.product_name = ?
                   AND CONCAT(c.primary_name, COALESCE(CONCAT(" - ", c.secondary_name), "")) = ?
                   AND COALESCE(di.tags, "") = ?',
                [ $itemName, $category, $tags ]
            )->fetch();
            $count = (int)($row['n'] ?? 0);
            sendJson(['success'=>true, 'data'=>['updated'=>$count]]);
        } catch (Exception $e) {
            sendJson(['success'=>false,'error'=>'Failed to update tags: ' . $e->getMessage()], 500);
        }
    }

    // GET /api/inventory/list
    if ($method === 'GET' && preg_match('#^/(list|list/)\z#', $sub)) {
        $db = Database::getInstance();

        // Filters
        $q = isset($_GET['q']) ? trim(sanitize($_GET['q'])) : '';
        $category = isset($_GET['category']) ? trim(sanitize($_GET['category'])) : '';
        $dateRange = isset($_GET['date']) ? trim($_GET['date']) : ''; // All | Today | This Week | This Month
        $donorId = isset($_GET['donor_id']) && $_GET['donor_id'] !== '' ? (int)$_GET['donor_id'] : null;
        $groupMode = isset($_GET['group']) ? trim($_GET['group']) : '';

        // Pagination
        $page = isset($_GET['page']) ? max(1, (int)$_GET['page']) : 1;
        $limit = isset($_GET['limit']) ? max(1, min(100, (int)$_GET['limit'])) : 25;
        $offset = ($page - 1) * $limit;

        $where = [];
        $params = [];
        if ($q !== '') {
            $where[] = "(di.product_name LIKE ? OR CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) LIKE ?)";
            $params[] = '%' . $q . '%';
            $params[] = '%' . $q . '%';
        }
        if ($category !== '' && strtolower($category) !== 'all') {
            $where[] = "CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) = ?";
            $params[] = $category;
        }
        if ($donorId) {
            $where[] = 'd.donor_id = ?';
            $params[] = $donorId;
        }
        if ($dateRange && strtolower($dateRange) !== 'all') {
            // Filter by added_at relative ranges
            if ($dateRange === 'Today') {
                $where[] = 'DATE(inv.added_at) = CURDATE()';
            } elseif ($dateRange === 'This Week') {
                $where[] = 'YEARWEEK(inv.added_at, 1) = YEARWEEK(CURDATE(), 1)';
            } elseif ($dateRange === 'This Month') {
                $where[] = 'DATE_FORMAT(inv.added_at, "%Y-%m") = DATE_FORMAT(CURDATE(), "%Y-%m")';
            }
        }
        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        if ($groupMode === 'merge') {
            // Group by item_name + category
            $countSql = "SELECT COUNT(*) AS n FROM (
                SELECT 1 FROM inventory inv
                INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                LEFT JOIN categories c ON c.category_id = di.category_id
                INNER JOIN donations d ON d.donation_id = di.donation_id
                $whereSql GROUP BY di.product_name, CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), ''))
            ) x";
            $total = (int)($db->query($countSql, $params)->fetch()['n'] ?? 0);

            $sql = "SELECT 
                        di.product_name AS item_name,
                        CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS category,
                        SUM(inv.quantity) AS total_quantity,
                        MIN(di.expiry_date) AS earliest_expiry,
                        MIN(inv.added_at) AS first_added_at,
                        MAX(inv.added_at) AS last_added_at,
                        MIN(COALESCE(u.label, u.code)) AS unit,
                        GROUP_CONCAT(DISTINCT NULLIF(di.tags, '') ORDER BY di.tags SEPARATOR ',') AS tags_concat,
                        COUNT(*) AS lots
                    FROM inventory inv
                    INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                    LEFT JOIN categories c ON c.category_id = di.category_id
                    LEFT JOIN units u ON u.unit_id = di.unit_id
                    INNER JOIN donations d ON d.donation_id = di.donation_id
                    $whereSql
                    GROUP BY di.product_name, CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), ''))
                    ORDER BY COALESCE(MIN(di.expiry_date), '9999-12-31') ASC, di.product_name ASC
                    LIMIT $limit OFFSET $offset";
            $rows = $db->query($sql, $params)->fetchAll();
            // Derive status using earliest_expiry
            $today = new DateTime('today');
            foreach ($rows as &$r) {
                $status = 'In Stock';
                if (!empty($r['earliest_expiry'])) {
                    try {
                        $exp = new DateTime($r['earliest_expiry']);
                        if ($exp < $today) {
                            $status = 'Expired';
                        } else {
                            $diff = (int)$today->diff($exp)->format('%r%a');
                            if ($diff >= 0 && $diff <= 3) { $status = 'Expiring Soon'; }
                        }
                    } catch (Exception $e) { /* ignore */ }
                }
                $r['derived_status'] = $status;
            }
        } else {
            $countSql = "SELECT COUNT(*) AS n FROM inventory inv INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id LEFT JOIN categories c ON c.category_id = di.category_id INNER JOIN donations d ON d.donation_id = di.donation_id $whereSql";
            $total = (int)($db->query($countSql, $params)->fetch()['n'] ?? 0);

            $sql = "SELECT 
                        inv.inventory_id AS id,
                        di.product_name AS item_name,
                        CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS category,
                        inv.quantity,
                        di.expiry_date,
                        inv.added_at,
                        COALESCE(units.label, units.code) AS unit,
                        d.donation_id AS source_donation_id,
                        d.batch_id AS source_batch_id,
                        d.donor_id,
                        dp.organization_name AS donor_org,
                        usr.name AS donor_name
                    FROM inventory inv
                    INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                    LEFT JOIN categories c ON c.category_id = di.category_id
                    LEFT JOIN units units ON units.unit_id = di.unit_id
                    INNER JOIN donations d ON d.donation_id = di.donation_id
                    LEFT JOIN users usr ON usr.user_id = d.donor_id
                    LEFT JOIN donor_profiles dp ON dp.user_id = usr.user_id
                    $whereSql
                    ORDER BY inv.added_at DESC
                    LIMIT $limit OFFSET $offset";
            $rows = $db->query($sql, $params)->fetchAll();

            // Derive status client-friendly (expired, expiring soon, in stock)
            $today = new DateTime('today');
            foreach ($rows as &$r) {
                $status = 'In Stock';
                if (!empty($r['expiry_date'])) {
                    try {
                        $exp = new DateTime($r['expiry_date']);
                        if ($exp < $today) {
                            $status = 'Expired';
                        } else {
                            $diff = (int)$today->diff($exp)->format('%r%a');
                            if ($diff >= 0 && $diff <= 3) { $status = 'Expiring Soon'; }
                        }
                    } catch (Exception $e) { /* ignore */ }
                }
                $r['derived_status'] = $status;
            }
        }

        $resp = [
            'success' => true,
            'data' => [
                'items' => $rows,
                'pagination' => [
                    'page' => $page,
                    'limit' => $limit,
                    'total' => $total,
                    'pages' => ($limit ? (int)ceil($total / $limit) : 1)
                ]
            ]
        ];
        echo json_encode($resp);
        exit;
    }

    // GET /api/inventory/movements
    if ($method === 'GET' && preg_match('#^/(movements|movements/)\z#', $sub)) {
        $db = Database::getInstance();
        $limitRaw = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
        $allowed = [20,50,100];
        $limit = in_array($limitRaw, $allowed, true) ? $limitRaw : 20;
        $page = isset($_GET['page']) ? max(1, (int)$_GET['page']) : 1;
        $mode = isset($_GET['mode']) ? trim(sanitize($_GET['mode'])) : '';
        $recipientId = isset($_GET['recipient_id']) && $_GET['recipient_id'] !== '' ? (int)$_GET['recipient_id'] : null;
        $since = isset($_GET['since']) ? trim($_GET['since']) : '';
        $days = isset($_GET['days']) ? max(1, min(31, (int)$_GET['days'])) : 2;
        $direction = isset($_GET['direction']) ? strtolower(trim(sanitize($_GET['direction']))) : 'out'; // in|out|all

        $where = [];
        $params = [];
        if ($direction === 'in') {
            $where[] = 'im.direction = "in"';
        } elseif ($direction === 'out') {
            $where[] = 'im.direction = "out"';
        } else { // all
            $where[] = 'im.direction IN ("in","out")';
        }
        // Only apply mode/recipient filters when direction is out
        if ($direction !== 'in') {
            if ($mode !== '' && in_array($mode, ['recipient','onsite'], true)) {
                $where[] = 'im.mode = ?';
                $params[] = $mode;
            }
            if (!empty($recipientId)) {
                $where[] = 'im.recipient_id = ?';
                $params[] = $recipientId;
            }
        }
        if ($since !== '') {
            $where[] = 'im.created_at >= ?';
            $params[] = $since;
        } else {
            $where[] = 'im.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
            $params[] = $days;
        }
        $whereSql = 'WHERE ' . implode(' AND ', $where);

        // Count total for pagination
        $countSql = "SELECT COUNT(*) AS n
                FROM inventory_movements im
                $whereSql";
        $total = (int)($db->query($countSql, $params)->fetch()['n'] ?? 0);
        $pages = ($limit ? (int)ceil($total / $limit) : 1);
        if ($page > $pages && $pages > 0) { $page = $pages; }
        $offset = ($page - 1) * $limit;

        $sql = "SELECT 
                    im.id,
                    im.inventory_id,
                    im.direction,
                    im.quantity,
                    im.mode,
                    im.recipient_id,
                    ur.name AS recipient_name,
                    im.performed_by,
                    COALESCE(NULLIF(rp.organization_name, ''), up.name) AS performed_by_name,
                    im.created_at,
                    di.product_name AS item_name,
                    CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS category
                FROM inventory_movements im
                LEFT JOIN inventory inv ON inv.inventory_id = im.inventory_id
                LEFT JOIN donation_items di ON di.donation_item_id = COALESCE(im.donation_item_id, inv.donation_item_id)
                LEFT JOIN categories c ON c.category_id = di.category_id
                LEFT JOIN users ur ON ur.user_id = im.recipient_id
                LEFT JOIN recipient_profiles rp ON rp.user_id = im.recipient_id
                LEFT JOIN users up ON up.user_id = im.performed_by
                $whereSql
                ORDER BY im.created_at DESC, im.id DESC
                LIMIT $limit OFFSET $offset";
        $rows = $db->query($sql, $params)->fetchAll();
        sendJson(['success' => true, 'data' => ['items' => $rows, 'pagination' => ['page'=>$page,'limit'=>$limit,'total'=>$total,'pages'=>$pages]]]);
    }

    // POST /api/inventory/move-out
    if ($method === 'POST' && preg_match('#^/(move-out|move-out/)\z#', $sub)) {
        $data = getJsonInput();
        $inventoryId = isset($data['inventory_id']) ? (int)$data['inventory_id'] : 0;
        $quantity = isset($data['quantity']) ? (int)$data['quantity'] : 0;
        $mode = isset($data['mode']) ? sanitize($data['mode']) : '';
        $recipientId = isset($data['recipient_id']) && $data['recipient_id'] !== '' ? (int)$data['recipient_id'] : null;
        $note = isset($data['note']) ? sanitize($data['note']) : null;

        if ($inventoryId <= 0) { sendJson(['success' => false, 'error' => 'inventory_id is required'], 400); }
        if ($quantity <= 0) { sendJson(['success' => false, 'error' => 'quantity must be positive'], 400); }
        if (!in_array($mode, ['recipient','onsite','discarded'], true)) { sendJson(['success' => false, 'error' => 'mode must be recipient, onsite, or discarded'], 400); }
        if ($mode === 'recipient' && empty($recipientId)) { sendJson(['success' => false, 'error' => 'recipient_id is required for recipient mode'], 400); }

        $inv = new Inventory();
        try {
            $result = $inv->moveOut($inventoryId, $quantity, (int)currentUserId(), $mode, $recipientId, $note);
            sendJson(['success' => true, 'data' => $result]);
        } catch (Exception $e) {
            $msg = $e->getMessage();
            $code = 400;
            if (!preg_match('/(Quantity must be positive|Invalid mode|required|not found|Insufficient stock)/i', $msg)) {
                $code = 500; $msg = 'Internal server error';
                error_log('Inventory move-out error: ' . $e->getMessage());
            }
            sendJson(['success' => false, 'error' => $msg], $code);
        }
    }

    // POST /api/inventory/move-out-group
    if ($method === 'POST' && preg_match('#^/(move-out-group|move-out-group/)\z#', $sub)) {
        $data = getJsonInput();
        $itemName = isset($data['item_name']) ? sanitize($data['item_name']) : '';
        $category = isset($data['category']) ? sanitize($data['category']) : '';
        $quantity = isset($data['quantity']) ? (int)$data['quantity'] : 0;
        $mode = isset($data['mode']) ? sanitize($data['mode']) : '';
        $recipientId = isset($data['recipient_id']) && $data['recipient_id'] !== '' ? (int)$data['recipient_id'] : null;
        $note = isset($data['note']) ? sanitize($data['note']) : null;

        if ($itemName === '' || $category === '') { sendJson(['success' => false, 'error' => 'item_name and category are required'], 400); }
        if ($quantity <= 0) { sendJson(['success' => false, 'error' => 'quantity must be positive'], 400); }
        if (!in_array($mode, ['recipient','onsite','discarded'], true)) { sendJson(['success' => false, 'error' => 'mode must be recipient, onsite, or discarded'], 400); }
        if ($mode === 'recipient' && empty($recipientId)) { sendJson(['success' => false, 'error' => 'recipient_id is required for recipient mode'], 400); }

        $inv = new Inventory();
        try {
            $result = $inv->moveOutGroup($itemName, $category, $quantity, (int)currentUserId(), $mode, $recipientId, $note);
            sendJson(['success' => true, 'data' => $result]);
        } catch (Exception $e) {
            $msg = $e->getMessage();
            $code = 400;
            if (!preg_match('/(Quantity must be positive|Invalid mode|required|not found|Insufficient stock)/i', $msg)) {
                $code = 500; $msg = 'Internal server error';
                error_log('Inventory move-out-group error: ' . $e->getMessage());
            }
            sendJson(['success' => false, 'error' => $msg], $code);
        }
    }

    echo json_encode(['success' => false, 'error' => 'Endpoint not found']);
} catch (Exception $e) {
    error_log('Inventory API error: ' . $e->getMessage());
    $debug = isset($_GET['debug']) ? (int)$_GET['debug'] : 0;
    $msg = $debug ? $e->getMessage() : 'Internal server error';
    echo json_encode(['success' => false, 'error' => $msg]);
}
