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

    // Create a donation record, returns new id
    public function create(array $payload): int
    {
        // First try the new schema with batch_id
        $this->db->beginTransaction();
        try {
            // Snapshot donor name/org at time of creation
            $donorName = null;
            try {
                $row = $this->db->query("SELECT organization_name, name FROM users WHERE user_id = ?", [(int)$payload['donor_id']])->fetch();
                if ($row) { $donorName = !empty($row['organization_name']) ? $row['organization_name'] : (!empty($row['name']) ? $row['name'] : null); }
            } catch (Exception $e) { /* ignore */ }
            $this->db->query(
                "INSERT INTO donations (donor_id, batch_id, product_category, product_name, quantity, expiry_date, remarks, total_weight, total_cost, donor_name, entry_date, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'Pending', NOW())",
                [
                    (int)$payload['donor_id'],
                    $payload['batch_id'] ?? null,
                    $payload['type'],
                    $payload['name'],
                    (int)$payload['quantity'],
                    !empty($payload['expiry_date']) ? $payload['expiry_date'] : null,
                    isset($payload['remarks']) && $payload['remarks'] !== '' ? sanitize((string)$payload['remarks']) : null,
                    isset($payload['total_weight']) && $payload['total_weight'] !== '' ? (float)$payload['total_weight'] : null,
                    isset($payload['total_cost']) && $payload['total_cost'] !== '' ? (float)$payload['total_cost'] : null,
                    $donorName,
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
                    // Fallback path (old schema without batch_id) still snapshots donor_name and sets entry_date
                    $donorName = null;
                    try {
                        $row = $this->db->query("SELECT organization_name, name FROM users WHERE user_id = ?", [(int)$payload['donor_id']])->fetch();
                        if ($row) { $donorName = !empty($row['organization_name']) ? $row['organization_name'] : (!empty($row['name']) ? $row['name'] : null); }
                    } catch (Exception $e3) { /* ignore */ }
                    $this->db->query(
                        "INSERT INTO donations (donor_id, product_category, product_name, quantity, expiry_date, remarks, total_weight, total_cost, donor_name, entry_date, status, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'Pending', NOW())",
                        [
                            (int)$payload['donor_id'],
                            $payload['type'],
                            $payload['name'],
                            (int)$payload['quantity'],
                            !empty($payload['expiry_date']) ? $payload['expiry_date'] : null,
                            isset($payload['remarks']) && $payload['remarks'] !== '' ? sanitize((string)$payload['remarks']) : null,
                            isset($payload['total_weight']) && $payload['total_weight'] !== '' ? (float)$payload['total_weight'] : null,
                            isset($payload['total_cost']) && $payload['total_cost'] !== '' ? (float)$payload['total_cost'] : null,
                            $donorName,
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
                            MIN(d.donation_id) AS id,
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
                            d.donation_id AS id,
                            d.donor_id,
                            u.name AS donor_name,
                            u.organization_name AS donor_org,
                            d.product_name AS name,
                            d.product_category AS type,
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
            $sql = "SELECT d.donation_id AS id, d.donor_id, u.name AS donor_name, u.organization_name AS donor_org,
                           d.product_category AS type, d.product_name AS name, d.quantity, d.expiry_date, d.status, d.created_at,
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
            "SELECT d.donation_id AS id, d.donor_id, u.name AS donor_name, u.organization_name AS donor_org,
                    d.product_category AS type, d.product_name AS name, d.quantity, d.expiry_date, d.status, d.created_at
             FROM donations d
             LEFT JOIN users u ON u.user_id = d.donor_id
             WHERE d.donation_id = ? AND d.deleted_at IS NULL",
            [$id]
        )->fetch();
        return $row ?: null;
    }

    // Update status
    public function updateStatus(int $id, string $status): void
    {
        $allowed = ['Pending','Acknowledged','Picked Up','Failed Safety','Completed','Cancelled'];
        if (!in_array($status, $allowed, true)) {
            throw new Exception('Invalid status value');
        }
        $this->db->query("UPDATE donations SET status = ? WHERE donation_id = ?", [$status, $id]);
    }

    // Delete donation
    public function delete(int $id): void
    {
        $this->db->query("UPDATE donations SET deleted_at = NOW() WHERE donation_id = ?", [$id]);
    }

    // List items by batch id (non-archived)
    public function listByBatch(string $batchId): array
    {
        $sql = "SELECT d.donation_id AS id, d.donor_id, u.name AS donor_name, u.organization_name AS donor_org,
                       d.product_category AS type, d.product_name AS name, d.quantity, d.expiry_date, d.status, d.created_at
                FROM donations d
                LEFT JOIN users u ON u.user_id = d.donor_id
                WHERE d.deleted_at IS NULL AND d.batch_id = ?
                ORDER BY d.created_at ASC";
        return $this->db->query($sql, [$batchId])->fetchAll();
    }

    // Batch: update status for all items in a batch (non-archived)
    public function updateStatusByBatch(string $batchId, string $status): void
    {
        if (!in_array($status, ['Pending','Acknowledged','Picked Up','Failed Safety','Completed','Cancelled'], true)) {
            throw new Exception('Invalid status value');
        }
        $this->db->query("UPDATE donations SET status = ? WHERE deleted_at IS NULL AND batch_id = ?", [$status, $batchId]);
    }

    // Batch: soft delete all items in a batch
    public function deleteByBatch(string $batchId): void
    {
        $this->db->query("UPDATE donations SET deleted_at = NOW() WHERE deleted_at IS NULL AND batch_id = ?", [$batchId]);
    }

    // Search distinct item names for suggestions (optionally filter by category)
    public function searchItemNames(string $q = '', int $limit = 20, ?string $category = null): array
    {
        $limit = max(1, min(100, (int)$limit));
        $params = [];
        $where = ['deleted_at IS NULL'];
        if ($category !== null && $category !== '') { $where[] = 'product_category = ?'; $params[] = $category; }
        if ($q !== '') {
            $like = '%' . $q . '%';
            $where[] = 'product_name LIKE ?';
            $params[] = $like;
            $sql = "SELECT DISTINCT product_name AS name FROM donations WHERE " . implode(' AND ', $where) . " ORDER BY product_name ASC LIMIT $limit";
            $rows = $this->db->query($sql, $params)->fetchAll();
        } else {
            // Return most frequent names when no query provided
            $sql = "SELECT product_name AS name FROM donations WHERE " . implode(' AND ', $where) . " AND product_name IS NOT NULL AND product_name<>'' GROUP BY product_name ORDER BY COUNT(*) DESC, product_name ASC LIMIT $limit";
            $rows = $this->db->query($sql, $params)->fetchAll();
        }
        return array_values(array_filter(array_map(function($r){ return $r['name'] ?? null; }, $rows), function($v){ return $v !== null && $v !== ''; }));
    }


}

// Donor-side editing/cancellation helper
class DonationEditor
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // Ensure the donation exists, is owned by the given donor (unless admin), and is Pending
    public function assertEditable(int $donationId, int $donorId, bool $isAdmin = false): array
    {
        $row = $this->db->query(
            "SELECT donation_id AS id, donor_id, status FROM donations WHERE donation_id = ? AND deleted_at IS NULL",
            [$donationId]
        )->fetch();
        if (!$row) { throw new Exception('Not found'); }
        if (!$isAdmin && (int)$row['donor_id'] !== $donorId) { throw new Exception('Forbidden'); }
        if (($row['status'] ?? '') !== 'Pending') { throw new Exception('Only pending donations can be modified'); }
        return $row;
    }

    // Update name/type/quantity/expiry_date for a Pending donation
    public function updateFields(int $donationId, array $fields): void
    {
        $allowed = ['type','name','quantity','expiry_date'];
        $set = [];
        $params = [];
        foreach ($allowed as $k) {
            if (array_key_exists($k, $fields)) {
                if ($k === 'quantity') {
                    $val = (int)$fields[$k];
                    if ($val < 1) { throw new Exception('Quantity must be at least 1'); }
                    $set[] = "quantity = ?";
                    $params[] = $val;
                } elseif ($k === 'expiry_date') {
                    $v = $fields[$k];
                    $v = ($v === '' || $v === null) ? null : $v;
                    $set[] = "expiry_date = ?";
                    $params[] = $v;
                } elseif ($k === 'type') {
                    $v = sanitize((string)$fields[$k]);
                    $set[] = "product_category = ?";
                    $params[] = $v;
                } elseif ($k === 'name') {
                    $v = sanitize((string)$fields[$k]);
                    $set[] = "product_name = ?";
                    $params[] = $v;
                } else {
                    $v = sanitize((string)$fields[$k]);
                    $set[] = "$k = ?";
                    $params[] = $v;
                }
            }
        }
        if (!$set) { return; }
        $params[] = $donationId;
        $sql = "UPDATE donations SET " . implode(', ', $set) . " WHERE donation_id = ?";
        $this->db->query($sql, $params);
    }

    // Create the cancellations table if not exists
    private function ensureCancellationTable(): void
    {
        $this->db->query(
            "CREATE TABLE IF NOT EXISTS donation_cancellations (
                id INT(11) NOT NULL AUTO_INCREMENT,
                donation_id INT(11) DEFAULT NULL,
                batch_id VARCHAR(36) DEFAULT NULL,
                user_id INT(11) NOT NULL,
                reason TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
                PRIMARY KEY (id),
                KEY donation_id (donation_id),
                KEY batch_id (batch_id),
                KEY user_id (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci"
        );
    }

    // Cancel a single donation with a reason
    public function cancel(int $donationId, int $userId, string $reason): void
    {
        $reason = trim($reason);
        if ($reason === '') { throw new Exception('Reason is required'); }
        $this->ensureCancellationTable();
        $this->db->beginTransaction();
        try {
            $this->db->query("UPDATE donations SET status = 'Cancelled' WHERE donation_id = ?", [$donationId]);
            $this->db->query(
                "INSERT INTO donation_cancellations (donation_id, batch_id, user_id, reason) VALUES (?, NULL, ?, ?)",
                [$donationId, $userId, $reason]
            );
            $this->db->commit();
        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    // Cancel an entire batch (set all to Cancelled) with a reason
    public function cancelByBatch(string $batchId, int $userId, string $reason): void
    {
        $reason = trim($reason);
        if ($reason === '') { throw new Exception('Reason is required'); }
        $this->ensureCancellationTable();
        $this->db->beginTransaction();
        try {
            $this->db->query("UPDATE donations SET status = 'Cancelled' WHERE deleted_at IS NULL AND batch_id = ?", [$batchId]);
            $this->db->query(
                "INSERT INTO donation_cancellations (donation_id, batch_id, user_id, reason) VALUES (NULL, ?, ?, ?)",
                [$batchId, $userId, $reason]
            );
            $this->db->commit();
        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    // Ensure all items in batch belong to donor (unless admin) and are Pending
    public function assertBatchEditable(string $batchId, int $donorId, bool $isAdmin = false): array
    {
        $rows = $this->db->query(
            "SELECT donation_id AS id, donor_id, status FROM donations WHERE deleted_at IS NULL AND batch_id = ?",
            [$batchId]
        )->fetchAll();
        if (!$rows) { throw new Exception('Not found'); }
        if (!$isAdmin) {
            foreach ($rows as $r) {
                if ((int)$r['donor_id'] !== $donorId) { throw new Exception('Forbidden'); }
            }
        }
        foreach ($rows as $r) {
            if (($r['status'] ?? '') !== 'Pending') { throw new Exception('Only pending batches can be modified'); }
        }
        return $rows;
    }

    // Update batch category (type) and individual items fields
    // Supports: update existing items, create new items (id=0), soft-delete removed items
    public function updateBatchFields(string $batchId, ?string $type, array $items): void
    {
        $this->db->beginTransaction();
        try {
            // Fetch existing items in the batch to determine donor_id, current type, and detect removals
            $existing = $this->db->query(
                "SELECT donation_id AS id, donor_id, product_category AS type FROM donations WHERE deleted_at IS NULL AND batch_id = ?",
                [$batchId]
            )->fetchAll();
            if (!$existing) { throw new Exception('Not found'); }
            $donorId = (int)$existing[0]['donor_id'];
            $currentType = $existing[0]['type'] ?? null;

            // If a new type is specified, apply to all items in the batch
            $effectiveType = $type !== null ? sanitize($type) : ($currentType !== null ? sanitize((string)$currentType) : null);
            if ($type !== null) {
                $this->db->query(
                    "UPDATE donations SET product_category = ? WHERE deleted_at IS NULL AND batch_id = ?",
                    [$effectiveType, $batchId]
                );
            }

            // Build sets of existing IDs and submitted IDs
            $existingIds = array_map(fn($r) => (int)$r['id'], $existing);
            $submittedIds = [];

            // Validate and upsert
            foreach ($items as $it) {
                $id = (int)($it['id'] ?? 0);
                $name = isset($it['name']) ? sanitize((string)$it['name']) : '';
                $qty = isset($it['quantity']) ? (int)$it['quantity'] : 0;
                $expiry = isset($it['expiry_date']) ? (string)$it['expiry_date'] : '';
                if ($name === '' || $qty < 1 || $expiry === '') { throw new Exception('Invalid item fields'); }

                if ($id > 0) {
                    // Update existing
                    $submittedIds[] = $id;
                    $this->db->query(
                        "UPDATE donations SET product_name = ?, quantity = ?, expiry_date = ? WHERE donation_id = ? AND deleted_at IS NULL AND batch_id = ?",
                        [$name, $qty, $expiry, $id, $batchId]
                    );
                } else {
                    // Insert new item into the batch; use effective type (new or current)
                    // Snapshot donor name/org and set entry_date
                    $donorName = null;
                    try {
                        $row = $this->db->query("SELECT organization_name, name FROM users WHERE user_id = ?", [$donorId])->fetch();
                        if ($row) { $donorName = !empty($row['organization_name']) ? $row['organization_name'] : (!empty($row['name']) ? $row['name'] : null); }
                    } catch (Exception $e) { /* ignore */ }
                    $this->db->query(
                        "INSERT INTO donations (donor_id, batch_id, product_category, product_name, quantity, expiry_date, donor_name, entry_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'Pending', NOW())",
                        [
                            $donorId,
                            $batchId,
                            $effectiveType,
                            $name,
                            $qty,
                            $expiry === '' ? null : $expiry,
                            $donorName,
                        ]
                    );
                    $submittedIds[] = (int)$this->db->lastInsertId();
                }
            }

            // Soft-delete items that were removed (present before but not in submitted list)
            $toDelete = array_values(array_diff($existingIds, $submittedIds));
            if (!empty($toDelete)) {
                // Build placeholders
                $placeholders = implode(',', array_fill(0, count($toDelete), '?'));
                $params = $toDelete;
                $params[] = $batchId;
                $this->db->query(
                    "UPDATE donations SET deleted_at = NOW() WHERE donation_id IN ($placeholders) AND batch_id = ?",
                    $params
                );
            }

            $this->db->commit();
        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
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
