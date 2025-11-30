<?php
require_once __DIR__ . '/../../includes/config.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$override = $_GET['_method'] ?? $_POST['_method'] ?? ($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '');
if ($override) {
    $ov = strtoupper(trim((string)$override));
    if (in_array($ov, ['GET','POST','PUT','PATCH','DELETE'], true)) {
        $method = $ov;
    }
}
$payload = getJsonInput();
$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';

if (in_array(strtoupper($method), ['POST','PUT','PATCH','DELETE'], true)) {
    requireCsrfToken();
}

function db() { return Database::getInstance(); }

// Ensure session is available for tracking last-read markers
if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); }

// Store and read last-read message id per other user (conversation)
function getLastReadId($otherUserId) {
    if (!isset($_SESSION['messages_last_read']) || !is_array($_SESSION['messages_last_read'])) {
        $_SESSION['messages_last_read'] = [];
    }
    $oid = (int)$otherUserId;
    return isset($_SESSION['messages_last_read'][$oid]) ? (int)$_SESSION['messages_last_read'][$oid] : 0;
}
function setLastReadId($otherUserId, $lastId) {
    if (!isset($_SESSION['messages_last_read']) || !is_array($_SESSION['messages_last_read'])) {
        $_SESSION['messages_last_read'] = [];
    }
    $_SESSION['messages_last_read'][(int)$otherUserId] = max(0, (int)$lastId);
}

function getUserDisplay($userId) {
    // Base user record (no org_name column here)
    $row = db()->query('SELECT user_id, name, email, role FROM users WHERE user_id = ? LIMIT 1', [$userId])->fetch();
    if (!$row) return ['user_id'=>$userId, 'display'=>'User #'.$userId, 'role'=>null];
    $role = isset($row['role']) ? (string)$row['role'] : '';
    $org  = '';
    // Fetch organization from the respective profile table
    try {
        if ($role === 'donor') {
            $p = db()->query('SELECT organization_name FROM donor_profiles WHERE user_id = ? LIMIT 1', [$userId])->fetch();
            $org = $p && !empty($p['organization_name']) ? trim((string)$p['organization_name']) : '';
        } elseif ($role === 'recipient') {
            $p = db()->query('SELECT organization_name FROM recipient_profiles WHERE user_id = ? LIMIT 1', [$userId])->fetch();
            $org = $p && !empty($p['organization_name']) ? trim((string)$p['organization_name']) : '';
        } elseif ($role === 'admin') {
            $p = db()->query('SELECT organization_name FROM admin_profiles WHERE user_id = ? LIMIT 1', [$userId])->fetch();
            $org = $p && !empty($p['organization_name']) ? trim((string)$p['organization_name']) : '';
        }
    } catch (Exception $e) {
        // Ignore profile lookup errors; fallback below
        $org = '';
    }
    // Prefer organization name when available; else fallback to name/email
    if ($org !== '') {
        $label = $org;
    } else {
        $label = ($row['name'] ?: ($row['email'] ?: ('User #'.$userId)));
    }
    return ['user_id'=>(int)$row['user_id'], 'display'=>$label, 'role'=>$role];
}

try {
    switch ($method) {
        case 'GET':
            if ($action === 'list_conversations') {
                requireAuth();
                $userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : (int)(currentUserId() ?? 0);
                if ($userId <= 0) sendJson(['success'=>false,'error'=>'user_id is required'], 400);

                $sql = "SELECT other_id FROM (
                          SELECT receiver_id AS other_id FROM messages WHERE sender_id = ?
                          UNION
                          SELECT sender_id AS other_id   FROM messages WHERE receiver_id = ?
                        ) t ORDER BY other_id ASC";
                $rows = db()->query($sql, [$userId, $userId])->fetchAll();
                $others = array_map(fn($r)=>(int)$r['other_id'], $rows);

                $role = (string)(currentUserRole() ?? '');
                $adminRows = db()->query("SELECT user_id FROM users WHERE role='admin' ORDER BY user_id ASC")->fetchAll();
                $adminIds = array_map(fn($r)=>(int)$r['user_id'], $adminRows);
                if ($role !== 'admin') {
                    $aid = $adminIds ? $adminIds[0] : 0;
                    if ($aid > 0 && !in_array($aid, $others, true)) $others[] = $aid;
                    if ($aid > 0) {
                        $others = array_values(array_unique(array_map('intval', $others)));
                        $filtered = [];
                        $added = false;
                        foreach ($others as $oid) {
                            if (in_array($oid, $adminIds, true)) {
                                if (!$added) { $filtered[] = $aid; $added = true; }
                            } else {
                                $filtered[] = $oid;
                            }
                        }
                        if (!$added) { $filtered[] = $aid; }
                        $others = array_values(array_unique($filtered));
                    }
                }

                // Build presentation objects (synthetic conversation per other user)
                $items = [];
                foreach ($others as $oid) {
                    $disp = getUserDisplay($oid);
                    $isUnifiedAdmin = ($role !== 'admin') && $adminIds && in_array($oid, [$adminIds[0]], true);
                    if ($isUnifiedAdmin) {
                        $ph = implode(',', array_fill(0, count($adminIds), '?'));
                        $paramsLast = array_merge($adminIds, [$userId], [$userId], $adminIds);
                        $last = db()->query(
                            'SELECT id, sender_id, content, created_at FROM messages
                             WHERE (sender_id IN ('.$ph.') AND receiver_id=?) OR (sender_id=? AND receiver_id IN ('.$ph.'))
                             ORDER BY id DESC LIMIT 1',
                             $paramsLast
                        )->fetch();
                        $lastMsg = $last ? json_encode([
                            'id'=>(int)$last['id'],
                            'sender_id'=>(int)$last['sender_id'],
                            'body'=>$last['content'],
                            'created_at'=>$last['created_at']
                        ]) : null;
                        $paramsUnread = array_merge($adminIds, [$userId]);
                        $row = db()->query(
                            'SELECT COUNT(*) AS c FROM messages WHERE sender_id IN ('.$ph.') AND receiver_id=? AND (receiver_read_at IS NULL OR receiver_read_at = "0000-00-00 00:00:00")',
                            $paramsUnread
                        )->fetch();
                        $unread = (int)($row ? $row['c'] : 0);
                        $items[] = [
                            'id' => $oid,
                            'title' => $disp['display'],
                            'display_title' => $disp['display'],
                            'other_role' => 'admin',
                            'last_message' => $lastMsg,
                            'unread_count' => $unread,
                        ];
                    } else {
                        $last = db()->query(
                            'SELECT id, sender_id, content, created_at FROM messages
                             WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
                             ORDER BY id DESC LIMIT 1',
                             [$userId,$oid,$oid,$userId]
                        )->fetch();
                        $lastMsg = $last ? json_encode([
                            'id'=>(int)$last['id'],
                            'sender_id'=>(int)$last['sender_id'],
                            'body'=>$last['content'],
                            'created_at'=>$last['created_at']
                        ]) : null;
                        $row = db()->query(
                            'SELECT COUNT(*) AS c FROM messages WHERE sender_id=? AND receiver_id=? AND (receiver_read_at IS NULL OR receiver_read_at = "0000-00-00 00:00:00")',
                            [$oid, $userId]
                        )->fetch();
                        $unread = (int)($row ? $row['c'] : 0);
                        $items[] = [
                            'id' => $oid,
                            'title' => $disp['display'],
                            'display_title' => $disp['display'],
                            'other_role' => $disp['role'],
                            'last_message' => $lastMsg,
                            'unread_count' => $unread,
                        ];
                    }
                }
                // Sort by latest activity desc
                usort($items, function($a,$b){
                    $la = $a['last_message'] ? json_decode($a['last_message'], true)['id'] ?? 0 : 0;
                    $lb = $b['last_message'] ? json_decode($b['last_message'], true)['id'] ?? 0 : 0;
                    return $lb <=> $la;
                });
                sendJson(['success'=>true,'data'=>['items'=>$items]]);
            }

            if ($action === 'list_messages') {
                requireAuth();
                $otherId = isset($_GET['conversation_id']) ? (int)$_GET['conversation_id'] : 0; // interpret as other user id
                if ($otherId <= 0) sendJson(['success'=>false,'error'=>'conversation_id is required'], 400);
                $me = (int)(currentUserId() ?? 0);
                $limit = isset($_GET['limit']) ? max(1,(int)$_GET['limit']) : 100;
                $afterId = isset($_GET['after_id']) ? (int)$_GET['after_id'] : 0;
                $role = (string)(currentUserRole() ?? '');
                $isAdminOther = (function($oid){ $r = db()->query('SELECT role FROM users WHERE user_id=? LIMIT 1', [$oid])->fetch(); return strtolower((string)($r['role'] ?? '')) === 'admin'; })($otherId);
                if ($role !== 'admin' && $isAdminOther) {
                    $adminRows = db()->query("SELECT user_id FROM users WHERE role='admin' ORDER BY user_id ASC")->fetchAll();
                    $adminIds = array_map(fn($r)=>(int)$r['user_id'], $adminRows);
                    if (!$adminIds) { $adminIds = [$otherId]; }
                    $ph = implode(',', array_fill(0, count($adminIds), '?'));
                    $sql = '(
                              SELECT m.id, m.sender_id, u.name AS sender_name, m.content AS body, m.created_at
                              FROM messages m
                              JOIN users u ON u.user_id = m.sender_id
                              WHERE m.sender_id IN ('.$ph.') AND m.receiver_id = ?
                                AND (? = 0 OR m.id > ?)
                           )
                           UNION ALL
                           (
                              SELECT MIN(m.id) AS id, m.sender_id, u.name AS sender_name, m.content AS body, MIN(m.created_at) AS created_at
                              FROM messages m
                              JOIN users u ON u.user_id = m.sender_id
                              WHERE m.sender_id = ? AND m.receiver_id IN ('.$ph.')
                              GROUP BY m.sender_id, m.content, DATE_FORMAT(m.created_at, "%Y-%m-%d %H:%i:%s")
                              HAVING (? = 0 OR MIN(m.id) > ?)
                           )
                           ORDER BY created_at ASC, id ASC
                           LIMIT ?';
                    $params = array_merge(
                        $adminIds, [ $me, $afterId, $afterId ],
                        [ $me ], $adminIds, [ $afterId, $afterId, $limit ]
                    );
                    $rows = db()->query($sql, $params)->fetchAll();
                } else {
                    if (strtolower($role) === 'admin' && !$isAdminOther) {
                        $adminRows = db()->query("SELECT user_id FROM users WHERE role='admin' ORDER BY user_id ASC")->fetchAll();
                        $adminIds = array_map(fn($r)=>(int)$r['user_id'], $adminRows);
                        if (!$adminIds) { $adminIds = [$me]; }
                        $ph = implode(',', array_fill(0, count($adminIds), '?'));
                        $sql = '(
                                  SELECT MIN(m.id) AS id, m.sender_id, u.name AS sender_name, m.content AS body, MIN(m.created_at) AS created_at
                                  FROM messages m
                                  JOIN users u ON u.user_id = m.sender_id
                                  WHERE m.sender_id = ? AND m.receiver_id IN ('.$ph.')
                                  GROUP BY m.sender_id, m.content, DATE_FORMAT(m.created_at, "%Y-%m-%d %H:%i:%s")
                                  HAVING (? = 0 OR MIN(m.id) > ?)
                               )
                               UNION ALL
                               (
                                  SELECT m.id, m.sender_id, u.name AS sender_name, m.content AS body, m.created_at
                                  FROM messages m
                                  JOIN users u ON u.user_id = m.sender_id
                                  WHERE m.sender_id IN ('.$ph.') AND m.receiver_id = ?
                                    AND (? = 0 OR m.id > ?)
                               )
                               ORDER BY created_at ASC, id ASC
                               LIMIT ?';
                        $params = array_merge(
                            [ $otherId ], $adminIds, [ $afterId, $afterId ],
                            $adminIds, [ $otherId, $afterId, $afterId, $limit ]
                        );
                        $rows = db()->query($sql, $params)->fetchAll();
                    } else {
                        $rows = db()->query(
                            'SELECT m.id, m.sender_id, u.name AS sender_name, m.content AS body, m.created_at
                             FROM messages m
                             JOIN users u ON u.user_id = m.sender_id
                             WHERE ((m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?))
                               AND (? = 0 OR m.id > ?)
                             ORDER BY m.id ASC
                             LIMIT ?',
                            [$me,$otherId,$otherId,$me,$afterId,$afterId,$limit]
                        )->fetchAll();
                    }
                }
                $rows = array_map(function($r){ $r['id']=(int)$r['id']; $r['sender_id']=(int)$r['sender_id']; return $r; }, $rows);
                sendJson(['success'=>true,'data'=>['items'=>$rows]]);
            }

            sendJson(['success'=>false,'error'=>'Invalid action'], 400);

        case 'POST':
            if ($action === 'get_or_create_direct') {
                requireRole(['admin','recipient','donor']);
                $currentId = (int)(currentUserId() ?? 0);
                if ($currentId <= 0) { sendJson(['success'=>false,'error'=>'Authentication required'], 401); }
                $otherUserId = isset($payload['other_user_id']) ? (int)$payload['other_user_id'] : (isset($_POST['other_user_id']) ? (int)$_POST['other_user_id'] : (isset($_GET['other_user_id']) ? (int)$_GET['other_user_id'] : 0));
                if ($otherUserId <= 0) {
                    $role = (string)(currentUserRole() ?? '');
                    if (strtolower($role) !== 'admin') {
                        // Default to first admin id to support initial open for donors/recipients
                        $adminRows = db()->query("SELECT user_id FROM users WHERE role='admin' ORDER BY user_id ASC")->fetchAll();
                        $otherUserId = $adminRows ? (int)$adminRows[0]['user_id'] : 0;
                    }
                    if ($otherUserId <= 0) {
                        sendJson(['success'=>false,'error'=>'other_user_id is required'], 400);
                    }
                }

                $disp = getUserDisplay($otherUserId);
                $conv = [
                    'id' => $otherUserId, // conversation id == other user id
                    'title' => $disp['display'],
                    'display_title' => $disp['display']
                ];
                sendJson(['success'=>true,'data'=>['conversation'=>$conv]], 201);
            }

            if ($action === 'send_message') {
                requireAuth();
                $me = (int)(currentUserId() ?? 0);
                $otherId = isset($payload['conversation_id']) ? (int)$payload['conversation_id'] : (isset($_POST['conversation_id']) ? (int)$_POST['conversation_id'] : (isset($_GET['conversation_id']) ? (int)$_GET['conversation_id'] : 0));
                $bodyRaw = isset($payload['body']) ? $payload['body'] : (isset($_POST['body']) ? $_POST['body'] : '');
                $body = trim((string)$bodyRaw);
                if ($otherId <= 0 || $body === '') sendJson(['success'=>false,'error'=>'conversation_id and body are required'], 400);
                $dedupe = db()->query(
                    'SELECT id, sender_id, content AS body, created_at
                     FROM messages
                     WHERE sender_id=? AND receiver_id=? AND content=?
                       AND created_at >= (NOW() - INTERVAL 2 MINUTE)
                     ORDER BY id DESC LIMIT 1',
                    [$me, $otherId, $body]
                )->fetch();
                if ($dedupe) {
                    $row = $dedupe;
                    $id = (int)$dedupe['id'];
                } else {
                    db()->query('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)', [$me, $otherId, $body]);
                    $id = (int)db()->lastInsertId();
                    $row = db()->query('SELECT id, sender_id, content AS body, created_at FROM messages WHERE id=?', [$id])->fetch();
                }
                $row['id'] = (int)$row['id'];
                $row['sender_id'] = (int)$row['sender_id'];
                $role = (string)(currentUserRole() ?? '');
                if (in_array(strtolower($role), ['donor','recipient'], true)) {
                    $r = db()->query('SELECT role FROM users WHERE user_id = ? LIMIT 1', [$otherId])->fetch();
                    $otherRole = strtolower((string)($r['role'] ?? ''));
                    if ($otherRole === 'admin') {
                        $admins = db()->query("SELECT user_id FROM users WHERE role='admin' AND status='approved'")->fetchAll();
                        foreach ($admins as $a) {
                            $aid = (int)$a['user_id'];
                            if ($aid > 0 && $aid !== $otherId) {
                                $exists = db()->query(
                                    'SELECT id FROM messages
                                     WHERE sender_id=? AND receiver_id=? AND content=?
                                       AND created_at >= (NOW() - INTERVAL 2 MINUTE)
                                     ORDER BY id DESC LIMIT 1',
                                    [$me, $aid, $body]
                                )->fetch();
                                if (!$exists) {
                                    db()->query('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)', [$me, $aid, $body]);
                                }
                            }
                        }
                    }
                }
                sendJson(['success'=>true,'data'=>['message'=>$row]], 201);
            }

            sendJson(['success'=>false,'error'=>'Invalid action'], 400);

        case 'PATCH':
            if ($action === 'mark_read') {
                requireAuth();
                $me = (int)(currentUserId() ?? 0);
                $otherId = isset($_GET['conversation_id']) ? (int)$_GET['conversation_id'] : (isset($_POST['conversation_id']) ? (int)$_POST['conversation_id'] : 0);
                if ($otherId <= 0) sendJson(['success'=>false,'error'=>'conversation_id is required'], 400);
                $role = (string)(currentUserRole() ?? '');
                $isAdminOther = (function($oid){ $r = db()->query('SELECT role FROM users WHERE user_id=? LIMIT 1', [$oid])->fetch(); return strtolower((string)($r['role'] ?? '')) === 'admin'; })($otherId);
                if ($role !== 'admin' && $isAdminOther) {
                    $adminRows = db()->query("SELECT user_id FROM users WHERE role='admin' ORDER BY user_id ASC")->fetchAll();
                    $adminIds = array_map(fn($r)=>(int)$r['user_id'], $adminRows);
                    if (!$adminIds) { $adminIds = [$otherId]; }
                    $ph = implode(',', array_fill(0, count($adminIds), '?'));
                    db()->query('UPDATE messages SET receiver_read_at = NOW() WHERE sender_id IN ('.$ph.') AND receiver_id=? AND (receiver_read_at IS NULL OR receiver_read_at = "0000-00-00 00:00:00")', array_merge($adminIds, [$me]));
                    $rowMax = db()->query('SELECT MAX(id) AS max_id FROM messages WHERE ((sender_id IN ('.$ph.') AND receiver_id=?) OR (sender_id=? AND receiver_id IN ('.$ph.')))', array_merge($adminIds, [$me], [$me], $adminIds))->fetch();
                    $maxId = (int)($rowMax && $rowMax['max_id'] ? $rowMax['max_id'] : 0);
                    $rowUnread = db()->query('SELECT COUNT(*) AS c FROM messages WHERE sender_id IN ('.$ph.') AND receiver_id=? AND (receiver_read_at IS NULL OR receiver_read_at = "0000-00-00 00:00:00")', array_merge($adminIds, [$me]))->fetch();
                    $remaining = (int)($rowUnread ? $rowUnread['c'] : 0);
                } else {
                    db()->query(
                        'UPDATE messages SET receiver_read_at = NOW() WHERE sender_id=? AND receiver_id=? AND (receiver_read_at IS NULL OR receiver_read_at = "0000-00-00 00:00:00")',
                        [$otherId, $me]
                    );
                    $rowMax = db()->query(
                        'SELECT MAX(id) AS max_id FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)',
                        [$me, $otherId, $otherId, $me]
                    )->fetch();
                    $maxId = (int)($rowMax && $rowMax['max_id'] ? $rowMax['max_id'] : 0);
                    $rowUnread = db()->query(
                        'SELECT COUNT(*) AS c FROM messages WHERE sender_id=? AND receiver_id=? AND (receiver_read_at IS NULL OR receiver_read_at = "0000-00-00 00:00:00")',
                        [$otherId, $me]
                    )->fetch();
                    $remaining = (int)($rowUnread ? $rowUnread['c'] : 0);
                }
                sendJson(['success'=>true,'message'=>'ok','data'=>['last_read_id'=>$maxId,'remaining_unread'=>$remaining]]);
            }
            sendJson(['success'=>false,'error'=>'Invalid action'], 400);

        default:
            sendJson(['success'=>false,'error'=>'Method not allowed'], 405);
    }
} catch (Exception $e) {
    error_log('Messages API error: ' . $e->getMessage());
    $role = (string)(currentUserRole() ?? '');
    $payload = ['success'=>false,'error'=>'Server error'];
    if ($role === 'admin') { $payload['detail'] = $e->getMessage(); }
    sendJson($payload, 500);
}
