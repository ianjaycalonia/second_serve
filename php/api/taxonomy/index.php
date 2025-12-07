<?php
require_once __DIR__ . '/../../includes/config.php';

// Basic helpers mirroring other APIs
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$override = $_GET['_method'] ?? $_POST['_method'] ?? ($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '');
if ($override) {
    $ov = strtoupper(trim($override));
    if (in_array($ov, ['PUT','PATCH','DELETE'])) { $method = $ov; }
}
$uri = $_SERVER['REQUEST_URI'] ?? '';
$path = parse_url($uri, PHP_URL_PATH);
$pos = strpos($path, '/api/taxonomy');
$sub = $pos !== false ? substr($path, $pos + strlen('/api/taxonomy')) : '/';
$sub = $sub === '' ? '/' : $sub;
if (strpos($sub, '/index.php') === 0) { $sub = substr($sub, strlen('/index.php')) ?: '/'; }

function getJsonInputSafe(){
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function ensureMasterItemExclusionTable($db){
    static $ensured = false;
    if ($ensured) {
        return;
    }
    // Keep key length < 767 bytes for utf8mb4 on older MySQL versions
    $db->query('CREATE TABLE IF NOT EXISTS master_item_exclusions (
        product_name VARCHAR(191) NOT NULL PRIMARY KEY
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci');
    $ensured = true;
}

function taxonomyHasCategoryCodeColumn(): bool {
    static $has = null;
    if ($has !== null) {
        return $has;
    }
    try {
        $db = Database::getInstance();
        $db->query('SELECT code FROM categories LIMIT 1');
        $has = true;
    } catch (Throwable $e) {
        $has = false;
    }
    return $has;
}

function generateCategoryCode(Database $db, string $primary, ?string $secondary = null): string {
    $raw = trim($primary . ' ' . ($secondary ?? ''));
    $raw = strtoupper(preg_replace('/[^A-Z0-9]+/', '', $raw));
    if ($raw === '') {
        $raw = 'CAT';
    }
    $base = substr($raw, 0, 8) ?: 'CAT';
    $candidate = $base;
    $suffix = 1;

    while (true) {
        $exists = $db->query('SELECT 1 FROM categories WHERE LOWER(code)=? LIMIT 1', [strtolower($candidate)])->fetch();
        if (!$exists) {
            return $candidate;
        }
        $suffixStr = str_pad((string)$suffix, 2, '0', STR_PAD_LEFT);
        $maxBaseLen = max(1, 32 - strlen($suffixStr));
        $candidate = substr($base, 0, $maxBaseLen) . $suffixStr;
        $suffix++;
        if ($suffix > 9999) {
            $candidate = substr($base, 0, 24) . strtoupper(bin2hex(random_bytes(4)));
            $suffix = 1;
        }
    }
}

try {

    // GET /taxonomy/categories
    if ($method === 'GET' && preg_match('#^/(categories|categories/)\z#', $sub)) {
        $db = Database::getInstance();
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        $active = isset($_GET['active']) ? trim((string)$_GET['active']) : '';
        $params = [];
        $where = 'WHERE 1=1';
        if ($q !== '') { $where .= ' AND (LOWER(primary_name) LIKE ? OR LOWER(COALESCE(secondary_name, "")) LIKE ?)'; $params[] = '%'.strtolower($q).'%'; $params[] = '%'.strtolower($q).'%'; }
        if ($active !== '') { $where .= ' AND is_active = ?'; $params[] = ($active==='1'||strtolower($active)==='true') ? 1 : 0; }
        $hasCode = taxonomyHasCategoryCodeColumn();
        $codeSelect = $hasCode ? 'code' : 'NULL AS code';
        $rows = $db->query("SELECT category_id, $codeSelect, primary_name, secondary_name, is_active, created_at FROM categories $where ORDER BY primary_name, secondary_name", $params)->fetchAll();
        if ($hasCode) {
            foreach ($rows as &$row) {
                if (empty($row['code'])) {
                    $generated = generateCategoryCode($db, (string)$row['primary_name'], $row['secondary_name'] !== null ? (string)$row['secondary_name'] : null);
                    $db->query('UPDATE categories SET code=? WHERE category_id=?', [$generated, (int)$row['category_id']]);
                    $row['code'] = $generated;
                }
            }
            unset($row);
        }
        sendJson(['success'=>true,'items'=>$rows]);
    }

    // POST /taxonomy/categories
    if ($method === 'POST' && preg_match('#^/(categories|categories/)\z#', $sub)) {
        requireRole(['admin']);
        $db = Database::getInstance();
        $in = $_POST ?: getJsonInputSafe();
        $hasCode = taxonomyHasCategoryCodeColumn();
        $codeRaw = trim((string)($in['code'] ?? ''));
        $code = $hasCode && $codeRaw !== '' ? strtoupper($codeRaw) : null;
        $primary = trim((string)($in['primary_name'] ?? ''));
        $secondary = trim((string)($in['secondary_name'] ?? ''));
        if ($primary === '') { sendJson(['success'=>false,'error'=>'primary_name is required'],400); }
        if ($hasCode) {
            if ($code !== null) {
                $codeExists = $db->query('SELECT 1 FROM categories WHERE LOWER(code)=?', [strtolower($code)])->fetch();
                if ($codeExists) { sendJson(['success'=>false,'error'=>'Category code already exists'],409); }
            } else {
                $code = generateCategoryCode($db, $primary, $secondary !== '' ? $secondary : null);
            }
        }
        // uniqueness (case-insensitive) on (primary, secondary)
        $exists = $db->query('SELECT 1 FROM categories WHERE LOWER(primary_name)=? AND LOWER(COALESCE(secondary_name, ""))=?', [strtolower($primary), strtolower($secondary)])->fetch();
        if ($exists) { sendJson(['success'=>false,'error'=>'Category already exists'],409); }
        if ($hasCode) {
            $db->query('INSERT INTO categories (code, primary_name, secondary_name, is_active, created_at) VALUES (?,?,?,1,NOW())', [$code, $primary, ($secondary!==''?$secondary:null)]);
        } else {
            $db->query('INSERT INTO categories (primary_name, secondary_name, is_active, created_at) VALUES (?,?,1,NOW())', [$primary, ($secondary!==''?$secondary:null)]);
        }
        sendJson(['success'=>true]);
    }

    // PUT /taxonomy/categories/{id}
    if ($method === 'PUT' && preg_match('#^/categories/(\d+)(/)?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $db = Database::getInstance();
        $in = getJsonInputSafe();

        // Enforce uniqueness of (primary_name, secondary_name) on update
        $hasCode = taxonomyHasCategoryCodeColumn();
        $selectCols = $hasCode ? 'code, primary_name, secondary_name' : 'NULL AS code, primary_name, secondary_name';
        $current = $db->query(
            "SELECT $selectCols FROM categories WHERE category_id = ? LIMIT 1",
            [$id]
        )->fetch();
        if (!$current) {
            sendJson(['success'=>false,'error'=>'Category not found'],404);
        }
        $currentCode = $current['code'] ?? null;
        $codeProvided = array_key_exists('code', $in);
        $newCodeRaw = $codeProvided
            ? trim((string)$in['code'])
            : (string)($currentCode ?? '');
        $newCode = $hasCode && $newCodeRaw !== '' ? strtoupper($newCodeRaw) : null;
        $newPrimary = array_key_exists('primary_name', $in)
            ? trim((string)$in['primary_name'])
            : (string)($current['primary_name'] ?? '');
        $newSecondary = array_key_exists('secondary_name', $in)
            ? trim((string)$in['secondary_name'])
            : (string)($current['secondary_name'] ?? '');
        if ($newPrimary === '') {
            sendJson(['success'=>false,'error'=>'primary_name is required'],400);
        }
        if ($hasCode) {
            if ($newCode === null && $currentCode === null) {
                $newCode = generateCategoryCode($db, $newPrimary, $newSecondary !== '' ? $newSecondary : null);
                $codeProvided = true;
            }
            if ($newCode !== null && strtolower((string)$newCode) !== strtolower((string)$currentCode)) {
                $dupCode = $db->query(
                    'SELECT 1 FROM categories WHERE category_id <> ? AND LOWER(code)=? LIMIT 1',
                    [$id, strtolower($newCode)]
                )->fetch();
                if ($dupCode) {
                    sendJson(['success'=>false,'error'=>'Category code already exists'],409);
                }
            }
        }
        $dup = $db->query(
            'SELECT 1 FROM categories WHERE category_id <> ? AND LOWER(primary_name)=? AND LOWER(COALESCE(secondary_name, ""))=? LIMIT 1',
            [$id, strtolower($newPrimary), strtolower($newSecondary)]
        )->fetch();
        if ($dup) {
            sendJson(['success'=>false,'error'=>'Category already exists'],409);
        }

        $fields = [];
        $params = [];
        if ($hasCode && ($codeProvided || ($currentCode === null && $newCode !== null))) { $fields[]='code=?'; $params[] = $newCode; }
        if (array_key_exists('primary_name',$in)) { $fields[]='primary_name=?'; $params[] = $newPrimary; }
        if (array_key_exists('secondary_name',$in)) { $fields[]='secondary_name=?'; $params[] = ($newSecondary!==''?$newSecondary:null); }
        if (array_key_exists('is_active',$in)) { $fields[]='is_active=?'; $params[] = $in['is_active']?1:0; }
        if (!$fields) { sendJson(['success'=>false,'error'=>'No fields'],400); }
        $params[] = $id;
        $db->query('UPDATE categories SET '.implode(',', $fields).' WHERE category_id=?', $params);
        sendJson(['success'=>true]);
    }

    // DELETE /taxonomy/categories/{id} -> soft delete
    if ($method === 'DELETE' && preg_match('#^/categories/(\d+)(/)?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $db = Database::getInstance();
        $db->query('UPDATE categories SET is_active=0 WHERE category_id=?', [$id]);
        sendJson(['success'=>true]);
    }

    // GET /taxonomy/units
    if ($method === 'GET' && preg_match('#^/(units|units/)\z#', $sub)) {
        $db = Database::getInstance();
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        $active = isset($_GET['active']) ? trim((string)$_GET['active']) : '';
        $params = [];
        $where = 'WHERE 1=1';
        if ($q !== '') { $where .= ' AND (LOWER(code) LIKE ? OR LOWER(COALESCE(label, "")) LIKE ?)'; $params[] = '%'.strtolower($q).'%'; $params[] = '%'.strtolower($q).'%'; }
        if ($active !== '') { $where .= ' AND is_active = ?'; $params[] = ($active==='1'||strtolower($active)==='true') ? 1 : 0; }
        $rows = $db->query("SELECT unit_id, code, label, is_active, created_at FROM units $where ORDER BY code", $params)->fetchAll();
        sendJson(['success'=>true,'items'=>$rows]);
    }

    // POST /taxonomy/units
    if ($method === 'POST' && preg_match('#^/(units|units/)\z#', $sub)) {
        requireRole(['admin']);
        $db = Database::getInstance();
        $in = $_POST ?: getJsonInputSafe();
        $code = trim((string)($in['code'] ?? ''));
        $label = trim((string)($in['label'] ?? ''));
        if ($code === '') { sendJson(['success'=>false,'error'=>'code is required'],400); }
        $exists = $db->query('SELECT 1 FROM units WHERE LOWER(code)=?', [strtolower($code)])->fetch();
        if ($exists) { sendJson(['success'=>false,'error'=>'Unit already exists'],409); }
        $db->query('INSERT INTO units (code, label, is_active, created_at) VALUES (?,?,1,NOW())', [$code, ($label!==''?$label:null)]);
        sendJson(['success'=>true]);
    }

    // PUT /taxonomy/units/{id}
    if ($method === 'PUT' && preg_match('#^/units/(\d+)(/)?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $db = Database::getInstance();
        $in = getJsonInputSafe();

        // Enforce uniqueness of unit code on update
        $current = $db->query('SELECT code FROM units WHERE unit_id = ? LIMIT 1', [$id])->fetch();
        if (!$current) {
            sendJson(['success'=>false,'error'=>'Unit not found'],404);
        }
        $newCode = array_key_exists('code', $in)
            ? trim((string)$in['code'])
            : (string)($current['code'] ?? '');
        if ($newCode === '') {
            sendJson(['success'=>false,'error'=>'code is required'],400);
        }
        $dup = $db->query(
            'SELECT 1 FROM units WHERE unit_id <> ? AND LOWER(code)=? LIMIT 1',
            [$id, strtolower($newCode)]
        )->fetch();
        if ($dup) {
            sendJson(['success'=>false,'error'=>'Unit code already exists'],409);
        }

        $fields = [];
        $params = [];
        if (array_key_exists('code',$in)) { $fields[]='code=?'; $params[] = $newCode; }
        if (array_key_exists('label',$in)) { $fields[]='label=?'; $params[] = ($in['label']!==''?trim((string)$in['label']):null); }
        if (array_key_exists('is_active',$in)) { $fields[]='is_active=?'; $params[] = $in['is_active']?1:0; }
        if (!$fields) { sendJson(['success'=>false,'error'=>'No fields'],400); }
        $params[] = $id;
        $db->query('UPDATE units SET '.implode(',', $fields).' WHERE unit_id=?', $params);
        sendJson(['success'=>true]);
    }

    // DELETE /taxonomy/units/{id} -> soft delete
    if ($method === 'DELETE' && preg_match('#^/units/(\d+)(/)?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $db = Database::getInstance();
        $db->query('UPDATE units SET is_active=0 WHERE unit_id=?', [$id]);
        sendJson(['success'=>true]);
    }

    // GET /taxonomy/master-items
    if ($method === 'GET' && preg_match('#^/(master-items|master-items/)\\z#', $sub)) {
        requireRole(['admin','donor']);
        $db = Database::getInstance();
        ensureMasterItemExclusionTable($db);
        $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
        $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
        if ($page < 1) { $page = 1; }
        $pageSizeRaw = isset($_GET['page_size']) ? (int)$_GET['page_size'] : 20;
        $allowedPageSizes = [20, 50, 100];
        $pageSize = in_array($pageSizeRaw, $allowedPageSizes, true) ? $pageSizeRaw : 20;
        $offset = ($page - 1) * $pageSize;

        $where = 'WHERE d.deleted_at IS NULL AND mie.product_name IS NULL';
        $params = [];
        if ($q !== '') {
            $like = '%' . strtolower($q) . '%';
            $where .= ' AND (LOWER(di.product_name) LIKE ? OR LOWER(COALESCE(cat.primary_name, "")) LIKE ? OR LOWER(COALESCE(cat.secondary_name, "")) LIKE ?)';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $totalSql = "SELECT COUNT(DISTINCT di.product_name) AS total
                FROM donation_items di
                INNER JOIN donations d ON d.donation_id = di.donation_id
                LEFT JOIN categories cat ON cat.category_id = di.category_id
                LEFT JOIN units u ON u.unit_id = di.unit_id
                LEFT JOIN master_item_exclusions mie ON mie.product_name = di.product_name
                $where";
        $totalRow = $db->query($totalSql, $params)->fetch();
        $total = (int)($totalRow['total'] ?? 0);

        $sql = "SELECT 
                    di.product_name,
                    MAX(di.category_id) AS category_id,
                    MAX(di.unit_id) AS unit_id,
                    MIN(cat.primary_name) AS primary_category,
                    MIN(cat.secondary_name) AS secondary_category,
                    MIN(u.code) AS unit_code,
                    MIN(u.label) AS unit_label,
                    SUM(di.quantity) AS quantity_total,
                    SUM(CASE WHEN di.total_weight IS NOT NULL THEN di.total_weight ELSE 0 END) AS total_weight_sum,
                    SUM(CASE WHEN di.total_weight IS NOT NULL THEN 1 ELSE 0 END) AS weight_present_count,
                    MIN(di.created_at) AS first_recorded,
                    MAX(di.created_at) AS last_restocked,
                    SUM(CASE WHEN di.category_id IS NULL THEN 1 ELSE 0 END) AS missing_category_count,
                    SUM(CASE WHEN di.unit_id IS NULL THEN 1 ELSE 0 END) AS missing_unit_count,
                    SUM(CASE WHEN di.total_weight IS NULL THEN 1 ELSE 0 END) AS missing_weight_count,
                    MAX(di.donation_item_id) AS sample_donation_item_id,
                    (SELECT di2.total_cost
                       FROM donation_items di2
                       INNER JOIN donations d2 ON d2.donation_id = di2.donation_id
                      WHERE di2.product_name = di.product_name
                        AND di2.total_cost IS NOT NULL AND di2.total_cost > 0
                        AND d2.deleted_at IS NULL
                      ORDER BY di2.donation_item_id DESC
                      LIMIT 1) AS last_unit_cost
                FROM donation_items di
                INNER JOIN donations d ON d.donation_id = di.donation_id
                LEFT JOIN categories cat ON cat.category_id = di.category_id
                LEFT JOIN units u ON u.unit_id = di.unit_id
                LEFT JOIN master_item_exclusions mie ON mie.product_name = di.product_name
                $where
                GROUP BY di.product_name
                ORDER BY (
                    SUM(CASE WHEN di.category_id IS NULL THEN 1 ELSE 0 END) +
                    SUM(CASE WHEN di.unit_id IS NULL THEN 1 ELSE 0 END) +
                    SUM(CASE WHEN di.total_weight IS NULL THEN 1 ELSE 0 END)
                ) DESC,
                di.product_name ASC
                LIMIT %d OFFSET %d";

        $sql = sprintf($sql, $pageSize, $offset);
        $rows = $db->query($sql, $params)->fetchAll();

        $items = array_map(function ($row) {
            $unitCost = isset($row['last_unit_cost']) && $row['last_unit_cost'] !== null
                ? (float)$row['last_unit_cost']
                : null;
            $weightCount = (int)($row['weight_present_count'] ?? 0);
            $totalWeightKg = $weightCount > 0 && $row['total_weight_sum'] !== null
                ? (float)$row['total_weight_sum']
                : null;
            $missingCategory = (int)($row['missing_category_count'] ?? 0) > 0;
            $missingUnit = (int)($row['missing_unit_count'] ?? 0) > 0;
            $missingWeight = (int)($row['missing_weight_count'] ?? 0) > 0;

            $missing = [];
            if ($missingCategory) { $missing[] = 'Category'; }
            if ($missingUnit) { $missing[] = 'Unit'; }
            if ($missingWeight) { $missing[] = 'Weight'; }

            return [
                'product_name' => $row['product_name'],
                'category_id' => $row['category_id'] !== null ? (int)$row['category_id'] : null,
                'unit_id' => $row['unit_id'] !== null ? (int)$row['unit_id'] : null,
                'primary_category' => $row['primary_category'] ?? null,
                'secondary_category' => $row['secondary_category'] ?? null,
                'unit_code' => $row['unit_code'] ?? null,
                'unit_label' => $row['unit_label'] ?? null,
                'unit_cost' => $unitCost,
                'total_weight_kg' => $totalWeightKg,
                'first_recorded' => $row['first_recorded'],
                'last_restocked' => $row['last_restocked'],
                'missing_category' => $missingCategory,
                'missing_unit' => $missingUnit,
                'missing_weight' => $missingWeight,
                'missing_any' => $missingCategory || $missingUnit || $missingWeight,
                'missing_labels' => $missing,
                'sample_donation_item_id' => $row['sample_donation_item_id'] !== null ? (int)$row['sample_donation_item_id'] : null,
            ];
        }, $rows);

        sendJson([
            'success' => true,
            'items' => $items,
            'count' => count($items),
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
        ]);
    }

    if ($method === 'DELETE' && preg_match('#^/(master-items|master-items/)\z#', $sub)) {
        requireRole(['admin']);
        $db = Database::getInstance();
        ensureMasterItemExclusionTable($db);
        $input = getJsonInputSafe();
        $productName = isset($input['product_name']) ? trim((string)$input['product_name']) : '';
        if ($productName === '' && isset($_GET['product_name'])) {
            $productName = trim((string)$_GET['product_name']);
        }
        if ($productName === '') {
            sendJson(['success'=>false,'error'=>'product_name required'], 400);
        }
        $db->query('REPLACE INTO master_item_exclusions (product_name) VALUES (?)', [$productName]);
        sendJson(['success'=>true]);
    }

    // GET /taxonomy/missing-metadata
    if ($method === 'GET' && preg_match('#^/(missing-metadata|missing-metadata/)\z#', $sub)) {
        requireRole(['admin']);
        $db = Database::getInstance();
        $limit = isset($_GET['limit']) ? max(1, min(500, (int)$_GET['limit'])) : 200;
        $rows = $db->query(
            "SELECT di.donation_item_id,
                    di.product_name,
                    di.quantity,
                    di.total_weight,
                    di.unit_id,
                    di.category_id,
                    di.expiry_date,
                    d.created_at AS submitted_at,
                    d.donation_id,
                    COALESCE(dp.organization_name, u.name, d.donor_name) AS donor_name,
                    CASE WHEN di.category_id IS NULL THEN 1 ELSE 0 END AS missing_category,
                    CASE WHEN di.unit_id IS NULL THEN 1 ELSE 0 END AS missing_unit,
                    CASE WHEN di.total_weight IS NULL THEN 1 ELSE 0 END AS missing_weight
             FROM donation_items di
             INNER JOIN donations d ON d.donation_id = di.donation_id
             LEFT JOIN users u ON u.user_id = d.donor_id
             LEFT JOIN donor_profiles dp ON dp.user_id = d.donor_id
             WHERE (di.category_id IS NULL OR di.unit_id IS NULL OR di.total_weight IS NULL)
               AND d.deleted_at IS NULL
             ORDER BY d.created_at DESC
             LIMIT $limit"
        )->fetchAll();

        $items = array_map(function($row){
            $missing = [];
            if (!empty($row['missing_category'])) { $missing[] = 'Category'; }
            if (!empty($row['missing_unit'])) { $missing[] = 'Unit'; }
            if (!empty($row['missing_weight'])) { $missing[] = 'Weight'; }
            return [
                'donation_item_id' => (int)$row['donation_item_id'],
                'donation_id' => (int)$row['donation_id'],
                'product_name' => $row['product_name'],
                'quantity' => (int)$row['quantity'],
                'expiry_date' => $row['expiry_date'],
                'submitted_at' => $row['submitted_at'],
                'donor_name' => $row['donor_name'],
                'missing' => $missing,
            ];
        }, $rows);

        sendJson(['success'=>true, 'items'=>$items, 'count'=>count($items)]);
    }

    if ($method === 'GET' && preg_match('#^/missing-metadata/(\d+)(/)?\z#', $sub, $m)) {
        requireRole(['admin']);
        $donationItemId = (int)$m[1];
        $db = Database::getInstance();
        $row = $db->query(
            'SELECT di.donation_item_id,
                    di.donation_id,
                    di.product_name,
                    di.quantity,
                    di.total_weight,
                    di.total_cost,
                    di.category_id,
                    di.unit_id,
                    di.expiry_date,
                    di.created_at,
                    cat.primary_name,
                    cat.secondary_name,
                    u.code AS unit_code,
                    u.label AS unit_label
             FROM donation_items di
             LEFT JOIN categories cat ON cat.category_id = di.category_id
             LEFT JOIN units u ON u.unit_id = di.unit_id
             WHERE di.donation_item_id = ?
             LIMIT 1',
            [$donationItemId]
        )->fetch();
        if (!$row) {
            sendJson(['success'=>false,'error'=>'Item not found'], 404);
        }
        $unitCost = isset($row['total_cost']) && $row['total_cost'] !== null ? (float)$row['total_cost'] : null;
        if ($unitCost === null && isset($row['product_name'])) {
            $fallbackCost = $db->query(
                'SELECT di2.total_cost
                 FROM donation_items di2
                 INNER JOIN donations d2 ON d2.donation_id = di2.donation_id
                 WHERE di2.product_name = ?
                   AND di2.total_cost IS NOT NULL
                   AND di2.total_cost > 0
                   AND d2.deleted_at IS NULL
                   AND d2.status IN (\'Picked Up\', \'Completed\')
                 ORDER BY di2.donation_item_id DESC
                 LIMIT 1',
                [$row['product_name']]
            )->fetch();
            if ($fallbackCost && $fallbackCost['total_cost'] !== null) {
                $unitCost = (float)$fallbackCost['total_cost'];
            }
        }

        $missing = [];
        if ($row['category_id'] === null) { $missing[] = 'Category'; }
        if ($row['unit_id'] === null) { $missing[] = 'Unit'; }
        if ($row['total_weight'] === null) { $missing[] = 'Weight'; }
        sendJson([
            'success' => true,
            'item' => [
                'donation_item_id' => (int)$row['donation_item_id'],
                'donation_id' => (int)$row['donation_id'],
                'product_name' => $row['product_name'],
                'quantity' => (int)$row['quantity'],
                'total_weight' => $row['total_weight'],
                'unit_cost' => $unitCost,
                'total_cost' => $row['total_cost'] !== null ? (float)$row['total_cost'] : null,
                'category_id' => $row['category_id'] !== null ? (int)$row['category_id'] : null,
                'unit_id' => $row['unit_id'] !== null ? (int)$row['unit_id'] : null,
                'category_label' => $row['primary_name'] ? ($row['secondary_name'] ? $row['primary_name'].' - '.$row['secondary_name'] : $row['primary_name']) : null,
                'unit_label' => $row['unit_label'] ?? $row['unit_code'],
                'missing' => $missing,
            ],
        ]);
    }

    // PUT /taxonomy/missing-metadata/{donation_item_id}
    if ($method === 'PUT' && preg_match('#^/missing-metadata/(\d+)(/)?\z#', $sub, $m)) {
        requireRole(['admin']);
        $donationItemId = (int)$m[1];
        $db = Database::getInstance();
        $input = getJsonInputSafe();

        $categoryId = isset($input['category_id']) ? (int)$input['category_id'] : null;
        $categoryLabel = isset($input['category_label']) ? trim((string)$input['category_label']) : '';
        $unitId = isset($input['unit_id']) ? (int)$input['unit_id'] : null;
        $unitLabel = isset($input['unit_label']) ? trim((string)$input['unit_label']) : '';
        $weight = isset($input['weight']) && $input['weight'] !== '' ? (float)$input['weight'] : null;

        $newProductName = isset($input['new_product_name']) ? trim((string)$input['new_product_name']) : '';
        $unitCost = isset($input['unit_cost']) && $input['unit_cost'] !== '' ? (float)$input['unit_cost'] : null;

        if ($categoryId === null && $categoryLabel === '' && $unitId === null && $unitLabel === '' && $weight === null && $newProductName === '' && $unitCost === null) {
            sendJson(['success'=>false,'error'=>'No metadata supplied'], 400);
        }

        $db->beginTransaction();
        try {
            // Get the product_name for this item
            $itemRow = $db->query('SELECT product_name FROM donation_items WHERE donation_item_id = ?', [$donationItemId])->fetch();
            if (!$itemRow) {
                $db->rollBack();
                sendJson(['success'=>false,'error'=>'Item not found'], 404);
            }
            $productName = $itemRow['product_name'];

            // Optional rename of product name across items for this name
            if ($newProductName !== '' && strcasecmp($newProductName, (string)$productName) !== 0) {
                $db->query('UPDATE donation_items SET product_name = ? WHERE product_name = ?', [$newProductName, $productName]);
                $productName = $newProductName;
            }

            // Upsert category if needed
            if ($categoryId === null && $categoryLabel !== '') {
                $parts = array_map('trim', preg_split('/\\s*-\\s*/', $categoryLabel));
                $primary = $parts[0] ?? $categoryLabel;
                $secondary = $parts[1] ?? null;
                $existing = $db->query(
                    'SELECT category_id FROM categories WHERE LOWER(primary_name) = ? AND LOWER(COALESCE(secondary_name, "")) = ? LIMIT 1',
                    [strtolower($primary), strtolower($secondary ?? '')]
                )->fetch();
                if ($existing) {
                    $categoryId = (int)$existing['category_id'];
                } else {
                    $db->query(
                        'INSERT INTO categories (primary_name, secondary_name, is_active, created_at) VALUES (?,?,1,NOW())',
                        [$primary, $secondary]
                    );
                    $categoryId = (int)$db->lastInsertId();
                }
            }

            // Upsert unit if needed
            if ($unitId === null && $unitLabel !== '') {
                $code = strtoupper(preg_replace('/[^A-Z0-9]+/', '', substr($unitLabel, 0, 6)) ?: 'UNIT');
                $existing = $db->query('SELECT unit_id, code FROM units WHERE LOWER(code) = ? LIMIT 1', [strtolower($unitLabel)])->fetch();
                if ($existing) {
                    $unitId = (int)$existing['unit_id'];
                } else {
                    // ensure unique code by suffixing if necessary
                    $baseCode = $code;
                    $suffix = 1;
                    while (true) {
                        $row = $db->query('SELECT unit_id FROM units WHERE code = ? LIMIT 1', [$code])->fetch();
                        if (!$row) break;
                        $code = $baseCode . $suffix;
                        $suffix++;
                    }
                    $db->query(
                        'INSERT INTO units (code, label, is_active, created_at) VALUES (?,?,1,NOW())',
                        [$code, $unitLabel]
                    );
                    $unitId = (int)$db->lastInsertId();
                }
            }

            // Update all donation_items with the same product_name that are missing metadata
            $fields = [];
            $params = [];
            if ($categoryId !== null) {
                $fields[] = 'category_id = ?';
                $params[] = $categoryId;
            }
            if ($unitId !== null) {
                $fields[] = 'unit_id = ?';
                $params[] = $unitId;
            }
            if ($weight !== null || array_key_exists('weight', $input)) {
                $fields[] = 'total_weight = ?';
                $params[] = ($weight !== null ? $weight : null);
            }
            if (!$fields) {
                // It's okay if only name or unit_cost update was requested
            } else {
                $params[] = $productName;
                $db->query('UPDATE donation_items SET ' . implode(',', $fields) . ' WHERE product_name = ?', $params);
            }

            // Apply unit_cost to items without cost (store per-unit cost as-is)
            if ($unitCost !== null && $unitCost >= 0) {
                // Always update the edited donation item with the new cost
                $db->query('UPDATE donation_items SET total_cost = ? WHERE donation_item_id = ?', [$unitCost, $donationItemId]);
                // Propagate to items without an explicit cost for consistency
                $db->query('UPDATE donation_items SET total_cost = ? WHERE product_name = ? AND (total_cost IS NULL OR total_cost = 0)', [$unitCost, $productName]);
            }
            
            // Trigger logic: Sync product category for all products with this name
            if ($categoryId !== null) {
                require_once __DIR__ . '/../../core/TriggerLogic.php';
                $triggerLogic = new TriggerLogic();
                
                // Find or create product entry
                $product = $db->query('SELECT product_id FROM products WHERE product_name = ?', [$productName])->fetch();
                if ($product) {
                    // Update existing product
                    $db->query('UPDATE products SET category_id = ? WHERE product_id = ?', [$categoryId, $product['product_id']]);
                    $triggerLogic->syncProductCategory((int)$product['product_id'], $categoryId);
                } else {
                    // Create new product
                    $db->query('INSERT INTO products (product_name, category_id) VALUES (?, ?)', [$productName, $categoryId]);
                    $productId = (int)$db->lastInsertId();
                    $triggerLogic->syncProductCategory($productId, $categoryId);
                }
            }

            $db->commit();
            sendJson(['success'=>true, 'category_id'=>$categoryId, 'unit_id'=>$unitId, 'weight'=>$weight, 'product_name'=>$productName, 'unit_cost'=>$unitCost]);
        } catch (Exception $e) {
            $db->rollBack();
            sendJson(['success'=>false,'error'=>$e->getMessage()], 500);
        }
    }

    sendJson(['success'=>false,'error'=>'Not found'],404);
} catch (Exception $e) {
    sendJson(['success'=>false,'error'=>$e->getMessage()], 400);
}
