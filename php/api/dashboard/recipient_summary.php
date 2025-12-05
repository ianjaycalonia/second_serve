<?php
// php/api/dashboard/recipient_summary.php
// Returns aggregated figures for the recipient dashboard scoped to the current recipient

require_once __DIR__ . '/../../includes/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');

try {
    requireRole('recipient');

    $db = Database::getInstance();
    $recipientId = (int)(currentUserId() ?? 0);
    if ($recipientId <= 0) {
        sendJson(['success' => false, 'error' => 'Unauthorized'], 401);
    }

    // Deliveries received (completed pickups)
    $row = $db->query(
        "SELECT COUNT(*) AS c
           FROM allocations
          WHERE recipient_id = ?
            AND status IN ('Completed','Picked Up')",
        [$recipientId]
    )->fetch();
    $receivedCount = (int)($row['c'] ?? 0);

    // Upcoming deliveries (scheduled in the future or acknowledged/notified awaiting schedule)
    $row = $db->query(
        "SELECT COUNT(*) AS c
           FROM allocations
          WHERE recipient_id = ?
            AND status IN ('Pending','Notified','Acknowledged','Updated')
            AND (
                (scheduled_pickup_at IS NOT NULL AND scheduled_pickup_at >= NOW())
                OR status IN ('Notified','Acknowledged')
            )",
        [$recipientId]
    )->fetch();
    $upcomingCount = (int)($row['c'] ?? 0);

    // Pending deliveries (awaiting confirmation, no scheduled pickup yet)
    $row = $db->query(
        "SELECT COUNT(*) AS c
           FROM allocations
          WHERE recipient_id = ?
            AND status IN ('Pending','Updated')",
        [$recipientId]
    )->fetch();
    $pendingCount = (int)($row['c'] ?? 0);

    // Missed deliveries (cancelled allocations in recent quarter)
    $row = $db->query(
        "SELECT COUNT(*) AS c
           FROM allocations
          WHERE recipient_id = ?
            AND status = 'Cancelled'
            AND (cancelled_at IS NULL OR cancelled_at >= DATE_SUB(NOW(), INTERVAL 90 DAY))",
        [$recipientId]
    )->fetch();
    $missedCount = (int)($row['c'] ?? 0);

    // Weekly trend: completed or picked up allocations in last 7 days
    $trendRows = $db->query(
        "SELECT DATE(COALESCE(delivered_at, picked_up_at, scheduled_pickup_at, created_at)) AS day,
                COUNT(*) AS cnt
           FROM allocations
          WHERE recipient_id = ?
            AND status IN ('Completed','Picked Up')
            AND COALESCE(delivered_at, picked_up_at, scheduled_pickup_at, created_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
          GROUP BY day
          ORDER BY day ASC",
        [$recipientId]
    )->fetchAll();

    $trendMap = [];
    foreach ($trendRows as $row) {
        if (!empty($row['day'])) {
            $trendMap[$row['day']] = (int)$row['cnt'];
        }
    }

    $labels = [];
    $data = [];
    for ($i = 6; $i >= 0; $i--) {
        $date = new DateTime('today');
        $date->setTime(0, 0, 0);
        if ($i > 0) {
            $date->modify('-' . $i . ' day');
        }
        $key = $date->format('Y-m-d');
        $labels[] = $date->format('D');
        $data[] = $trendMap[$key] ?? 0;
    }

    sendJson([
        'success' => true,
        'data' => [
            'totals' => [
                'received' => $receivedCount,
                'upcoming' => $upcomingCount,
                'pending' => $pendingCount,
                'missed' => $missedCount,
            ],
            'trend' => [
                'labels' => $labels,
                'data' => $data,
            ],
        ],
    ]);
} catch (Exception $e) {
    error_log('Recipient dashboard summary error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Server error'], 500);
}
