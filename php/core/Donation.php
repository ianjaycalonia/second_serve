<?php
require_once __DIR__ . '/../includes/config.php';

class Donation
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // Create a donation record, returns new id
    public function create(array $payload): int
    {
        // First try the new schema with batch_id
        $this->db->beginTransaction();
        try {
            $this->db->query(
                "INSERT INTO donations (donor_id, batch_id, type, name, quantity, expiry_date, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'Pending', NOW())",
                [
                    (int)$payload['donor_id'],
                    $payload['batch_id'] ?? null,
                    $payload['type'],
                    $payload['name'],
                    (int)$payload['quantity'],
                    !empty($payload['expiry_date']) ? $payload['expiry_date'] : null,
                ]
            );
            $id = (int)$this->db->lastInsertId();
            $this->db->commit();
            return $id;
        } catch (Exception $e) {
            $this->db->rollBack();
            // If the DB doesn't yet have batch_id, retry insert without it for backward compatibility
            if (stripos($e->getMessage(), "Unknown column 'batch_id'") !== false) {
                $this->db->beginTransaction();
                try {
                    $this->db->query(
                        "INSERT INTO donations (donor_id, type, name, quantity, expiry_date, status, created_at)
                         VALUES (?, ?, ?, ?, ?, 'Pending', NOW())",
                        [
                            (int)$payload['donor_id'],
                            $payload['type'],
                            $payload['name'],
                            (int)$payload['quantity'],
                            !empty($payload['expiry_date']) ? $payload['expiry_date'] : null,
                        ]
                    );
                    $id = (int)$this->db->lastInsertId();
                    $this->db->commit();
                    return $id;
                } catch (Exception $e2) {
                    $this->db->rollBack();
                    throw $e2;
                }
            }
            throw $e;
        }
    }

    // List donations, optionally by status
    public function list(array $filters = []): array
    {
        $where = [];
        $params = [];
        // exclude archived
        $where[] = 'd.deleted_at IS NULL';
        if (!empty($filters['status'])) { $where[] = 'd.status = ?'; $params[] = $filters['status']; }
        if (!empty($filters['donor_id'])) { $where[] = 'd.donor_id = ?'; $params[] = (int)$filters['donor_id']; }

        $groupMode = isset($filters['group']) && $filters['group'] === 'batch';
        if ($groupMode) {
            // Build base WHERE parts
            $baseWhere = $where ? implode(' AND ', $where) : '';
            $whereSqlGrouped = ' WHERE ' . ($baseWhere ? ($baseWhere . ' AND ') : '') . 'd.batch_id IS NOT NULL';
            $whereSqlSingles = ' WHERE ' . ($baseWhere ? ($baseWhere . ' AND ') : '') . 'd.batch_id IS NULL';
            // Grouped batches: only rows with batch_id NOT NULL are aggregated
            $sqlGrouped = "SELECT 
                            MIN(d.id) AS id,
                            d.donor_id,
                            u.name AS donor_name,
                            u.organization_name AS donor_org,
                            CONCAT('Batch (', COUNT(*), ' items)') AS name,
                            NULL AS type,
                            SUM(d.quantity) AS quantity,
                            NULL AS expiry_date,
                            CASE WHEN MIN(d.status) = MAX(d.status) THEN MIN(d.status) ELSE 'Mixed' END AS status,
                            MAX(d.created_at) AS created_at,
                            d.batch_id AS batch_id,
                            1 AS is_group
                        FROM donations d
                        LEFT JOIN users u ON u.user_id = d.donor_id" . $whereSqlGrouped . "
                        GROUP BY d.donor_id, u.name, u.organization_name, d.batch_id";

            // Ungrouped singles: rows with batch_id NULL are returned as-is
            $sqlSingles = "SELECT 
                            d.id,
                            d.donor_id,
                            u.name AS donor_name,
                            u.organization_name AS donor_org,
                            d.name,
                            d.type,
                            d.quantity,
                            d.expiry_date,
                            d.status,
                            d.created_at,
                            NULL AS batch_id,
                            0 AS is_group
                        FROM donations d
                        LEFT JOIN users u ON u.user_id = d.donor_id" . $whereSqlSingles . "";

            $sql = "SELECT * FROM (" . $sqlGrouped . ") g
                    UNION ALL
                    SELECT * FROM (" . $sqlSingles . ") s
                    ORDER BY created_at DESC
                    LIMIT 500";
            return $this->db->query($sql, $params)->fetchAll();
        } else {
            $sql = "SELECT d.id, d.donor_id, u.name AS donor_name, u.organization_name AS donor_org,
                           d.type, d.name, d.quantity, d.expiry_date, d.status, d.created_at,
                           d.batch_id AS batch_id,
                           0 AS is_group
                    FROM donations d
                    LEFT JOIN users u ON u.user_id = d.donor_id";
            if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
            $sql .= ' ORDER BY d.created_at DESC LIMIT 500';
            return $this->db->query($sql, $params)->fetchAll();
        }
    }

    // Get one donation by id
    public function getById(int $id): ?array
    {
        $row = $this->db->query(
            "SELECT d.id, d.donor_id, u.name AS donor_name, u.organization_name AS donor_org,
                    d.type, d.name, d.quantity, d.expiry_date, d.status, d.created_at
             FROM donations d
             LEFT JOIN users u ON u.user_id = d.donor_id
             WHERE d.id = ? AND d.deleted_at IS NULL",
            [$id]
        )->fetch();
        return $row ?: null;
    }

    // Update status
    public function updateStatus(int $id, string $status): void
    {
        $allowed = ['Pending','Allocated','Picked Up','Failed Safety','Completed','Cancelled'];
        if (!in_array($status, $allowed, true)) {
            throw new Exception('Invalid status value');
        }
        $this->db->query("UPDATE donations SET status = ? WHERE id = ?", [$status, $id]);
    }

    // Delete donation
    public function delete(int $id): void
    {
        $this->db->query("UPDATE donations SET deleted_at = NOW() WHERE id = ?", [$id]);
    }

    // List items by batch id (non-archived)
    public function listByBatch(string $batchId): array
    {
        $sql = "SELECT d.id, d.donor_id, u.name AS donor_name, u.organization_name AS donor_org,
                       d.type, d.name, d.quantity, d.expiry_date, d.status, d.created_at
                FROM donations d
                LEFT JOIN users u ON u.user_id = d.donor_id
                WHERE d.deleted_at IS NULL AND d.batch_id = ?
                ORDER BY d.created_at ASC";
        return $this->db->query($sql, [$batchId])->fetchAll();
    }

    // Batch: update status for all items in a batch (non-archived)
    public function updateStatusByBatch(string $batchId, string $status): void
    {
        if (!in_array($status, ['Pending','Allocated','Picked Up','Failed Safety','Completed','Cancelled'], true)) {
            throw new Exception('Invalid status value');
        }
        $this->db->query("UPDATE donations SET status = ? WHERE deleted_at IS NULL AND batch_id = ?", [$status, $batchId]);
    }

    // Batch: soft delete all items in a batch
    public function deleteByBatch(string $batchId): void
    {
        $this->db->query("UPDATE donations SET deleted_at = NOW() WHERE deleted_at IS NULL AND batch_id = ?", [$batchId]);
    }

    // Search distinct item names for suggestions
    public function searchItemNames(string $q = '', int $limit = 20): array
    {
        $limit = max(1, min(100, (int)$limit));
        if ($q !== '') {
            $like = '%' . $q . '%';
            $sql = "SELECT DISTINCT name FROM donations WHERE deleted_at IS NULL AND name LIKE ? ORDER BY name ASC LIMIT $limit";
            $rows = $this->db->query($sql, [$like])->fetchAll();
        } else {
            // Return most frequent names when no query provided
            $sql = "SELECT name FROM donations WHERE deleted_at IS NULL AND name IS NOT NULL AND name<>'' GROUP BY name ORDER BY COUNT(*) DESC, name ASC LIMIT $limit";
            $rows = $this->db->query($sql)->fetchAll();
        }
        return array_values(array_filter(array_map(function($r){ return $r['name'] ?? null; }, $rows), function($v){ return $v !== null && $v !== ''; }));
    }
}

// Image helper: save base64 data to file and return relative path
function saveDonationImageBase64(string $base64): string
{
    if (preg_match('/^data:image\/(png|jpg|jpeg|gif);base64,/', $base64, $m)) {
        $base64 = substr($base64, strpos($base64, ',') + 1);
        $ext = $m[1] === 'jpeg' ? 'jpg' : $m[1];
    } else {
        // default to png if header missing
        $ext = 'png';
    }
    $data = base64_decode($base64, true);
    if ($data === false) {
        throw new Exception('Invalid base64 image data');
    }
    $dir = __DIR__ . '/../../images/uploads/donations';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $filename = 'donation_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $path = $dir . '/' . $filename;
    if (file_put_contents($path, $data) === false) {
        throw new Exception('Failed to save image');
    }
    // Return relative URL path from web root
    return 'images/uploads/donations/' . $filename;
}
