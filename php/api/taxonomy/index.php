<?php
require_once __DIR__ . '/../../includes/config.php';

// Basic helpers mirroring other APIs
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}
setCorsHeaders();
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
        $rows = $db->query("SELECT category_id, primary_name, secondary_name, is_active, created_at FROM categories $where ORDER BY primary_name, secondary_name", $params)->fetchAll();
        sendJson(['success'=>true,'items'=>$rows]);
    }

    // POST /taxonomy/categories
    if ($method === 'POST' && preg_match('#^/(categories|categories/)\z#', $sub)) {
        requireRole(['admin']);
        $db = Database::getInstance();
        $in = $_POST ?: getJsonInputSafe();
        $primary = trim((string)($in['primary_name'] ?? ''));
        $secondary = trim((string)($in['secondary_name'] ?? ''));
        if ($primary === '') { sendJson(['success'=>false,'error'=>'primary_name is required'],400); }
        // uniqueness (case-insensitive) on (primary, secondary)
        $exists = $db->query('SELECT 1 FROM categories WHERE LOWER(primary_name)=? AND LOWER(COALESCE(secondary_name, ""))=?', [strtolower($primary), strtolower($secondary)])->fetch();
        if ($exists) { sendJson(['success'=>false,'error'=>'Category already exists'],409); }
        $db->query('INSERT INTO categories (primary_name, secondary_name, is_active, created_at) VALUES (?,?,1,NOW())', [$primary, ($secondary!==''?$secondary:null)]);
        sendJson(['success'=>true]);
    }

    // PUT /taxonomy/categories/{id}
    if ($method === 'PUT' && preg_match('#^/categories/(\d+)(/)?\z#', $sub, $m)) {
        requireRole(['admin']);
        $id = (int)$m[1];
        $db = Database::getInstance();
        $in = getJsonInputSafe();
        $fields = [];
        $params = [];
        if (array_key_exists('primary_name',$in)) { $fields[]='primary_name=?'; $params[] = trim((string)$in['primary_name']); }
        if (array_key_exists('secondary_name',$in)) { $fields[]='secondary_name=?'; $params[] = ($in['secondary_name']!==''?trim((string)$in['secondary_name']):null); }
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
        $fields = [];
        $params = [];
        if (array_key_exists('code',$in)) { $fields[]='code=?'; $params[] = trim((string)$in['code']); }
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

    // PUT /taxonomy/missing-metadata/{donation_item_id}
    if ($method === 'PUT' && preg_match('#^/missing-metadata/(\\d+)(/)?\\z#', $sub, $m)) {
        requireRole(['admin']);
        $donationItemId = (int)$m[1];
        $db = Database::getInstance();
        $input = getJsonInputSafe();

        $categoryId = isset($input['category_id']) ? (int)$input['category_id'] : null;
        $categoryLabel = isset($input['category_label']) ? trim((string)$input['category_label']) : '';
        $unitId = isset($input['unit_id']) ? (int)$input['unit_id'] : null;
        $unitLabel = isset($input['unit_label']) ? trim((string)$input['unit_label']) : '';
        $weight = isset($input['weight']) && $input['weight'] !== '' ? (float)$input['weight'] : null;

        if ($categoryId === null && $categoryLabel === '' && $unitId === null && $unitLabel === '' && $weight === null) {
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
                $db->rollBack();
                sendJson(['success'=>false,'error'=>'Nothing to update'], 400);
            }
            $params[] = $productName;
            $db->query('UPDATE donation_items SET ' . implode(',', $fields) . ' WHERE product_name = ? AND (category_id IS NULL OR unit_id IS NULL OR total_weight IS NULL)', $params);
            
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
            sendJson(['success'=>true, 'category_id'=>$categoryId, 'unit_id'=>$unitId, 'weight'=>$weight]);
        } catch (Exception $e) {
            $db->rollBack();
            sendJson(['success'=>false,'error'=>$e->getMessage()], 500);
        }
    }

    sendJson(['success'=>false,'error'=>'Not found'],404);
} catch (Exception $e) {
    sendJson(['success'=>false,'error'=>$e->getMessage()], 400);
}
