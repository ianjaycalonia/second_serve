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
