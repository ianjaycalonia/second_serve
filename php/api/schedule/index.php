<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Notification.php';

// Handle OPTIONS requests without emitting CORS headers
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? strtolower(trim($_GET['action'])) : '';
$payload = getJsonInput();

function ensureScheduleTable(){
    $db = Database::getInstance();
    // Create tables if not exist using latest schema definition.
    $sqlEvents = "CREATE TABLE IF NOT EXISTS schedule_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        event_type ENUM('admin','donor','recipient') NOT NULL DEFAULT 'admin',
        status ENUM('scheduled','confirmed','completed','cancelled') NOT NULL DEFAULT 'scheduled',
        start_datetime DATETIME NOT NULL,
        end_datetime DATETIME DEFAULT NULL,
        location VARCHAR(255) DEFAULT NULL,
        notes TEXT NULL,
        primary_recipient_id INT DEFAULT NULL,
        donor_id INT DEFAULT NULL,
        created_by INT NOT NULL,
        created_for_user_id INT DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        updated_by INT DEFAULT NULL,
        INDEX idx_schedule_events_start (start_datetime),
        INDEX idx_schedule_events_type (event_type),
        INDEX idx_schedule_events_status (status),
        INDEX idx_schedule_events_primary_recipient (primary_recipient_id),
        INDEX idx_schedule_events_donor (donor_id),
        INDEX idx_schedule_events_created_by (created_by),
        CONSTRAINT fk_schedule_events_primary_recipient FOREIGN KEY (primary_recipient_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_events_donor FOREIGN KEY (donor_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_events_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_events_created_for FOREIGN KEY (created_for_user_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_schedule_events_updated_by FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;";
    try { $db->query($sqlEvents); } catch (Exception $e) { /* ignore create race */ }

    $sqlRecipients = "CREATE TABLE IF NOT EXISTS schedule_event_recipients (
        event_id INT NOT NULL,
        recipient_id INT NOT NULL,
        is_primary TINYINT(1) NOT NULL DEFAULT 0,
        added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (event_id, recipient_id),
        KEY idx_ser_recipient (recipient_id),
        CONSTRAINT fk_ser_event FOREIGN KEY (event_id) REFERENCES schedule_events(id) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_ser_recipient FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;";
    try { $db->query($sqlRecipients); } catch (Exception $e) { /* ignore create race */ }

    // Apply schema upgrades for older installations.
    $alterStatements = [
        "ALTER TABLE schedule_events ADD COLUMN event_type ENUM('admin','donor','recipient') NOT NULL DEFAULT 'admin'",
        "ALTER TABLE schedule_events ADD COLUMN created_for_user_id INT DEFAULT NULL",
        "ALTER TABLE schedule_events ADD COLUMN status ENUM('scheduled','confirmed','completed','cancelled') NOT NULL DEFAULT 'scheduled'",
        "ALTER TABLE schedule_events ADD COLUMN primary_recipient_id INT DEFAULT NULL",
        "ALTER TABLE schedule_events ADD COLUMN updated_by INT DEFAULT NULL",
        "ALTER TABLE schedule_events ADD INDEX idx_schedule_events_type (event_type)",
        "ALTER TABLE schedule_events ADD INDEX idx_schedule_events_status (status)",
        "ALTER TABLE schedule_events ADD INDEX idx_schedule_events_primary_recipient (primary_recipient_id)",
        "ALTER TABLE schedule_events ADD INDEX idx_schedule_events_created_by (created_by)",
        "ALTER TABLE schedule_events ADD CONSTRAINT fk_schedule_events_primary_recipient FOREIGN KEY (primary_recipient_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE",
        "ALTER TABLE schedule_events ADD CONSTRAINT fk_schedule_events_created_for FOREIGN KEY (created_for_user_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE",
        "ALTER TABLE schedule_events ADD CONSTRAINT fk_schedule_events_updated_by FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE"
    ];
    foreach ($alterStatements as $stmt) {
        try { $db->query($stmt); } catch (Exception $e) { /* ignore if already applied */ }
    }

    // Rename legacy recipient_id column if present.
    try {
        $db->query("ALTER TABLE schedule_events CHANGE COLUMN recipient_id primary_recipient_id INT DEFAULT NULL");
    } catch (Exception $e) { /* ignore */ }

    // Ensure recipient join table exists (legacy installs may not have it).
    try {
        $db->query($sqlRecipients);
    } catch (Exception $e) { /* ignore */ }
}

function extractRecipientIds($raw){
    if (empty($raw)) return [];
    if (!is_array($raw)) {
        $raw = [$raw];
    }
    $ids = [];
    foreach ($raw as $value){
        if (is_array($value)){
            $value = $value['id'] ?? $value['recipient_id'] ?? null;
        }
        $num = (int)$value;
        if ($num > 0 && !in_array($num, $ids, true)){
            $ids[] = $num;
        }
    }
    return $ids;
}

function attachEventRecipients(Database $db, array &$rows){
    if (empty($rows)) return;
    $eventIds = array_column($rows, 'id');
    $placeholders = implode(',', array_fill(0, count($eventIds), '?'));
    $sql = "SELECT ser.event_id, ser.recipient_id, ser.is_primary,
                   COALESCE(rp.organization_name, u.name) AS recipient_display,
                   rp.address AS recipient_address
            FROM schedule_event_recipients ser
            LEFT JOIN users u ON u.user_id = ser.recipient_id
            LEFT JOIN recipient_profiles rp ON rp.user_id = u.user_id
            WHERE ser.event_id IN ($placeholders)";
    $recipientRows = $db->query($sql, $eventIds)->fetchAll();
    $grouped = [];
    foreach ($recipientRows as $rec){
        $eventId = (int)$rec['event_id'];
        if (!isset($grouped[$eventId])) $grouped[$eventId] = [];
        $grouped[$eventId][] = [
            'id' => (int)$rec['recipient_id'],
            'is_primary' => (int)$rec['is_primary'],
            'display_name' => $rec['recipient_display'],
            'address' => $rec['recipient_address']
        ];
    }
    foreach ($rows as &$row){
        $id = (int)$row['id'];
        $row['recipients'] = $grouped[$id] ?? [];
    }
}

function finalizeEventRows(array $rows, $role, $currentId){
    foreach ($rows as &$row){
        if (!isset($row['recipients'])) $row['recipients'] = [];
        $primaryId = isset($row['primary_recipient_id']) ? (int)$row['primary_recipient_id'] : null;
        // Ensure primary recipient appears in recipients list for convenience
        if ($primaryId && !in_array($primaryId, array_column($row['recipients'], 'id'), true)) {
            $row['recipients'][] = [
                'id' => $primaryId,
                'is_primary' => 1,
                'display_name' => $row['recipient_display'] ?? null,
                'address' => $row['recipient_address'] ?? null
            ];
        }
        // Provide compatibility aliases
        $row['recipient_id'] = $primaryId;
        $roleType = $row['event_type'] ?? null;
        if (!$roleType){
            $roleType = $primaryId ? 'recipient' : (($row['donor_id'] ?? null) ? 'donor' : 'admin');
        }
        $row['role_type'] = $roleType;
        $recipientIds = array_map(static function($r){ return (int)$r['id']; }, $row['recipients']);
        $createdFor = isset($row['created_for_user_id']) ? (int)$row['created_for_user_id'] : null;
        $isInvolved = ($role === 'admin')
            || ((int)($row['created_by'] ?? 0) === $currentId)
            || ((int)($row['donor_id'] ?? 0) === $currentId)
            || ($createdFor && $createdFor === $currentId)
            || ($primaryId && $primaryId === $currentId)
            || in_array($currentId, $recipientIds, true);
        $creatorName = trim((string)($row['created_by_name'] ?? ''));
        $creatorOrg = trim((string)($row['created_by_org'] ?? ''));
        $creatorEmail = trim((string)($row['created_by_email'] ?? ''));
        $creatorParts = [];
        if ($creatorName !== '') $creatorParts[] = $creatorName;
        if ($creatorOrg !== '' && strcasecmp($creatorOrg, $creatorName) !== 0) $creatorParts[] = $creatorOrg;
        if (!$creatorParts && $creatorEmail !== '') $creatorParts[] = $creatorEmail;
        $row['created_by_display'] = $creatorParts ? implode(' — ', $creatorParts) : null;

        if ($role !== 'admin' && !$isInvolved){
            $row['title'] = 'Busy';
            $row['location'] = null;
            $row['notes'] = null;
            $row['donor_id'] = null;
            $row['primary_recipient_id'] = null;
            $row['recipient_id'] = null;
            $row['recipients'] = [];
            $row['recipient_display'] = null;
            $row['recipient_address'] = null;
            $row['donor_display'] = null;
            $row['donor_address'] = null;
            $row['event_type'] = 'busy';
            $row['role_type'] = 'busy';
            $row['status'] = 'busy';
            $row['is_busy'] = 1;
            $row['created_by_display'] = null;
        } else {
            $row['is_busy'] = 0;
        }
    }
    return $rows;
}

function canAccessEvent($row, $role, $currentId){
    if ($role === 'admin') return true;
    if (!$row) return false;
    $createdBy = (int)($row['created_by'] ?? 0);
    $donorId = (int)($row['donor_id'] ?? 0);
    $recipientId = (int)($row['primary_recipient_id'] ?? ($row['recipient_id'] ?? 0));
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
                    e.id,
                    e.title,
                    e.event_type,
                    e.start_datetime AS start,
                    e.end_datetime AS end,
                    e.primary_recipient_id,
                    e.donor_id,
                    e.location,
                    e.notes,
                    e.status,
                    e.created_by,
                    e.created_for_user_id,
                    e.created_at,
                    e.updated_at,
                    e.updated_by,
                    COALESCE(dp_d.organization_name, u_d.name) AS donor_display,
                    dp_d.address AS donor_address,
                    COALESCE(rp_r.organization_name, u_r.name) AS recipient_display,
                    rp_r.address AS recipient_address,
                    u_up.role AS editor_role,
                    u_cb.name AS created_by_name,
                    u_cb.email AS created_by_email,
                    COALESCE(dp_cb.organization_name, rp_cb.organization_name, ap_cb.organization_name) AS created_by_org
                FROM schedule_events e
                LEFT JOIN users u_d ON u_d.user_id = e.donor_id
                LEFT JOIN donor_profiles dp_d ON dp_d.user_id = u_d.user_id
                LEFT JOIN users u_r ON u_r.user_id = e.primary_recipient_id
                LEFT JOIN recipient_profiles rp_r ON rp_r.user_id = u_r.user_id
                LEFT JOIN users u_up ON u_up.user_id = e.updated_by
                LEFT JOIN users u_cb ON u_cb.user_id = e.created_by
                LEFT JOIN donor_profiles dp_cb ON dp_cb.user_id = u_cb.user_id
                LEFT JOIN recipient_profiles rp_cb ON rp_cb.user_id = u_cb.user_id
                LEFT JOIN admin_profiles ap_cb ON ap_cb.user_id = u_cb.user_id';
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= ' ORDER BY start_datetime ASC LIMIT 1000';
        $rows = $db->query($sql, $params)->fetchAll();
        attachEventRecipients($db, $rows);
        $items = finalizeEventRows($rows, $role, $currentId);
        sendJson(['success'=>true,'data'=>['items'=>$items]]);
    }

    if ($method === 'POST' && $action === 'create'){
        $title = trim((string)($payload['title'] ?? ''));
        $start = isset($payload['start']) ? date('Y-m-d H:i:s', strtotime($payload['start'])) : null;
        $end = isset($payload['end']) && $payload['end'] ? date('Y-m-d H:i:s', strtotime($payload['end'])) : null;
        $location = isset($payload['location']) ? trim((string)$payload['location']) : null;
        $notes = isset($payload['notes']) ? (string)$payload['notes'] : null;
        $status = isset($payload['status']) ? strtolower(trim((string)$payload['status'])) : 'scheduled';
        $donorId = isset($payload['donor_id']) ? (int)$payload['donor_id'] : null;
        $primaryRecipientId = isset($payload['recipient_id']) ? (int)$payload['recipient_id'] : null;
        $createdForUserId = isset($payload['created_for_user_id']) ? (int)$payload['created_for_user_id'] : null;
        $recipientIds = extractRecipientIds($payload['recipient_ids'] ?? []);
        $eventType = strtolower(trim((string)($payload['event_type'] ?? 'admin')));
        if (!in_array($eventType, ['admin','donor','recipient'], true)) $eventType = 'admin';

        if ($title === '' || !$start){ sendJson(['success'=>false,'error'=>'title and start are required'], 400); }

        if ($primaryRecipientId > 0 && !in_array($primaryRecipientId, $recipientIds, true)){
            $recipientIds[] = $primaryRecipientId;
        }

        if ($role === 'donor') {
            if ($donorId && $donorId !== $currentId) { sendJson(['success'=>false,'error'=>'Cannot create events for other donors'], 403); }
            $donorId = $currentId;
            $eventType = 'donor';
            $createdForUserId = $currentId;
        } elseif ($role === 'recipient') {
            if ($primaryRecipientId && $primaryRecipientId !== $currentId) { sendJson(['success'=>false,'error'=>'Cannot create events for other recipients'], 403); }
            $primaryRecipientId = $currentId;
            $eventType = 'recipient';
            $recipientIds = [$currentId];
            $createdForUserId = $currentId;
        }

        if ($eventType === 'recipient'){
            if (!$recipientIds && $primaryRecipientId){ $recipientIds = [$primaryRecipientId]; }
            $recipientIds = array_values(array_unique(array_filter($recipientIds, static function($v){ return (int)$v > 0; })));
            if (!$recipientIds){ sendJson(['success'=>false,'error'=>'Recipient events require at least one recipient'], 400); }
            $primaryRecipientId = $recipientIds[0];
        } else {
            $recipientIds = [];
        }

        if (!$createdForUserId){
            if ($eventType === 'recipient' && $primaryRecipientId){ $createdForUserId = $primaryRecipientId; }
            elseif ($eventType === 'donor' && $donorId){ $createdForUserId = $donorId; }
        }

        // Scheduling constraints disabled per user request
        $startTs = strtotime($start);
        $startDate = date('Y-m-d', $startTs);

        $status = in_array($status, ['scheduled','confirmed','completed','cancelled'], true) ? $status : 'scheduled';
        $db->query('INSERT INTO schedule_events (title,event_type,status,start_datetime,end_datetime,location,notes,primary_recipient_id,donor_id,created_by,created_for_user_id,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
            $title,
            $eventType,
            $status,
            $start,
            $end,
            $location,
            $notes,
            $primaryRecipientId,
            $donorId,
            $currentId,
            $createdForUserId,
            $currentId
        ]);
        $id = (int)$db->lastInsertId();

        if ($eventType === 'recipient' && $recipientIds){
            $insertSql = 'INSERT INTO schedule_event_recipients (event_id, recipient_id, is_primary) VALUES (?,?,?) ON DUPLICATE KEY UPDATE is_primary=VALUES(is_primary)';
            foreach ($recipientIds as $rid){
                $db->query($insertSql, [ $id, $rid, $rid === $primaryRecipientId ? 1 : 0 ]);
            }
        }

        // Pre-format start for notification messages
        $formattedStart = $start;
        try {
            $dt = new DateTime($start);
            $formattedStart = $dt->format('M j, Y g:i A');
        } catch (Exception $e) {
            // keep fallback string
        }

        // Notify recipients about this new schedule event
        if ($eventType === 'recipient' && strtolower((string)$role) !== 'recipient'){
            $notifyIds = $recipientIds;
            if (!$notifyIds && $primaryRecipientId){
                $notifyIds = [$primaryRecipientId];
            }
            $notifyIds = array_values(array_unique(array_filter(array_map('intval', $notifyIds), static function($v){ return $v > 0; })));
            if ($notifyIds){
                try {
                    $notifSvc = new Notification();
                    foreach ($notifyIds as $rid){
                        try {
                            $message = sprintf(
                                '%s scheduled for %s%s.',
                                $title ?: 'Recipient pickup',
                                $formattedStart,
                                $location ? ' at '.$location : ''
                            );
                            $notifSvc->create([
                                'user_id' => $rid,
                                'type' => 'schedule_event_created',
                                'reference_type' => 'schedule_event',
                                'reference_id' => $id,
                                'message' => $message
                            ]);
                        } catch (Exception $e) {
                            error_log('Failed to create recipient schedule notification: '.$e->getMessage());
                        }
                    }
                } catch (Exception $e) {
                    error_log('Notification service unavailable: '.$e->getMessage());
                }
            }
        }
        
        if ($donorId){
            $actorIsDonor = (strtolower((string)$role) === 'donor' && (int)$donorId === $currentId);
            if (!$actorIsDonor) {
                try {
                    $notifSvc = isset($notifSvc) && $notifSvc instanceof Notification ? $notifSvc : new Notification();
                    $message = sprintf(
                        '%s scheduled for %s%s.',
                        $title ?: 'Donor pickup',
                        $formattedStart,
                        $location ? ' at '.$location : ''
                    );
                    $notifSvc->create([
                        'user_id' => $donorId,
                        'type' => 'schedule_event_created',
                        'reference_type' => 'schedule_event',
                        'reference_id' => $id,
                        'message' => $message
                    ]);
                } catch (Exception $e) {
                    error_log('Failed to create donor schedule notification: '.$e->getMessage());
                }
            }
        }

        // Notify all approved admins when a donor or recipient creates a schedule
        if (in_array(strtolower((string)$role), ['donor','recipient'], true)) {
            try {
                $admins = $db->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll();
            } catch (Exception $e) {
                $admins = [];
            }
            if ($admins) {
                // Identify actor display
                $actorDisplay = '';
                try {
                    $u = $db->query(
                        "SELECT u.name, COALESCE(dp.organization_name, rp.organization_name, ap.organization_name) AS org
                         FROM users u
                         LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
                         LEFT JOIN recipient_profiles rp ON rp.user_id = u.user_id
                         LEFT JOIN admin_profiles ap ON ap.user_id = u.user_id
                         WHERE u.user_id = ?",
                        [ $currentId ]
                    )->fetch();
                    if ($u) {
                        if (!empty($u['org'])) { $actorDisplay = $u['org']; }
                        elseif (!empty($u['name'])) { $actorDisplay = $u['name']; }
                    }
                } catch (Exception $e) {
                    // ignore actor lookup failure
                }
                $who = $actorDisplay !== '' ? $actorDisplay : ucfirst(strtolower((string)$role));
                $adminMsg = sprintf('%s created a schedule for %s%s.', $who, $formattedStart, $location ? ' at '.$location : '');
                try {
                    $notifSvc = isset($notifSvc) && $notifSvc instanceof Notification ? $notifSvc : new Notification();
                    foreach ($admins as $admin) {
                        try {
                            $notifSvc->create([
                                'user_id' => (int)$admin['user_id'],
                                'type' => 'schedule_event_created',
                                'reference_type' => 'schedule_event',
                                'reference_id' => $id,
                                'message' => $adminMsg
                            ]);
                        } catch (Exception $e) {
                            error_log('Failed to create admin schedule notification: '.$e->getMessage());
                        }
                    }
                } catch (Exception $e) {
                    error_log('Notification service unavailable for admin alerts: '.$e->getMessage());
                }
            }
        }

        $row = $db->query('SELECT 
                e.id,
                e.title,
                e.event_type,
                e.start_datetime AS start,
                e.end_datetime AS end,
                e.primary_recipient_id,
                e.donor_id,
                e.location,
                e.notes,
                e.status,
                e.created_by,
                e.created_for_user_id,
                e.created_at,
                e.updated_at,
                e.updated_by,
                COALESCE(dp_d.organization_name, u_d.name) AS donor_display,
                dp_d.address AS donor_address,
                COALESCE(rp_r.organization_name, u_r.name) AS recipient_display,
                rp_r.address AS recipient_address,
                u_up.role AS editor_role
            FROM schedule_events e
            LEFT JOIN users u_d ON u_d.user_id = e.donor_id
            LEFT JOIN donor_profiles dp_d ON dp_d.user_id = u_d.user_id
            LEFT JOIN users u_r ON u_r.user_id = e.primary_recipient_id
            LEFT JOIN recipient_profiles rp_r ON rp_r.user_id = u_r.user_id
            LEFT JOIN users u_up ON u_up.user_id = e.updated_by
            WHERE e.id = ?', [$id])->fetch();
        $rowSet = $row ? [$row] : [];
        attachEventRecipients($db, $rowSet);
        $rowSet = finalizeEventRows($rowSet, $role, $currentId);
        $responseRow = $rowSet ? $rowSet[0] : null;
        sendJson(['success'=>true,'data'=>$responseRow], 201);
    }

    if ($method === 'PATCH' && $action === 'update'){
        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0; if ($id<=0) sendJson(['success'=>false,'error'=>'id required'],400);
        $row = $db->query('SELECT * FROM schedule_events WHERE id=?', [$id])->fetch();
        if (!$row) sendJson(['success'=>false,'error'=>'Not found'],404);
        if (!canAccessEvent($row, $role, $currentId)) sendJson(['success'=>false,'error'=>'Forbidden'],403);

        $currentEventType = $row['event_type'] ?? 'admin';
        $newEventType = isset($payload['event_type']) ? strtolower(trim((string)$payload['event_type'])) : $currentEventType;
        if (!in_array($newEventType, ['admin','donor','recipient'], true)) {
            $newEventType = $currentEventType;
        }

        $newTitle = isset($payload['title']) ? trim((string)$payload['title']) : null;
        $newStart = isset($payload['start']) ? date('Y-m-d H:i:s', strtotime($payload['start'])) : null;
        $newEnd = array_key_exists('end',$payload) ? ($payload['end'] ? date('Y-m-d H:i:s', strtotime($payload['end'])) : null) : null;
        $newLocation = isset($payload['location']) ? trim((string)$payload['location']) : null;
        $newNotes = isset($payload['notes']) ? (string)$payload['notes'] : null;
        $newStatus = isset($payload['status']) ? strtolower(trim((string)$payload['status'])) : null;
        $newDonorId = array_key_exists('donor_id',$payload) ? ($payload['donor_id']!==null ? (int)$payload['donor_id'] : null) : null;
        $newPrimaryRecipientId = array_key_exists('recipient_id',$payload) ? ($payload['recipient_id']!==null ? (int)$payload['recipient_id'] : null) : null;
        $newCreatedFor = array_key_exists('created_for_user_id',$payload) ? ($payload['created_for_user_id']!==null ? (int)$payload['created_for_user_id'] : null) : null;
        $recipientIds = extractRecipientIds($payload['recipient_ids'] ?? []);

        if ($newPrimaryRecipientId && !in_array($newPrimaryRecipientId, $recipientIds, true)){
            $recipientIds[] = $newPrimaryRecipientId;
        }

        if ($role === 'donor'){
            $newDonorId = $currentId;
            $newEventType = 'donor';
            $newCreatedFor = $currentId;
        }
        if ($role === 'recipient'){
            $newPrimaryRecipientId = $currentId;
            $newEventType = 'recipient';
            $recipientIds = [$currentId];
            $newCreatedFor = $currentId;
        }

        if ($newEventType === 'recipient'){
            if (!$recipientIds){
                $recipientIds = [$newPrimaryRecipientId ?? (int)($row['primary_recipient_id'] ?? 0)];
            }
            $recipientIds = array_values(array_unique(array_filter($recipientIds, static function($v){ return (int)$v > 0; })));
            if (!$recipientIds){ sendJson(['success'=>false,'error'=>'Recipient events require at least one recipient'], 400); }
            $newPrimaryRecipientId = $recipientIds[0];
        } else {
            $recipientIds = [];
            $newPrimaryRecipientId = null;
        }

        if ($newCreatedFor === null){
            if ($newEventType === 'recipient' && $newPrimaryRecipientId){ $newCreatedFor = $newPrimaryRecipientId; }
            elseif ($newEventType === 'donor' && ($newDonorId ?? $row['donor_id'])){ $newCreatedFor = $newDonorId ?? $row['donor_id']; }
        }

        $fields = [];
        $params = [];
        if ($newTitle !== null){ $fields[] = 'title=?'; $params[] = $newTitle; }
        if ($newStart !== null){ $fields[] = 'start_datetime=?'; $params[] = $newStart; }
        if ($newEnd !== null || array_key_exists('end',$payload)){ $fields[] = 'end_datetime=?'; $params[] = $newEnd; }
        if ($newLocation !== null){ $fields[] = 'location=?'; $params[] = $newLocation; }
        if ($newNotes !== null){ $fields[] = 'notes=?'; $params[] = $newNotes; }
        if ($newStatus !== null){ $sanitized = in_array($newStatus,['scheduled','confirmed','completed','cancelled'], true) ? $newStatus : 'scheduled'; $fields[]='status=?'; $params[]=$sanitized; }
        if ($newEventType !== $currentEventType){ $fields[]='event_type=?'; $params[] = $newEventType; }
        if ($newDonorId !== null || array_key_exists('donor_id',$payload) || $role==='donor'){
            $fields[] = 'donor_id=?';
            $params[] = $newDonorId;
        }
        if ($newEventType === 'recipient' || array_key_exists('recipient_id',$payload) || $role==='recipient'){
            $fields[] = 'primary_recipient_id=?';
            $params[] = $newPrimaryRecipientId;
        }
        if ($newCreatedFor !== null || array_key_exists('created_for_user_id',$payload)){
            $fields[] = 'created_for_user_id=?';
            $params[] = $newCreatedFor;
        }
        $fields[] = 'updated_by=?';
        $params[] = $currentId;

        if (!$fields){ sendJson(['success'=>false,'error'=>'No updates provided'],400); }

        // Scheduling constraints disabled per user request
        $candidateStart = $newStart ?? $row['start_datetime'];
        $candidateTs = strtotime($candidateStart);
        $candidateDate = date('Y-m-d', $candidateTs);

        $params[] = $id;
        $db->query('UPDATE schedule_events SET '.implode(',', $fields).' WHERE id=?', $params);

        if ($newEventType === 'recipient'){
            $db->query('DELETE FROM schedule_event_recipients WHERE event_id=?', [$id]);
            $insertSql = 'INSERT INTO schedule_event_recipients (event_id, recipient_id, is_primary) VALUES (?,?,?)';
            foreach ($recipientIds as $rid){
                $db->query($insertSql, [ $id, $rid, $rid === $newPrimaryRecipientId ? 1 : 0 ]);
            }
        } else {
            $db->query('DELETE FROM schedule_event_recipients WHERE event_id=?', [$id]);
        }

        $row = $db->query('SELECT 
                e.id,
                e.title,
                e.event_type,
                e.start_datetime AS start,
                e.end_datetime AS end,
                e.primary_recipient_id,
                e.donor_id,
                e.location,
                e.notes,
                e.status,
                e.created_by,
                e.created_for_user_id,
                e.created_at,
                e.updated_at,
                e.updated_by,
                COALESCE(dp_d.organization_name, u_d.name) AS donor_display,
                dp_d.address AS donor_address,
                COALESCE(rp_r.organization_name, u_r.name) AS recipient_display,
                rp_r.address AS recipient_address,
                u_up.role AS editor_role
            FROM schedule_events e
            LEFT JOIN users u_d ON u_d.user_id = e.donor_id
            LEFT JOIN donor_profiles dp_d ON dp_d.user_id = u_d.user_id
            LEFT JOIN users u_r ON u_r.user_id = e.primary_recipient_id
            LEFT JOIN recipient_profiles rp_r ON rp_r.user_id = u_r.user_id
            LEFT JOIN users u_up ON u_up.user_id = e.updated_by
            WHERE e.id = ?', [$id])->fetch();
        $rowSet = $row ? [$row] : [];
        attachEventRecipients($db, $rowSet);
        $rowSet = finalizeEventRows($rowSet, $role, $currentId);
        $responseRow = $rowSet ? $rowSet[0] : null;
        sendJson(['success'=>true,'data'=>$responseRow]);
    }

    if ($method === 'POST' && $action === 'auto-decouple'){
        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0; if ($id<=0) sendJson(['success'=>false,'error'=>'id required'],400);
        $input = json_decode(file_get_contents('php://input'), true);
        $recipientId = isset($input['recipient_id']) ? (int)$input['recipient_id'] : 0;
        $newEventData = isset($input['new_event_data']) ? $input['new_event_data'] : [];
        if ($recipientId <= 0) sendJson(['success'=>false,'error'=>'recipient_id required'],400);
        
        $db->beginTransaction();
        try {
            // Get original event
            $originalEvent = $db->query('SELECT * FROM schedule_events WHERE id=?', [$id])->fetch();
            if (!$originalEvent) sendJson(['success'=>false,'error'=>'Event not found'],404);
            if (!canAccessEvent($originalEvent, $role, $currentId)) sendJson(['success'=>false,'error'=>'Forbidden'],403);
            if ($originalEvent['event_type'] !== 'recipient') sendJson(['success'=>false,'error'=>'Only recipient events can be auto-decoupled'],400);
            
            // Get current recipients
            $currentRecipients = $db->query('SELECT recipient_id, is_primary FROM schedule_event_recipients WHERE event_id=?', [$id])->fetchAll();
            if (count($currentRecipients) <= 1) sendJson(['success'=>false,'error'=>'Event has only one recipient'],400);
            
            // Validate recipient exists in this event
            $recipientExists = false;
            foreach ($currentRecipients as $rec) {
                if ($rec['recipient_id'] == $recipientId) {
                    $recipientExists = true;
                    break;
                }
            }
            if (!$recipientExists) sendJson(['success'=>false,'error'=>'Recipient not found in event'],400);
            
            // Create new event with updated time
            $newEventFields = [
                'title' => $newEventData['title'] ?? $originalEvent['title'],
                'event_type' => 'recipient',
                'status' => $newEventData['status'] ?? $originalEvent['status'],
                'start_datetime' => $newEventData['start'] ?? $originalEvent['start_datetime'],
                'end_datetime' => $newEventData['end'] ?? $originalEvent['end_datetime'],
                'location' => $newEventData['location'] ?? $originalEvent['location'],
                'notes' => $newEventData['notes'] ?? $originalEvent['notes'],
                'primary_recipient_id' => $recipientId,
                'donor_id' => $originalEvent['donor_id'],
                'created_by' => $currentId,
                'created_for_user_id' => null
            ];
            
            $placeholders = str_repeat('?,', count($newEventFields));
            $placeholders = rtrim($placeholders, ',');
            $db->query("INSERT INTO schedule_events (".implode(',', array_keys($newEventFields)).") VALUES ($placeholders)", array_values($newEventFields));
            $newEventId = (int)$db->lastInsertId();
            
            // Move the specific recipient to new event
            $db->query('INSERT INTO schedule_event_recipients (event_id, recipient_id, is_primary) VALUES (?,?,1)', [$newEventId, $recipientId]);
            
            // Remove recipient from original event
            $db->query('DELETE FROM schedule_event_recipients WHERE event_id=? AND recipient_id=?', [$id, $recipientId]);
            
            // Update primary recipient for original event if needed
            if ($originalEvent['primary_recipient_id'] == $recipientId) {
                $remainingRecipients = $db->query('SELECT recipient_id FROM schedule_event_recipients WHERE event_id=? LIMIT 1', [$id])->fetch();
                if ($remainingRecipients) {
                    $db->query('UPDATE schedule_events SET primary_recipient_id=? WHERE id=?', [$remainingRecipients['recipient_id'], $id]);
                }
            }
            
            $db->commit();
            sendJson(['success'=>true,'message'=>'Recipient auto-decoupled successfully']);
        } catch (Exception $e) {
            $db->rollback();
            throw $e;
        }
    }

    if ($method === 'GET' && $action === 'check-auto-couple'){
        // Find recipient events with same time that can be coupled
        $sql = "SELECT 
                e1.id as event1_id,
                e2.id as event2_id,
                e1.start_datetime,
                e1.end_datetime,
                e1.location,
                e1.title,
                e1.donor_id,
                GROUP_CONCAT(DISTINCT ser1.recipient_id) as recipients1,
                GROUP_CONCAT(DISTINCT ser2.recipient_id) as recipients2
            FROM schedule_events e1
            INNER JOIN schedule_event_recipients ser1 ON ser1.event_id = e1.id
            INNER JOIN schedule_events e2 ON e2.start_datetime = e1.start_datetime 
                AND e2.end_datetime = e1.end_datetime 
                AND e2.location = e1.location
                AND e2.id < e1.id  -- Avoid duplicates
            INNER JOIN schedule_event_recipients ser2 ON ser2.event_id = e2.id
            WHERE e1.event_type = 'recipient' 
                AND e2.event_type = 'recipient'
                AND e1.status = 'scheduled'
                AND e2.status = 'scheduled'
            GROUP BY e1.id, e2.id
            HAVING COUNT(DISTINCT ser1.recipient_id) > 0 AND COUNT(DISTINCT ser2.recipient_id) > 0";
        
        $potentialCouples = $db->query($sql)->fetchAll();
        $couplePairs = [];
        
        foreach ($potentialCouples as $couple) {
            // Check if user can access both events
            $event1 = ['id' => $couple['event1_id']];
            $event2 = ['id' => $couple['event2_id']];
            if (canAccessEvent($event1, $role, $currentId) && canAccessEvent($event2, $role, $currentId)) {
                $couplePairs[] = [
                    'event1_id' => $couple['event1_id'],
                    'event2_id' => $couple['event2_id'],
                    'recipients1' => explode(',', $couple['recipients1']),
                    'recipients2' => explode(',', $couple['recipients2'])
                ];
            }
        }
        
        sendJson(['success'=>true, 'data' => ['can_couple' => !empty($couplePairs), 'couple_pairs' => $couplePairs]]);
    }

    if ($method === 'POST' && $action === 'auto-couple'){
        $input = json_decode(file_get_contents('php://input'), true);
        $couplePairs = isset($input['couple_pairs']) ? $input['couple_pairs'] : [];
        if (!is_array($couplePairs) || empty($couplePairs)) sendJson(['success'=>false,'error'=>'couple_pairs required'],400);
        
        $db->beginTransaction();
        $coupledCount = 0;
        try {
            foreach ($couplePairs as $pair) {
                $event1Id = (int)$pair['event1_id'];
                $event2Id = (int)$pair['event2_id'];
                
                // Get both events
                $event1 = $db->query('SELECT * FROM schedule_events WHERE id=?', [$event1Id])->fetch();
                $event2 = $db->query('SELECT * FROM schedule_events WHERE id=?', [$event2Id])->fetch();
                
                if (!$event1 || !$event2) continue;
                if (!canAccessEvent($event1, $role, $currentId) || !canAccessEvent($event2, $role, $currentId)) continue;
                
                // Move all recipients from event2 to event1
                $recipients2 = $db->query('SELECT recipient_id FROM schedule_event_recipients WHERE event_id=?', [$event2Id])->fetchAll();
                foreach ($recipients2 as $rec) {
                    $db->query('INSERT INTO schedule_event_recipients (event_id, recipient_id, is_primary) VALUES (?,?,0)', [$event1Id, $rec['recipient_id']]);
                }
                
                // Delete event2
                $db->query('DELETE FROM schedule_events WHERE id=?', [$event2Id]);
                
                $coupledCount++;
            }
            
            $db->commit();
            sendJson(['success'=>true, 'message' => 'Events auto-coupled successfully', 'coupled_count' => $coupledCount]);
        } catch (Exception $e) {
            $db->rollback();
            throw $e;
        }
    }

    if ($method === 'POST' && $action === 'decouple'){
        $id = isset($_GET['id']) ? (int)$_GET['id'] : 0; if ($id<=0) sendJson(['success'=>false,'error'=>'id required'],400);
        $input = json_decode(file_get_contents('php://input'), true);
        $recipientIds = isset($input['recipient_ids']) ? $input['recipient_ids'] : [];
        if (!is_array($recipientIds) || empty($recipientIds)) sendJson(['success'=>false,'error'=>'recipient_ids required'],400);
        
        $db->beginTransaction();
        try {
            // Get original event
            $originalEvent = $db->query('SELECT * FROM schedule_events WHERE id=?', [$id])->fetch();
            if (!$originalEvent) sendJson(['success'=>false,'error'=>'Event not found'],404);
            if (!canAccessEvent($originalEvent, $role, $currentId)) sendJson(['success'=>false,'error'=>'Forbidden'],403);
            if ($originalEvent['event_type'] !== 'recipient') sendJson(['success'=>false,'error'=>'Only recipient events can be decoupled'],400);
            
            // Get current recipients
            $currentRecipients = $db->query('SELECT recipient_id, is_primary FROM schedule_event_recipients WHERE event_id=?', [$id])->fetchAll();
            if (count($currentRecipients) <= 1) sendJson(['success'=>false,'error'=>'Event has only one recipient'],400);
            
            // Validate that we're not removing all recipients
            $remainingRecipients = array_filter($currentRecipients, fn($r) => !in_array($r['recipient_id'], $recipientIds));
            if (empty($remainingRecipients)) sendJson(['success'=>false,'error'=>'Cannot decouple all recipients'],400);
            
            // Create new event with same details
            $newEventFields = [
                'title' => $originalEvent['title'],
                'event_type' => 'recipient',
                'status' => $originalEvent['status'],
                'start_datetime' => $originalEvent['start_datetime'],
                'end_datetime' => $originalEvent['end_datetime'],
                'location' => $originalEvent['location'],
                'notes' => $originalEvent['notes'],
                'primary_recipient_id' => null, // Will be set below
                'donor_id' => $originalEvent['donor_id'],
                'created_by' => $currentId,
                'created_for_user_id' => null
            ];
            
            $placeholders = str_repeat('?,', count($newEventFields));
            $placeholders = rtrim($placeholders, ',');
            $db->query("INSERT INTO schedule_events (".implode(',', array_keys($newEventFields)).") VALUES ($placeholders)", array_values($newEventFields));
            $newEventId = (int)$db->lastInsertId();
            
            // Determine primary recipient for new event (first selected recipient)
            $primaryRecipientId = null;
            foreach ($currentRecipients as $rec) {
                if (in_array($rec['recipient_id'], $recipientIds)) {
                    $primaryRecipientId = $rec['recipient_id'];
                    break;
                }
            }
            
            // Move selected recipients to new event
            $insertSql = 'INSERT INTO schedule_event_recipients (event_id, recipient_id, is_primary) VALUES (?,?,?)';
            foreach ($currentRecipients as $rec) {
                if (in_array($rec['recipient_id'], $recipientIds)) {
                    $isPrimary = $rec['recipient_id'] === $primaryRecipientId ? 1 : 0;
                    $db->query($insertSql, [$newEventId, $rec['recipient_id'], $isPrimary]);
                }
            }
            
            // Remove selected recipients from original event
            $placeholders = str_repeat('?,', count($recipientIds));
            $placeholders = rtrim($placeholders, ',');
            $db->query("DELETE FROM schedule_event_recipients WHERE event_id=? AND recipient_id IN ($placeholders)", array_merge([$id], $recipientIds));
            
            // Update primary recipient for original event if needed
            $originalPrimaryRemoved = false;
            foreach ($recipientIds as $rid) {
                if ($rid == $originalEvent['primary_recipient_id']) {
                    $originalPrimaryRemoved = true;
                    break;
                }
            }
            if ($originalPrimaryRemoved && !empty($remainingRecipients)) {
                $newPrimary = $remainingRecipients[0]['recipient_id'];
                $db->query('UPDATE schedule_events SET primary_recipient_id=? WHERE id=?', [$newPrimary, $id]);
            }
            
            $db->commit();
            sendJson(['success'=>true,'message'=>'Recipients decoupled successfully']);
        } catch (Exception $e) {
            $db->rollback();
            throw $e;
        }
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
