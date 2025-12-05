<?php
require_once __DIR__ . '/../../includes/config.php';

// Handle OPTIONS requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$uri = $_SERVER['REQUEST_URI'] ?? '';

// Normalize path after '/api/lookups' and strip optional '/index.php'
$path = parse_url($uri, PHP_URL_PATH);
$pos = strpos($path, '/api/lookups');
$sub = $pos !== false ? substr($path, $pos + strlen('/api/lookups')) : '/';
$sub = $sub === '' ? '/' : $sub;
if (strpos($sub, '/index.php') === 0) {
    $sub = substr($sub, strlen('/index.php'));
    if ($sub === '') { $sub = '/'; }
}

function readQueryParams(): array {
    $q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
    $limit = isset($_GET['limit']) ? max(1, min(200, (int)$_GET['limit'])) : 100;
    $activeOnly = isset($_GET['active']) ? (int)($_GET['active'] ? 1 : 0) : null; // 1 or 0 or null
    return [$q, $limit, $activeOnly];
}

try {
    // GET /api/lookups/donor-categories
    if ($method === 'GET' && preg_match('#^/(donor-categories|donor-categories/)\z#', $sub)) {
        // donors and admins can see list; recipients don't need this but allow public read
        $db = Database::getInstance();
        [$q, $limit, $activeOnly] = readQueryParams();
        $where = [];
        $params = [];
        if ($q !== '') { $where[] = 'name LIKE ?'; $params[] = '%' . $q . '%'; }
        if ($activeOnly !== null) { $where[] = 'is_active = ?'; $params[] = $activeOnly; }
        $sql = 'SELECT id, name FROM donor_categories';
        if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
        $sql .= ' ORDER BY name ASC LIMIT ' . (int)$limit;
        $rows = $db->query($sql, $params)->fetchAll();
        sendJson(['success' => true, 'items' => array_map(function($r){ return ['id'=>(int)$r['id'], 'name'=>$r['name']]; }, $rows)]);
    }

    // GET /api/lookups/beneficiary-categories
    if ($method === 'GET' && preg_match('#^/(beneficiary-categories|beneficiary-categories/)\z#', $sub)) {
        $db = Database::getInstance();
        [$q, $limit, $activeOnly] = readQueryParams();
        // Detect PK column name to support both legacy and current schemas
        $pk = 'beneficiary_category_id';
        try {
            $col = $db->query('SHOW COLUMNS FROM beneficiary_categories LIKE ?',[ 'beneficiary_category_id' ])->fetch();
            if (!$col) { $pk = 'id'; }
        } catch (Exception $e) { /* default to beneficiary_category_id */ }
        $where = [];
        $params = [];
        if ($q !== '') { $where[] = 'name LIKE ?'; $params[] = '%' . $q . '%'; }
        if ($activeOnly !== null) { $where[] = 'is_active = ?'; $params[] = $activeOnly; }
        $sql = 'SELECT ' . $pk . ' AS id, name FROM beneficiary_categories';
        if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
        $sql .= ' ORDER BY name ASC LIMIT ' . (int)$limit;
        $rows = $db->query($sql, $params)->fetchAll();
        sendJson(['success' => true, 'items' => array_map(function($r){ return ['id'=>(int)$r['id'], 'name'=>$r['name']]; }, $rows)]);
    }

    // Fallback
    sendJson(['success' => false, 'error' => 'Not found'], 404);
} catch (Exception $e) {
    sendJson(['success' => false, 'error' => $e->getMessage()], 500);
}
