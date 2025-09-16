<?php
require_once __DIR__ . '/../includes/config.php';

class RecipientAssignments
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // Ensure the table exists (idempotent)
    private function ensureTable(): void
    {
        $this->db->query(<<<SQL
CREATE TABLE IF NOT EXISTS `recipient_month_assignments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `month` date NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `assigned_by` int(11) DEFAULT NULL,
  `assigned_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_month_recipient` (`month`,`recipient_id`),
  KEY `rma_recipient_idx` (`recipient_id`),
  KEY `rma_assigned_by_idx` (`assigned_by`),
  CONSTRAINT `rma_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rma_assigned_by_fk` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
)
ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
SQL);
    }

    // Normalize input like '2025-09' or '2025-09-15' to canonical 'YYYY-MM-01'
    public static function normalizeMonth(string $month): string
    {
        $m = trim($month);
        if (preg_match('/^\d{4}-\d{2}$/', $m)) {
            return $m . '-01';
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $m)) {
            return substr($m, 0, 7) . '-01';
        }
        // fallback to current month
        return date('Y-m-01');
    }

    // Get assignments for a list of months. Returns [ 'YYYY-MM-01' => [ {user...}, ... ], ... ]
    public function getAssignments(array $months): array
    {
        $this->ensureTable();
        if (empty($months)) return [];
        $canon = array_values(array_unique(array_map([self::class, 'normalizeMonth'], $months)));
        $placeholders = implode(',', array_fill(0, count($canon), '?'));
        $rows = $this->db->query(
            "SELECT rma.`month`, u.user_id, u.name, u.email, u.organization_name, u.address, u.contact_number
             FROM recipient_month_assignments rma
             JOIN users u ON u.user_id = rma.recipient_id
             WHERE rma.`month` IN ($placeholders)",
            $canon
        )->fetchAll();
        $out = [];
        foreach ($canon as $m) $out[$m] = [];
        foreach ($rows as $r) {
            $out[$r['month']][] = [
                'user_id' => (int)$r['user_id'],
                'name' => $r['name'],
                'email' => $r['email'],
                'organization_name' => $r['organization_name'],
                'address' => $r['address'],
                'contact_number' => $r['contact_number'],
            ];
        }
        return $out;
    }

    // Replace assignments for a month with the given set of recipient IDs
    public function saveAssignments(string $month, array $recipientIds, ?int $adminId = null): void
    {
        $this->ensureTable();
        $m = self::normalizeMonth($month);
        // Filter numeric recipient IDs
        $ids = array_values(array_unique(array_map('intval', array_filter($recipientIds, fn($v) => is_numeric($v)))));
        $this->db->beginTransaction();
        try {
            // Delete existing for this month
            $this->db->query('DELETE FROM recipient_month_assignments WHERE `month` = ?', [$m]);
            // Insert new ones
            foreach ($ids as $rid) {
                $this->db->query(
                    'INSERT INTO recipient_month_assignments (`month`, recipient_id, assigned_by) VALUES (?,?,?)',
                    [$m, $rid, $adminId]
                );
            }
            $this->db->commit();
        } catch (Exception $e) {
            if ($this->db->inTransaction()) { $this->db->rollBack(); }
            throw $e;
        }
    }
}
