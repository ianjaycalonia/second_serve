<?php
require_once __DIR__ . '/../includes/config.php';

class Inventory
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    private function ensureTables(): void
    {
        // Create core tables if they don't exist
        $this->db->query(
            "CREATE TABLE IF NOT EXISTS inventory (
                id INT(11) NOT NULL AUTO_INCREMENT,
                item_name VARCHAR(255) DEFAULT NULL,
                category VARCHAR(50) DEFAULT NULL,
                quantity INT(11) NOT NULL DEFAULT 0,
                expiry_date DATE DEFAULT NULL,
                donor_id INT(11) DEFAULT NULL,
                source_donation_id INT(11) DEFAULT NULL,
                source_batch_id VARCHAR(36) DEFAULT NULL,
                added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
                PRIMARY KEY (id),
                KEY item_cat (item_name, category),
                KEY donor_id (donor_id),
                KEY src_donation (source_donation_id),
                KEY src_batch (source_batch_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci"
        );

        $this->db->query(
            "CREATE TABLE IF NOT EXISTS inventory_movements (
                id INT(11) NOT NULL AUTO_INCREMENT,
                inventory_id INT(11) NOT NULL,
                direction ENUM('in','out') NOT NULL,
                quantity INT(11) NOT NULL,
                mode ENUM('recipient','onsite') DEFAULT NULL,
                recipient_id INT(11) DEFAULT NULL,
                note TEXT DEFAULT NULL,
                performed_by INT(11) DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
                PRIMARY KEY (id),
                KEY inventory_id (inventory_id),
                KEY created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci"
        );
    }

    public function addFromDonationRow(array $donation): void
    {
        if (!$donation || empty($donation['id'])) { return; }
        $id = (int)$donation['id'];
        $this->ensureTables();
        // Idempotency: skip if already added
        $exists = $this->db->query("SELECT id FROM inventory WHERE source_donation_id = ? LIMIT 1", [$id])->fetch();
        if ($exists) { return; }
        // Prepare safe values (item_name is NOT NULL in schema)
        $itemName = isset($donation['name']) ? trim((string)$donation['name']) : '';
        if ($itemName === '') { $itemName = 'Unknown Item'; }
        $category = isset($donation['type']) ? trim((string)$donation['type']) : null; // nullable
        $qty = isset($donation['quantity']) ? (int)$donation['quantity'] : 0;
        $expiry = (!empty($donation['expiry_date']) ? (string)$donation['expiry_date'] : null);
        $donorId = isset($donation['donor_id']) ? (int)$donation['donor_id'] : null;
        $batchId = $donation['batch_id'] ?? null;

        $this->db->query(
            "INSERT INTO inventory (item_name, category, quantity, expiry_date, donor_id, source_donation_id, source_batch_id, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
            [
                $itemName,
                ($category === '' ? null : $category),
                $qty,
                $expiry,
                $donorId,
                (int)$id,
                $batchId,
            ]
        );
    }

    public function addFromDonationId(int $donationId): void
    {
        $row = $this->db->query(
            "SELECT id, donor_id, batch_id, type, name, quantity, expiry_date FROM donations WHERE id = ?",
            [$donationId]
        )->fetch();
        if ($row) { $this->addFromDonationRow($row); }
    }

    public function addFromBatchId(string $batchId): int
    {
        $rows = $this->db->query(
            "SELECT id, donor_id, batch_id, type, name, quantity, expiry_date
             FROM donations
             WHERE batch_id = ? AND deleted_at IS NULL",
            [$batchId]
        )->fetchAll();
        $count = 0;
        foreach ($rows as $r) {
            $this->addFromDonationRow($r);
            $count++;
        }
        return $count;
    }

    /**
     * Decrease inventory quantity and log movement.
     * @param int $inventoryId
     * @param int $quantity Positive integer to subtract
     * @param int $performedBy User ID who performed the action
     * @param string $mode 'recipient' or 'onsite'
     * @param int|null $recipientId Required when mode='recipient'
     * @param string|null $note Optional note
     * @return array ['new_quantity' => int]
     */
    public function moveOut(int $inventoryId, int $quantity, int $performedBy, string $mode, ?int $recipientId = null, ?string $note = null): array
    {
        if ($quantity <= 0) { throw new Exception('Quantity must be positive'); }
        if (!in_array($mode, ['recipient','onsite'], true)) { throw new Exception('Invalid mode'); }
        if ($mode === 'recipient' && empty($recipientId)) { throw new Exception('recipient_id is required for recipient mode'); }

        $this->ensureTables();
        $this->db->beginTransaction();
        try {
            $row = $this->db->query("SELECT id, quantity FROM inventory WHERE id = ? FOR UPDATE", [$inventoryId])->fetch();
            if (!$row) { throw new Exception('Inventory item not found'); }
            $current = (int)$row['quantity'];
            if ($quantity > $current) { throw new Exception('Insufficient stock'); }
            $newQty = $current - $quantity;
            $this->db->query("UPDATE inventory SET quantity = ? WHERE id = ?", [$newQty, $inventoryId]);
            $this->db->query(
                "INSERT INTO inventory_movements (inventory_id, direction, quantity, mode, recipient_id, note, performed_by, created_at)
                 VALUES (?, 'out', ?, ?, ?, ?, ?, NOW())",
                [$inventoryId, $quantity, $mode, $recipientId, $note, $performedBy]
            );
            $this->db->commit();
            return ['new_quantity' => $newQty];
        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Decrease inventory across multiple lots for the same item_name+category, using earliest expiry first (FIFO).
     * Returns remaining quantity and affected lot ids.
     */
    public function moveOutGroup(string $itemName, string $category, int $quantity, int $performedBy, string $mode, ?int $recipientId = null, ?string $note = null): array
    {
        if ($quantity <= 0) { throw new Exception('Quantity must be positive'); }
        if (!in_array($mode, ['recipient','onsite'], true)) { throw new Exception('Invalid mode'); }
        if ($mode === 'recipient' && empty($recipientId)) { throw new Exception('recipient_id is required for recipient mode'); }

        $this->ensureTables();
        $this->db->beginTransaction();
        try {
            // Lock matching lots ordered by soonest expiry, then by added_at
            $lots = $this->db->query(
                "SELECT id, quantity FROM inventory WHERE item_name = ? AND category = ? ORDER BY COALESCE(expiry_date, '9999-12-31') ASC, added_at ASC FOR UPDATE",
                [$itemName, $category]
            )->fetchAll();
            $toGo = $quantity;
            $affected = [];
            foreach ($lots as $lot) {
                if ($toGo <= 0) break;
                $invId = (int)$lot['id'];
                $have = (int)$lot['quantity'];
                if ($have <= 0) continue;
                $take = min($have, $toGo);
                // Update this lot and record movement
                $newQty = $have - $take;
                $this->db->query("UPDATE inventory SET quantity = ? WHERE id = ?", [$newQty, $invId]);
                $this->db->query(
                    "INSERT INTO inventory_movements (inventory_id, direction, quantity, mode, recipient_id, note, performed_by, created_at)
                     VALUES (?, 'out', ?, ?, ?, ?, ?, NOW())",
                    [$invId, $take, $mode, $recipientId, $note, $performedBy]
                );
                $toGo -= $take;
                $affected[] = ['inventory_id' => $invId, 'taken' => $take, 'new_quantity' => $newQty];
            }
            if ($toGo > 0) { throw new Exception('Insufficient stock'); }
            $this->db->commit();
            return ['requested' => $quantity, 'affected' => $affected];
        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }
}
