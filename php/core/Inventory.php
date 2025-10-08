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
        // Idempotency: skip if any inventory lot already exists for this donation (via donation_items)
        $exists = $this->db->query(
            "SELECT inv.inventory_id
             FROM inventory inv
             INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
             WHERE di.donation_id = ?
             LIMIT 1",
            [$id]
        )->fetch();
        if ($exists) { return; }
        // Prepare safe values for new schema
        $itemName = isset($donation['name']) ? trim((string)$donation['name']) : '';
        if ($itemName === '') { $itemName = 'Unknown Item'; }
        $category = isset($donation['type']) ? trim((string)$donation['type']) : null; // nullable
        $qty = isset($donation['quantity']) ? (int)$donation['quantity'] : 0;
        $expiry = (!empty($donation['expiry_date']) ? (string)$donation['expiry_date'] : null);
        $unitVal = isset($donation['unit']) && $donation['unit'] !== '' ? trim((string)$donation['unit']) : null;
        $donorId = isset($donation['donor_id']) ? (int)$donation['donor_id'] : null;
        $batchId = $donation['batch_id'] ?? null;
        $adminInCharge = isset($donation['admin_in_charge']) ? (int)$donation['admin_in_charge'] : null;

        // Resolve category_id and upsert if needed (supports both schemas)
        $categoryId = null;
        if (!empty($category)) {
            try {
                // Detect new schema with primary_name
                $hasPS = false;
                try {
                    $chk = $this->db->query("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='categories' AND COLUMN_NAME='primary_name' LIMIT 1")->fetch();
                    $hasPS = (bool)$chk;
                } catch (Exception $e2) { $hasPS = false; }

                if ($hasPS) {
                    $primary = $category;
                    $secondary = null;
                    // Split on LAST ' - ' so that compound parents are preserved
                    $pos = strrpos($category, ' - ');
                    if ($pos !== false) {
                        $primary = trim(substr($category, 0, $pos));
                        $secondary = trim(substr($category, $pos + 3));
                    }
                    $rowCat = $this->db->query(
                        "SELECT category_id FROM categories WHERE primary_name = ? AND ((? IS NULL AND secondary_name IS NULL) OR secondary_name = ?) LIMIT 1",
                        [$primary, $secondary, $secondary]
                    )->fetch();
                    if ($rowCat) { $categoryId = (int)$rowCat['category_id']; }
                    else {
                        $this->db->query(
                            "INSERT INTO categories (primary_name, secondary_name, is_active, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())",
                            [$primary, $secondary]
                        );
                        $categoryId = (int)$this->db->lastInsertId();
                    }
                } else {
                    $rowCat = $this->db->query("SELECT category_id FROM categories WHERE name = ? LIMIT 1", [$category])->fetch();
                    if ($rowCat) { $categoryId = (int)$rowCat['category_id']; }
                    else {
                        $this->db->query("INSERT INTO categories (name, parent_id, is_active, created_at, updated_at) VALUES (?, NULL, 1, NOW(), NOW())", [$category]);
                        $categoryId = (int)$this->db->lastInsertId();
                    }
                }
            } catch (Exception $e) { /* ignore */ }
        }

        // Resolve donation_item_id: if provided by caller (already exists), use it; otherwise create it now
        $donationItemId = isset($donation['donation_item_id']) ? (int)$donation['donation_item_id'] : 0;
        if ($donationItemId <= 0) {
            try {
                $this->db->query(
                    "INSERT INTO donation_items (donation_id, product_name, product_category, category_id, quantity, unit, total_weight, total_cost, expiry_date, tags, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NOW())",
                    [ (int)$id, $itemName, ($category === '' ? null : $category), $categoryId, $qty, $unitVal, $expiry ]
                );
                $donationItemId = (int)$this->db->lastInsertId();
            } catch (Exception $eDI) { /* fallback continue without donation_items */ }
        }

        // Insert to inventory (normalized minimal columns)
        if ($donationItemId > 0) {
            $this->db->query(
                "INSERT INTO inventory (donation_item_id, quantity, added_at) VALUES (?, ?, NOW())",
                [ $donationItemId, $qty ]
            );
        }
        // Record an 'in' movement for audit and reporting
        try {
            $this->ensureTables();
            $invId = (int)$this->db->lastInsertId();
            $performedBy = null;
            if (!empty($adminInCharge)) { $performedBy = (int)$adminInCharge; }
            if (empty($performedBy)) {
                try { $performedBy = (int)currentUserId(); } catch (Exception $e) { $performedBy = 0; }
            }
            if (empty($performedBy) && !empty($donorId)) { $performedBy = (int)$donorId; }
            if ($invId > 0 && $qty > 0 && $performedBy > 0) {
                // mode uses a broader string to indicate source
                if ($donationItemId) {
                    $this->db->query(
                        "INSERT INTO inventory_movements (inventory_id, donation_item_id, direction, quantity, mode, recipient_id, note, performed_by, created_at)
                         VALUES (?, ?, 'in', ?, 'donated', NULL, NULL, ?, NOW())",
                        [$invId, $donationItemId, (int)$qty, (int)$performedBy]
                    );
                } else {
                    $this->db->query(
                        "INSERT INTO inventory_movements (inventory_id, direction, quantity, mode, recipient_id, note, performed_by, created_at)
                         VALUES (?, 'in', ?, 'donated', NULL, NULL, ?, NOW())",
                        [$invId, (int)$qty, (int)$performedBy]
                    );
                }
            }
        } catch (Exception $e) {
            // non-fatal
        }
    }

    public function addFromDonationId(int $donationId): void
    {
        // Read all items under this donation header and add each to inventory
        $rows = $this->db->query(
            "SELECT di.donation_item_id, di.product_name AS name, di.product_category AS type, di.quantity, di.unit, di.expiry_date,
                    d.donation_id AS id, d.donor_id, d.batch_id, d.admin_in_charge
             FROM donation_items di
             INNER JOIN donations d ON d.donation_id = di.donation_id
             WHERE di.donation_id = ?",
            [$donationId]
        )->fetchAll();
        foreach ($rows as $r) {
            $this->addFromDonationRow([
                'donation_item_id' => (int)$r['donation_item_id'],
                'name' => $r['name'],
                'type' => $r['type'],
                'quantity' => (int)$r['quantity'],
                'unit' => $r['unit'],
                'expiry_date' => $r['expiry_date'],
                'id' => (int)$r['id'],
                'donor_id' => isset($r['donor_id']) ? (int)$r['donor_id'] : null,
                'batch_id' => $r['batch_id'] ?? null,
                'admin_in_charge' => isset($r['admin_in_charge']) ? (int)$r['admin_in_charge'] : null,
            ]);
        }
    }

    public function addFromBatchId(string $batchId): int
    {
        $rows = $this->db->query(
            "SELECT di.donation_item_id, di.product_name AS name, di.product_category AS type, di.quantity, di.unit, di.expiry_date,
                    d.donation_id AS id, d.donor_id, d.batch_id, d.admin_in_charge
             FROM donation_items di
             INNER JOIN donations d ON d.donation_id = di.donation_id
             WHERE d.batch_id = ? AND d.deleted_at IS NULL",
            [$batchId]
        )->fetchAll();
        $count = 0;
        foreach ($rows as $r) {
            $this->addFromDonationRow([
                'donation_item_id' => (int)$r['donation_item_id'],
                'name' => $r['name'],
                'type' => $r['type'],
                'quantity' => (int)$r['quantity'],
                'unit' => $r['unit'],
                'expiry_date' => $r['expiry_date'],
                'id' => (int)$r['id'],
                'donor_id' => isset($r['donor_id']) ? (int)$r['donor_id'] : null,
                'batch_id' => $r['batch_id'] ?? null,
                'admin_in_charge' => isset($r['admin_in_charge']) ? (int)$r['admin_in_charge'] : null,
            ]);
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
            // Lock matching lots ordered by soonest expiry (from donation_items), then by added_at
            $lots = $this->db->query(
                "SELECT inv.inventory_id, inv.quantity
                 FROM inventory inv
                 INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
                 WHERE di.product_name = ? AND di.product_category = ?
                 ORDER BY COALESCE(di.expiry_date, '9999-12-31') ASC, inv.added_at ASC
                 FOR UPDATE",
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

    /**
     * Bulk import inventory rows.
     * Expected fields per row: item_name (string), category (nullable string), quantity (int>=1), expiry_date (nullable Y-m-d), tags (nullable string)
     * Returns summary counts and per-row errors (if any). Inserts valid rows; skips invalid ones.
     */
    public function importRows(array $rows, int $performedBy): array
    {
        $inserted = 0; $errors = [];
        if (!is_array($rows)) { return ['inserted' => 0, 'errors' => [['row' => -1, 'error' => 'rows must be array']]]; }
        // Soft limit to prevent abuse
        if (count($rows) > 1000) { $rows = array_slice($rows, 0, 1000); }
        foreach ($rows as $idx => $r) {
            $item = isset($r['item_name']) ? trim((string)$r['item_name']) : '';
            $cat  = isset($r['category']) ? trim((string)$r['category']) : '';
            $qty  = isset($r['quantity']) ? (int)$r['quantity'] : 0;
            $exp  = isset($r['expiry_date']) ? trim((string)$r['expiry_date']) : '';
            $tags = isset($r['tags']) ? trim((string)$r['tags']) : '';
            $unit = isset($r['unit']) ? trim((string)$r['unit']) : '';
            $tw   = isset($r['total_weight']) && $r['total_weight'] !== '' ? (float)$r['total_weight'] : null;
            $tc   = isset($r['total_cost']) && $r['total_cost'] !== '' ? (float)$r['total_cost'] : null;
            $batch= isset($r['source_batch_id']) ? trim((string)$r['source_batch_id']) : '';
            $donEmail = isset($r['donor_email']) ? trim((string)$r['donor_email']) : '';
            $donOrg   = isset($r['donor_org']) ? trim((string)$r['donor_org']) : (isset($r['donor_organization']) ? trim((string)$r['donor_organization']) : '');
            $donName  = isset($r['donor_name']) ? trim((string)$r['donor_name']) : '';
            $donCategory = isset($r['donor_category']) ? trim((string)$r['donor_category']) : '';
            $entryBy = isset($r['entry_by']) ? trim((string)$r['entry_by']) : '';
            $entryDateRaw = isset($r['entry_date']) ? trim((string)$r['entry_date']) : '';
            if ($item === '') { $errors[] = ['row' => $idx, 'error' => 'item_name is required']; continue; }
            if ($qty <= 0) { $errors[] = ['row' => $idx, 'error' => 'quantity must be >= 1']; continue; }
            // Normalize date to Y-m-d or null
            $expNorm = null;
            if ($exp !== '') {
                // Accept forms like YYYY-MM-DD or DD/MM/YYYY; try strtotime
                $ts = strtotime($exp);
                if ($ts !== false) { $expNorm = date('Y-m-d', $ts); }
            }
            // Resolve donor_id preference: organization_name first (donor name = org name), then email, then user name
            $donorId = null;
            try {
                if ($donorId === null && $donOrg !== '') {
                    $rowDon = $this->db->query("SELECT u.user_id FROM users u JOIN donor_profiles dp ON dp.user_id=u.user_id WHERE u.role='donor' AND dp.organization_name = ? LIMIT 1", [$donOrg])->fetch();
                    if ($rowDon) { $donorId = (int)$rowDon['user_id']; }
                }
                if ($donorId === null && $donEmail !== '') {
                    $rowDon = $this->db->query("SELECT user_id FROM users WHERE role='donor' AND email = ? LIMIT 1", [$donEmail])->fetch();
                    if ($rowDon) { $donorId = (int)$rowDon['user_id']; }
                }
                if ($donorId === null && $donName !== '') {
                    $rowDon = $this->db->query("SELECT user_id FROM users WHERE role='donor' AND name = ? LIMIT 1", [$donName])->fetch();
                    if ($rowDon) { $donorId = (int)$rowDon['user_id']; }
                }
            } catch (Exception $e) { /* ignore lookup errors */ }

            // Auto-create donor if not found and at least one identifier is present
            if (($donorId === null || $donorId <= 0) && ($donOrg !== '' || $donEmail !== '' || $donName !== '')) {
                try {
                    $orgName = $donOrg !== '' ? $donOrg : ($donName !== '' ? $donName : 'Imported Donor');
                    // Build email according to rule -> name@simplyshare.org with special shortening for long names
                    $email = $donEmail;
                    if ($email === '') {
                        $parts = preg_split('/\s+/', trim($orgName));
                        $parts = array_values(array_filter($parts, fn($p) => $p !== ''));
                        $local = '';
                        if (count($parts) > 3) {
                            $w1 = $parts[0];
                            $w2 = $parts[1] ?? '';
                            $w3 = $parts[2] ?? '';
                            $local = strtolower(preg_replace('/[^a-z0-9]/i','', $w1 . substr($w2,0,1) . substr($w3,0,1)));
                        } else {
                            $local = strtolower(preg_replace('/[^a-z0-9]/i','', implode('', $parts)));
                        }
                        if ($local === '') { $local = 'donor'; }
                        $baseEmail = $local . '@simplyshare.org';
                        // Ensure uniqueness by retrying with numeric suffix if needed
                        $email = $baseEmail;
                        $suffix = 1;
                        while (true) {
                            $exists = $this->db->query("SELECT user_id FROM users WHERE email = ? LIMIT 1", [$email])->fetch();
                            if (!$exists) break;
                            $email = $local . $suffix . '@simplyshare.org';
                            $suffix++;
                            if ($suffix > 99) { $email = $local . uniqid() . '@simplyshare.org'; break; }
                        }
                    }
                    // Generate a random password hash
                    $raw = bin2hex(random_bytes(8));
                    $hash = password_hash($raw, PASSWORD_BCRYPT);
                    // Create user as approved donor
                    $this->db->query(
                        "INSERT INTO users (name, email, password_hash, role, status, created_at, last_login) VALUES (?, ?, ?, 'donor', 'approved', NOW(), NOW())",
                        [$orgName, $email, $hash]
                    );
                    $newUid = (int)$this->db->lastInsertId();
                    // Create donor profile with organization_name and optional donor_category
                    $this->db->query(
                        "INSERT INTO donor_profiles (user_id, organization_name, donor_category, contact_number, address, notes) VALUES (?, ?, ?, NULL, NULL, NULL)",
                        [$newUid, $orgName, ($donCategory !== '' ? $donCategory : null)]
                    );
                    $donorId = $newUid;
                } catch (Exception $e) {
                    // If creation fails, proceed with null donor_id
                    $donorId = null;
                }
            }

            // If donor_category provided and donor found, update donor_profiles.donor_category (best effort)
            if ($donorId !== null && $donorId > 0 && $donCategory !== '') {
                try {
                    $this->db->query("UPDATE donor_profiles SET donor_category = ? WHERE user_id = ?", [$donCategory, $donorId]);
                } catch (Exception $e) { /* ignore */ }
            }

            // Resolve category_id (supports primary/secondary schema)
            $categoryId = null;
            if ($cat !== '') {
                try {
                    $hasPS = false;
                    try { $chk = $this->db->query("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='categories' AND COLUMN_NAME='primary_name' LIMIT 1")->fetch(); $hasPS = (bool)$chk; } catch (Exception $e2) { $hasPS = false; }
                    if ($hasPS) {
                        $primary = $cat; $secondary = null;
                        // Split on LAST ' - ' so compound parents are preserved
                        $pos = strrpos($cat, ' - ');
                        if ($pos !== false) {
                            $primary = trim(substr($cat, 0, $pos));
                            $secondary = trim(substr($cat, $pos + 3));
                        }
                        $rowCat = $this->db->query(
                            "SELECT category_id FROM categories WHERE primary_name = ? AND ((? IS NULL AND secondary_name IS NULL) OR secondary_name = ?) LIMIT 1",
                            [$primary, $secondary, $secondary]
                        )->fetch();
                        if ($rowCat) { $categoryId = (int)$rowCat['category_id']; }
                        else {
                            $this->db->query("INSERT INTO categories (primary_name, secondary_name, is_active, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())", [$primary, $secondary]);
                            $categoryId = (int)$this->db->lastInsertId();
                        }
                    } else {
                        $rowCat = $this->db->query("SELECT category_id FROM categories WHERE name = ? LIMIT 1", [$cat])->fetch();
                        if ($rowCat) { $categoryId = (int)$rowCat['category_id']; }
                        else {
                            // Upsert category if not present
                            $this->db->query("INSERT INTO categories (name, parent_id, is_active, created_at, updated_at) VALUES (?, NULL, 1, NOW(), NOW())", [$cat]);
                            $categoryId = (int)$this->db->lastInsertId();
                        }
                    }
                } catch (Exception $e) { /* ignore */ }
            }
            try {
                // Resolve admin_in_charge (optional FK)
                $adminInCharge = null;
                if ($entryBy !== '') {
                    try {
                        $rowU = $this->db->query("SELECT user_id FROM users WHERE name = ? LIMIT 1", [$entryBy])->fetch();
                        if ($rowU && isset($rowU['user_id'])) { $adminInCharge = (int)$rowU['user_id']; }
                    } catch (Exception $e) { /* ignore */ }
                }
                if ($adminInCharge === null) {
                    try {
                        $pb = (int)$performedBy;
                        if ($pb > 0) {
                            $chk = $this->db->query("SELECT user_id FROM users WHERE user_id = ? LIMIT 1", [$pb])->fetch();
                            if ($chk && isset($chk['user_id'])) { $adminInCharge = $pb; }
                        }
                    } catch (Exception $e) { /* ignore */ }
                }

                // Create a donation header to satisfy donation_items FK
                $procType = ($tc !== null && $tc > 0) ? 'purchased' : 'donated';
                $donorDisplay = ($donOrg !== '' ? $donOrg : $donName);
                $this->db->query(
                    "INSERT INTO donations (donor_id, admin_in_charge, procurement_type, donor_name, entry_date, remarks, status, created_at)
                     VALUES (?, ?, ?, ?, NOW(), NULL, 'Picked Up', NOW())",
                    [ $donorId, $adminInCharge, $procType, ($donorDisplay !== '' ? $donorDisplay : NULL) ]
                );
                $donationId = (int)$this->db->lastInsertId();

                // Create donation_item row
                $this->db->query(
                    "INSERT INTO donation_items (donation_id, product_name, product_category, category_id, quantity, unit, total_weight, total_cost, expiry_date, tags, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())",
                    [ $donationId, $item, ($cat === '' ? NULL : $cat), $categoryId, $qty, ($unit === '' ? NULL : $unit), $tw, $tc, $expNorm, ($tags === '' ? NULL : $tags) ]
                );
                $donationItemId = (int)$this->db->lastInsertId();

                // Create inventory lot referencing the donation_item
                $addedAt = (function() use ($entryDateRaw) {
                    if ($entryDateRaw !== '') { $ts = strtotime($entryDateRaw); if ($ts !== false) { return date('Y-m-d H:i:s', $ts); } }
                    return date('Y-m-d H:i:s');
                })();
                $this->db->query(
                    "INSERT INTO inventory (donation_item_id, quantity, added_at) VALUES (?, ?, ?)",
                    [ $donationItemId, $qty, $addedAt ]
                );
                $invId = (int)$this->db->lastInsertId();

                // Movement audit (mode from procurement type)
                try {
                    $this->ensureTables();
                    $pb = (int)$performedBy;
                    if ($invId > 0 && $qty > 0 && $pb > 0) {
                        $this->db->query(
                            "INSERT INTO inventory_movements (inventory_id, donation_item_id, direction, quantity, mode, recipient_id, note, performed_by, created_at)
                             VALUES (?, ?, 'in', ?, ?, NULL, NULL, ?, NOW())",
                            [ $invId, $donationItemId, (int)$qty, $procType, $pb ]
                        );
                    }
                } catch (Exception $e2) { /* ignore movement log errors */ }
                $inserted++;
            } catch (Exception $e) {
                error_log('Inventory import insert failed at row '.$idx.': '.$e->getMessage());
                $errors[] = ['row' => $idx, 'error' => 'insert failed: ' . $e->getMessage()];
            }
        }
        return ['inserted' => $inserted, 'errors' => $errors];
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
                `mode` varchar(32) NOT NULL,
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
        // Attempt to migrate existing 'mode' column to VARCHAR(32) if it was an ENUM
        try {
            $col = $this->db->query("SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='inventory_movements' AND COLUMN_NAME='mode' LIMIT 1")->fetch();
            if ($col && isset($col['COLUMN_TYPE']) && stripos($col['COLUMN_TYPE'], 'enum(') === 0) {
                $this->db->query("ALTER TABLE inventory_movements MODIFY COLUMN mode varchar(32) NOT NULL");
            }
        } catch (Exception $e) { /* ignore */ }
    }

    /**
     * Update tags for all lots of an item/category group.
     * Passing null clears the tags.
     */
    public function updateTagsGroup(string $itemName, string $category, ?string $tags): void
    {
        // Update tags on the source donation_items rows for this item/category
        $this->db->query(
            "UPDATE donation_items SET tags = ? WHERE product_name = ? AND product_category = ?",
            [ $tags, $itemName, $category ]
        );
    }

    /**
     * Update tags for a single inventory lot by id.
     */
    public function updateTagsLot(int $inventoryId, ?string $tags): void
    {
        // Update tags on the donation_items row backing this inventory lot
        $row = $this->db->query("SELECT donation_item_id FROM inventory WHERE inventory_id = ?", [$inventoryId])->fetch();
        if ($row && isset($row['donation_item_id'])) {
            $this->db->query(
                "UPDATE donation_items SET tags = ? WHERE donation_item_id = ?",
                [ $tags, (int)$row['donation_item_id'] ]
            );
        }
    }
}
