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
$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = sanitize(getJsonInput());

try {
    switch ($action) {
        case 'get_plan':
            requireRole(['admin']);
            $month = isset($_GET['month']) ? trim((string)$_GET['month']) : '';
            if ($month === '') {
                $month = (new DateTime('now'))->format('Y-m');
            }
            $db = Database::getInstance();
            $weeks = ['W1','W2','W3','W4'];
            $result = [];
            foreach ($weeks as $wk) {
                $key = $month . '-' . $wk; // custom period_key for storage
                $rows = $db->query(
                    "SELECT recipient_id FROM recipient_plans WHERE period_key = ? ORDER BY CASE WHEN source='carryover' THEN 0 ELSE 1 END, position ASC",
                    [$key]
                )->fetchAll();
                $result[$wk] = array_map(fn($r)=> (int)$r['recipient_id'], $rows ?: []);
            }
            sendJson(['success' => true, 'data' => ['month' => $month, 'weeks' => $result]]);
            break;

        case 'save_plan':
            requireRole(['admin']);
            $adminId = (int)(currentUserId() ?? 0);
            $month = isset($payload['month']) ? trim((string)$payload['month']) : '';
            if ($month === '' || !preg_match('/^\d{4}-\d{2}$/', $month)) {
                $month = (new DateTime('now'))->format('Y-m');
            }
            $weeksData = $payload['weeks'] ?? [];
            if (!is_array($weeksData)) { sendJson(['success' => false, 'error' => 'weeks must be an object'], 400); }
            $db = Database::getInstance();
            $weeks = ['W1','W2','W3','W4'];
            foreach ($weeks as $wk) {
                $ids = isset($weeksData[$wk]) && is_array($weeksData[$wk]) ? array_values(array_filter(array_map('intval', $weeksData[$wk]), fn($v)=>$v>0)) : [];
                $key = $month . '-' . $wk;
                // Replace planned rows for this period_key
                $db->query("DELETE FROM recipient_plans WHERE period_key = ? AND source = 'planned'", [$key]);
                // Insert with positions 0..n-1
                $pos = 0;
                foreach ($ids as $rid) {
                    $db->query(
                        "INSERT INTO recipient_plans (period_key, recipient_id, source, position) VALUES (?,?, 'planned', ?)",
                        [ $key, $rid, $pos++ ]
                    );
                }
            }
            sendJson(['success' => true, 'message' => 'Plan saved']);
            break;

        case 'finalize_week':
            // Compute final ordered list: carry-overs (prev week, skipped_pending=1) first, then planned for this week
            requireRole(['admin']);
            $db = Database::getInstance();
            $periodKey = isset($_GET['period_key']) ? trim((string)$_GET['period_key']) : '';
            $monthParam = isset($_GET['month']) ? trim((string)$_GET['month']) : '';
            $weekParam = isset($_GET['week']) ? trim((string)$_GET['week']) : '';
            if ($periodKey === '') {
                if ($monthParam !== '' && preg_match('/^\d{4}-\d{2}$/', $monthParam) && in_array($weekParam, ['W1','W2','W3','W4'], true)) {
                    $periodKey = $monthParam . '-' . $weekParam;
                } else {
                    sendJson(['success' => false, 'error' => 'period_key or (month + week) required'], 400);
                }
            }
            // derive previous period key (month-week scheme W1..W4)
            if (!preg_match('/^(\d{4})-(\d{2})-W([1-4])$/', $periodKey, $m)) {
                sendJson(['success' => false, 'error' => 'Invalid period_key'], 400);
            }
            $year = (int)$m[1];
            $mon  = (int)$m[2];
            $wIndex = (int)$m[3];
            $prevW = $wIndex - 1;
            $prevYear = $year; $prevMon = $mon;
            if ($prevW < 1) {
                $prevW = 4;
                $prevMon = $mon - 1; if ($prevMon < 1) { $prevMon = 12; $prevYear = $year - 1; }
            }
            $prevKey = sprintf('%04d-%02d-W%d', $prevYear, $prevMon, $prevW);

            // Load planned list for this period from recipient_plans
            $rowsPlan = $db->query(
                "SELECT recipient_id FROM recipient_plans WHERE period_key = ? AND source = 'planned' ORDER BY position ASC",
                [$periodKey]
            )->fetchAll();
            $planned = array_map(fn($r)=> (int)$r['recipient_id'], $rowsPlan ?: []);

            // Load carry-overs from previous period: absent attendees
            $rows = $db->query(
                "SELECT recipient_id FROM recipient_attendance WHERE period_key = ? AND status = 'absent'",
                [$prevKey]
            )->fetchAll();
            $carryOvers = array_map(fn($r)=> (int)$r['recipient_id'], $rows ?: []);

            // Merge with cap: keep final size equal to planned size.
            // Take up to planned_count carry-overs first, then fill from planned until reaching planned_count.
            $plannedCount = count($planned);
            $carryKeep = array_slice($carryOvers, 0, max(0, $plannedCount));
            $final = [];
            $seen = [];
            // add carry-overs up to cap
            foreach ($carryKeep as $id) {
                if ($id > 0 && !isset($seen[$id])) { $seen[$id] = true; $final[] = $id; }
                if (count($final) >= $plannedCount) break;
            }
            // fill with planned
            if (count($final) < $plannedCount) {
                foreach ($planned as $id) {
                    if ($id > 0 && !isset($seen[$id])) { $seen[$id] = true; $final[] = $id; }
                    if (count($final) >= $plannedCount) break;
                }
            }

            // Persist carryovers in recipient_plans for visibility (replace prior carryover rows)
            $db->query("DELETE FROM recipient_plans WHERE period_key = ? AND source = 'carryover'", [$periodKey]);
            $cCount = count($carryKeep);
            for ($i = 0; $i < $cCount; $i++) {
                $rid = $carryKeep[$i];
                $db->query(
                    "INSERT INTO recipient_plans (period_key, recipient_id, source, position) VALUES (?,?, 'carryover', ?)",
                    [ $periodKey, $rid, -$cCount + $i ]
                );
            }

            sendJson(['success' => true, 'data' => [
                'period_key' => $periodKey,
                'previous_period_key' => $prevKey,
                'carry_overs' => $carryKeep,
                'planned' => $planned,
                'final' => $final,
            ]]);
            break;

        case 'mark_attendance':
            requireRole(['admin']);
            $db = Database::getInstance();
            $pk = isset($payload['period_key']) ? trim((string)$payload['period_key']) : '';
            $rid = isset($payload['recipient_id']) ? (int)$payload['recipient_id'] : 0;
            $statusVal = isset($payload['status']) ? strtolower(trim((string)$payload['status'])) : '';
            if ($pk === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $pk)) { sendJson(['success'=>false,'error'=>'Invalid period_key'],400); }
            if ($rid <= 0) { sendJson(['success'=>false,'error'=>'Invalid recipient_id'],400); }
            if (!in_array($statusVal, ['served','absent'], true)) { sendJson(['success'=>false,'error'=>'Invalid status'],400); }
            // Upsert row for this period and recipient in recipient_attendance
            $db->beginTransaction();
            try {
                $row = $db->query("SELECT served_count, status FROM recipient_attendance WHERE period_key = ? AND recipient_id = ? LIMIT 1", [$pk, $rid])->fetch();
                if ($row) {
                    if ($statusVal === 'served') {
                        $db->query("UPDATE recipient_attendance SET status='served', served_count = ?, last_served_at = NOW() WHERE period_key = ? AND recipient_id = ?", [ max(1, (int)$row['served_count'] + 1), $pk, $rid ]);
                    } else {
                        $db->query("UPDATE recipient_attendance SET status='absent' WHERE period_key = ? AND recipient_id = ?", [ $pk, $rid ]);
                    }
                } else {
                    if ($statusVal === 'served') {
                        $db->query("INSERT INTO recipient_attendance (period_key, recipient_id, status, served_count, last_served_at) VALUES (?,?, 'served', 1, NOW())", [$pk, $rid]);
                    } else {
                        $db->query("INSERT INTO recipient_attendance (period_key, recipient_id, status, served_count, last_served_at) VALUES (?,?, 'absent', 0, NULL)", [$pk, $rid]);
                    }
                }
                $db->commit();
            } catch (Exception $e) {
                if ($db->inTransaction()) $db->rollBack();
                throw $e;
            }
            sendJson(['success'=>true, 'message'=>'Attendance updated']);
            break;

        default:
            sendJson(['success' => false, 'error' => 'Invalid action'], 400);
    }
} catch (Exception $e) {
    error_log('RecipientsList API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Server error'], 500);
}
