<?php
require_once __DIR__ . '/../includes/config.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$payload = getJsonInput();
$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';

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

                // Distinct other users who have any messages with this user
                $sql = "SELECT other_id FROM (
                          SELECT receiver_id AS other_id FROM messages WHERE sender_id = ?
                          UNION
                          SELECT sender_id AS other_id   FROM messages WHERE receiver_id = ?
                        ) t ORDER BY other_id ASC";
                $rows = db()->query($sql, [$userId, $userId])->fetchAll();
                $others = array_map(fn($r)=>(int)$r['other_id'], $rows);

                // For non-admin, make sure at least one admin appears (food bank chat)
                $role = (string)(currentUserRole() ?? '');
                if ($role !== 'admin') {
                    $admin = db()->query("SELECT user_id FROM users WHERE role='admin' ORDER BY user_id ASC LIMIT 1")->fetch();
                    if ($admin) {
                        $aid = (int)$admin['user_id'];
                        if (!in_array($aid, $others, true)) $others[] = $aid;
                    }
                }

                // Build presentation objects (synthetic conversation per other user)
                $items = [];
                foreach ($others as $oid) {
                    $disp = getUserDisplay($oid);
                    // Last message preview
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

                    // Unread count: messages from other -> me with id greater than our last-read marker
                    $lastReadId = getLastReadId($oid);
                    $unread = 0;
                    if ($lastReadId >= 0) {
                        $row = db()->query(
                            'SELECT COUNT(*) AS c FROM messages WHERE sender_id=? AND receiver_id=? AND id > ?',
                            [$oid, $userId, $lastReadId]
                        )->fetch();
                        $unread = (int)($row ? $row['c'] : 0);
                    }
                    $items[] = [
                        // Synthetic conversation id: use other user id (interpreted by frontend code as conversation_id)
                        'id' => $oid,
                        'title' => $disp['display'],
                        'display_title' => $disp['display'],
                        'other_role' => $disp['role'],
                        'last_message' => $lastMsg,
                        'unread_count' => $unread,
                    ];
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
                $sql = 'SELECT id, sender_id, content AS body, created_at
                        FROM messages
                        WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
                          AND (? = 0 OR id > ?)
                        ORDER BY id ASC
                        LIMIT ?';
                $rows = db()->query($sql, [$me,$otherId,$otherId,$me,$afterId,$afterId,$limit])->fetchAll();
                // Normalize ints
                $rows = array_map(function($r){ $r['id']=(int)$r['id']; $r['sender_id']=(int)$r['sender_id']; return $r; }, $rows);
                sendJson(['success'=>true,'data'=>['items'=>$rows]]);
            }

            sendJson(['success'=>false,'error'=>'Invalid action'], 400);

        case 'POST':
            if ($action === 'get_or_create_direct') {
                requireAuth();
                $me = (int)(currentUserId() ?? 0);
                $otherUserId = (int)($payload['other_user_id'] ?? 0);
                $role = (string)(currentUserRole() ?? '');
                if ($otherUserId <= 0 && $role !== 'admin') {
                    $admin = db()->query("SELECT user_id FROM users WHERE role='admin' ORDER BY user_id ASC LIMIT 1")->fetch();
                    if (!$admin) sendJson(['success'=>false,'error'=>'Admin user not found'], 500);
                    $otherUserId = (int)$admin['user_id'];
                }
                if ($otherUserId <= 0) sendJson(['success'=>false,'error'=>'other_user_id is required'], 400);

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
                $otherId = (int)($payload['conversation_id'] ?? 0); // interpret as other user id
                $body = trim((string)($payload['body'] ?? ''));
                if ($otherId <= 0 || $body === '') sendJson(['success'=>false,'error'=>'conversation_id and body are required'], 400);
                db()->query('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)', [$me, $otherId, $body]);
                $id = (int)db()->lastInsertId();
                $row = db()->query('SELECT id, sender_id, content AS body, created_at FROM messages WHERE id=?', [$id])->fetch();
                $row['id'] = (int)$row['id'];
                $row['sender_id'] = (int)$row['sender_id'];
                sendJson(['success'=>true,'data'=>['message'=>$row]], 201);
            }

            sendJson(['success'=>false,'error'=>'Invalid action'], 400);

        case 'PATCH':
            if ($action === 'mark_read') {
                requireAuth();
                $me = (int)(currentUserId() ?? 0);
                $otherId = isset($_GET['conversation_id']) ? (int)$_GET['conversation_id'] : 0;
                if ($otherId <= 0) sendJson(['success'=>false,'error'=>'conversation_id is required'], 400);
                // Set last-read to the latest message id in this conversation (both directions)
                $row = db()->query(
                    'SELECT MAX(id) AS max_id FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)',
                    [$me, $otherId, $otherId, $me]
                )->fetch();
                $maxId = (int)($row && $row['max_id'] ? $row['max_id'] : 0);
                setLastReadId($otherId, $maxId);
                sendJson(['success'=>true,'message'=>'ok','data'=>['last_read_id'=>$maxId]]);
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
