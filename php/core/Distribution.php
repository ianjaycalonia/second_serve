<?php
require_once __DIR__ . '/../includes/config.php';

class Distribution
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // Ensure table exists (idempotent)
    private function ensureTable(): void
    {
        $this->db->query(<<<SQL
CREATE TABLE IF NOT EXISTS `distribution_period_status` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_key` varchar(12) NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `served_count` int(11) NOT NULL DEFAULT 0,
  `last_served_at` timestamp NULL DEFAULT NULL,
  `skipped_pending` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_period_recipient` (`period_key`,`recipient_id`),
  KEY `dps_recipient_idx` (`recipient_id`),
  CONSTRAINT `dps_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
SQL);
        // Auxiliary table for selection logs (recipient_specialties removed; now using recipient_profiles.specialty)
        $this->db->query(<<<SQL
CREATE TABLE IF NOT EXISTS `distribution_selection_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_key` varchar(12) NOT NULL,
  `period_type` enum('weekly','monthly','quarterly') NOT NULL,
  `pool_type` enum('general','specialty') NOT NULL,
  `specialty_key` varchar(64) DEFAULT NULL,
  `round_size` int(11) NOT NULL,
  `selected_ids_json` text NOT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `dsl_period_idx` (`period_key`,`period_type`),
  KEY `dsl_created_by_idx` (`created_by`),
  CONSTRAINT `dsl_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
SQL);
    }

    public static function currentPeriodKey(string $type): string
    {
        $type = strtolower($type);
        $now = new DateTime('now');
        if ($type === 'weekly') {
            // ISO week
            return $now->format('o') . '-W' . $now->format('W');
        } elseif ($type === 'monthly') {
            return $now->format('Y-m');
        } else { // quarterly
            $m = (int)$now->format('n');
            $q = (int)ceil($m / 3);
            return $now->format('Y') . '-Q' . $q;
        }
    }

    public static function normalizePeriodKey(string $type, ?string $key): string
    {
        if (is_string($key)) {
            $key = trim($key);
        }
        $type = strtolower($type);
        if ($type === 'weekly') {
            if (is_string($key) && preg_match('/^\d{4}-W\d{2}$/', $key)) return $key;
            return self::currentPeriodKey('weekly');
        } elseif ($type === 'monthly') {
            if (is_string($key) && preg_match('/^\d{4}-\d{2}$/', $key)) return $key;
            return self::currentPeriodKey('monthly');
        } else {
            if (is_string($key) && preg_match('/^\d{4}-Q[1-4]$/', $key)) return $key;
            return self::currentPeriodKey('quarterly');
        }
    }

    public static function monthsForPeriod(string $type, string $periodKey): array
    {
        $type = strtolower($type);
        if ($type === 'weekly') {
            // Derive the month containing the Monday of this ISO week
            $dt = DateTime::createFromFormat('o-\WW', $periodKey);
            if (!$dt) { $dt = new DateTime('now'); }
            return [$dt->format('Y-m-01')];
        } elseif ($type === 'monthly') {
            // YYYY-MM
            if (!preg_match('/^(\d{4})-(\d{2})$/', $periodKey, $m)) {
                $dt = new DateTime('now');
                return [$dt->format('Y-m-01')];
            }
            return [sprintf('%04d-%02d-01', (int)$m[1], (int)$m[2])];
        } else { // quarterly
            if (!preg_match('/^(\d{4})-Q([1-4])$/', $periodKey, $m)) {
                $dt = new DateTime('now');
                $month = (int)$dt->format('n');
                $q = (int)ceil($month / 3);
                $year = (int)$dt->format('Y');
                $startMonth = ($q - 1) * 3 + 1;
                return [ sprintf('%04d-%02d-01', $year, $startMonth), sprintf('%04d-%02d-01', $year, $startMonth+1), sprintf('%04d-%02d-01', $year, $startMonth+2) ];
            }
            $year = (int)$m[1];
            $q = (int)$m[2];
            $startMonth = ($q - 1) * 3 + 1;
            return [ sprintf('%04d-%02d-01', $year, $startMonth), sprintf('%04d-%02d-01', $year, $startMonth+1), sprintf('%04d-%02d-01', $year, $startMonth+2) ];
        }
    }

    private function ensureStatusRows(string $periodKey, array $poolRecipientIds): void
    {
        if (empty($poolRecipientIds)) return;
        $values = [];
        $params = [];
        foreach ($poolRecipientIds as $rid) {
            $values[] = '(?,?,0,NULL,0)';
            $params[] = $periodKey; $params[] = (int)$rid;
        }
        if ($values) {
            $sql = 'INSERT INTO distribution_period_status (period_key, recipient_id, served_count, last_served_at, skipped_pending) VALUES '
                 . implode(',', $values)
                 . ' ON DUPLICATE KEY UPDATE period_key = period_key';
            $this->db->query($sql, $params);
        }
        $placeholders = implode(',', array_fill(0, count($poolRecipientIds), '?'));
        $params2 = array_merge([$periodKey], array_map('intval', $poolRecipientIds));
        $this->db->query(
            "DELETE FROM distribution_period_status WHERE period_key = ? AND recipient_id NOT IN ($placeholders)",
            $params2
        );
    }

    // General pool: all approved recipients
    private function loadGeneralPool(): array
    {
        $rows = $this->db->query(
            "SELECT user_id FROM users WHERE role='recipient' AND status='approved'"
        )->fetchAll();
        return array_map(fn($r)=> (int)$r['user_id'], $rows);
    }

    // Specialty/OrgType pool: approved recipients filtered by recipient_profiles.organization_type
    // For backward compatibility, the parameter name is kept as $specialtyKey but it represents organization_type
    private function loadSpecialtyPool(string $specialtyKey): array
    {
        $rows = $this->db->query(
            "SELECT u.user_id
             FROM users u
             JOIN recipient_profiles rp ON rp.user_id = u.user_id
             WHERE u.role='recipient' AND u.status='approved' AND rp.organization_type = ?",
            [$specialtyKey]
        )->fetchAll();
        return array_map(fn($r)=> (int)$r['user_id'], $rows);
    }

    public function suggest(string $periodType, ?string $periodKey, int $roundSize, string $poolType = 'general', ?string $specialtyKey = null, ?int $adminId = null): array
    {
        $this->ensureTable();
        $periodType = strtolower($periodType);
        $pKey = self::normalizePeriodKey($periodType, $periodKey);
        // Fairness reset is monthly: derive a monthly key for status tracking
        $monthlyKey = self::normalizePeriodKey('monthly', substr($pKey, 0, 7));

        // Load pool per type
        $poolType = ($poolType === 'specialty') ? 'specialty' : 'general';
        if ($poolType === 'specialty') {
            $spec = is_string($specialtyKey) ? trim($specialtyKey) : '';
            if ($spec === '') { return ['period_key' => $pKey, 'recipient_ids' => []]; }
            $pool = $this->loadSpecialtyPool($spec);
        } else {
            $pool = $this->loadGeneralPool();
        }
        $this->ensureStatusRows($monthlyKey, $pool);
        if (empty($pool)) return ['period_key' => $pKey, 'recipient_ids' => []];
        // Load status
        $place = implode(',', array_fill(0, count($pool), '?'));
        $params = array_merge([$monthlyKey], $pool);
        $rows = $this->db->query(
            "SELECT recipient_id, served_count, skipped_pending, last_served_at
             FROM distribution_period_status
             WHERE period_key = ? AND recipient_id IN ($place)",
            $params
        )->fetchAll();
        $byId = [];
        foreach ($rows as $r) { $byId[(int)$r['recipient_id']] = $r; }
        $skipped = [];
        $unserved = [];
        $served = [];
        foreach ($pool as $rid) {
            $st = $byId[$rid] ?? ['served_count'=>0,'skipped_pending'=>0,'last_served_at'=>null];
            if ((int)$st['skipped_pending'] === 1) {
                $skipped[] = $rid;
            } elseif ((int)$st['served_count'] === 0) {
                $unserved[] = $rid;
            } else {
                $served[] = $rid;
            }
        }
        usort($served, function($a,$b) use ($byId){
            $sa = (int)($byId[$a]['served_count'] ?? 0);
            $sb = (int)($byId[$b]['served_count'] ?? 0);
            if ($sa === $sb) {
                $la = $byId[$a]['last_served_at'] ?? '';
                $lb = $byId[$b]['last_served_at'] ?? '';
                return strcmp((string)$la, (string)$lb);
            }
            return $sa <=> $sb;
        });
        // Apply weekly cap and randomization rules
        $roundSize = max(1, $roundSize);
        $cap = ($periodType === 'weekly') ? 10 : $roundSize;
        $target = ($periodType === 'weekly') ? min($roundSize, $cap) : $roundSize;

        $picked = [];
        // Always take skipped first (in current order)
        foreach ($skipped as $rid) {
            if (count($picked) >= $target) break; $picked[] = $rid;
        }
        if (count($picked) < $target) {
            $remaining = $target - count($picked);
            if (count($unserved) > $remaining) {
                // Randomly sample remaining from unserved
                $idx = range(0, count($unserved)-1);
                shuffle($idx);
                for ($i=0; $i<count($unserved) && $remaining>0; $i++) {
                    $rid = $unserved[$idx[$i]];
                    $picked[] = $rid; $remaining--;
                }
            } else {
                // Take all unserved
                foreach ($unserved as $rid) { if (count($picked) >= $target) break; $picked[] = $rid; }
                // If still short, allow repeats from served in fairness order
                foreach ($served as $rid) { if (count($picked) >= $target) break; $picked[] = $rid; }
            }
        }

        // Log selection for transparency
        try {
            $this->db->query(
                "INSERT INTO distribution_selection_logs (period_key, period_type, pool_type, specialty_key, round_size, selected_ids_json, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
                [
                    $pKey,
                    $periodType,
                    $poolType,
                    $poolType === 'specialty' ? $specialtyKey : null,
                    $roundSize,
                    json_encode($picked),
                    $adminId
                ]
            );
        } catch (Exception $e) { /* logging best-effort */ }

        $leftover = max(0, $roundSize - count($picked));
        return ['period_key' => $pKey, 'recipient_ids' => $picked, 'leftover_slots' => $leftover];
    }

    public function markResult(string $periodType, ?string $periodKey, array $servedIds, array $skippedIds): void
    {
        $this->ensureTable();
        $pKey = self::normalizePeriodKey($periodType, $periodKey);
        $servedIds = array_values(array_unique(array_map('intval', array_filter($servedIds, fn($v)=>$v>0))));
        $skippedIds = array_values(array_unique(array_map('intval', array_filter($skippedIds, fn($v)=>$v>0))));
        if (empty($servedIds) && empty($skippedIds)) return;
        $this->db->beginTransaction();
        try {
            $pool = array_values(array_unique(array_merge($servedIds, $skippedIds)));
            $this->ensureStatusRows($pKey, $pool);
            if ($servedIds) {
                $place = implode(',', array_fill(0, count($servedIds), '?'));
                $params = array_merge([$pKey], $servedIds);
                $this->db->query(
                    "UPDATE distribution_period_status
                     SET served_count = served_count + 1, last_served_at = NOW(), skipped_pending = 0
                     WHERE period_key = ? AND recipient_id IN ($place)",
                    $params
                );
            }
            if ($skippedIds) {
                $place = implode(',', array_fill(0, count($skippedIds), '?'));
                $params = array_merge([$pKey], $skippedIds);
                $this->db->query(
                    "UPDATE distribution_period_status
                     SET skipped_pending = 1
                     WHERE period_key = ? AND recipient_id IN ($place)",
                    $params
                );
            }
            $this->db->commit();
        } catch (Exception $e) {
            if ($this->db->inTransaction()) { $this->db->rollBack(); }
            throw $e;
        }
    }
}
