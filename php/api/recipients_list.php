<?php
require_once __DIR__ . '/../includes/config.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

/**
 * Compute the calendar date for the start of the given week within a month.
 * $month: 'YYYY-MM'
 * $weekIndex: 1..4 corresponding to W1..W4
 * $weekStart: 'sunday' or 'monday'
 * Returns date string 'Y-m-d'.
 */
function rl_week_start_date_from_month($month, $weekIndex, $weekStart){
    try {
        if (!preg_match('/^(\d{4})-(\d{2})$/', (string)$month, $m)) return null;
        $year = (int)$m[1];
        $mon  = (int)$m[2];
        $weekIndex = max(1, min(4, (int)$weekIndex));
        $weekStartDow = ($weekStart === 'monday') ? 1 : 0; // 0=Sun..6=Sat
        $first = new DateTime(sprintf('%04d-%02d-01', $year, $mon));
        $firstDow = (int)$first->format('w');
        $offset = ($firstDow - $weekStartDow + 7) % 7; // days to go back to first week start
        $firstWeekStart = clone $first; $firstWeekStart->modify(sprintf('-%d day', $offset));
        $start = clone $firstWeekStart; $start->modify('+' . (7 * ($weekIndex - 1)) . ' day');
        return $start->format('Y-m-d');
    } catch (Throwable $e){ return null; }
}

/**
 * From a period_key 'YYYY-MM-Wn', derive [month, weekIndex].
 */
function rl_month_and_index_from_period_key($periodKey){
    if (!preg_match('/^(\d{4}-\d{2})-W([1-4])$/', (string)$periodKey, $m)) return [null, null];
    return [$m[1], (int)$m[2]];
}

setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? sanitize($_GET['action']) : '';
$payload = sanitize(getJsonInput());

function rl_get_setting($key, $default = null){
    try {
        $db = Database::getInstance();
        $row = $db->query('SELECT `value` FROM settings WHERE `key` = ? LIMIT 1', [$key])->fetch();
        if ($row && array_key_exists('value', $row)) return $row['value'];
    } catch (Throwable $e) { /* ignore */ }
    return $default;
}

try {
    switch ($action) {
        case 'get_plan':
            requireRole(['admin']);
            $month = isset($_GET['month']) ? trim((string)$_GET['month']) : '';
            if ($month === '') {
                $month = (new DateTime('now'))->format('Y-m');
            }
            $weekStart = isset($_GET['week_start']) ? strtolower(trim((string)$_GET['week_start'])) : '';
            if (!in_array($weekStart, ['sunday','monday'], true)) {
                $weekStart = strtolower((string)rl_get_setting('week_start', 'sunday'));
                if (!in_array($weekStart, ['sunday','monday'], true)) $weekStart = 'sunday';
            }
            $includeCarry = false;
            if (isset($_GET['include_carryover'])) {
                $v = strtolower(trim((string)$_GET['include_carryover']));
                $includeCarry = in_array($v, ['1','true','yes','on'], true);
            }
            $db = Database::getInstance();
            $weeks = ['W1','W2','W3','W4'];
            $result = [];
            foreach ($weeks as $wk) {
                $key = $month . '-' . $wk; // custom period_key for storage
                if ($includeCarry) {
                    $rows = $db->query(
                        "SELECT recipient_id FROM recipient_plans WHERE period_key = ? ORDER BY CASE WHEN source='carryover' THEN 0 ELSE 1 END, position ASC",
                        [$key]
                    )->fetchAll();
                } else {
                    $rows = $db->query(
                        "SELECT recipient_id FROM recipient_plans WHERE period_key = ? AND source='planned' ORDER BY position ASC",
                        [$key]
                    )->fetchAll();
                }
                $result[$wk] = array_map(fn($r)=> (int)$r['recipient_id'], $rows ?: []);
            }
            sendJson(['success' => true, 'data' => ['month' => $month, 'weeks' => $result, 'week_start' => $weekStart]]);
            break;

        case 'save_plan':
            requireRole(['admin']);
            $adminId = (int)(currentUserId() ?? 0);
            $month = isset($payload['month']) ? trim((string)$payload['month']) : '';
            if ($month === '' || !preg_match('/^\d{4}-\d{2}$/', $month)) {
                $month = (new DateTime('now'))->format('Y-m');
            }
            // Resolve week basis from settings
            $weekBasis = strtolower((string) rl_get_setting('week_start', 'sunday')) === 'monday' ? 'monday' : 'sunday';
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
                // Compute week_start_date for this key
                $wIndex = (int)substr($wk, 1);
                $wkStartDate = rl_week_start_date_from_month($month, $wIndex, $weekBasis);
                foreach ($ids as $rid) {
                    $db->query(
                        "INSERT INTO recipient_plans (period_key, recipient_id, source, position, week_start_date, week_basis) VALUES (?,?, 'planned', ?, ?, ?)",
                        [ $key, $rid, $pos++, $wkStartDate, $weekBasis ]
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
            $weekStart = isset($_GET['week_start']) ? strtolower(trim((string)$_GET['week_start'])) : '';
            if (!in_array($weekStart, ['sunday','monday'], true)) {
                $weekStart = strtolower((string)rl_get_setting('week_start', 'sunday'));
                if (!in_array($weekStart, ['sunday','monday'], true)) $weekStart = 'sunday';
            }
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
            // Compute week_start_date and basis for current period
            $monthStr = sprintf('%04d-%02d', $year, $mon);
            $weekBasis = $weekStart; // already normalized
            $wkStartDate = rl_week_start_date_from_month($monthStr, $wIndex, $weekBasis);
            $cCount = count($carryKeep);
            for ($i = 0; $i < $cCount; $i++) {
                $rid = $carryKeep[$i];
                $db->query(
                    "INSERT INTO recipient_plans (period_key, recipient_id, source, position, week_start_date, week_basis) VALUES (?,?, 'carryover', ?, ?, ?)",
                    [ $periodKey, $rid, -$cCount + $i, $wkStartDate, $weekBasis ]
                );
            }

            sendJson(['success' => true, 'data' => [
                'period_key' => $periodKey,
                'previous_period_key' => $prevKey,
                'carry_overs' => $carryKeep,
                'planned' => $planned,
                'final' => $final,
                'week_start' => $weekStart,
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
            // Compute week_start_date and basis from current settings at time of mark
            $weekBasis = strtolower((string) rl_get_setting('week_start', 'sunday')) === 'monday' ? 'monday' : 'sunday';
            [ $monthStr, $wIndex ] = rl_month_and_index_from_period_key($pk);
            $wkStartDate = ($monthStr && $wIndex) ? rl_week_start_date_from_month($monthStr, $wIndex, $weekBasis) : null;
            // Upsert row for this period and recipient in recipient_attendance
            $db->beginTransaction();
            try {
                $row = $db->query("SELECT served_count, status FROM recipient_attendance WHERE period_key = ? AND recipient_id = ? LIMIT 1", [$pk, $rid])->fetch();
                if ($row) {
                    if ($statusVal === 'served') {
                        $db->query("UPDATE recipient_attendance SET status='served', served_count = ?, last_served_at = NOW(), week_start_date = COALESCE(week_start_date, ?), week_basis = COALESCE(week_basis, ?) WHERE period_key = ? AND recipient_id = ?", [ max(1, (int)$row['served_count'] + 1), $wkStartDate, $weekBasis, $pk, $rid ]);
                    } else {
                        $db->query("UPDATE recipient_attendance SET status='absent', week_start_date = COALESCE(week_start_date, ?), week_basis = COALESCE(week_basis, ?) WHERE period_key = ? AND recipient_id = ?", [ $wkStartDate, $weekBasis, $pk, $rid ]);
                    }
                } else {
                    if ($statusVal === 'served') {
                        $db->query("INSERT INTO recipient_attendance (period_key, recipient_id, status, served_count, last_served_at, week_start_date, week_basis) VALUES (?,?, 'served', 1, NOW(), ?, ?)", [$pk, $rid, $wkStartDate, $weekBasis]);
                    } else {
                        $db->query("INSERT INTO recipient_attendance (period_key, recipient_id, status, served_count, last_served_at, week_start_date, week_basis) VALUES (?,?, 'absent', 0, NULL, ?, ?)", [$pk, $rid, $wkStartDate, $weekBasis]);
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
