<?php
require_once __DIR__ . '/../includes/config.php';

class Donation
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }
    // Create a donation header and a single item, returns donation_id
    public function create(array $payload): int
    {
        // Basic dedupe guard: if the same donor submitted a donation with the same
        // name/quantity within the last 5 minutes, return the existing record to
        // avoid duplicate inserts when clients retry quickly.
        try {
            $donorId = (int)($payload['donor_id'] ?? 0);
            $name = isset($payload['name']) ? sanitize((string)$payload['name']) : null;
            $quantity = isset($payload['quantity']) ? (int)$payload['quantity'] : 0;
            $canonicalExpiry = isset($payload['expiry_date']) ? trim((string)$payload['expiry_date']) : '';
            if ($donorId > 0 && $name !== null && $name !== '' && $quantity > 0) {
                $params = [$donorId, $name, $quantity];
                $sql = "SELECT d.donation_id
                        FROM donations d
                        INNER JOIN donation_items di ON di.donation_id = d.donation_id
                        WHERE d.donor_id = ?
                          AND di.product_name = ?
                          AND di.quantity = ?
                          AND d.created_at >= (NOW() - INTERVAL 5 MINUTE)";
                if ($canonicalExpiry !== '') {
                    $sql .= " AND (di.expiry_date = ? OR di.expiry_date IS NULL)";
                    $params[] = $canonicalExpiry;
                }
                $row = $this->db->query($sql . " ORDER BY d.donation_id DESC LIMIT 1", $params)->fetch();
                if ($row && isset($row['donation_id'])) {
                    return (int)$row['donation_id'];
                }
            }
        } catch (Exception $e) {
            // Dedupe is best-effort; continue with normal creation if it fails
        }

        $this->db->beginTransaction();
        try {
            $donationId = $this->createHeader([
                'donor_id' => (int)$payload['donor_id'],
                'batch_id' => $payload['batch_id'] ?? null,
                'remarks' => isset($payload['remarks']) ? (string)$payload['remarks'] : null,
                'procurement_type' => isset($payload['procurement_type']) && in_array($payload['procurement_type'], ['donated','purchased'], true) ? $payload['procurement_type'] : 'donated',
            ]);
            $this->addItem($donationId, [
                'product_name' => $payload['name'] ?? null,
                'quantity' => (int)($payload['quantity'] ?? 0),
                'expiry_date' => (!empty($payload['expiry_date']) ? $payload['expiry_date'] : null),
                'total_weight' => isset($payload['total_weight']) && $payload['total_weight'] !== '' ? (float)$payload['total_weight'] : null,
                'total_cost' => isset($payload['total_cost']) && $payload['total_cost'] !== '' ? (float)$payload['total_cost'] : null,
                'category_id' => isset($payload['category_id']) ? (int)$payload['category_id'] : null,
                'unit_id' => isset($payload['unit_id']) ? (int)$payload['unit_id'] : null,
                'tags' => null,
            ]);
            $this->db->commit();
            return (int)$donationId;
        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    // Create only the header; returns donation_id
    public function createHeader(array $hdr): int
    {
        // Snapshot donor name/org at time of creation (org from donor_profiles)
        $donorName = null;
        try {
            $row = $this->db->query(
                "SELECT COALESCE(dp.organization_name, '') AS org, u.name
                 FROM users u LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
                 WHERE u.user_id = ?",
                [(int)$hdr['donor_id']]
            )->fetch();
            if ($row) { $donorName = ($row['org'] !== '') ? $row['org'] : (!empty($row['name']) ? $row['name'] : null); }
        } catch (Exception $e) { /* ignore */ }
        $procType = isset($hdr['procurement_type']) && in_array($hdr['procurement_type'], ['donated','purchased'], true) ? $hdr['procurement_type'] : 'donated';
        $this->db->query(
            "INSERT INTO donations (donor_id, batch_id, admin_in_charge, procurement_type, donor_name, entry_date, remarks, status, created_at)
             VALUES (?, ?, NULL, ?, ?, NOW(), ?, 'Pending', NOW())",
            [
                (int)$hdr['donor_id'],
                $hdr['batch_id'] ?? null,
                $procType,
                $donorName,
                isset($hdr['remarks']) && $hdr['remarks'] !== '' ? sanitize((string)$hdr['remarks']) : null,
            ]
        );
        return (int)$this->db->lastInsertId();
    }

    // Add an item to an existing donation header; returns donation_item_id
    public function addItem(int $donationId, array $it): int
    {
        // Normalize provided values
        $name = isset($it['product_name']) ? sanitize((string)$it['product_name']) : null;
        $catId = isset($it['category_id']) ? ($it['category_id'] ?: null) : null;
        $qty = (int)($it['quantity'] ?? 0);
        $unitId = isset($it['unit_id']) ? ($it['unit_id'] ?: null) : null;
        $tw = isset($it['total_weight']) && $it['total_weight'] !== '' ? (float)$it['total_weight'] : null;
        $tc = isset($it['total_cost']) && $it['total_cost'] !== '' ? (float)$it['total_cost'] : null;
        $exp = (!empty($it['expiry_date']) ? $it['expiry_date'] : null);
        $tags = isset($it['tags']) ? sanitize((string)$it['tags']) : null;

        // If category/unit/weight not provided, infer from latest existing row with same product_name
        if (!empty($name) && ($catId === null || $unitId === null || $tw === null)) {
            try {
                $row = $this->db->query(
                    "SELECT di.category_id, di.unit_id, di.total_weight
                     FROM donation_items di
                     INNER JOIN donations d ON d.donation_id = di.donation_id
                     WHERE di.product_name = ? AND d.deleted_at IS NULL
                     ORDER BY di.created_at DESC
                     LIMIT 1",
                    [$name]
                )->fetch();
                if ($row) {
                    if ($catId === null && isset($row['category_id']) && $row['category_id'] !== null) {
                        $catId = (int)$row['category_id'];
                    }
                    if ($unitId === null && isset($row['unit_id']) && $row['unit_id'] !== null) {
                        $unitId = (int)$row['unit_id'];
                    }
                    if ($tw === null && isset($row['total_weight']) && $row['total_weight'] !== null && $row['total_weight'] !== '') {
                        $tw = (float)$row['total_weight'];
                    }
                }
            } catch (Exception $e) { /* ignore inference errors */ }
        }

        $this->db->query(
            "INSERT INTO donation_items (donation_id, product_name, category_id, quantity, unit_id, total_weight, total_cost, expiry_date, tags)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (int)$donationId,
                $name,
                $catId,
                $qty,
                $unitId,
                $tw,
                $tc,
                $exp,
                $tags,
            ]
        );
        return (int)$this->db->lastInsertId();
    }

    /**
     * (Optional future use) Infer latest saved defaults for a given product_name.
     */
    private function inferDefaultsByProductName(string $name): array
    {
        try {
            $row = $this->db->query(
                "SELECT di.category_id, di.unit_id, di.total_weight
                 FROM donation_items di
                 INNER JOIN donations d ON d.donation_id = di.donation_id
                 WHERE di.product_name = ? AND d.deleted_at IS NULL
                 ORDER BY di.created_at DESC
                 LIMIT 1",
                [$name]
            )->fetch();
            if ($row) {
                return [
                    'category_id' => isset($row['category_id']) ? ($row['category_id'] !== null ? (int)$row['category_id'] : null) : null,
                    'unit_id' => isset($row['unit_id']) ? ($row['unit_id'] !== null ? (int)$row['unit_id'] : null) : null,
                    'total_weight' => isset($row['total_weight']) ? ($row['total_weight'] !== null ? (float)$row['total_weight'] : null) : null,
                ];
            }
        } catch (Exception $e) { /* ignore */ }
        return ['category_id' => null, 'unit_id' => null, 'total_weight' => null];
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
        // By default, hide repack-generated donations (internal stock production), which are tagged on items
        if (empty($filters['include_repack'])) {
            $where[] = "(di.tags IS NULL OR di.tags <> 'Repack Kit')";
        }

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
                            COALESCE(dp.organization_name, d.donor_name, u.name) AS donor_org,
                            CONCAT('Batch (', COUNT(di.donation_item_id), ' items)') AS name,
                            NULL AS type,
                            SUM(di.quantity) AS quantity,
                            NULL AS expiry_date,
                            CASE WHEN MIN(d.status) = MAX(d.status) THEN MIN(d.status) ELSE 'Mixed' END AS status,
                            MAX(d.created_at) AS created_at,
                            d.batch_id AS batch_id,
                            1 AS is_group
                        FROM donations d
                        LEFT JOIN users u ON u.user_id = d.donor_id
                        LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
                        LEFT JOIN donation_items di ON di.donation_id = d.donation_id" . $whereSqlGrouped . "
                        GROUP BY d.donor_id, u.name, dp.organization_name, d.batch_id";

            // Ungrouped singles: rows with batch_id NULL are returned as-is
            $sqlSingles = "SELECT 
                            d.donation_id AS id,
                            d.donor_id,
                            u.name AS donor_name,
                            COALESCE(dp.organization_name, d.donor_name, u.name) AS donor_org,
                            di.product_name AS name,
                            CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS type,
                            di.quantity,
                            di.unit_id,
                            COALESCE(un.label, un.code) AS unit_label,
                            di.unit AS unit,
                            di.expiry_date,
                            d.status,
                            d.created_at,
                            NULL AS batch_id,
                            0 AS is_group
                        FROM donations d
                        LEFT JOIN users u ON u.user_id = d.donor_id
                        LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
                        INNER JOIN donation_items di ON di.donation_id = d.donation_id
                        LEFT JOIN categories c ON c.category_id = di.category_id
                        LEFT JOIN units un ON un.unit_id = di.unit_id" . $whereSqlSingles . "";

            $sql = "SELECT * FROM (" . $sqlGrouped . ") g
                    UNION ALL
                    SELECT * FROM (" . $sqlSingles . ") s
                    ORDER BY created_at DESC
                    LIMIT 500";
            return $this->db->query($sql, $params)->fetchAll();
        } else {
            $sql = "SELECT d.donation_id AS id, d.donor_id, u.name AS donor_name, COALESCE(dp.organization_name, d.donor_name, u.name) AS donor_org,
                           CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS type, di.product_name AS name, di.quantity, di.unit_id, COALESCE(un.label, un.code) AS unit_label, di.expiry_date, d.status, d.created_at,
                           d.batch_id AS batch_id,
                           d.admin_in_charge AS admin_in_charge,
                           0 AS is_group
                    FROM donations d
                    LEFT JOIN users u ON u.user_id = d.donor_id
                    LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
                    INNER JOIN donation_items di ON di.donation_id = d.donation_id
                    LEFT JOIN categories c ON c.category_id = di.category_id
                    LEFT JOIN units un ON un.unit_id = di.unit_id";
            if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
            $sql .= ' ORDER BY d.created_at DESC LIMIT 500';
            return $this->db->query($sql, $params)->fetchAll();
        }
    }

    // Get one donation by id
    public function getById(int $id): ?array
    {
        $row = $this->db->query(
            "SELECT d.donation_id AS id, d.donor_id, u.name AS donor_name, COALESCE(dp.organization_name, d.donor_name, u.name) AS donor_org,
                    CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS type, di.product_name AS name, di.quantity, di.expiry_date, d.status, d.created_at
             FROM donations d
             LEFT JOIN users u ON u.user_id = d.donor_id
             LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
             LEFT JOIN donation_items di ON di.donation_id = d.donation_id
             LEFT JOIN categories c ON c.category_id = di.category_id
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
        $sql = "SELECT di.donation_item_id AS id, d.donation_id, d.donor_id,
                       u.name AS donor_name,
                       COALESCE(dp.organization_name, d.donor_name, u.name) AS donor_org,
                       di.product_name AS name,
                       CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) AS type,
                       di.quantity,
                       di.unit_id,
                       COALESCE(un.label, un.code) AS unit_label,
                       di.expiry_date,
                       d.status,
                       d.created_at
                FROM donations d
                LEFT JOIN users u ON u.user_id = d.donor_id
                LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
                INNER JOIN donation_items di ON di.donation_id = d.donation_id
                LEFT JOIN categories c ON c.category_id = di.category_id
                LEFT JOIN units un ON un.unit_id = di.unit_id
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
        $where = ['d.deleted_at IS NULL'];
        if ($category !== null && $category !== '') { $where[] = "CONCAT(c.primary_name, COALESCE(CONCAT(' - ', c.secondary_name), '')) = ?"; $params[] = $category; }
        if ($q !== '') {
            $like = '%' . $q . '%';
            $where[] = 'di.product_name LIKE ?';
            $params[] = $like;
            $sql = "SELECT DISTINCT di.product_name AS name FROM donation_items di INNER JOIN donations d ON d.donation_id = di.donation_id LEFT JOIN categories c ON c.category_id = di.category_id WHERE " . implode(' AND ', $where) . " ORDER BY di.product_name ASC LIMIT $limit";
            $rows = $this->db->query($sql, $params)->fetchAll();
        } else {
            // Return most frequent names when no query provided
            $sql = "SELECT di.product_name AS name FROM donation_items di INNER JOIN donations d ON d.donation_id = di.donation_id WHERE " . implode(' AND ', $where) . " AND di.product_name IS NOT NULL AND di.product_name<>'' GROUP BY di.product_name ORDER BY COUNT(*) DESC, di.product_name ASC LIMIT $limit";
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

    // Update individual items fields for a batch using normalized donation_items
    // Supports: update existing items (id=donation_item_id), create new items (id=0)
    public function updateBatchFields(string $batchId, ?string $type, array $items): void
    {
        $this->db->beginTransaction();
        try {
            // Fetch existing donation headers and items within this batch
            $existing = $this->db->query(
                "SELECT d.donation_id, d.donor_id FROM donations d WHERE d.deleted_at IS NULL AND d.batch_id = ?",
                [$batchId]
            )->fetchAll();
            if (!$existing) { throw new Exception('Not found'); }
            $donorId = (int)$existing[0]['donor_id'];
            // Choose the first header to attach new items if needed
            $headerDonationId = (int)$existing[0]['donation_id'];

            // Map of existing donation_item_id => donation_id (to validate ownership)
            $rows = $this->db->query(
                "SELECT di.donation_item_id, di.donation_id FROM donation_items di INNER JOIN donations d ON d.donation_id = di.donation_id WHERE d.deleted_at IS NULL AND d.batch_id = ?",
                [$batchId]
            )->fetchAll();
            $byItemId = [];
            foreach ($rows as $r) { $byItemId[(int)$r['donation_item_id']] = (int)$r['donation_id']; }

            // Build sets of existing IDs and submitted IDs
            $existingIds = array_keys($byItemId);
            $submittedIds = [];

            // Validate and upsert
            foreach ($items as $it) {
                $id = (int)($it['id'] ?? 0); // donation_item_id
                $name = isset($it['name']) ? sanitize((string)$it['name']) : '';
                $qty = isset($it['quantity']) ? (int)$it['quantity'] : 0;
                $expiry = isset($it['expiry_date']) ? (string)$it['expiry_date'] : '';
                $totalCost = isset($it['total_cost']) && $it['total_cost'] !== '' ? (float)$it['total_cost'] : null;
                if ($name === '' || $qty < 1 || $expiry === '') { throw new Exception('Invalid item fields'); }

                if ($id > 0) {
                    // Update existing donation_items row (ensure it belongs to this batch)
                    $submittedIds[] = $id;
                    if (!isset($byItemId[$id])) { throw new Exception('Invalid item id'); }
                    $this->db->query(
                        "UPDATE donation_items SET product_name = ?, quantity = ?, expiry_date = ?, total_cost = ? WHERE donation_item_id = ?",
                        [$name, $qty, $expiry, $totalCost, $id]
                    );
                } else {
                    // Insert new donation_items row under the chosen header
                    $svc = new Donation();
                    $newItemId = $svc->addItem($headerDonationId, [
                        'product_name' => $name,
                        'quantity' => $qty,
                        'expiry_date' => $expiry,
                        'total_cost' => $totalCost,
                    ]);
                    $submittedIds[] = (int)$newItemId;
                }
            }

            // Soft-delete items that were removed (present before but not in submitted list)
            // For safety, do not delete historical items automatically. (No-op)

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
