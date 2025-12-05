<?php
// php/api/dashboard/donor_summary.php
// Returns aggregated figures for the donor dashboard scoped to the current donor

require_once __DIR__ . '/../../includes/config.php';

// Handle OPTIONS requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');

try {
    // Authenticate and require donor
    requireRole('donor');

    $db = Database::getInstance();
    $donorId = (int)(currentUserId() ?? 0);
    if ($donorId <= 0) {
        sendJson(['success' => false, 'error' => 'Unauthorized'], 401);
    }

    // Total donations created (non-archived)
    $row = $db->query(
        "SELECT 
            (
              SELECT COUNT(DISTINCT d.batch_id)
              FROM donations d
              WHERE d.deleted_at IS NULL AND d.donor_id = ? AND d.batch_id IS NOT NULL
            ) + (
              SELECT COUNT(*)
              FROM donations d
              WHERE d.deleted_at IS NULL AND d.donor_id = ? AND d.batch_id IS NULL
            ) AS c",
        [$donorId, $donorId]
    )->fetch();
    $totalDonations = (int)($row['c'] ?? 0);

    // Upcoming pickups (Pending) grouped by batch vs single
    $row = $db->query(
        "SELECT 
            (
              SELECT COUNT(DISTINCT d.batch_id)
              FROM donations d
              WHERE d.deleted_at IS NULL AND d.donor_id = ? AND d.batch_id IS NOT NULL AND d.status = 'Pending'
            ) + (
              SELECT COUNT(*)
              FROM donations d
              WHERE d.deleted_at IS NULL AND d.donor_id = ? AND d.batch_id IS NULL AND d.status = 'Pending'
            ) AS upcoming",
        [$donorId, $donorId]
    )->fetch();
    $upcomingPickups = (int)($row['upcoming'] ?? 0);

    // Pending donations grouped (same value as upcomingPickups tile)
    $pending = $upcomingPickups;

    // Cancelled donations grouped by batch vs single
    $row = $db->query(
        "SELECT 
            (
              SELECT COUNT(DISTINCT d.batch_id)
              FROM donations d
              WHERE d.deleted_at IS NULL AND d.donor_id = ? AND d.batch_id IS NOT NULL AND d.status = 'Cancelled'
            ) + (
              SELECT COUNT(*)
              FROM donations d
              WHERE d.deleted_at IS NULL AND d.donor_id = ? AND d.batch_id IS NULL AND d.status = 'Cancelled'
            ) AS cancelled",
        [$donorId, $donorId]
    )->fetch();
    $cancelled = (int)($row['cancelled'] ?? 0);

    // Weekly trend: donations created per day (last 7 days) by this donor
    $trendRows = $db->query(
        "SELECT DATE(created_at) AS d, 
                (
                  (
                    SELECT COUNT(DISTINCT batch_id)
                    FROM donations dd
                    WHERE dd.donor_id = d1.donor_id
                      AND dd.deleted_at IS NULL
                      AND dd.batch_id IS NOT NULL
                      AND DATE(dd.created_at) = DATE(d1.created_at)
                  ) + (
                    SELECT COUNT(*)
                    FROM donations ds
                    WHERE ds.donor_id = d1.donor_id
                      AND ds.deleted_at IS NULL
                      AND ds.batch_id IS NULL
                      AND DATE(ds.created_at) = DATE(d1.created_at)
                  )
                ) AS cnt,
                d1.donor_id
         FROM donations d1
         WHERE d1.donor_id = ?
           AND d1.deleted_at IS NULL
           AND d1.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
         GROUP BY DATE(d1.created_at), d1.donor_id
         ORDER BY d ASC",
        [$donorId]
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

    sendJson([
        'success' => true,
        'data' => [
            'totals' => [
                'total' => $totalDonations,
                'upcoming_pickups' => $upcomingPickups,
                'pending' => $pending,
                'cancelled' => $cancelled,
            ],
            'trend' => [
                'labels' => $labels,
                'data' => $data
            ]
        ]
    ]);
} catch (Exception $e) {
    error_log('Donor dashboard summary error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Server error'], 500);
}
