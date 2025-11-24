<?php
require_once __DIR__ . '/../includes/config.php';

class SchedulingEngine
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // Public API
    public function scheduleMonth(int $year, int $month, int $defaultCapacity = 10): array
    {
        $weeks = $this->ensureWeeksForMonth($year, $month, $defaultCapacity);
        // Preassigned from legacy recipient_plans for compatibility
        $preassigned = $this->loadLegacyPlanned($year, $month);
        // Build or refresh assignments for each week
        foreach ($weeks as $wk) {
            $weekId = (int)$wk['id'];
            $index = (int)$wk['week_number'];
            // keep existing week_recipients; do not auto-wipe manual overrides
            $current = $this->listWeekRecipients($weekId);
            $occupied = count($current);
            // capacity from weeks table with default fallback
            $capacity = isset($wk['capacity']) && (int)$wk['capacity'] > 0 ? (int)$wk['capacity'] : $defaultCapacity;
            $need = max(0, $capacity - $occupied);
            if ($need <= 0) continue;
            // preassigned for this week_index from legacy plans
            $pre = $preassigned[$index] ?? [];
            $already = array_column($current, 'recipient_id');
            // Add preassigned first
            foreach ($pre as $rid) {
                if ($need <= 0) break;
                if (in_array($rid, $already, true)) continue;
                $this->assignRecipient($weekId, $rid, 'Scheduled', null, 'legacy-planned');
                $already[] = $rid; $need--;
            }
            if ($need <= 0) continue;
            // Fill remaining from reserve pool (simple heuristic: approved recipients not already scheduled in this week)
            $pool = $this->reservePool($already, $year, $month, $index);
            foreach ($pool as $rid) {
                if ($need <= 0) break;
                $this->assignRecipient($weekId, $rid, 'Scheduled', null, 'reserve');
                $need--;
            }
        }
        return $this->getMonthSchedule($year, $month);
    }

    public function getMonthSchedule(int $year, int $month): array
    {
        $weeks = $this->db->query('SELECT * FROM weeks WHERE year = ? AND month = ? ORDER BY week_number ASC', [$year, $month])->fetchAll() ?: [];
        $out = [];
        foreach ($weeks as $wk) {
            $items = $this->listWeekRecipientsDetailed((int)$wk['id']);
            $out[] = [ 'week' => $wk, 'recipients' => $items ];
        }
        return $out;
    }

    public function markStatus(int $weekRecipientId, string $status): bool
    {
        $status = $this->normalizeStatus($status);
        if (!$status) return false;
        $this->db->query('UPDATE week_recipients SET status = ?, updated_at = NOW() WHERE id = ?', [$status, $weekRecipientId]);
        return true;
    }

    public function processWeekResults(int $weekId): array
    {
        $week = $this->db->query('SELECT * FROM weeks WHERE id = ? LIMIT 1', [$weekId])->fetch();
        if (!$week) return ['changed'=>0];
        $changed = 0;
        $rows = $this->listWeekRecipients($weekId);
        // Handle cancellations: replace immediately
        foreach ($rows as $r) {
            if ($r['status'] === 'Cancelled') {
                $repl = $this->findReplacement((int)$weekId);
                if ($repl) {
                    $this->assignRecipient($weekId, $repl, 'Scheduled', (int)$r['id'], 'replacement');
                    $changed++;
                }
            }
        }
        // Handle absents: carry to next week or roll to next month W1
        foreach ($rows as $r) {
            if ($r['status'] === 'Absent') {
                $target = $this->getNextWeek((int)$weekId);
                if ($target) {
                    $this->assignRecipient((int)$target['id'], (int)$r['recipient_id'], 'CarriedOver', null, 'absent-carry');
                } else {
                    $nextMonth = $this->getFirstWeekOfNextMonth((int)$week['year'], (int)$week['month']);
                    if ($nextMonth) {
                        $this->assignRecipient((int)$nextMonth['id'], (int)$r['recipient_id'], 'RolledOver', null, 'month-rollover');
                    }
                }
                $changed++;
            }
        }
        return ['changed'=>$changed];
    }

    // Helpers
    private function ensureWeeksForMonth(int $year, int $month, int $defaultCapacity = 10): array
    {
        $basis = $this->getWeekStart();
        $starts = $this->computeWeekStarts($year, $month, $basis);
        // Upsert weeks 1..n
        $rows = [];
        $idx = 1;
        foreach ($starts as $start) {
            $end = (clone $start)->modify('+6 day');
            $this->db->query(
                'INSERT INTO weeks (year, month, week_number, capacity, start_date, end_date) VALUES (?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE start_date = VALUES(start_date), end_date = VALUES(end_date), capacity = COALESCE(weeks.capacity, VALUES(capacity))'
                , [$year, $month, $idx, $defaultCapacity, $start->format('Y-m-d'), $end->format('Y-m-d')]
            );
            $row = $this->db->query('SELECT * FROM weeks WHERE year = ? AND month = ? AND week_number = ? LIMIT 1', [$year, $month, $idx])->fetch();
            if ($row) $rows[] = $row;
            $idx++;
        }
        return $rows;
    }

    private function getWeekStart(): string
    {
        try {
            $row = $this->db->query("SELECT `value` FROM settings WHERE `key`='week_start' LIMIT 1", [])->fetch();
            $val = strtolower((string)($row['value'] ?? 'sunday'));
            return ($val === 'monday') ? 'monday' : 'sunday';
        } catch (Throwable $e) { return 'sunday'; }
    }

    private function computeWeekStarts(int $year, int $month, string $basis): array
    {
        $basis = ($basis === 'monday') ? 'monday' : 'sunday';
        $first = new DateTime(sprintf('%04d-%02d-01', $year, $month));
        $dow = (int)$first->format('w'); // 0=Sun..6=Sat
        $targetDow = ($basis === 'monday') ? 1 : 0;
        $offset = ($dow - $targetDow + 7) % 7; // back to week start
        $firstStart = (clone $first)->modify('-'.$offset.' day');
        $starts = [];
        $cursor = clone $firstStart;
        // generate starts that overlap this month; allow up to 5
        for ($i=0; $i<6; $i++){
            $weekEnd = (clone $cursor)->modify('+6 day');
            // include any week that has at least one day within this month
            if ((int)$cursor->format('n') === $month || (int)$weekEnd->format('n') === $month) {
                $starts[] = clone $cursor;
            }
            // stop if next start moves beyond month and we already have at least 4
            $next = (clone $cursor)->modify('+7 day');
            if ((int)$next->format('n') !== $month && count($starts) >= 4) {
                // permit 5th if still overlapping current month
                if ((int)$cursor->format('n') === $month && (int)$weekEnd->format('n') === $month) {
                    $cursor = $next; // allow consider once more
                }
                break;
            }
            $cursor = $next;
        }
        // Cap to max 5
        return array_slice($starts, 0, 5);
    }

    private function listWeekRecipients(int $weekId): array
    {
        return $this->db->query('SELECT * FROM week_recipients WHERE week_id = ? ORDER BY id ASC', [$weekId])->fetchAll() ?: [];
    }

    private function listWeekRecipientsDetailed(int $weekId): array
    {
        $rows = $this->db->query(
            'SELECT wr.*, u.name as recipient_name, rp.organization_name
             FROM week_recipients wr
             JOIN users u ON u.user_id = wr.recipient_id
             LEFT JOIN recipient_profiles rp ON rp.user_id = u.user_id
             WHERE wr.week_id = ? ORDER BY wr.id ASC',
            [$weekId]
        )->fetchAll() ?: [];
        // derive display name
        foreach ($rows as &$r){
            $label = trim((string)($r['organization_name'] ?? ''));
            if ($label === '') $label = (string)($r['recipient_name'] ?? '');
            $r['display_name'] = $label;
        }
        return $rows;
    }

    private function assignRecipient(int $weekId, int $recipientId, string $status = 'Scheduled', ?int $replacementFor = null, ?string $note = null): void
    {
        $status = $this->normalizeStatus($status) ?: 'Scheduled';
        $this->db->query(
            'INSERT INTO week_recipients (week_id, recipient_id, status, replacement_for, rationale) VALUES (?,?,?,?,?)',
            [$weekId, $recipientId, $status, $replacementFor, $note]
        );
    }

    private function normalizeStatus(string $status): ?string
    {
        $s = strtolower(trim($status));
        switch ($s) {
            case 'scheduled': return 'Scheduled';
            case 'served': return 'Served';
            case 'absent': return 'Absent';
            case 'cancelled': return 'Cancelled';
            case 'carriedover': case 'carried_over': return 'CarriedOver';
            case 'rolledover': case 'rolled_over': return 'RolledOver';
            default: return null;
        }
    }

    private function getNextWeek(int $weekId): ?array
    {
        $wk = $this->db->query('SELECT year, month, week_index FROM weeks WHERE id = ? LIMIT 1', [$weekId])->fetch();
        if (!$wk) return null;
        $y = (int)$wk['year']; $m = (int)$wk['month']; $i = (int)$wk['week_number'];
        $next = $this->db->query('SELECT * FROM weeks WHERE year = ? AND month = ? AND week_number = ? LIMIT 1', [$y, $m, $i+1])->fetch();
        if ($next) return $next;
        return $this->getFirstWeekOfNextMonth($y, $m);
    }

    private function getFirstWeekOfNextMonth(int $year, int $month): ?array
    {
        $m = $month + 1; $y = $year;
        if ($m > 12) { $m = 1; $y++; }
        $ensure = $this->ensureWeeksForMonth($y, $m);
        foreach ($ensure as $wk) { if ((int)$wk['week_number'] === 1) return $wk; }
        return $ensure[0] ?? null;
    }

    private function findReplacement(int $weekId): ?int
    {
        // Prefer someone not yet in this week and approved recipients
        $current = $this->listWeekRecipients($weekId);
        $already = array_column($current, 'recipient_id');
        $pool = $this->reservePool($already, null, null, null);
        return $pool[0] ?? null;
    }

    private function reservePool(array $excludeIds, ?int $year, ?int $month, ?int $weekIndex): array
    {
        $excludeIds = array_values(array_unique(array_map('intval', $excludeIds)));
        $exPlace = $excludeIds ? (' AND u.user_id NOT IN ('.implode(',', array_fill(0, count($excludeIds), '?')).')') : '';
        $params = $excludeIds;
        $rows = $this->db->query('SELECT u.user_id FROM users u WHERE u.role = "recipient" AND u.status = "approved"'.$exPlace.' ORDER BY u.user_id ASC LIMIT 100', $params)->fetchAll();
        return array_map(fn($r)=> (int)$r['user_id'], $rows ?: []);
    }

    private function loadLegacyPlanned(int $year, int $month): array
    {
        $rows = $this->db->query('SELECT week, recipient_id FROM recipient_plans WHERE year = ? AND month = ? AND source = "planned" ORDER BY position ASC', [$year, $month])->fetchAll();
        $map = [1=>[],2=>[],3=>[],4=>[],5=>[]];
        foreach ($rows as $r){ $wi = max(1, min(5, (int)($r['week'] ?? 0))); $map[$wi][] = (int)$r['recipient_id']; }
        return $map;
    }
}
