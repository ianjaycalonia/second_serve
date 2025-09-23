<?php
require_once __DIR__ . '/../includes/config.php';

class Inventory
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function addFromDonationRow(array $donation): void
    {
        if (!$donation || empty($donation['id'])) { return; }
        $id = (int)$donation['id'];
        // Idempotency: skip if already added (new schema)
        $exists = $this->db->query("SELECT inventory_id FROM inventory WHERE donation_id = ? LIMIT 1", [$id])->fetch();
        if ($exists) { return; }
        // Prepare safe values for new schema
        $itemName = isset($donation['name']) ? trim((string)$donation['name']) : '';
        if ($itemName === '') { $itemName = 'Unknown Item'; }
        $category = isset($donation['type']) ? trim((string)$donation['type']) : null; // nullable
        $qty = isset($donation['quantity']) ? (int)$donation['quantity'] : 0;
        $expiry = (!empty($donation['expiry_date']) ? (string)$donation['expiry_date'] : null);
        $donorId = isset($donation['donor_id']) ? (int)$donation['donor_id'] : null;
        $batchId = $donation['batch_id'] ?? null;

        // Insert to new inventory schema
        $this->db->query(
            "INSERT INTO inventory (
                donation_id, product_id, product_name, product_category, quantity, unit, total_weight, total_cost, expiry_date,
                donor_id, source_batch_id, admin_in_charge, pack_by, added_at
            ) VALUES (?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, NULL, NOW())",
            [
                (int)$id,
                $itemName,
                ($category === '' ? null : $category),
                $qty,
                $expiry,
                $donorId,
                $batchId,
            ]
        );
    }

    public function addFromDonationId(int $donationId): void
    {
        $row = $this->db->query(
            "SELECT donation_id AS id, donor_id, batch_id, product_category AS type, product_name AS name, quantity, expiry_date
             FROM donations WHERE donation_id = ?",
            [$donationId]
        )->fetch();
        if ($row) { $this->addFromDonationRow($row); }
    }

    public function addFromBatchId(string $batchId): int
    {
        $rows = $this->db->query(
            "SELECT donation_id AS id, donor_id, batch_id, product_category AS type, product_name AS name, quantity, expiry_date
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
            $row = $this->db->query("SELECT inventory_id, quantity FROM inventory WHERE inventory_id = ? FOR UPDATE", [$inventoryId])->fetch();
            if (!$row) { throw new Exception('Inventory item not found'); }
            $current = (int)$row['quantity'];
            if ($quantity > $current) { throw new Exception('Insufficient stock'); }
            $newQty = $current - $quantity;
            $this->db->query("UPDATE inventory SET quantity = ? WHERE inventory_id = ?", [$newQty, $inventoryId]);
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
                "SELECT inventory_id, quantity FROM inventory WHERE product_name = ? AND product_category = ? ORDER BY COALESCE(expiry_date, '9999-12-31') ASC, added_at ASC FOR UPDATE",
                [$itemName, $category]
            )->fetchAll();
            $toGo = $quantity;
            $affected = [];
            foreach ($lots as $lot) {
                if ($toGo <= 0) break;
                $invId = (int)$lot['inventory_id'];
                $have = (int)$lot['quantity'];
                if ($have <= 0) continue;
                $take = min($have, $toGo);
                // Update this lot and record movement
                $newQty = $have - $take;
                $this->db->query("UPDATE inventory SET quantity = ? WHERE inventory_id = ?", [$newQty, $invId]);
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

    // Ensure auxiliary tables used by inventory operations exist
    private function ensureTables(): void
    {
        // Movements audit table (not part of base schema, created on demand)
        $this->db->query(
            "CREATE TABLE IF NOT EXISTS `inventory_movements` (
                `id` int(11) NOT NULL AUTO_INCREMENT,
                `inventory_id` int(11) NOT NULL,
                `direction` enum('in','out') NOT NULL,
                `quantity` int(11) NOT NULL,
                `mode` enum('recipient','onsite') NOT NULL,
                `recipient_id` int(11) DEFAULT NULL,
                `note` text DEFAULT NULL,
                `performed_by` int(11) NOT NULL,
                `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
                PRIMARY KEY (`id`),
                KEY `im_inventory_idx` (`inventory_id`),
                KEY `im_recipient_idx` (`recipient_id`),
                KEY `im_performed_by_idx` (`performed_by`),
                CONSTRAINT `im_inventory_fk` FOREIGN KEY (`inventory_id`) REFERENCES `inventory` (`inventory_id`) ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT `im_performed_by_fk` FOREIGN KEY (`performed_by`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT `im_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci"
        );
    }

    /**
     * Update tags for all lots of an item/category group.
     * Passing null clears the tags.
     */
    public function updateTagsGroup(string $itemName, string $category, ?string $tags): void
    {
        $this->db->query(
            "UPDATE inventory SET tags = ? WHERE product_name = ? AND product_category = ?",
            [$tags, $itemName, $category]
        );
    }

    /**
     * Update tags for a single inventory lot by id.
     */
    public function updateTagsLot(int $inventoryId, ?string $tags): void
    {
        $this->db->query(
            "UPDATE inventory SET tags = ? WHERE inventory_id = ?",
            [$tags, $inventoryId]
        );
    }
}
