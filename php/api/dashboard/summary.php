<?php
// php/api/dashboard/summary.php
// Returns aggregated figures for the admin dashboard

require_once __DIR__ . '/../../includes/config.php';

// Handle OPTIONS requests with empty 204 response
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');

try {
    // Authenticate and require admin
    requireRole('admin');

    $db = Database::getInstance();

    $validTimeframes = ['daily', 'weekly', 'monthly'];
    $timeframeParam = isset($_GET['timeframe']) ? strtolower(trim((string)$_GET['timeframe'])) : '';
    $timeframe = in_array($timeframeParam, $validTimeframes, true) ? $timeframeParam : null;

    $startParam = isset($_GET['start']) ? trim((string)$_GET['start']) : null;
    $endParam = isset($_GET['end']) ? trim((string)$_GET['end']) : null;
    $startDt = null;
    $endDt = null;
    $timeParams = [];
    $timeFilterClause = '';
    $timeFilterClauseNoAlias = '';
    $metricsSubTimeFilterClause = '';
    $movementTimeFilterClause = '';

    if (($startParam && !$endParam) || ($endParam && !$startParam)) {
        sendJson(['success' => false, 'error' => 'Both start and end dates are required'], 400);
    }

    if ($startParam && $endParam) {
        $startDt = DateTime::createFromFormat('Y-m-d', $startParam) ?: DateTime::createFromFormat('Y-m-d', $startParam);
        $endDt = DateTime::createFromFormat('Y-m-d', $endParam) ?: DateTime::createFromFormat('Y-m-d', $endParam);
        if (!$startDt || !$endDt) {
            sendJson(['success' => false, 'error' => 'Invalid date range'], 400);
        }
        $startDt->setTime(0, 0, 0);
        $endDt->setTime(23, 59, 59);
        if ($endDt < $startDt) {
            sendJson(['success' => false, 'error' => 'End date must be after start date'], 400);
        }
        $startDateTime = $startDt->format('Y-m-d H:i:s');
        $endDateTime = $endDt->format('Y-m-d H:i:s');
        $timeParams = [$startDateTime, $endDateTime];
        $timeFilterClause = ' AND d.created_at BETWEEN ? AND ?';
        $timeFilterClauseNoAlias = ' AND created_at BETWEEN ? AND ?';
        $metricsSubTimeFilterClause = ' AND d_avg.created_at BETWEEN ? AND ?';
        $movementTimeFilterClause = ' AND im.created_at BETWEEN ? AND ?';
    }

    // Total meals donated: sum of donation_items.quantity for donations that are Picked Up/Completed
    $mealSql = "SELECT COALESCE(SUM(di.quantity), 0) AS total_meals
           FROM donation_items di
           INNER JOIN donations d ON d.donation_id = di.donation_id
           LEFT JOIN categories cat ON cat.category_id = di.category_id
          WHERE d.status IN ('Picked Up','Completed')
            AND d.deleted_at IS NULL
            AND (cat.primary_name IS NULL OR cat.primary_name NOT LIKE 'Non-Food%')" . $timeFilterClause;
    $row = $db->query($mealSql, $timeParams)->fetch();
    $totalMeals = (int)($row['total_meals'] ?? 0);

    // Aggregate food-only donation metrics with weight/cost estimation via per-product averages
    $weightExpr = "CASE
            WHEN cat.primary_name IS NOT NULL AND cat.primary_name LIKE 'Non-Food%' THEN 0
            WHEN di.quantity IS NOT NULL AND di.quantity <> 0 AND di.total_weight IS NOT NULL THEN (di.total_weight / NULLIF(di.quantity,0)) * im.quantity
            WHEN metrics.avg_weight_per_unit IS NOT NULL THEN im.quantity * metrics.avg_weight_per_unit
            ELSE 0
        END";
    $costExpr = "CASE
            WHEN cat.primary_name IS NOT NULL AND cat.primary_name LIKE 'Non-Food%' THEN 0
            WHEN di.quantity IS NOT NULL AND di.quantity <> 0 AND di.total_cost IS NOT NULL THEN (di.total_cost / NULLIF(di.quantity,0)) * im.quantity
            WHEN metrics.avg_cost_per_unit IS NOT NULL THEN im.quantity * metrics.avg_cost_per_unit
            ELSE 0
        END";

    $metricsSql = "SELECT
            SUM($weightExpr) AS total_weight,
            SUM($costExpr) AS total_cost,
            SUM(
                CASE
                    WHEN cat.primary_name IS NOT NULL AND cat.primary_name LIKE 'Non-Food%' THEN 0
                    ELSE im.quantity
                END
            ) AS total_quantity,
            COUNT(DISTINCT CASE
                WHEN cat.primary_name IS NULL OR cat.primary_name NOT LIKE 'Non-Food%'
                    THEN im.id
                ELSE NULL
            END) AS product_out_count
         FROM inventory_movements im
         LEFT JOIN inventory inv ON inv.inventory_id = im.inventory_id
         LEFT JOIN donation_items di ON di.donation_item_id = COALESCE(im.donation_item_id, inv.donation_item_id)
         LEFT JOIN categories cat ON cat.category_id = di.category_id
         LEFT JOIN (
             SELECT di_avg.product_name,
                    SUM(di_avg.total_weight) / NULLIF(SUM(CASE WHEN di_avg.total_weight IS NOT NULL THEN di_avg.quantity ELSE 0 END), 0) AS avg_weight_per_unit,
                    SUM(di_avg.total_cost) / NULLIF(SUM(CASE WHEN di_avg.total_cost IS NOT NULL THEN di_avg.quantity ELSE 0 END), 0) AS avg_cost_per_unit
             FROM donation_items di_avg
             INNER JOIN donations d_avg ON d_avg.donation_id = di_avg.donation_id
             LEFT JOIN categories cat_avg ON cat_avg.category_id = di_avg.category_id
              WHERE d_avg.deleted_at IS NULL
                AND d_avg.status IN ('Picked Up','Completed')
                AND di_avg.quantity IS NOT NULL
                AND di_avg.quantity > 0
                AND (cat_avg.primary_name IS NULL OR cat_avg.primary_name NOT LIKE 'Non-Food%')" .
                ($metricsSubTimeFilterClause !== '' ? $metricsSubTimeFilterClause : '') . "
              GROUP BY di_avg.product_name
         ) metrics ON metrics.product_name = di.product_name
         WHERE im.direction = 'out'
           AND (im.mode IS NULL OR im.mode <> 'repack')" . $movementTimeFilterClause;

    $metricsParams = [];
    if (!empty($timeParams)) {
        // Subquery consumes first pair, outer query consumes second
        $metricsParams = array_merge($timeParams, $timeParams, $timeParams);
    }
    $metricsRow = $db->query($metricsSql, $metricsParams)->fetch();
    $totalWeightKg = (float)($metricsRow['total_weight'] ?? 0);
    $totalDonationValue = (float)($metricsRow['total_cost'] ?? 0);
    $totalFoodQuantity = (int)($metricsRow['total_quantity'] ?? 0);
    $foodDonationCount = (int)($metricsRow['product_out_count'] ?? 0);

    $avgDonationValue = 0.0;
    $avgDonationValueMode = 'per_item';
    $avgDonationValueSampleDays = null;

    if ($timeframe && $startDt && $endDt) {
        $dailyTotalsSql = "SELECT DATE(im.created_at) AS donation_day,
                SUM($costExpr) AS total_cost
             FROM inventory_movements im
             LEFT JOIN inventory inv ON inv.inventory_id = im.inventory_id
             LEFT JOIN donation_items di ON di.donation_item_id = COALESCE(im.donation_item_id, inv.donation_item_id)
             LEFT JOIN categories cat ON cat.category_id = di.category_id
             LEFT JOIN (
                 SELECT di_avg.product_name,
                        SUM(di_avg.total_weight) / NULLIF(SUM(CASE WHEN di_avg.total_weight IS NOT NULL THEN di_avg.quantity ELSE 0 END), 0) AS avg_weight_per_unit,
                        SUM(di_avg.total_cost) / NULLIF(SUM(CASE WHEN di_avg.total_cost IS NOT NULL THEN di_avg.quantity ELSE 0 END), 0) AS avg_cost_per_unit
                 FROM donation_items di_avg
                 INNER JOIN donations d_avg ON d_avg.donation_id = di_avg.donation_id
                 LEFT JOIN categories cat_avg ON cat_avg.category_id = di_avg.category_id
                 WHERE d_avg.deleted_at IS NULL
                   AND d_avg.status IN ('Picked Up','Completed')
                   AND di_avg.quantity IS NOT NULL
                   AND di_avg.quantity > 0
                   AND (cat_avg.primary_name IS NULL OR cat_avg.primary_name NOT LIKE 'Non-Food%')" .
                    ($metricsSubTimeFilterClause !== '' ? $metricsSubTimeFilterClause : '') . "
                 GROUP BY di_avg.product_name
             ) metrics ON metrics.product_name = di.product_name
             WHERE im.direction = 'out'
               AND (im.mode IS NULL OR im.mode <> 'repack')" . $movementTimeFilterClause . "
             GROUP BY DATE(im.created_at)
             ORDER BY donation_day ASC";

        $dailyParams = [];
        if (!empty($timeParams)) {
            $dailyParams = array_merge($timeParams, $timeParams);
        }
        $dailyRows = $db->query($dailyTotalsSql, $dailyParams)->fetchAll();
        $dailyTotals = [];
        foreach ($dailyRows as $dailyRow) {
            if (!isset($dailyRow['donation_day'])) {
                continue;
            }
            $dailyTotals[$dailyRow['donation_day']] = (float)($dailyRow['total_cost'] ?? 0);
        }

        $periodStart = (clone $startDt);
        $periodStart->setTime(0, 0, 0);
        $periodEnd = (clone $endDt);
        $periodEnd->setTime(0, 0, 0);

        $dayCount = 0;
        $sumDailyTotals = 0.0;
        $cursor = clone $periodStart;
        while ($cursor <= $periodEnd) {
            $dayKey = $cursor->format('Y-m-d');
            $dayValue = $dailyTotals[$dayKey] ?? 0.0;
            $sumDailyTotals += $dayValue;
            $dayCount++;
            $cursor->modify('+1 day');
        }

        if ($timeframe === 'daily') {
            $avgDonationValue = $dailyTotals[$periodStart->format('Y-m-d')] ?? 0.0;
            $avgDonationValueMode = 'daily_total';
        } else {
            $avgDonationValue = $dayCount > 0 ? ($sumDailyTotals / $dayCount) : 0.0;
            $avgDonationValueMode = 'average_daily';
        }
        $avgDonationValueSampleDays = $dayCount;
    } else {
        $avgDonationValue = $totalFoodQuantity > 0 ? ($totalDonationValue / $totalFoodQuantity) : 0.0;
    }

    // Total successful donations by batches (count DISTINCT completed batches)
    $completedSql = "SELECT COUNT(DISTINCT batch_id) AS c
           FROM donations
          WHERE deleted_at IS NULL
            AND batch_id IS NOT NULL
            AND status = 'Completed'" . $timeFilterClauseNoAlias;
    $row = $db->query($completedSql, $timeParams)->fetch();
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

    // Weekly trend (last 7 days) counted by DISTINCT completed batches per day (exclude singles)
    $trendRows = $db->query(
        "SELECT DATE(created_at) AS d, COUNT(DISTINCT batch_id) AS cnt
         FROM donations
         WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
           AND deleted_at IS NULL
           AND batch_id IS NOT NULL
           AND status = 'Completed'
         GROUP BY DATE(created_at)
         ORDER BY d ASC"
    )->fetchAll();

    // Distribution trend (last 7 days) - product out movements excluding repack
    $distributionRows = $db->query(
        "SELECT DATE(im.created_at) AS d, COUNT(DISTINCT im.id) AS cnt
         FROM inventory_movements im
         LEFT JOIN categories cat ON cat.category_id = (
             SELECT di.category_id FROM donation_items di 
             WHERE di.donation_item_id = im.donation_item_id 
             LIMIT 1
         )
         WHERE im.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
           AND im.direction = 'out'
           AND (im.mode IS NULL OR im.mode <> 'repack')
           AND (cat.primary_name IS NULL OR cat.primary_name NOT LIKE 'Non-Food%')
         GROUP BY DATE(im.created_at)
         ORDER BY d ASC"
    )->fetchAll();

    $labels = [];
    $data = [];
    $distributionData = [];
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
        
        // Process distribution data
        $distMatch = 0;
        foreach ($distributionRows as $r) {
            if ($r['d'] === $key) { $distMatch = (int)$r['cnt']; break; }
        }
        $distributionData[] = $distMatch;
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
                'total_weight_kg' => $totalWeightKg,
                'total_value' => $totalDonationValue,
                'avg_donation_value' => $avgDonationValue,
                'avg_donation_value_mode' => $avgDonationValueMode,
                'avg_donation_value_sample_days' => $avgDonationValueSampleDays,
                'food_quantity' => $totalFoodQuantity,
                'food_donation_count' => $foodDonationCount,
                'upcoming_pickups' => $upcomingPickups,
                'active_donors' => $activeDonors,
                'active_recipients' => $activeRecipients,
                'completed_batches' => $completedBatches,
            ],
            'trend' => [
                'labels' => $labels,
                'data' => $data,
                'distribution_data' => $distributionData,
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
