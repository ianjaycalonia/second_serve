<?php
require_once __DIR__ . '/../includes/config.php';

// CORS + JSON header
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { setCorsHeaders(); exit(0); }
setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? strtolower(trim($_GET['action'])) : '';
$payload = getJsonInput();

function ensureScheduleTable(){
    $db = Database::getInstance();
    // Create table if not exists
    $sql = "CREATE TABLE IF NOT EXISTS schedule_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        start_datetime DATETIME NOT NULL,
        end_datetime DATETIME DEFAULT NULL,
        recipient_id INT DEFAULT NULL,
        donor_id INT DEFAULT NULL,
        location VARCHAR(255) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        status ENUM('scheduled','confirmed','completed','cancelled') NOT NULL DEFAULT 'scheduled',
        created_by INT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_start (start_datetime),
        INDEX idx_recipient (recipient_id),
        INDEX idx_donor (donor_id),
        CONSTRAINT fk_schedule_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_recipient FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_donor FOREIGN KEY (donor_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;";
    try { $db->query($sql); } catch (Exception $e) { /* ignore create race */ }
}

function canAccessEvent($row, $role, $currentId){
    if ($role === 'admin') return true;
    if (!$row) return false;
    $createdBy = (int)($row['created_by'] ?? 0);
    $donorId = (int)($row['donor_id'] ?? 0);
    $recipientId = (int)($row['recipient_id'] ?? 0);
    if ($role === 'donor') return ($createdBy === $currentId) || ($donorId === $currentId);
    if ($role === 'recipient') return ($createdBy === $currentId) || ($recipientId === $currentId);
    return false;
}

try {
    ensureScheduleTable();
    $db = Database::getInstance();
    $currentId = (int)(currentUserId() ?? 0);
    $role = (string)(currentUserRole() ?? '');
    if ($currentId <= 0){ sendJson(['success'=>false,'error'=>'Unauthorized'], 401); }

    if ($method === 'GET' && $action === 'list'){
        $start = isset($_GET['start']) ? $_GET['start'] : null;
        $end = isset($_GET['end']) ? $_GET['end'] : null;
        $params = [];
        $where = [];
        if ($start){ $where[] = 'start_datetime >= ?'; $params[] = date('Y-m-d H:i:s', strtotime($start)); }
        if ($end){ $where[] = 'start_datetime <= ?'; $params[] = date('Y-m-d H:i:s', strtotime($end)); }
        // Role scoping
        if ($role === 'admin'){
            // no extra filter
        } elseif ($role === 'donor'){
            $where[] = '(created_by = ? OR donor_id = ?)'; $params[] = $currentId; $params[] = $currentId;
        } elseif ($role === 'recipient'){
            $where[] = '(created_by = ? OR recipient_id = ?)'; $params[] = $currentId; $params[] = $currentId;
        } else {
            // default: only own created
            $where[] = 'created_by = ?'; $params[] = $currentId;
        }
        $sql = 'SELECT id, title, start_datetime AS start, end_datetime AS end, recipient_id, donor_id, location, notes, status, created_by, created_at, updated_at FROM schedule_events';
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= ' ORDER BY start_datetime ASC LIMIT 1000';
        $rows = $db->fetchAll($sql, $params);
        sendJson(['success'=>true,'data'=>['items'=>$rows]]);
    }

    if ($method === 'POST' && $action === 'create'){
        $title = trim((string)($payload['title'] ?? ''));
        $start = isset($payload['start']) ? date('Y-m-d H:i:s', strtotime($payload['start'])) : null;
        $end = isset($payload['end']) && $payload['end'] ? date('Y-m-d H:i:s', strtotime($payload['end'])) : null;
        $recipientId = isset($payload['recipient_id']) ? (int)$payload['recipient_id'] : null;
        $donorId = isset($payload['donor_id']) ? (int)$payload['donor_id'] : null;
        $location = isset($payload['location']) ? trim((string)$payload['location']) : null;
        $notes = isset($payload['notes']) ? (string)$payload['notes'] : null;
        $status = isset($payload['status']) ? strtolower(trim((string)$payload['status'])) : 'scheduled';
        if ($title === '' || !$start){ sendJson(['success'=>false,'error'=>'title and start are required'], 400); }
        // Auto-assign donor/recipient to self depending on role if not provided
        if ($role === 'donor' && !$donorId) $donorId = $currentId;
        if ($role === 'recipient' && !$recipientId) $recipientId = $currentId;
        $db->query('INSERT INTO schedule_events (title,start_datetime,end_datetime,recipient_id,donor_id,location,notes,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)', [
            $title, $start, $end, $recipientId, $donorId, $location, $notes, in_array($status,['scheduled','confirmed','completed','cancelled'])?$status:'scheduled', $currentId
        ]);
        $id = (int)$db->lastInsertId();
        $row = $db->fetchOne('SELECT id, title, start_datetime AS start, end_datetime AS end, recipient_id, donor_id, location, notes, status, created_by, created_at, updated_at FROM schedule_events WHERE id = ?', [$id]);
        sendJson(['success'=>true,'data'=>$row], 201);
    }

    if ($method === 'PATCH' && $action === 'update'){
        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0; if ($id<=0) sendJson(['success'=>false,'error'=>'id required'],400);
        $row = $db->fetchOne('SELECT * FROM schedule_events WHERE id=?', [$id]);
        if (!$row) sendJson(['success'=>false,'error'=>'Not found'],404);
        if (!canAccessEvent($row, $role, $currentId)) sendJson(['success'=>false,'error'=>'Forbidden'],403);
        $fields = [];$params=[];
        if (isset($payload['title'])){ $fields[]='title=?'; $params[] = trim((string)$payload['title']); }
        if (isset($payload['start'])){ $fields[]='start_datetime=?'; $params[] = date('Y-m-d H:i:s', strtotime($payload['start'])); }
        if (array_key_exists('end',$payload)){ $fields[]='end_datetime=?'; $params[] = ($payload['end']?date('Y-m-d H:i:s', strtotime($payload['end'])):null); }
        if (array_key_exists('recipient_id',$payload)){ $fields[]='recipient_id=?'; $params[] = $payload['recipient_id']!==null ? (int)$payload['recipient_id'] : null; }
        if (array_key_exists('donor_id',$payload)){ $fields[]='donor_id=?'; $params[] = $payload['donor_id']!==null ? (int)$payload['donor_id'] : null; }
        if (isset($payload['location'])){ $fields[]='location=?'; $params[] = trim((string)$payload['location']); }
        if (isset($payload['notes'])){ $fields[]='notes=?'; $params[] = (string)$payload['notes']; }
        if (isset($payload['status'])){ $st = strtolower(trim((string)$payload['status'])); $fields[]='status=?'; $params[] = in_array($st,['scheduled','confirmed','completed','cancelled'])?$st:'scheduled'; }
        if (!$fields) sendJson(['success'=>false,'error'=>'No updates provided'],400);
        $params[] = $id;
        $db->query('UPDATE schedule_events SET '.implode(',', $fields).' WHERE id=?', $params);
        $new = $db->fetchOne('SELECT id, title, start_datetime AS start, end_datetime AS end, recipient_id, donor_id, location, notes, status, created_by, created_at, updated_at FROM schedule_events WHERE id = ?', [$id]);
        sendJson(['success'=>true,'data'=>$new]);
    }

    if ($method === 'DELETE' && $action === 'delete'){
        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0; if ($id<=0) sendJson(['success'=>false,'error'=>'id required'],400);
        $row = $db->fetchOne('SELECT * FROM schedule_events WHERE id=?', [$id]);
        if (!$row) sendJson(['success'=>false,'error'=>'Not found'],404);
        if (!canAccessEvent($row, $role, $currentId)) sendJson(['success'=>false,'error'=>'Forbidden'],403);
        $db->query('DELETE FROM schedule_events WHERE id=?', [$id]);
        sendJson(['success'=>true,'message'=>'Deleted']);
    }

    sendJson(['success'=>false,'error'=>'Invalid method or action'], 400);
} catch (Exception $e){
    error_log('Schedule API error: '.$e->getMessage());
    $resp = ['success'=>false,'error'=>'Server error'];
    if ((string)(currentUserRole() ?? '') === 'admin') $resp['detail']=$e->getMessage();
    sendJson($resp, 500);
}
