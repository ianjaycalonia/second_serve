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

    sendJson(['success'=>false,'error'=>'Not found'],404);
} catch (Exception $e) {
    sendJson(['success'=>false,'error'=>$e->getMessage()], 400);
}
