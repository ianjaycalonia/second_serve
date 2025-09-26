<?php
require_once __DIR__ . '/../../includes/config.php';

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
        notes TEXT NULL,
        status ENUM('scheduled','confirmed','completed','cancelled') NOT NULL DEFAULT 'scheduled',
        created_by INT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        updated_by INT DEFAULT NULL,
        INDEX idx_start (start_datetime),
        INDEX idx_recipient (recipient_id),
        INDEX idx_donor (donor_id),
        CONSTRAINT fk_schedule_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_recipient FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_donor FOREIGN KEY (donor_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_updated_by FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;";
    try { $db->query($sql); } catch (Exception $e) { /* ignore create race */ }
    // In case table already existed without updated_by, try to add it (ignore if already present)
    try { $db->query("ALTER TABLE schedule_events ADD COLUMN updated_by INT DEFAULT NULL"); } catch (Exception $e) { /* ignore */ }
    try { $db->query("ALTER TABLE schedule_events ADD CONSTRAINT fk_schedule_updated_by FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE"); } catch (Exception $e) { /* ignore */ }
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
        // For privacy-friendly busy view, fetch all events in range for donors/recipients
        // Admin sees everything with full detail
        $sql = 'SELECT 
                    e.id, e.title, e.start_datetime AS start, e.end_datetime AS end,
                    e.recipient_id, e.donor_id, e.location, e.notes, e.status,
                    e.created_by, e.created_at, e.updated_at, e.updated_by,
                    -- donor display
                    COALESCE(dp_d.organization_name, u_d.name) AS donor_display,
                    dp_d.address AS donor_address,
                    COALESCE(rp_r.organization_name, u_r.name) AS recipient_display,
                    rp_r.address AS recipient_address,
                    u_up.role AS editor_role
                FROM schedule_events e
                LEFT JOIN users u_d ON u_d.user_id = e.donor_id
                LEFT JOIN donor_profiles dp_d ON dp_d.user_id = u_d.user_id
                LEFT JOIN users u_r ON u_r.user_id = e.recipient_id
                LEFT JOIN recipient_profiles rp_r ON rp_r.user_id = u_r.user_id
                LEFT JOIN users u_up ON u_up.user_id = e.updated_by';
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= ' ORDER BY start_datetime ASC LIMIT 1000';
        $rows = $db->query($sql, $params)->fetchAll();

        $items = [];
        foreach ($rows as $row) {
            $createdBy = (int)($row['created_by'] ?? 0);
            $donId = (int)($row['donor_id'] ?? 0);
            $recId = (int)($row['recipient_id'] ?? 0);
            // infer role_type for coloring
            $roleType = $recId ? 'recipient' : ($donId ? 'donor' : 'admin');
            $isInvolved = ($role === 'admin') || ($createdBy === $currentId) || ($donId === $currentId) || ($recId === $currentId);
            $isBusy = false;
            $out = $row;
            $out['role_type'] = $roleType;
            if ($role !== 'admin' && !$isInvolved) {
                // scrub details
                $isBusy = true;
                $out['title'] = 'Busy';
                $out['location'] = null;
                $out['notes'] = null;
                // do not expose counterpart IDs
                $out['donor_id'] = null;
                $out['recipient_id'] = null;
            }
            $out['is_busy'] = $isBusy ? 1 : 0;
            $items[] = $out;
        }
        sendJson(['success'=>true,'data'=>['items'=>$items]]);
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
        // Auto-assign donor/recipient to self depending on role if not provided, and enforce constraints
        if ($role === 'donor') {
            if ($donorId && $donorId !== $currentId) { sendJson(['success'=>false,'error'=>'Cannot create events for other donors'], 403); }
            $donorId = $currentId; // ensure
        }
        if ($role === 'recipient') {
            if ($recipientId && $recipientId !== $currentId) { sendJson(['success'=>false,'error'=>'Cannot create events for other recipients'], 403); }
            $recipientId = $currentId; // ensure
        }
        // Scheduling constraints
        $startTs = strtotime($start);
        if ($startTs < time()){
            sendJson(['success'=>false,'error'=>'Cannot create events in the past'], 400);
        }
        $startDate = date('Y-m-d', $startTs);
        $startH = (int)date('H', $startTs); $startM = (int)date('i', $startTs);
        if ($role === 'recipient'){
            // Window 10:00 - 16:00 inclusive
            $mins = $startH*60 + $startM;
            if ($mins < (10*60) || $mins > (16*60)){
                sendJson(['success'=>false,'error'=>'Recipients can only book between 10:00 and 16:00'], 400);
            }
            // Must be at least 3 hours after latest donor booking that day at or before this time
            $rowDon = $db->query('SELECT MAX(start_datetime) AS last_donor FROM schedule_events WHERE donor_id IS NOT NULL AND DATE(start_datetime)=? AND start_datetime<=?',[ $startDate, $start ])->fetch();
            if (!empty($rowDon['last_donor'])){
                $lastDonTs = strtotime($rowDon['last_donor']);
                if ($startTs < ($lastDonTs + 3*3600)){
                    sendJson(['success'=>false,'error'=>'Must be at least 3 hours after the latest donor booking'], 400);
                }
            }
        }
        if ($role === 'donor'){
            // Only one donor booking per day for this donor
            $rowCnt = $db->query('SELECT COUNT(*) AS c FROM schedule_events WHERE donor_id=? AND DATE(start_datetime)=?', [ $currentId, $startDate ])->fetch();
            if ((int)($rowCnt['c'] ?? 0) > 0){
                sendJson(['success'=>false,'error'=>'Only one donor booking per day is allowed'], 400);
            }
        }
        // Admin may create admin events (no donor/recipient) or specify either/both
        $db->query('INSERT INTO schedule_events (title,start_datetime,end_datetime,recipient_id,donor_id,location,notes,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)', [
            $title, $start, $end, $recipientId, $donorId, $location, $notes, in_array($status,['scheduled','confirmed','completed','cancelled'])?$status:'scheduled', $currentId, $currentId
        ]);
        $id = (int)$db->lastInsertId();
        $row = $db->query('SELECT id, title, start_datetime AS start, end_datetime AS end, recipient_id, donor_id, location, notes, status, created_by, created_at, updated_at FROM schedule_events WHERE id = ?', [$id])->fetch();
        sendJson(['success'=>true,'data'=>$row], 201);
    }

    if ($method === 'PATCH' && $action === 'update'){
        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0; if ($id<=0) sendJson(['success'=>false,'error'=>'id required'],400);
        $row = $db->query('SELECT * FROM schedule_events WHERE id=?', [$id])->fetch();
        if (!$row) sendJson(['success'=>false,'error'=>'Not found'],404);
        if (!canAccessEvent($row, $role, $currentId)) sendJson(['success'=>false,'error'=>'Forbidden'],403);
        // Donors can only edit entries for themselves (donor_id must be null or their own id)
        if ($role === 'donor') {
            $rowDon = isset($row['donor_id']) ? (int)$row['donor_id'] : 0;
            if ($rowDon !== 0 && $rowDon !== $currentId) {
                sendJson(['success'=>false,'error'=>'Forbidden'],403);
            }
        }
        // Recipients can only edit entries for themselves (recipient_id must be null or their own id)
        if ($role === 'recipient') {
            $rowRec = isset($row['recipient_id']) ? (int)$row['recipient_id'] : 0;
            if ($rowRec !== 0 && $rowRec !== $currentId) {
                sendJson(['success'=>false,'error'=>'Forbidden'],403);
            }
        }
        $fields = [];$params=[];
        if (isset($payload['title'])){ $fields[]='title=?'; $params[] = trim((string)$payload['title']); }
        if (isset($payload['start'])){ $fields[]='start_datetime=?'; $params[] = date('Y-m-d H:i:s', strtotime($payload['start'])); }
        if (array_key_exists('end',$payload)){ $fields[]='end_datetime=?'; $params[] = ($payload['end']?date('Y-m-d H:i:s', strtotime($payload['end'])):null); }
        if (array_key_exists('recipient_id',$payload)){
            $newRec = $payload['recipient_id']!==null ? (int)$payload['recipient_id'] : null;
            if ($role === 'recipient') {
                // Force recipient_id to self; recipients cannot reassign to others or null
                $fields[]='recipient_id=?'; $params[] = $currentId;
            } else {
                $fields[]='recipient_id=?'; $params[] = $newRec;
            }
        }
        if (array_key_exists('donor_id',$payload)){
            $newDon = $payload['donor_id']!==null ? (int)$payload['donor_id'] : null;
            if ($role === 'donor') {
                // Force donor_id to self; donors cannot reassign to others or null
                $fields[]='donor_id=?'; $params[] = $currentId;
            } else {
                $fields[]='donor_id=?'; $params[] = $newDon;
            }
        }
        if (isset($payload['location'])){ $fields[]='location=?'; $params[] = trim((string)$payload['location']); }
        if (isset($payload['notes'])){ $fields[]='notes=?'; $params[] = (string)$payload['notes']; }
        if (isset($payload['status'])){ $st = strtolower(trim((string)$payload['status'])); $fields[]='status=?'; $params[] = in_array($st,['scheduled','confirmed','completed','cancelled'])?$st:'scheduled'; }
        // Always stamp who updated
        $fields[] = 'updated_by=?';
        $params[] = $currentId;
        if (!$fields) sendJson(['success'=>false,'error'=>'No updates provided'],400);
        $params[] = $id;
        // Before update, enforce constraints using the would-be new values
        $newStart = null;
        foreach ($fields as $idx=>$f){ if (strpos($f,'start_datetime=')===0){ $newStart = $params[$idx]; break; } }
        if (!$newStart) { $newStart = $row['start_datetime']; }
        $newStartTs = strtotime($newStart);
        if ($newStartTs < time()){
            sendJson(['success'=>false,'error'=>'Cannot update events to a past time'], 400);
        }
        $newDate = date('Y-m-d', $newStartTs);
        if ($role === 'recipient'){
            $h = (int)date('H',$newStartTs); $m=(int)date('i',$newStartTs); $mins=$h*60+$m;
            if ($mins < (10*60) || $mins > (16*60)){
                sendJson(['success'=>false,'error'=>'Recipients can only book between 10:00 and 16:00'], 400);
            }
            $rowDon = $db->query('SELECT MAX(start_datetime) AS last_donor FROM schedule_events WHERE donor_id IS NOT NULL AND DATE(start_datetime)=? AND start_datetime<=? AND id<>?',[ $newDate, $newStart, $id ])->fetch();
            if (!empty($rowDon['last_donor'])){
                $lastDonTs = strtotime($rowDon['last_donor']);
                if ($newStartTs < ($lastDonTs + 3*3600)){
                    sendJson(['success'=>false,'error'=>'Must be at least 3 hours after the latest donor booking'], 400);
                }
            }
        }
        if ($role === 'donor'){
            $rowCnt = $db->query('SELECT COUNT(*) AS c FROM schedule_events WHERE donor_id=? AND DATE(start_datetime)=? AND id<>?', [ $currentId, $newDate, $id ])->fetch();
            if ((int)($rowCnt['c'] ?? 0) > 0){ sendJson(['success'=>false,'error'=>'Only one donor booking per day is allowed'], 400); }
        }
        $db->query('UPDATE schedule_events SET '.implode(',', $fields).' WHERE id=?', $params);
        $new = $db->query('SELECT id, title, start_datetime AS start, end_datetime AS end, recipient_id, donor_id, location, notes, status, created_by, created_at, updated_at FROM schedule_events WHERE id = ?', [$id])->fetch();
        sendJson(['success'=>true,'data'=>$new]);
    }

    if ($method === 'DELETE' && $action === 'delete'){
        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0; if ($id<=0) sendJson(['success'=>false,'error'=>'id required'],400);
        $row = $db->query('SELECT * FROM schedule_events WHERE id=?', [$id])->fetch();
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
