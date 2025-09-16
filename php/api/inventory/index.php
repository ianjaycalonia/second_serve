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
            $where[] = '(i.product_name LIKE ? OR i.product_category LIKE ?)';
            $params[] = '%' . $q . '%';
            $params[] = '%' . $q . '%';
        }

    // POST /api/inventory/backfill - scan donations with status 'Picked Up' and add missing inventory lots
    if ($method === 'POST' && preg_match('#^/(backfill|backfill/)\z#', $sub)) {
        // Admin only (already enforced above)
        $db = Database::getInstance();
        $inv = new Inventory();
        $added = 0; $skipped = 0;
        // Fetch donations that are Picked Up or Completed and not deleted
        $rows = $db->query(
            "SELECT donation_id FROM donations WHERE deleted_at IS NULL AND status IN ('Picked Up','Completed') ORDER BY donation_id ASC"
        )->fetchAll();
        foreach ($rows as $r) {
            try {
                // Inventory::addFromDonationRow is idempotent via source_donation_id unique check
                $inv->addFromDonationId((int)$r['donation_id']);
                $added++;
            } catch (Exception $e) {
                // If already exists, skip
                $skipped++;
            }
        }
        sendJson(['success' => true, 'data' => ['processed' => count($rows), 'added' => $added, 'skipped' => $skipped]]);
    }
        if ($category !== '' && strtolower($category) !== 'all') {
            $where[] = 'i.product_category = ?';
            $params[] = $category;
        }
        if ($donorId) {
            $where[] = 'i.donor_id = ?';
            $params[] = $donorId;
        }
        if ($dateRange && strtolower($dateRange) !== 'all') {
            // Filter by added_at relative ranges
            if ($dateRange === 'Today') {
                $where[] = 'DATE(i.added_at) = CURDATE()';
            } elseif ($dateRange === 'This Week') {
                $where[] = 'YEARWEEK(i.added_at, 1) = YEARWEEK(CURDATE(), 1)';
            } elseif ($dateRange === 'This Month') {
                $where[] = 'DATE_FORMAT(i.added_at, "%Y-%m") = DATE_FORMAT(CURDATE(), "%Y-%m")';
            }
        }
        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        if ($groupMode === 'merge') {
            // Group by item_name + category
            $countSql = "SELECT COUNT(*) AS n FROM (
                SELECT 1 FROM inventory i $whereSql GROUP BY i.product_name, i.product_category
            ) x";
            $total = (int)($db->query($countSql, $params)->fetch()['n'] ?? 0);

            $sql = "SELECT 
                        i.product_name AS item_name,
                        i.product_category AS category,
                        SUM(i.quantity) AS total_quantity,
                        MIN(i.expiry_date) AS earliest_expiry,
                        MIN(i.added_at) AS first_added_at,
                        MAX(i.added_at) AS last_added_at,
                        COUNT(*) AS lots
                    FROM inventory i
                    $whereSql
                    GROUP BY i.product_name, i.product_category
                    ORDER BY COALESCE(MIN(i.expiry_date), '9999-12-31') ASC, i.product_name ASC
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
            $countSql = "SELECT COUNT(*) AS n FROM inventory i $whereSql";
            $total = (int)($db->query($countSql, $params)->fetch()['n'] ?? 0);

            $sql = "SELECT 
                        i.inventory_id AS id,
                        i.product_name AS item_name,
                        i.product_category AS category,
                        i.quantity,
                        i.expiry_date,
                        i.added_at,
                        i.donation_id AS source_donation_id,
                        i.source_batch_id,
                        i.donor_id,
                        dp.organization_name AS donor_org,
                        u.name AS donor_name
                    FROM inventory i
                    LEFT JOIN users u ON u.user_id = i.donor_id
                    LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
                    $whereSql
                    ORDER BY i.added_at DESC
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
        if ($mode !== 'recipient' && $mode !== 'onsite') { sendJson(['success' => false, 'error' => 'mode must be recipient or onsite'], 400); }
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
        if ($mode !== 'recipient' && $mode !== 'onsite') { sendJson(['success' => false, 'error' => 'mode must be recipient or onsite'], 400); }
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
    echo json_encode(['success' => false, 'error' => 'Internal server error']);
}
