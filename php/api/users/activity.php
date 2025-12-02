<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Notification.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];

try {
    if ($method !== 'GET') {
        sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
    }
    requireAuth();

    $db = Database::getInstance();
    $userId = (int)(currentUserId() ?? 0);
    if ($userId <= 0) {
        sendJson(['success' => false, 'error' => 'Unauthorized'], 401);
    }

    // Base user info: last_login
    $user = $db->query('SELECT user_id, last_login FROM users WHERE user_id = ? LIMIT 1', [$userId])->fetch();
    $lastLogin = $user && isset($user['last_login']) ? $user['last_login'] : null;

    // Unread messages count, last 5 inbound previews, and last 5 outbound (my actions)
    // messages table: id, sender_id, receiver_id, content, created_at, receiver_read_at
    // Count unread inbound messages
    $rowUnread = null;
    try {
        $rowUnread = $db->query(
            'SELECT COUNT(*) AS c FROM messages WHERE receiver_id = ? AND (receiver_read_at IS NULL OR receiver_read_at = "0000-00-00 00:00:00")',
            [$userId]
        )->fetch();
    } catch (Exception $e) {
        $rowUnread = ['c' => 0];
    }
    $unreadMessages = (int)($rowUnread && isset($rowUnread['c']) ? $rowUnread['c'] : 0);

    // Last 5 messages involving the user (received by me)
    $recentMessages = [];
    try {
        $rows = $db->query(
            'SELECT id, sender_id, receiver_id, content AS body, created_at
             FROM messages
             WHERE receiver_id = ?
             ORDER BY id DESC
             LIMIT 5',
            [$userId]
        )->fetchAll();
        $recentMessages = $rows ?: [];
    } catch (Exception $e) {
        $recentMessages = [];
    }

    // Last 5 actions performed by the user (messages sent by me + donor-created donations)
    $recentActions = [];
    try {
        $rows = $db->query(
            'SELECT id, sender_id, receiver_id, content AS body, created_at
             FROM messages
             WHERE sender_id = ?
             ORDER BY id DESC
             LIMIT 5',
            [$userId]
        )->fetchAll();
        $recentActions = array_map(function($r){ $r['type'] = 'message'; return $r; }, ($rows ?: []));
    } catch (Exception $e) {
        $recentActions = [];
    }

    // If current user is a donor, include their last 5 created donations as synthetic action items
    try {
        $role = (string)(currentUserRole() ?? '');
        if (strtolower($role) === 'donor') {
            $rows = $db->query(
                'SELECT d.donation_id AS id, COALESCE(di.product_name, CONCAT("Batch (", COUNT(di2.donation_item_id), " items)")) AS name,
                        CONCAT(c.primary_name, COALESCE(CONCAT(" - ", c.secondary_name), "")) AS type, d.created_at, d.batch_id,
                        CASE WHEN d.batch_id IS NULL THEN 0 ELSE 1 END AS is_group
                 FROM donations d
                 LEFT JOIN donation_items di ON di.donation_id = d.donation_id
                 LEFT JOIN categories c ON c.category_id = di.category_id
                 LEFT JOIN donation_items di2 ON di2.donation_id = d.donation_id
                 WHERE d.deleted_at IS NULL AND d.donor_id = ?
                 GROUP BY d.donation_id, di.product_name, CONCAT(c.primary_name, COALESCE(CONCAT(" - ", c.secondary_name), "")), d.created_at, d.batch_id
                 ORDER BY d.created_at DESC
                 LIMIT 5',
                [$userId]
            )->fetchAll();
            foreach ($rows ?: [] as $r) {
                $label = $r['is_group'] ? ($r['name'] ?: 'Batch') : ($r['name'] ?: 'Donation');
                $recentActions[] = [
                    'id' => (int)$r['id'],
                    'sender_id' => $userId,
                    'receiver_id' => null,
                    'body' => 'Created donation: ' . $label,
                    'created_at' => $r['created_at'],
                    'type' => 'donation',
                ];
            }
            // Keep only 5 most recent across both sources
            usort($recentActions, function($a,$b){ return strcmp($b['created_at'] ?? '', $a['created_at'] ?? ''); });
            $recentActions = array_slice($recentActions, 0, 5);
        }
    } catch (Exception $e) { /* ignore */ }

    // Current session IP address (normalize)
    $ip = null;
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        // May contain a list; take the first public-looking IP
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $ip = trim($parts[0]);
    }
    if (!$ip) { $ip = $_SERVER['REMOTE_ADDR'] ?? null; }
    if ($ip === '::1') { $ip = '127.0.0.1'; }

    sendJson(['success' => true, 'data' => [
        'last_login' => $lastLogin,
        // Keep notifications available for future use, but UI will prefer recent_actions for "my activity"
        'recent_notifications' => [],
        'unread_messages' => $unreadMessages,
        'recent_messages' => $recentMessages,
        'recent_actions' => $recentActions,
        'ip' => $ip,
    ]]);
} catch (Exception $e) {
    error_log('User activity API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Server error'], 500);
}
