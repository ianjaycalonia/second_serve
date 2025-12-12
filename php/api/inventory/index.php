<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Inventory.php';
require_once __DIR__ . '/../../core/Repack.php';

const INVENTORY_SETTING_DEFAULTS = [
    'inventory_soon_expire_lead_days' => '7',
];

function inv_get_setting(string $key, $default = null){
    try {
        $db = Database::getInstance();
        $row = $db->query('SELECT `value` FROM settings WHERE `key` = ? LIMIT 1', [$key])->fetch();
        if ($row && array_key_exists('value', $row)) {
            return $row['value'];
        }
    } catch (Throwable $e){ /* ignore */ }
    if (array_key_exists($key, INVENTORY_SETTING_DEFAULTS)) {
        return INVENTORY_SETTING_DEFAULTS[$key];
    }
    return $default;
}

function inventory_move_expired_items(bool $background = false): array {
    $db = Database::getInstance();
    $startedTxn = !$db->inTransaction();
    if ($startedTxn) {
        $db->beginTransaction();
    }

    try {
        $expiredItems = $db->query(
            "SELECT inv.inventory_id, inv.quantity, di.*, d.donor_id, d.batch_id
             FROM inventory inv
             JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
             JOIN donations d ON d.donation_id = di.donation_id
             LEFT JOIN expired_inventory ei ON ei.inventory_id = inv.inventory_id
             WHERE di.expiry_date < CURDATE()
               AND inv.quantity > 0
               AND ei.inventory_id IS NULL"
        )->fetchAll();

        $movedCount = 0;
        $actingUserId = (int)(currentUserId() ?? 0);
        if ($actingUserId <= 0) {
            $actingUserId = 1; // fallback system user
        }

        foreach ($expiredItems as $item) {
            $inventoryId = (int)($item['inventory_id'] ?? 0);
            if ($inventoryId <= 0) {
                continue;
            }

            $db->query(
                "INSERT INTO expired_inventory (
                    inventory_id, product_name, category_id, quantity,
                    unit_id, expiry_date, original_donation_id,
                    donor_id, batch_id, moved_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    $inventoryId,
                    $item['product_name'],
                    $item['category_id'],
                    $item['quantity'],
                    $item['unit_id'],
                    $item['expiry_date'],
                    $item['donation_id'],
                    $item['donor_id'],
                    $item['batch_id'],
                    $actingUserId,
                ]
            );

            $db->query(
                "UPDATE inventory SET quantity = 0 WHERE inventory_id = ?",
                [$inventoryId]
            );

            $movedCount++;
        }

        if ($startedTxn && $db->inTransaction()) {
            $db->commit();
        }
    } catch (Exception $e) {
        if ($startedTxn && $db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }

    $alreadyInExpired = (int)($db->query(
        "SELECT COUNT(*) AS cnt
         FROM expired_inventory ei
         INNER JOIN inventory inv_exp ON inv_exp.inventory_id = ei.inventory_id
         INNER JOIN donation_items di_exp ON di_exp.donation_item_id = inv_exp.donation_item_id
         WHERE di_exp.expiry_date < CURDATE()"
    )->fetch()['cnt'] ?? 0);

    return [
        'moved_count' => $movedCount,
        'already_in_expired' => $alreadyInExpired,
        'timestamp' => date('Y-m-d H:i:s'),
        'background' => $background,
    ];
}

// Handle OPTIONS requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
header('Content-Type: application/json');

// CSRF protection for non-GET methods
requireCsrf();

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

    if ($method === 'GET' && preg_match('#^/lot-details/?$#', $sub)) {
        $itemName = trim((string)($_GET['item_name'] ?? ''));
        $categoryFilter = isset($_GET['category']) ? trim((string)$_GET['category']) : '';
        if ($itemName === '') {
            sendJson(['success' => false, 'error' => 'item_name required'], 400);
        }

        $db = Database::getInstance();
        $soonLeadDaysRaw = inv_get_setting('inventory_soon_expire_lead_days', null);
        $soonLeadDays = is_numeric($soonLeadDaysRaw) ? (int)$soonLeadDaysRaw : 7;
        if ($soonLeadDays < 0) { $soonLeadDays = 0; }
        $soonLeadDays = min($soonLeadDays, 365);

        $params = [$itemName];
        $catSql = '';
        if ($categoryFilter === '') {
            $catSql = " AND IFNULL(CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')), '') = ''";
        } else {
            $catSql = " AND IFNULL(CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')), '') = ?";
            $params[] = $categoryFilter;
        }

        $sql = "SELECT 
                    inv.inventory_id AS lot_id,
                    inv.quantity,
                    inv.added_at,
                    di.expiry_date,
                    COALESCE(u.label, u.code) AS unit
                FROM inventory inv
                INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                LEFT JOIN categories c ON c.category_id = di.category_id
                LEFT JOIN units u ON u.unit_id = di.unit_id
                WHERE di.product_name = ? {$catSql}
                ORDER BY 
                    CASE WHEN di.expiry_date IS NULL THEN 1 ELSE 0 END,
                    di.expiry_date,
                    inv.added_at";

        $rows = $db->query($sql, $params)->fetchAll();

        $today = new DateTime('today');
        $lots = [];
        foreach ($rows as $row) {
            $status = 'In Stock';
            $expiryDate = $row['expiry_date'] ?? null;
            if (!empty($expiryDate)) {
                try {
                    $exp = new DateTime($expiryDate);
                    if ($exp < $today) {
                        $status = 'Expired';
                    } else {
                        $diff = (int)$today->diff($exp)->format('%r%a');
                        if ($diff >= 0 && $diff <= $soonLeadDays) {
                            $status = 'Expiring Soon';
                        }
                    }
                } catch (Exception $e) {
                    // leave status as default
                }
            }

            $lots[] = [
                'lot_id' => (int)($row['lot_id'] ?? 0),
                'quantity' => (int)($row['quantity'] ?? 0),
                'unit' => $row['unit'] ?? null,
                'added_at' => $row['added_at'] ?? null,
                'expiry_date' => $expiryDate,
                'status' => $status,
            ];
        }

        sendJson([
            'success' => true,
            'data' => [
                'item_name' => $itemName,
                'category' => $categoryFilter,
                'lots' => $lots,
            ],
        ]);
    }

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

        $categoryExpr = 'c.name';
        try {
            $colRows = $db->query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='categories' AND COLUMN_NAME IN ('primary_name','secondary_name')")->fetchAll();
            $cols = [];
            foreach ($colRows as $row) {
                $name = isset($row['COLUMN_NAME']) ? (string)$row['COLUMN_NAME'] : null;
                if ($name !== null && $name !== '') {
                    $cols[] = strtolower($name);
                }
            }
            $hasPrimary = in_array('primary_name', $cols, true);
            $hasSecondary = in_array('secondary_name', $cols, true);
            if ($hasPrimary) {
                if ($hasSecondary) {
                    $categoryExpr = "CONCAT(c.primary_name, CASE WHEN c.secondary_name IS NULL OR c.secondary_name = '' THEN '' ELSE CONCAT(' - ', c.secondary_name) END)";
                } else {
                    $categoryExpr = 'c.primary_name';
                }
            }
        } catch (Exception $e) { /* fallback to legacy column */ }

        $donorCategoryParts = ['dc.name', 'dc2.name'];
        $hasLegacyDonorCategory = false;
        try {
            $chk = $db->query("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='donor_profiles' AND COLUMN_NAME='donor_category' LIMIT 1")->fetch();
            $hasLegacyDonorCategory = (bool)$chk;
        } catch (Exception $e) {
            $hasLegacyDonorCategory = false;
        }
        if ($hasLegacyDonorCategory) {
            $donorCategoryParts[] = 'dprof.donor_category';
            $donorCategoryParts[] = 'dprof_name.donor_category';
        }
        $donorCategoryExpr = "COALESCE(" . implode(', ', $donorCategoryParts) . ")";
        $donorNameExpr = "COALESCE(dprof.organization_name, du.name, dprof_name.organization_name, d.donor_name)";

        $sql = "SELECT 
                    DATE(im.created_at) AS entry_date,
                    COALESCE(NULLIF(d.procurement_type, ''), NULLIF(im.mode, '')) AS donated_or_purchased,
                    {$donorNameExpr} AS donor_name,
                    {$donorCategoryExpr} AS donor_category,
                    di.product_name,
                    {$categoryExpr} AS product_category,
                    im.quantity,
                    COALESCE(u.label, u.code) AS packed_by,
                    di.total_weight,
                    di.unit_cost,
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
                LEFT JOIN donor_profiles dprof_name ON dprof_name.organization_name = d.donor_name
                LEFT JOIN donor_categories dc2 ON dc2.id = dprof_name.donor_category_id
                LEFT JOIN users up ON up.user_id = im.performed_by
                WHERE im.direction = 'in'
                  AND (im.mode IS NULL OR im.mode <> 'repack')
                  AND im.created_at BETWEEN ? AND ?
                ORDER BY im.created_at ASC, im.id ASC";
        try {
            $rows = $db->query($sql, [$startDt, $endDt])->fetchAll();
        } catch (Exception $e) {
            error_log('report-in query failed: ' . $e->getMessage());
            sendJson(['success'=>false,'error'=>'report-in query failed: '.$e->getMessage()], 500);
        }
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
                'UNIT WEIGHT(KG)' => ($r['total_weight'] !== null && $r['quantity'] > 0 ? (float)($r['total_weight'] / $r['quantity']) : null),
                'UNIT COST(P)' => ($r['unit_cost'] !== null ? (float)$r['unit_cost'] : null),
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

        $categoryExpr = "CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), ''))";
        try {
            $colRows = $db->query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='categories' AND COLUMN_NAME IN ('primary_name','secondary_name','name')")->fetchAll();
            $cols = [];
            foreach ($colRows as $row) {
                $nm = isset($row['COLUMN_NAME']) ? strtolower((string)$row['COLUMN_NAME']) : null;
                if ($nm) { $cols[$nm] = true; }
            }
            $hasPrimary = isset($cols['primary_name']);
            $hasSecondary = isset($cols['secondary_name']);
            if ($hasPrimary) {
                if ($hasSecondary) {
                    $categoryExpr = "CONCAT(c.primary_name, CASE WHEN c.secondary_name IS NULL OR c.secondary_name = '' THEN '' ELSE CONCAT(' - ', c.secondary_name) END)";
                } else {
                    $categoryExpr = 'c.primary_name';
                }
            } elseif (isset($cols['name'])) {
                $categoryExpr = 'c.name';
            }
        } catch (Exception $e) { /* fallback */ }

        $unitBase = "COALESCE(u.label, u.code)";
        $weightSelect = "MAX(CASE
                            WHEN di.total_weight IS NULL THEN NULL
                            WHEN di.quantity IS NULL OR di.quantity = 0 THEN di.total_weight
                            ELSE ROUND((di.total_weight / NULLIF(di.quantity,0)) * im.quantity, 3)
                        END) AS total_weight";
        $beneficiarySelect = "COALESCE(
                                MAX(rp.organization_name),
                                MAX(alrp.organization_name),
                                MAX(ru.name),
                                MAX(alru.name)
                             ) AS beneficiary_agency";

        $sql = "SELECT 
                    im.id AS movement_id,
                    DATE(im.created_at) AS date_out,
                    im.quantity AS quantity,
                    {$beneficiarySelect},
                    MAX(di.product_name) AS item_name,
                    MAX({$categoryExpr}) AS product_category,
                    MAX({$unitBase}) AS unit_label,
                    {$weightSelect},
                    MAX(up.name) AS entry_by,
                    MAX(COALESCE(alloc.recipient_id, im.recipient_id)) AS recipient_user_id,
                    MAX(ro.repack_id) AS repack_id
                FROM inventory_movements im
                LEFT JOIN inventory inv ON inv.inventory_id = im.inventory_id
                LEFT JOIN donation_items di ON di.donation_item_id = COALESCE(im.donation_item_id, inv.donation_item_id)
                LEFT JOIN categories c ON c.category_id = di.category_id
                LEFT JOIN units u ON u.unit_id = di.unit_id
                LEFT JOIN users up ON up.user_id = im.performed_by
                LEFT JOIN users ru ON ru.user_id = im.recipient_id
                LEFT JOIN recipient_profiles rp ON rp.user_id = ru.user_id
                LEFT JOIN allocation_items ai ON ai.inventory_id = im.inventory_id
                LEFT JOIN allocations alloc ON alloc.allocation_id = ai.allocation_id
                LEFT JOIN users alru ON alru.user_id = alloc.recipient_id
                LEFT JOIN recipient_profiles alrp ON alrp.user_id = alloc.recipient_id
                LEFT JOIN repack_outputs ro ON ro.inventory_id = im.inventory_id
                WHERE im.direction = 'out'
                  AND (im.mode IS NULL OR im.mode NOT IN ('repack', 'discarded'))
                  AND im.created_at BETWEEN ? AND ?
                GROUP BY im.id
                ORDER BY im.created_at ASC, im.id ASC";
        $rows = $db->query($sql, [$startDt, $endDt])->fetchAll();

        // Preload repack operation details for any movements tied to repack outputs
        $repackIds = [];
        foreach ($rows as $r) {
            if (!empty($r['repack_id'])) {
                $rid = (int)$r['repack_id'];
                if ($rid > 0) {
                    $repackIds[$rid] = true;
                }
            }
        }

        $repackDetails = [];
        if (!empty($repackIds)) {
            $repackService = new RepackService();
            foreach (array_keys($repackIds) as $rid) {
                try {
                    $op = $repackService->getOperation($rid);
                    if ($op) {
                        $repackDetails[$rid] = $op;
                    }
                } catch (Exception $e) {
                    // If repack details cannot be loaded, we'll fall back to default row for that movement
                }
            }
        }

        $data = [];
        foreach ($rows as $r) {
            $dateOut = $r['date_out'] ?? '';
            $beneficiary = $r['beneficiary_agency'] ?? '';
            $entryBy = $r['entry_by'] ?? '';
            $recipientUserId = isset($r['recipient_user_id']) ? (int)$r['recipient_user_id'] : null;
            $movementQty = (int)($r['quantity'] ?? 0);
            $movementWeight = isset($r['total_weight']) ? (float)$r['total_weight'] : null;
            $repackId = isset($r['repack_id']) ? (int)$r['repack_id'] : 0;

            // When this movement comes from a repack kit, expand to component rows using
            // the repack operation's inputs and proportional quantities.
            if ($repackId > 0 && isset($repackDetails[$repackId]) && $movementQty > 0) {
                $op = $repackDetails[$repackId];
                $totalOutput = (int)($op['total_output_quantity'] ?? 0);
                $inputs = isset($op['inputs']) && is_array($op['inputs']) ? $op['inputs'] : [];

                if ($totalOutput > 0 && !empty($inputs)) {
                    foreach ($inputs as $input) {
                        $used = isset($input['quantity_used']) ? (float)$input['quantity_used'] : 0.0;
                        if ($used <= 0) {
                            continue;
                        }
                        // Scale component usage proportionally to this movement's quantity
                        $componentQty = (int)round(($used * $movementQty) / $totalOutput);
                        if ($componentQty <= 0) {
                            continue;
                        }

                        $data[] = [
                            'DATE' => $dateOut,
                            'BENEFICIARY AGENCY' => $beneficiary,
                            'PRODUCT NAME' => $input['product_name_snapshot'] ?? '',
                            'PRODUCT CATEGORY' => $input['category_label'] ?? '',
                            'QUANTITY' => $componentQty,
                            'UNIT' => $input['unit_label'] ?? '',
                            // For repack component rows, omit total weight to avoid double counting.
                            'TOTAL WEIGHT (KG)' => null,
                            'ENTRY BY' => $entryBy,
                            'RECIPIENT_ID' => $recipientUserId,
                            // Movement metadata for accurate aggregation on the frontend
                            'MOVEMENT_ID' => (int)$r['movement_id'],
                            'MOVEMENT_WEIGHT' => $movementWeight,
                            'MOVEMENT_QTY' => $movementQty,
                        ];
                    }
                    // Skip default row for this movement since we've expanded it to components
                    continue;
                }
            }

            // Default behavior for non-repack movements or when repack details are unavailable
            $data[] = [
                'DATE' => $dateOut,
                'BENEFICIARY AGENCY' => $beneficiary,
                'PRODUCT NAME' => $r['item_name'] ?? '',
                'PRODUCT CATEGORY' => $r['product_category'] ?? '',
                'QUANTITY' => $movementQty,
                'UNIT' => $r['unit_label'] ?? '',
                'TOTAL WEIGHT (KG)' => $movementWeight,
                'ENTRY BY' => $entryBy,
                'RECIPIENT_ID' => $recipientUserId,
                // Movement metadata for accurate aggregation on the frontend
                'MOVEMENT_ID' => (int)$r['movement_id'],
                'MOVEMENT_WEIGHT' => $movementWeight,
                'MOVEMENT_QTY' => $movementQty,
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

    // POST /api/inventory/check-expired - Check for and move expired items
    if ($method === 'POST' && preg_match('#^/(check-expired|check-expired/)\z#', $sub)) {
        try {
            $result = inventory_move_expired_items(false);
            sendJson(['success' => true] + $result);
        } catch (Exception $e) {
            sendJson([
                'success' => false,
                'error' => 'Failed to process expired items: ' . $e->getMessage()
            ], 500);
        }
    }

    // GET /api/inventory/list
    if ($method === 'GET' && preg_match('#^/(list|list/)\z#', $sub)) {
        $db = Database::getInstance();
        
        // Check for and move expired items if this is the first request of the day
        static $expiredChecked = false;
        if (!$expiredChecked) {
            try {
                $lastCheck = $db->query("SELECT value FROM settings WHERE `key` = 'last_expiry_check' LIMIT 1")->fetch();
                $today = date('Y-m-d');
                
                if (!$lastCheck || $lastCheck['value'] !== $today) {
                    try {
                        inventory_move_expired_items(true);
                        $db->query("INSERT INTO settings (`key`, value) VALUES ('last_expiry_check', ?) 
                                   ON DUPLICATE KEY UPDATE value = ?", [$today, $today]);
                    } catch (Exception $e2) {
                        error_log('Auto expired inventory sweep failed: ' . $e2->getMessage());
                    }
                }
            } catch (Exception $e) {
                // Log error but don't break the request
                error_log("Failed to check for expired items: " . $e->getMessage());
            }
            
            $expiredChecked = true;
        }

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
        $whereSqlExpired = '';
        if ($whereSql !== '') {
            $whereSqlExpired = str_replace(
                ['inv.', 'di.', 'd.', 'c.'],
                ['inv_exp.', 'di_exp.', 'd_exp.', 'c_exp.'],
                $whereSql
            );
        }
        $paramsWithExpired = [];
        if (!empty($params)) {
            $paramsWithExpired = array_merge($params, $params);
        }

        $soonLeadDaysRaw = inv_get_setting('inventory_soon_expire_lead_days', null);
        $soonLeadDays = is_numeric($soonLeadDaysRaw) ? (int)$soonLeadDaysRaw : 7;
        if ($soonLeadDays < 0) { $soonLeadDays = 0; }
        $soonLeadDays = min($soonLeadDays, 365);

        $soonIntervalSql = "DATE_ADD(CURDATE(), INTERVAL {$soonLeadDays} DAY)";

        if ($groupMode === 'merge') {
            // Group by item_name + category to show combined status breakdown
            $countSql = "SELECT COUNT(*) AS n FROM (
                            SELECT DISTINCT CONCAT(di.product_name, '|', c.primary_name, '|', COALESCE(c.secondary_name, '')) AS key_val
                            FROM inventory inv
                            INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                            LEFT JOIN categories c ON c.category_id = di.category_id
                            INNER JOIN donations d ON d.donation_id = di.donation_id
                            $whereSql
                            UNION
                            SELECT DISTINCT CONCAT(di_exp.product_name, '|', c_exp.primary_name, '|', COALESCE(c_exp.secondary_name, '')) AS key_val
                            FROM expired_inventory ei
                            INNER JOIN inventory inv_exp ON inv_exp.inventory_id = ei.inventory_id
                            INNER JOIN donation_items di_exp ON di_exp.donation_item_id = inv_exp.donation_item_id
                            LEFT JOIN categories c_exp ON c_exp.category_id = di_exp.category_id
                            INNER JOIN donations d_exp ON d_exp.donation_id = di_exp.donation_id
                            $whereSqlExpired
                        ) AS grouped_counts";
            $countParams = !empty($params) ? $paramsWithExpired : [];
            $total = (int)($db->query($countSql, $countParams)->fetch()['n'] ?? 0);

            // First get all items grouped by product name and category
            $sql = "SELECT 
                        di.product_name AS item_name,
                        CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS category,
                        MIN(COALESCE(u.label, u.code)) AS unit,
                        GROUP_CONCAT(DISTINCT NULLIF(di.tags, '') ORDER BY di.tags SEPARATOR ',') AS tags_concat,
                        
                        -- Status counts
                        (SUM(CASE WHEN di.expiry_date < CURDATE() THEN inv.quantity ELSE 0 END) + COALESCE(expired.expired_qty, 0)) AS expired_qty,
                        SUM(CASE WHEN di.expiry_date >= CURDATE() AND di.expiry_date <= {$soonIntervalSql} THEN inv.quantity ELSE 0 END) AS soon_qty,
                        SUM(CASE WHEN di.expiry_date > {$soonIntervalSql} OR di.expiry_date IS NULL THEN inv.quantity ELSE 0 END) AS in_stock_qty,
                        
                        -- Total quantity
                        (SUM(inv.quantity) + COALESCE(expired.expired_qty, 0)) AS total_quantity,
                        
                        -- Earliest expiry for sorting
                        MIN(CASE WHEN di.expiry_date >= CURDATE() OR di.expiry_date IS NULL THEN di.expiry_date END) AS next_expiry,
                        
                        -- Additional info
                        COUNT(DISTINCT inv.inventory_id) AS total_lots,
                        MIN(inv.added_at) AS first_added_at,
                        MAX(inv.added_at) AS last_added_at
                        
                    FROM inventory inv
                    INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                    LEFT JOIN categories c ON c.category_id = di.category_id
                    LEFT JOIN units u ON u.unit_id = di.unit_id
                    INNER JOIN donations d ON d.donation_id = di.donation_id
                    LEFT JOIN (
                        SELECT 
                            di_exp.product_name AS exp_product_name,
                            c_exp.primary_name AS exp_primary_name,
                            c_exp.secondary_name AS exp_secondary_name,
                            SUM(ei.quantity) AS expired_qty
                        FROM expired_inventory ei
                        INNER JOIN inventory inv_exp ON inv_exp.inventory_id = ei.inventory_id
                        INNER JOIN donation_items di_exp ON di_exp.donation_item_id = inv_exp.donation_item_id
                        LEFT JOIN categories c_exp ON c_exp.category_id = di_exp.category_id
                        INNER JOIN donations d_exp ON d_exp.donation_id = di_exp.donation_id
                        $whereSqlExpired
                        GROUP BY di_exp.product_name, c_exp.primary_name, c_exp.secondary_name
                    ) expired ON expired.exp_product_name = di.product_name
                        AND COALESCE(expired.exp_primary_name, '') = COALESCE(c.primary_name, '')
                        AND COALESCE(expired.exp_secondary_name, '') = COALESCE(c.secondary_name, '')
                    $whereSql
                    GROUP BY di.product_name, c.primary_name, c.secondary_name
                    ORDER BY 
                        CASE 
                            WHEN MIN(CASE WHEN di.expiry_date >= CURDATE() AND di.expiry_date <= {$soonIntervalSql} THEN 1 ELSE 2 END) = 1 THEN 0
                            ELSE 1
                        END,
                        MIN(CASE WHEN di.expiry_date >= CURDATE() OR di.expiry_date IS NULL THEN di.expiry_date END),
                        di.product_name
                    LIMIT $limit OFFSET $offset";
                    
            $selectParams = !empty($params) ? $paramsWithExpired : [];
            $rows = $db->query($sql, $selectParams)->fetchAll();
            
            // Process rows to set derived status and format data
            foreach ($rows as &$r) {
                $status = [];
                $total = 0;
                
                if (($r['expired_qty'] ?? 0) > 0) {
                    $status[] = 'Expired';
                    $total += $r['expired_qty'];
                }
                if (($r['soon_qty'] ?? 0) > 0) {
                    $status[] = 'Expiring Soon';
                    $total += $r['soon_qty'];
                }
                if (($r['in_stock_qty'] ?? 0) > 0) {
                    $status[] = 'In Stock';
                    $total += $r['in_stock_qty'];
                }
                
                $r['status_breakdown'] = [
                    'expired' => (int)($r['expired_qty'] ?? 0),
                    'soon' => (int)($r['soon_qty'] ?? 0),
                    'in_stock' => (int)($r['in_stock_qty'] ?? 0)
                ];
                
                // Set primary status for display - prioritize In Stock, then Expiring Soon, then Expired
                if (($r['in_stock_qty'] ?? 0) > 0) {
                    $r['derived_status'] = 'In Stock';
                } elseif (($r['soon_qty'] ?? 0) > 0) {
                    $r['derived_status'] = 'Expiring Soon';
                } else {
                    $r['derived_status'] = 'Expired';
                }
                
                // Clean up
                unset($r['expired_qty'], $r['soon_qty'], $r['in_stock_qty']);
                
                // Format expiry date for display
                $r['earliest_expiry'] = $r['next_expiry'] ?: null;
                unset($r['next_expiry']);
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
                            if ($diff >= 0 && $diff <= $soonLeadDays) { $status = 'Expiring Soon'; }
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
                ],
                'config' => [
                    'soon_expire_lead_days' => $soonLeadDays
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
                    CASE 
                        WHEN im.direction = 'out' THEN 
                            CASE 
                                WHEN LOWER(COALESCE(im.mode, '')) = 'repack' THEN 'Repack Component'
                                ELSE COALESCE(
                                    NULLIF(rp.organization_name, ''),
                                    NULLIF(ur.name, ''),
                                    CASE LOWER(COALESCE(im.mode, ''))
                                        WHEN 'recipient' THEN 'Recipient'
                                        WHEN 'onsite' THEN 'On-site'
                                        WHEN 'discarded' THEN 'Discarded'
                                        ELSE COALESCE(im.mode, '')
                                    END
                                )
                            END
                        ELSE 
                            CASE LOWER(COALESCE(im.mode, ''))
                                WHEN 'purchased' THEN 'Purchased'
                                WHEN 'repack' THEN 'Repack Product'
                                ELSE 'Donated'
                            END
                    END AS mode,
                    im.recipient_id,
                    ur.name AS recipient_name,
                    im.performed_by,
                    COALESCE(up.name, '') AS performed_by_name,
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
        
        // Load TriggerLogic for inventory movement synchronization
        require_once __DIR__ . '/../../core/TriggerLogic.php';
        $recipientId = isset($data['recipient_id']) && $data['recipient_id'] !== '' ? (int)$data['recipient_id'] : null;
        $note = isset($data['note']) ? sanitize($data['note']) : null;

        if ($inventoryId <= 0) { sendJson(['success' => false, 'error' => 'inventory_id is required'], 400); }
        if ($quantity <= 0) { sendJson(['success' => false, 'error' => 'quantity must be positive'], 400); }
        if (!in_array($mode, ['recipient','onsite','discarded'], true)) { sendJson(['success' => false, 'error' => 'mode must be recipient, onsite, or discarded'], 400); }
        if ($mode === 'recipient' && empty($recipientId)) { sendJson(['success' => false, 'error' => 'recipient_id is required for recipient mode'], 400); }

        $inv = new Inventory();
        try {
            $result = $inv->moveOut($inventoryId, $quantity, (int)currentUserId(), $mode, $recipientId, $note);
            
            // Apply trigger logic for inventory movement synchronization
            if (isset($result['movement_id']) && $result['movement_id'] > 0) {
                $triggerLogic = new TriggerLogic();
                $triggerLogic->syncInventoryMovementDonationItem((int)$result['movement_id'], $inventoryId);
            }
            
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
