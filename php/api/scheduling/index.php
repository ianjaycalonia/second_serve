<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/SchedulingEngine.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = sanitize(getJsonInput());

try {
    switch ($action) {
        case 'schedule_month':
            requireRole(['admin']);
            handleScheduleMonth($payload);
            break;
        case 'get_month_schedule':
            requireRole(['admin']);
            handleGetMonthSchedule();
            break;
        case 'mark_status':
            requireRole(['admin']);
            handleMarkStatus($payload);
            break;
        case 'process_week_results':
            requireRole(['admin']);
            handleProcessWeekResults($payload);
            break;
        default:
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('Scheduling API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Server error'], 500);
}

function handleScheduleMonth(array $payload) {
    $year = isset($payload['year']) ? (int)$payload['year'] : 0;
    $month = isset($payload['month']) ? (int)$payload['month'] : 0;
    $capacity = isset($payload['capacity']) ? max(1, (int)$payload['capacity']) : 10;
    if ($year <= 0 || $month < 1 || $month > 12) {
        sendJson(['success' => false, 'error' => 'Invalid year or month'], 400);
    }
    $engine = new SchedulingEngine();
    $result = $engine->scheduleMonth($year, $month, $capacity);
    sendJson(['success' => true, 'data' => [ 'weeks' => $result ]]);
}

function handleGetMonthSchedule() {
    $year = isset($_GET['year']) ? (int)$_GET['year'] : 0;
    $month = isset($_GET['month']) ? (int)$_GET['month'] : 0;
    if ($year <= 0 || $month < 1 || $month > 12) {
        sendJson(['success' => false, 'error' => 'Invalid year or month'], 400);
    }
    $engine = new SchedulingEngine();
    $weeks = $engine->getMonthSchedule($year, $month);
    // Shape output explicitly for UI consumption
    $out = [];
    foreach ($weeks as $w) {
        $wk = $w['week'];
        $items = [];
        foreach ($w['recipients'] as $r) {
            $items[] = [
                'id' => (int)$r['id'],
                'week_id' => (int)$r['week_id'],
                'recipient_id' => (int)$r['recipient_id'],
                'display_name' => (string)($r['display_name'] ?? ''),
                'status' => (string)$r['status'],
                'replacement_for' => isset($r['replacement_for']) && $r['replacement_for'] !== null ? (int)$r['replacement_for'] : null,
                'created_at' => (string)$r['created_at'],
                'updated_at' => (string)$r['updated_at'],
            ];
        }
        $out[] = [
            'week' => [
                'id' => (int)$wk['id'],
                'year' => (int)$wk['year'],
                'month' => (int)$wk['month'],
                'week_number' => (int)$wk['week_number'],
                'capacity' => (int)$wk['capacity'],
                'start_date' => (string)$wk['start_date'],
                'end_date' => (string)$wk['end_date'],
            ],
            'recipients' => $items,
        ];
    }
    sendJson(['success' => true, 'data' => [ 'weeks' => $out ]]);
}

function handleMarkStatus(array $payload) {
    $id = isset($payload['week_recipient_id']) ? (int)$payload['week_recipient_id'] : 0;
    $status = isset($payload['status']) ? (string)$payload['status'] : '';
    if ($id <= 0 || $status === '') { sendJson(['success'=>false,'error'=>'week_recipient_id and status are required'],400); }
    $engine = new SchedulingEngine();
    $ok = $engine->markStatus($id, $status);
    if (!$ok) sendJson(['success'=>false,'error'=>'Invalid status'],400);
    sendJson(['success'=>true, 'message'=>'Status updated']);
}

function handleProcessWeekResults(array $payload) {
    $weekId = isset($payload['week_id']) ? (int)$payload['week_id'] : 0;
    if ($weekId <= 0) { sendJson(['success'=>false,'error'=>'week_id is required'],400); }
    $engine = new SchedulingEngine();
    $res = $engine->processWeekResults($weekId);
    sendJson(['success'=>true, 'data'=>$res]);
}
