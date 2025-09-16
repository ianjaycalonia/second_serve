<?php
require_once __DIR__ . '/../includes/config.php';

class QuarterlyDistribution
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // Ensure the quarterly status table exists (idempotent)
    private function ensureTable(): void
    {
        $this->db->query(<<<SQL
CREATE TABLE IF NOT EXISTS `distribution_quarter_status` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `quarter_key` varchar(8) NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `served_count` int(11) NOT NULL DEFAULT 0,
  `last_served_at` timestamp NULL DEFAULT NULL,
  `skipped_pending` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_quarter_recipient` (`quarter_key`,`recipient_id`),
  KEY `dqs_recipient_idx` (`recipient_id`),
  CONSTRAINT `dqs_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
)
ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
SQL);
    }

    public static function currentQuarterKey(?DateTime $when = null): string
    {
        $when = $when ?: new DateTime('now');
        $m = (int)$when->format('n');
        $q = (int)ceil($m / 3);
        return $when->format('Y') . '-Q' . $q;
    }

    public static function quarterMonthsFromKey(string $quarterKey): array
    {
        if (!preg_match('/^(\d{4})-Q([1-4])$/', $quarterKey, $m)) {
            throw new Exception('Invalid quarter_key');
        }
        $year = (int)$m[1];
        $q = (int)$m[2];
        $startMonth = ($q - 1) * 3 + 1; // 1,4,7,10
        $months = [];
        for ($i = 0; $i < 3; $i++) {
            $month = $startMonth + $i;
            $months[] = sprintf('%04d-%02d-01', $year, $month);
        }
        return $months;
    }

    private function ensureStatusRows(string $quarterKey, array $poolRecipientIds): void
    {
        $this->ensureTable();
        if (empty($poolRecipientIds)) return;
        // Insert missing rows
        $values = [];
        $params = [];
        foreach ($poolRecipientIds as $rid) {
            $values[] = '(?,?,0,NULL,0)';
            $params[] = $quarterKey; $params[] = (int)$rid;
        }
        if ($values) {
            $sql = 'INSERT INTO distribution_quarter_status (quarter_key, recipient_id, served_count, last_served_at, skipped_pending) VALUES '
                 . implode(',', $values)
                 . ' ON DUPLICATE KEY UPDATE quarter_key = quarter_key';
            $this->db->query($sql, $params);
        }
        // Remove status rows not in pool (defensive cleanup)
        $placeholders = implode(',', array_fill(0, count($poolRecipientIds), '?'));
        $params2 = array_merge([$quarterKey], array_map('intval', $poolRecipientIds));
        $this->db->query(
            "DELETE FROM distribution_quarter_status WHERE quarter_key = ? AND recipient_id NOT IN ($placeholders)",
            $params2
        );
    }

    private function loadQuarterPool(string $quarterKey): array
    {
        $months = self::quarterMonthsFromKey($quarterKey);
        $placeholders = implode(',', array_fill(0, count($months), '?'));
        $rows = $this->db->query(
            "SELECT DISTINCT u.user_id
             FROM recipient_month_assignments rma
             JOIN users u ON u.user_id = rma.recipient_id
             WHERE rma.`month` IN ($placeholders)",
            $months
        )->fetchAll();
        return array_map(fn($r)=> (int)$r['user_id'], $rows);
    }

    public function suggest(string $quarterKey, int $roundSize): array
    {
        $this->ensureTable();
        $roundSize = max(1, $roundSize);
        // Build pool and ensure status rows exist
        $pool = $this->loadQuarterPool($quarterKey);
        $this->ensureStatusRows($quarterKey, $pool);
        if (empty($pool)) return [];
        // Load status
        $place = implode(',', array_fill(0, count($pool), '?'));
        $params = array_merge([$quarterKey], $pool);
        $rows = $this->db->query(
            "SELECT recipient_id, served_count, skipped_pending, last_served_at
             FROM distribution_quarter_status
             WHERE quarter_key = ? AND recipient_id IN ($place)",
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
        // Order served by served_count asc then last_served_at asc (already grouped by >0)
        usort($served, function($a,$b) use ($byId){
            $sa = (int)($byId[$a]['served_count'] ?? 0);
            $sb = (int)($byId[$b]['served_count'] ?? 0);
            if ($sa === $sb) {
                $la = $byId[$a]['last_served_at'] ?? null;
                $lb = $byId[$b]['last_served_at'] ?? null;
                return strcmp((string)$la, (string)$lb);
            }
            return $sa <=> $sb;
        });

        $order = array_merge($skipped, $unserved, $served);
        return array_slice($order, 0, $roundSize);
    }

    public function markResult(string $quarterKey, array $servedIds, array $skippedIds): void
    {
        $this->ensureTable();
        $servedIds = array_values(array_unique(array_map('intval', array_filter($servedIds, fn($v)=>$v>0))));
        $skippedIds = array_values(array_unique(array_map('intval', array_filter($skippedIds, fn($v)=>$v>0))));
        if (empty($servedIds) && empty($skippedIds)) return;
        $this->db->beginTransaction();
        try {
            // Ensure rows exist for all ids that appear here
            $pool = array_values(array_unique(array_merge($servedIds, $skippedIds)));
            $this->ensureStatusRows($quarterKey, $pool);
            if ($servedIds) {
                $place = implode(',', array_fill(0, count($servedIds), '?'));
                $params = array_merge([$quarterKey], $servedIds);
                $this->db->query(
                    "UPDATE distribution_quarter_status
                     SET served_count = served_count + 1, last_served_at = NOW(), skipped_pending = 0
                     WHERE quarter_key = ? AND recipient_id IN ($place)",
                    $params
                );
            }
            if ($skippedIds) {
                $place = implode(',', array_fill(0, count($skippedIds), '?'));
                $params = array_merge([$quarterKey], $skippedIds);
                $this->db->query(
                    "UPDATE distribution_quarter_status
                     SET skipped_pending = 1
                     WHERE quarter_key = ? AND recipient_id IN ($place)",
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
