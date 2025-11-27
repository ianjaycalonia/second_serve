<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Notification.php';

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}

// Helper: compute start of week for a given date and basis
function rl_start_of_week(DateTime $date, string $basis): DateTime {
    $basis = ($basis === 'monday') ? 'monday' : 'sunday';
    $d = clone $date; $d->setTime(0,0,0);
    $dow = (int)$d->format('w'); // 0=Sun..6=Sat
    $targetDow = ($basis === 'monday') ? 1 : 0;
    $diff = ($dow - $targetDow + 7) % 7; // days since start of week
    if ($diff !== 0) { $d->modify('-'.$diff.' day'); }
    return $d;
}

// Helper: upcoming 4 week starts from now per basis
function rl_upcoming_week_starts(string $basis): array {
    $basis = ($basis === 'monday') ? 'monday' : 'sunday';
    $now = new DateTime('now');
    $first = rl_start_of_week($now, $basis);
    $arr = [];
    for ($i=0; $i<4; $i++){
        $d = clone $first; $d->modify('+'.(7*$i).' day');
        $arr[] = $d; // DateTime
    }
    return $arr;
}

// ISO week number (Mon-based)
function rl_iso_week_number(DateTime $date): int {
    return (int)$date->format('W');
}

// Basis-aware week number
function rl_week_number_basis(DateTime $date, string $basis): int {
    $basis = ($basis === 'monday') ? 'monday' : 'sunday';
    if ($basis === 'monday') return rl_iso_week_number($date);
    // Sunday-based week numbering
    $year = (int)$date->format('Y');
    $start = rl_start_of_week($date, 'sunday');
    $jan1 = new DateTime(sprintf('%04d-01-01', $year));
    $yearWeek0 = rl_start_of_week($jan1, 'sunday');
    $diffDays = (int)floor(($start->getTimestamp() - $yearWeek0->getTimestamp()) / 86400);
    return (int)floor($diffDays / 7) + 1;
}

function rl_get_setting_bool($key, $default=false){
    $v = rl_get_setting($key, $default ? '1' : '0');
    $s = strtolower((string)$v);
    return in_array($s, ['1','true','yes','on'], true);
}

function rl_set_setting($key, $value){
    try{
        $db = Database::getInstance();
        $row = $db->query('SELECT `key` FROM settings WHERE `key`=? LIMIT 1', [$key])->fetch();
        if ($row){
            $db->query('UPDATE settings SET `value`=? WHERE `key`=?', [ (string)$value, $key ]);
        } else {
            $db->query('INSERT INTO settings (`key`,`value`) VALUES (?,?)', [ $key, (string)$value ]);
        }
    } catch (Throwable $e) { /* ignore */ }
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
        // Clamp to 1..4 and use fixed starts: 1, 8, 15, 22
        $weekIndex = max(1, min(4, (int)$weekIndex));
        $dayMap = [1 => 1, 2 => 8, 3 => 15, 4 => 22];
        $day = isset($dayMap[$weekIndex]) ? $dayMap[$weekIndex] : 1;
        $start = new DateTime(sprintf('%04d-%02d-%02d', $year, $mon, $day));
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

/**
 * Ensure an allocation run exists for period_key and return its run_id.
 * Creates the run if missing.
 */
function rl_ensure_run_id_for_period(Database $db, string $periodKey, int $year, int $month, int $week, int $adminId = 0): int {
    // Try existing
    $row = $db->query('SELECT run_id FROM allocation_runs WHERE period_key = ? LIMIT 1', [ $periodKey ])->fetch();
    if ($row && isset($row['run_id'])) return (int)$row['run_id'];
    // Create minimal run
    $db->query('INSERT INTO allocation_runs (period_key, year, month, week, created_by, created_at) VALUES (?,?,?,?,?, NOW())', [
        $periodKey, $year, $month, $week, ($adminId>0?$adminId:null)
    ]);
    $row2 = $db->query('SELECT run_id FROM allocation_runs WHERE period_key = ? LIMIT 1', [ $periodKey ])->fetch();
    return $row2 && isset($row2['run_id']) ? (int)$row2['run_id'] : 0;
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
            // Month parameter now drives which W1..W4 weeks are returned
            $month = isset($_GET['month']) ? trim((string)$_GET['month']) : (new DateTime('now'))->format('Y-m');
            // Respect client-provided week_start (monday|sunday); fallback to stored setting; default to sunday
            $weekStart = isset($_GET['week_start']) ? strtolower(trim((string)$_GET['week_start'])) : '';
            if (!in_array($weekStart, ['sunday','monday'], true)) {
                $weekStart = strtolower((string) rl_get_setting('week_start', 'sunday'));
                if (!in_array($weekStart, ['sunday','monday'], true)) $weekStart = 'sunday';
            }
            $includeCarry = false;
            if (isset($_GET['include_carryover'])) {
                $v = strtolower(trim((string)$_GET['include_carryover']));
                $includeCarry = in_array($v, ['1','true','yes','on'], true);
            }
            $db = Database::getInstance();
            // Disabled legacy auto-cleanup of recipient_plans on week rollover.
            // Scheduling API is now the source of truth; do not delete historical/planned rows here.

            // Build weeks from the provided month using the selected week basis
            $result = [];
            $resultEx = [];
            $locks = [];
            // Build strictly 4 weeks per month (W1..W4) using fixed week starts from rl_week_start_date_from_month
            $selYear = (int)substr($month, 0, 4);
            $selMonthNum = (int)substr($month, 5, 2);
            for ($i=1; $i<=4; $i++){
                $wStartStr = rl_week_start_date_from_month($month, $i, $weekStart);
                // Derive lock key from computed start date
                $wStart = new DateTime($wStartStr);
                $wn = rl_week_number_basis($wStart, $weekStart);
                $lockKey = sprintf('rl_lock_%04d-W%d', (int)$wStart->format('Y'), $wn);
                $locks['W'.$i] = rl_get_setting_bool($lockKey, false);
                if ($includeCarry) {
                    $rows = $db->query(
                        "SELECT recipient_id FROM recipient_plans WHERE week_start_date = ? ORDER BY CASE WHEN source='carryover' THEN 0 ELSE 1 END, position ASC",
                        [$wStartStr]
                    )->fetchAll();
                } else {
                    $rows = $db->query(
                        "SELECT recipient_id FROM recipient_plans WHERE week_start_date = ? AND source='planned' ORDER BY position ASC",
                        [$wStartStr]
                    )->fetchAll();
                    // Fallback to legacy rows stored by period_key if none by week_start_date
                    if (!$rows || count($rows) === 0) {
                        $periodKey = $month . '-W' . $i;
                        $rows = $db->query(
                            "SELECT recipient_id FROM recipient_plans WHERE period_key = ? AND source='planned' ORDER BY position ASC",
                            [$periodKey]
                        )->fetchAll();
                    }
                }
                $idsAll = array_map(fn($r)=> (int)$r['recipient_id'], $rows ?: []);
                $inMonth = ((int)$wStart->format('n') === $selMonthNum && (int)$wStart->format('Y') === $selYear);
                $result['W'.$i] = $idsAll;
                $resultEx[] = [
                    'year' => (int)$wStart->format('Y'),
                    'month' => (int)$wStart->format('n'),
                    'week' => $i,
                    'start_date' => $wStartStr,
                    'ids' => $result['W'.$i],
                    'locked' => $locks['W'.$i] ?? false,
                    'in_month' => $inMonth,
                ];
            }
            sendJson(['success' => true, 'data' => [
                'month' => $month,
                'weeks' => $result,
                'weeks_ex' => $resultEx,
                'week_start' => $weekStart,
                'locks' => $locks,
            ]]);
            break;

        case 'save_plan':
            requireRole(['admin']);
            $adminId = (int)(currentUserId() ?? 0);
            $month = isset($payload['month']) ? trim((string)$payload['month']) : '';
            if ($month === '' || !preg_match('/^\d{4}-\d{2}$/', $month)) {
                $month = (new DateTime('now'))->format('Y-m');
            }
            // Respect provided week_start in payload or stored setting; default to sunday
            $weekBasis = isset($payload['week_start']) ? strtolower(trim((string)$payload['week_start'])) : '';
            if (!in_array($weekBasis, ['sunday','monday'], true)) {
                $weekBasis = strtolower((string) rl_get_setting('week_start', 'sunday'));
                if (!in_array($weekBasis, ['sunday','monday'], true)) $weekBasis = 'sunday';
            }
            $weeksData = $payload['weeks'] ?? [];
            if (!is_array($weeksData)) { sendJson(['success' => false, 'error' => 'weeks must be an object'], 400); }
            $db = Database::getInstance();
            // Parse selected month to fix year/month attribution
            $yearParam = null; $monParam = null;
            if (preg_match('/^(\d{4})-(\d{2})$/', $month, $mm)) { $yearParam = (int)$mm[1]; $monParam = (int)$mm[2]; }
            // Map week key to index for quick lookup (W1..W4 only)
            $wkIndex = ['W1'=>0,'W2'=>1,'W3'=>2,'W4'=>3];
            foreach ($weeksData as $wk => $list) {
                if (!isset($wkIndex[$wk])) continue; // ignore unknown keys
                $i = $wkIndex[$wk]; // 0..3
                $ids = is_array($list) ? array_values(array_filter(array_map('intval', $list), fn($v)=>$v>0)) : [];
                // Compute week_start_date from provided month and index (i+1)
                $wStartStr = rl_week_start_date_from_month($month, $i+1, $weekBasis);
                $wStart = new DateTime($wStartStr);
                $periodKey = $month.'-'.$wk; // kept for compatibility
                // Ensure allocation run exists and resolve run_id for this period
                $yyForRun = ($yearParam !== null) ? $yearParam : (int)$wStart->format('Y');
                $mnForRun = ($monParam !== null) ? $monParam : (int)$wStart->format('n');
                $wkForRun = ($i+1);
                $runId = rl_ensure_run_id_for_period($db, $periodKey, $yyForRun, $mnForRun, $wkForRun, $adminId);
                // Replace planned rows for this week_start_date (only for this provided week)
                // Also delete any legacy rows saved by period_key to ensure clearing works
                $db->query("DELETE FROM recipient_plans WHERE week_start_date = ? AND source = 'planned'", [$wStartStr]);
                $db->query("DELETE FROM recipient_plans WHERE period_key = ? AND source = 'planned'", [$periodKey]);
                // If week is cleared (no ids), also remove carryover rows for this exact week to truly empty UI
                if (count($ids) === 0) {
                    $db->query("DELETE FROM recipient_plans WHERE week_start_date = ? AND source = 'carryover'", [$wStartStr]);
                    $db->query("DELETE FROM recipient_plans WHERE period_key = ? AND source = 'carryover'", [$periodKey]);
                }
                $pos = 0;
                foreach ($ids as $rid) {
                    // Year/Month should reflect selected month (not the calendar month of week_start_date)
                    $yy = ($yearParam !== null) ? $yearParam : (int)$wStart->format('Y');
                    $mn = ($monParam !== null) ? $monParam : (int)$wStart->format('n');
                    $db->query(
                        "INSERT INTO recipient_plans (period_key, year, month, week, recipient_id, source, position, week_start_date, week_basis, run_id) VALUES (?,?,?,?,?, 'planned', ?, ?, ?, ?)",
                        [ $periodKey, $yy, $mn, ($i+1), $rid, $pos++, $wStartStr, $weekBasis, $runId ]
                    );
                }
                // Set or remove lock flag for this provided week only
                $wn = rl_week_number_basis($wStart, $weekBasis);
                $lockKey = sprintf('rl_lock_%04d-W%d', (int)$wStart->format('Y'), $wn);
                if (count($ids) > 0) {
                    rl_set_setting($lockKey, '1');
                } else {
                    try { $db->query('DELETE FROM settings WHERE `key` = ?', [$lockKey]); } catch (Throwable $e) { /* ignore */ }
                }

                // Emit admin-only notification summarizing this week's plan save
                try {
                    $admins = $db->query("SELECT user_id FROM users WHERE role = 'admin'")->fetchAll();
                    if ($admins) {
                        $count = count($ids);
                        $msg = sprintf('Saved plan for %s %s: %d recipient%s', $month, $wk, $count, $count===1?'':'s');
                        foreach ($admins as $a) {
                            $db->query(
                                "INSERT INTO notifications (user_id, type, reference_type, reference_id, message, read_status, created_at) VALUES (?,?,?,?,?,0,NOW())",
                                [ (int)$a['user_id'], 'plan_saved', 'allocation_run', $runId, $msg ]
                            );
                        }
                    }
                } catch (Throwable $e) { /* non-fatal */ }
            }
            sendJson(['success' => true, 'message' => 'Plan saved and locks updated']);
            break;

        case 'notify_new_week':
            requireRole(['admin']);
            try {
                $today = new DateTime('now');
                $year = (int)$today->format('Y');
                $month = (int)$today->format('n');
                $day = (int)$today->format('j');

                $dayMap = [1, 8, 15, 22];
                $startDay = null;
                foreach ($dayMap as $candidate) {
                    if ($day >= $candidate) {
                        $startDay = $candidate;
                    }
                }
                if ($startDay === null) {
                    $startDay = 1;
                }

                $weekIndex = array_search($startDay, $dayMap, true);
                if ($weekIndex === false) {
                    $weekIndex = 0;
                }
                $weekNumber = $weekIndex + 1;

                $startDateStr = sprintf('%04d-%02d-%02d', $year, $month, $startDay);
                $settingKey = 'rl_last_week_notification';
                $last = (string)rl_get_setting($settingKey, '');
                if ($last === $startDateStr) {
                    sendJson(['success' => true, 'data' => ['message' => 'Already notified for this week.']]);
                    break;
                }

                $db = Database::getInstance();
                $admins = $db->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll();
                if ($admins && count($admins) > 0) {
                    $notif = new Notification();
                    $startDateObj = new DateTime($startDateStr);
                    $formatted = $startDateObj->format('F j, Y');
                    $msg = sprintf('Week %d distribution (starting %s) has begun. Review recipient plans.', $weekNumber, $formatted);
                    foreach ($admins as $row) {
                        $uid = (int)($row['user_id'] ?? 0);
                        if ($uid <= 0) continue;
                        try {
                            $notif->create([
                                'user_id' => $uid,
                                'type' => 'week_rollover',
                                'reference_type' => 'recipient_week',
                                'reference_id' => null,
                                'message' => $msg,
                            ]);
                        } catch (Throwable $e) {
                            /* ignore per-admin failure */
                        }
                    }
                }

                rl_set_setting($settingKey, $startDateStr);
                sendJson(['success' => true, 'message' => 'Admin notifications queued']);
            } catch (Throwable $e) {
                sendJson(['success' => false, 'error' => 'Failed to notify admins'], 500);
            }
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
                // Derive y,m from monthStr and use week index from $wIndex
                $db->query(
                    "INSERT INTO recipient_plans (period_key, year, month, week, recipient_id, source, position, week_start_date, week_basis) VALUES (?,?,?,?,?, 'carryover', ?, ?, ?)",
                    [ $periodKey, (int)$year, (int)$mon, (int)$wIndex, $rid, -$cCount + $i, $wkStartDate, $weekBasis ]
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
                // Derive year,month,week from pk / wkStartDate
                if (preg_match('/^(\d{4})-(\d{2})-W([1-4])$/', $pk, $pm)) {
                    $py = (int)$pm[1]; $pmn = (int)$pm[2]; $pwi = (int)$pm[3];
                } else { $py = (int)date('Y'); $pmn = (int)date('n'); $pwi = 1; }
                if ($row) {
                    if ($statusVal === 'served') {
                        $db->query("UPDATE recipient_attendance SET status='served', served_count = ?, last_served_at = NOW(), week_start_date = COALESCE(week_start_date, ?), week_basis = COALESCE(week_basis, ?), year = COALESCE(year, ?), month = COALESCE(month, ?), week = COALESCE(week, ?) WHERE period_key = ? AND recipient_id = ?", [ max(1, (int)$row['served_count'] + 1), $wkStartDate, $weekBasis, $py, $pmn, $pwi, $pk, $rid ]);
                    } else {
                        $db->query("UPDATE recipient_attendance SET status='absent', week_start_date = COALESCE(week_start_date, ?), week_basis = COALESCE(week_basis, ?), year = COALESCE(year, ?), month = COALESCE(month, ?), week = COALESCE(week, ?) WHERE period_key = ? AND recipient_id = ?", [ $wkStartDate, $weekBasis, $py, $pmn, $pwi, $pk, $rid ]);
                    }
                } else {
                    if ($statusVal === 'served') {
                        $db->query("INSERT INTO recipient_attendance (period_key, year, month, week, recipient_id, status, served_count, last_served_at, week_start_date, week_basis) VALUES (?,?,?,?,?, 'served', 1, NOW(), ?, ?)", [$pk, $py, $pmn, $pwi, $rid, $wkStartDate, $weekBasis]);
                    } else {
                        $db->query("INSERT INTO recipient_attendance (period_key, year, month, week, recipient_id, status, served_count, last_served_at, week_start_date, week_basis) VALUES (?,?,?,?,?, 'absent', 0, NULL, ?, ?)", [$pk, $py, $pmn, $pwi, $rid, $wkStartDate, $weekBasis]);
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
