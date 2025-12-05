<?php
require_once __DIR__ . '/../../includes/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');

try {
    requireRole('admin');

    $db = Database::getInstance();

    $type = strtolower(trim($_GET['type'] ?? 'donations'));
    if (!in_array($type, ['donations', 'pickups'], true)) {
        throw new InvalidArgumentException('Invalid type parameter');
    }

    $timeframe = strtolower(trim($_GET['timeframe'] ?? 'daily'));
    $validTimeframes = ['daily', 'weekly', 'monthly', 'yearly'];
    if (!in_array($timeframe, $validTimeframes, true)) {
        throw new InvalidArgumentException('Invalid timeframe parameter');
    }

    $defaultLimits = [
        'daily' => 14,
        'weekly' => 12,
        'monthly' => 12,
        'yearly' => 5,
    ];
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : $defaultLimits[$timeframe];
    if ($limit < 1) {
        $limit = $defaultLimits[$timeframe];
    }
    // Clamp maximum ranges to keep queries manageable
    if ($timeframe === 'daily' && $limit > 90) { $limit = 90; }
    if ($timeframe === 'weekly' && $limit > 52) { $limit = 52; }
    if ($timeframe === 'monthly' && $limit > 36) { $limit = 36; }
    if ($timeframe === 'yearly' && $limit > 10) { $limit = 10; }

    $now = new DateTime('now');
    $now->setTime(23, 59, 59);

    $timeline = [];
    $series = [];
    $queryStart = buildTimeline($timeframe, $limit, $now, $timeline, $series);
    $queryEnd = clone $now;

    $rows = [];
    if ($type === 'donations') {
        $rows = $db->query(
            "SELECT created_at FROM donations WHERE deleted_at IS NULL AND created_at BETWEEN ? AND ?",
            [$queryStart->format('Y-m-d H:i:s'), $queryEnd->format('Y-m-d H:i:s')]
        )->fetchAll();
    } else {
        $rows = $db->query(
            "SELECT created_at FROM inventory_movements WHERE direction = 'out' AND created_at BETWEEN ? AND ?",
            [$queryStart->format('Y-m-d H:i:s'), $queryEnd->format('Y-m-d H:i:s')]
        )->fetchAll();
    }

    foreach ($rows as $row) {
        $created = $row['created_at'] ?? null;
        if (!$created) { continue; }
        try {
            $dt = new DateTime($created);
        } catch (Exception $e) {
            continue;
        }
        $key = bucketKey($dt, $timeframe);
        if ($key !== null && array_key_exists($key, $series)) {
            $series[$key] = ($series[$key] ?? 0) + 1;
        }
    }

    $labels = [];
    $values = [];
    foreach ($timeline as $bucket) {
        $key = $bucket['key'];
        $labels[] = $bucket['label'];
        $values[] = (int)($series[$key] ?? 0);
    }

    sendJson([
        'success' => true,
        'data' => [
            'type' => $type,
            'timeframe' => $timeframe,
            'series' => [
                'labels' => $labels,
                'values' => $values,
            ],
            'range' => [
                'start' => $queryStart->format('Y-m-d'),
                'end' => $queryEnd->format('Y-m-d'),
            ],
        ],
    ]);
} catch (InvalidArgumentException $e) {
    sendJson(['success' => false, 'error' => $e->getMessage()], 400);
} catch (Exception $e) {
    error_log('reports/volume error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Unexpected error'], 500);
}

function buildTimeline(string $timeframe, int $limit, DateTime $end, array &$timeline, array &$series): DateTime
{
    switch ($timeframe) {
        case 'weekly':
            $endWeek = clone $end;
            $endWeek->setTime(0, 0, 0);
            $dayOfWeek = (int)$endWeek->format('N');
            if ($dayOfWeek > 1) {
                $endWeek->modify('-' . ($dayOfWeek - 1) . ' days');
            }
            $startWeek = clone $endWeek;
            $startWeek->modify('-' . ($limit - 1) . ' weeks');
            $startQuery = clone $startWeek;
            for ($i = 0; $i < $limit; $i++) {
                $dt = clone $startWeek;
                if ($i > 0) {
                    $dt->modify('+' . $i . ' weeks');
                }
                $key = $dt->format('o-\WW');
                $timeline[] = [
                    'key' => $key,
                    'label' => 'W' . $dt->format('W') . ' ' . $dt->format('o'),
                ];
                $series[$key] = 0;
            }
            return $startQuery;

        case 'monthly':
            $endMonth = new DateTime($end->format('Y-m-01') . ' 00:00:00');
            $startMonth = clone $endMonth;
            $startMonth->modify('-' . ($limit - 1) . ' months');
            $startQuery = clone $startMonth;
            for ($i = 0; $i < $limit; $i++) {
                $dt = clone $startMonth;
                if ($i > 0) {
                    $dt->modify('+' . $i . ' months');
                }
                $key = $dt->format('Y-m');
                $timeline[] = [
                    'key' => $key,
                    'label' => $dt->format('M Y'),
                ];
                $series[$key] = 0;
            }
            return $startQuery;

        case 'yearly':
            $endYear = new DateTime($end->format('Y-01-01') . ' 00:00:00');
            $startYear = clone $endYear;
            $startYear->modify('-' . ($limit - 1) . ' years');
            $startQuery = clone $startYear;
            for ($i = 0; $i < $limit; $i++) {
                $dt = clone $startYear;
                if ($i > 0) {
                    $dt->modify('+' . $i . ' years');
                }
                $key = $dt->format('Y');
                $timeline[] = [
                    'key' => $key,
                    'label' => $dt->format('Y'),
                ];
                $series[$key] = 0;
            }
            return $startQuery;

        case 'daily':
        default:
            $startDay = clone $end;
            $startDay->setTime(0, 0, 0);
            $startDay->modify('-' . ($limit - 1) . ' days');
            $startQuery = clone $startDay;
            for ($i = 0; $i < $limit; $i++) {
                $dt = clone $startDay;
                if ($i > 0) {
                    $dt->modify('+' . $i . ' days');
                }
                $key = $dt->format('Y-m-d');
                $timeline[] = [
                    'key' => $key,
                    'label' => $dt->format('M j'),
                ];
                $series[$key] = 0;
            }
            return $startQuery;
    }
}

function bucketKey(DateTime $dt, string $timeframe): ?string
{
    switch ($timeframe) {
        case 'weekly':
            $weekStart = clone $dt;
            $weekStart->setTime(0, 0, 0);
            $dayOfWeek = (int)$weekStart->format('N');
            if ($dayOfWeek > 1) {
                $weekStart->modify('-' . ($dayOfWeek - 1) . ' days');
            }
            return $weekStart->format('o-\WW');

        case 'monthly':
            return $dt->format('Y-m');

        case 'yearly':
            return $dt->format('Y');

        case 'daily':
        default:
            return $dt->format('Y-m-d');
    }
}
