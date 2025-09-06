<?php
// php/api/dashboard/summary.php
// Returns aggregated figures for the admin dashboard

require_once __DIR__ . '/../../includes/config.php';

// CORS preflight handling (match pattern used in other APIs)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    http_response_code(204);
    exit;
}

setCorsHeaders();
header('Content-Type: application/json');

try {
    // Authenticate and require admin
    requireRole('admin');

    $db = Database::getInstance();

    // Total meals donated (sum of quantities of completed/picked up donations)
    $row = $db->query(
        "SELECT COALESCE(SUM(quantity), 0) AS total_meals FROM donations WHERE status IN ('Picked Up','Completed') AND deleted_at IS NULL"
    )->fetch();
    $totalMeals = (int)($row['total_meals'] ?? 0);

    // Total successful donations by batches (count DISTINCT completed batches)
    $row = $db->query(
        "SELECT COUNT(DISTINCT batch_id) AS c
           FROM donations
          WHERE deleted_at IS NULL
            AND batch_id IS NOT NULL
            AND status = 'Completed'"
    )->fetch();
    $completedBatches = (int)($row['c'] ?? 0);

    // Upcoming pickups by batches: count each non-null batch_id once and each single (NULL batch_id) once
    $row = $db->query(
        "SELECT 
            (
              SELECT COUNT(DISTINCT batch_id)
              FROM donations
              WHERE status = 'Pending' AND deleted_at IS NULL AND batch_id IS NOT NULL
            )
            +
            (
              SELECT COUNT(*)
              FROM donations
              WHERE status = 'Pending' AND deleted_at IS NULL AND batch_id IS NULL
            ) AS upcoming"
    )->fetch();
    $upcomingPickups = (int)($row['upcoming'] ?? 0);

    // Active donors and recipients (approved users)
    $row = $db->query("SELECT COUNT(*) AS c FROM users WHERE role = 'donor' AND status = 'approved'")->fetch();
    $activeDonors = (int)($row['c'] ?? 0);

    $row = $db->query("SELECT COUNT(*) AS c FROM users WHERE role = 'recipient' AND status = 'approved'")->fetch();
    $activeRecipients = (int)($row['c'] ?? 0);

    // Weekly trend (last 7 days) counted by batches: per day, count DISTINCT batch_id for batched items + COUNT(*) for singles
    $trendRows = $db->query(
        "SELECT d, SUM(cnt) AS cnt FROM (
            SELECT DATE(created_at) AS d, COUNT(DISTINCT batch_id) AS cnt
            FROM donations
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
              AND deleted_at IS NULL
              AND batch_id IS NOT NULL
            GROUP BY DATE(created_at)
            UNION ALL
            SELECT DATE(created_at) AS d, COUNT(*) AS cnt
            FROM donations
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
              AND deleted_at IS NULL
              AND batch_id IS NULL
            GROUP BY DATE(created_at)
        ) x
        GROUP BY d
        ORDER BY d ASC"
    )->fetchAll();

    $labels = [];
    $data = [];
    for ($i = 6; $i >= 0; $i--) {
        $date = new DateTime();
        $date->setTime(0,0);
        $date->modify("-{$i} day");
        $key = $date->format('Y-m-d');
        $labels[] = $date->format('D');
        $match = 0;
        foreach ($trendRows as $r) {
            if ($r['d'] === $key) { $match = (int)$r['cnt']; break; }
        }
        $data[] = $match;
    }

    // Debug: counts by status to help frontend verify mappings
    $statusBreakdown = $db->query(
        "SELECT status, COUNT(*) AS c FROM donations WHERE deleted_at IS NULL GROUP BY status ORDER BY status"
    )->fetchAll();

    sendJson([
        'success' => true,
        'data' => [
            'totals' => [
                'meals' => $totalMeals,
                'upcoming_pickups' => $upcomingPickups,
                'active_donors' => $activeDonors,
                'active_recipients' => $activeRecipients,
                'completed_batches' => $completedBatches,
            ],
            'trend' => [
                'labels' => $labels,
                'data' => $data,
            ],
            'debug' => [
                'status_counts' => $statusBreakdown
            ]
        ]
    ]);
} catch (Exception $e) {
    error_log('Dashboard summary error: ' . $e->getMessage());
    sendJson(['error' => 'Server error'], 500);
}
