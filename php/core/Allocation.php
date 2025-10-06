<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/Notification.php';

class Allocation
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    private function normalizeTags($tags): array
    {
        $arr = [];
        if (is_string($tags)) {
            $arr = preg_split('/[,;]+/', strtolower($tags));
        } elseif (is_array($tags)) {
            $arr = array_map(function($t){ return strtolower((string)$t); }, $tags);
        } elseif ($tags === null) {
            $arr = [];
        }
        $norm = [];
        foreach ($arr as $t) {
            $t = trim($t);
            if ($t === '') continue;
            $t = preg_replace('/[\s\/]+/', '-', $t);
            $t = preg_replace('/-+/', '-', $t);
            // Map known synonyms to canonical specialty triad keys
            if ($t === 'medicine') { $t = 'medical'; }
            if ($t === 'med') { $t = 'medical'; }
            $norm[$t] = true;
            // Heuristics: if compound tag contains a triad keyword, add the triad tag too
            if (strpos($t, 'medical') !== false) { $norm['medical'] = true; }
            if (strpos($t, 'infant') !== false || strpos($t, 'baby') !== false || strpos($t, 'toddler') !== false) { $norm['infant'] = true; }
            if (strpos($t, 'elder') !== false || strpos($t, 'senior') !== false) { $norm['elderly'] = true; }
        }
        return array_keys($norm);
    }

    private function getRecipientTags(int $recipientId): array
    {
        $row = $this->db->query('SELECT tags FROM recipient_profiles WHERE user_id = ?', [$recipientId])->fetch();
        $tags = $row ? ($row['tags'] ?? '') : '';
        return $this->normalizeTags($tags);
    }

    private function getRecipientPopulations(array $recipientIds): array
    {
        if (empty($recipientIds)) return [];
        $place = implode(',', array_fill(0, count($recipientIds), '?'));
        $rows = $this->db->query(
            "SELECT user_id, total_residents, male_count, female_count FROM recipient_profiles WHERE user_id IN ($place)",
            array_map('intval', $recipientIds)
        )->fetchAll();
        $map = [];
        foreach ($rows as $r){
            $uid = (int)$r['user_id'];
            $tot = (int)($r['total_residents'] ?? 0);
            if ($tot <= 0){
                $m = (int)($r['male_count'] ?? 0);
                $f = (int)($r['female_count'] ?? 0);
                $tot = $m + $f;
            }
            $map[$uid] = max(0, (int)$tot);
        }
        return $map;
    }

    private function getFinalWeekList(string $periodKey): array
    {
        // Assemble final list from normalized tables: carry-overs from previous week (absent), then planned for this week, capped to planned size
        if (!preg_match('/^(\d{4})-(\d{2})-W([1-4])$/', $periodKey, $m)) return [];
        $year = (int)$m[1]; $mon = (int)$m[2]; $wIndex = (int)$m[3];
        $prevW = $wIndex - 1; $prevYear = $year; $prevMon = $mon;
        if ($prevW < 1){ $prevW = 4; $prevMon = $mon - 1; if ($prevMon < 1){ $prevMon = 12; $prevYear = $year - 1; } }
        $prevKey = sprintf('%04d-%02d-W%d', $prevYear, $prevMon, $prevW);

        // planned list
        $rowsPlan = $this->db->query(
            "SELECT recipient_id FROM recipient_plans WHERE period_key = ? AND source = 'planned' ORDER BY position ASC",
            [$periodKey]
        )->fetchAll();
        $planned = array_map(fn($r)=> (int)$r['recipient_id'], $rowsPlan ?: []);
        $plannedCount = count($planned);

        // carryovers (absent from previous week)
        $rowsCo = $this->db->query(
            "SELECT recipient_id FROM recipient_attendance WHERE period_key = ? AND status = 'absent'",
            [$prevKey]
        )->fetchAll();
        $carryOvers = array_map(fn($r)=> (int)$r['recipient_id'], $rowsCo ?: []);
        $carryKeep = array_slice($carryOvers, 0, max(0, $plannedCount));

        // merge
        $final = [];
        $seen = [];
        foreach ($carryKeep as $id){ if ($id>0 && !isset($seen[$id])){ $seen[$id]=true; $final[]=$id; if (count($final) >= $plannedCount) break; } }
        if (count($final) < $plannedCount){
            foreach ($planned as $id){ if ($id>0 && !isset($seen[$id])){ $seen[$id]=true; $final[]=$id; if (count($final) >= $plannedCount) break; } }
        }
        return $final;
    }

    private function getInventoryCandidates(): array
    {
        // Load available inventory with optional product join for tags
        $rows = $this->db->query(
            "SELECT i.inventory_id, i.product_id, i.product_name, i.product_category, i.unit, i.quantity,
                    COALESCE(NULLIF(TRIM(i.tags), ''), NULLIF(TRIM(p.tags), '')) AS tags
             FROM inventory i
             LEFT JOIN products p ON p.product_id = i.product_id
             WHERE COALESCE(i.quantity,0) > 0",
            []
        )->fetchAll();
        // Normalize tags and index
        foreach ($rows as &$r){
            $full = $this->normalizeTags($r['tags'] ?? '');
            // keep only specialty triad for matching (medicine -> medical mapping handled in normalizeTags)
            $triad = ['infant'=>true,'elderly'=>true,'medical'=>true];
            $r['tag_list'] = array_values(array_filter($full, fn($t)=> isset($triad[$t])));
        }
        unset($r);
        return $rows;
    }

    private function eligibleRecipientsForItem(array $finalList, array $item, array $recipientTagsMap): array
    {
        $itTags = $item['tag_list'] ?? [];
        $isSpecial = !empty($itTags);
        if (!$isSpecial) return $finalList; // general items available to all
        $triad = ['infant'=>true,'elderly'=>true,'medical'=>true];
        $eligible = [];
        foreach ($finalList as $rid){
            $rtags = $recipientTagsMap[$rid] ?? [];
            $recSpec = array_values(array_filter($rtags, fn($t)=> isset($triad[$t])));
            if (empty($recSpec)) continue;
            if (!empty(array_intersect($recSpec, $itTags))) $eligible[] = $rid;
        }
        return $eligible;
    }

    public function previewAllocation(string $periodKey, ?array $limitRecipientIds = null): array
    {
        // Delegate to consolidated algorithm for maintainability
        require_once __DIR__ . '/AllocationAlgorithm.php';
        $alg = new AllocationAlgorithm();
        return $alg->previewAllocation($periodKey, $limitRecipientIds);
    }

    public function allocateWeek(string $periodKey, int $adminId = 0): array
    {
        $preview = $this->previewAllocation($periodKey);
        $rows = $preview['allocations'] ?? [];
        if (empty($rows)) return ['allocated'=>0, 'already_allocated'=>false];
        $allocated = 0;
        $this->db->beginTransaction();
        try {
            // Create allocation run (idempotent per period_key)
            try {
                $y = 0; $m = 0; $w = 0;
                if (preg_match('/^(\d{4})-(\d{2})-W([1-4])$/', $periodKey, $mm)){
                    $y = (int)$mm[1]; $m = (int)$mm[2]; $w = (int)$mm[3];
                }
                $this->db->query('INSERT INTO allocation_runs (period_key, year, month, week, created_by, created_at) VALUES (?,?,?,?,?, NOW())', [$periodKey, $y, $m, $w, $adminId ?: null]);
            } catch (Exception $e) {
                // Duplicate means already allocated for this period
                if ($this->db->inTransaction()) $this->db->rollBack();
                return ['allocated'=>0, 'already_allocated'=>true];
            }
            // Retrieve run_id
            $runRow = $this->db->query('SELECT run_id FROM allocation_runs WHERE period_key = ? ORDER BY run_id DESC LIMIT 1', [$periodKey])->fetch();
            $runId = (int)($runRow['run_id'] ?? 0);
            if ($runId <= 0) { throw new Exception('Failed to create allocation run'); }

            foreach ($rows as $a){
                $invId = (int)($a['inventory_id'] ?? 0);
                $qty = (int)($a['quantity'] ?? 0);
                $rid = (int)($a['recipient_id'] ?? 0);
                if ($invId <= 0 || $qty <= 0 || $rid <= 0) continue;
                // Deduct inventory (ensure available)
                $cur = $this->db->query('SELECT quantity, product_name, product_category, unit FROM inventory WHERE inventory_id = ? FOR UPDATE', [$invId])->fetch();
                if (!$cur) continue;
                $currentQty = (int)($cur['quantity'] ?? 0);
                if ($currentQty < $qty) continue;
                $this->db->query('UPDATE inventory SET quantity = quantity - ? WHERE inventory_id = ?', [$qty, $invId]);
                // Log movement
                $this->db->query(
                    'INSERT INTO inventory_movements (inventory_id, direction, quantity, mode, recipient_id, performed_by, created_at) VALUES (?,?,?,?,?,?, NOW())',
                    [ $invId, 'out', $qty, 'recipient', $rid, $adminId ?: null ]
                );
                // Log run item - table doesn't exist in current schema, commenting out
                // $this->db->query('INSERT INTO allocation_run_items (run_id, recipient_id, inventory_id, quantity) VALUES (?,?,?,?)', [ $runId, $rid, $invId, $qty ]);
                $allocated++;
            }
            $this->db->commit();
        } catch (Exception $e){
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
        return ['allocated'=>$allocated, 'already_allocated'=>false, 'run_id'=>($runId ?? null)];
    }

    public function createAllocation(int $recipientId, array $items, ?int $runId = null, ?string $allocationCode = null, bool $notifyAdmins = false): int
    {
        if ($recipientId <= 0) {
            throw new Exception('Recipient ID is required');
        }

        if (empty($items)) {
            throw new Exception('Items array cannot be empty');
        }

        // Verify recipient exists
        $recipientRow = $this->db->query('SELECT user_id FROM users WHERE user_id = ? AND role = "recipient"', [$recipientId])->fetch();
        if (!$recipientRow) {
            throw new Exception('Recipient not found or not a valid recipient');
        }

        $this->db->beginTransaction();
        try {
            // Create allocation record
            $this->db->query(
                'INSERT INTO allocations (recipient_id, run_id, status, created_at, updated_at) VALUES (?, ?, "Pending", NOW(), NOW())',
                [$recipientId, $runId ?: null]
            );

            $allocationId = (int)$this->db->lastInsertId();
            if ($allocationId <= 0) {
                throw new Exception('Failed to create allocation record');
            }

            // Create allocation items
            $this->addAllocationItems($allocationId, $items);

            $this->db->commit();

            // Optional: notify admins about new allocation
            if ($notifyAdmins) {
                try {
                    $this->notifyAdmins('allocation_created', 'allocation', $allocationId, "New allocation #{$allocationId} created for recipient #{$recipientId}.");
                } catch (Exception $e) { /* ignore notification errors */ }
            }

            return $allocationId;
        } catch (Exception $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }

    public function createRun(int $adminId, ?string $note = null, ?string $periodKey = null): int
    {
        error_log("=== CREATERUN DEBUG ===");
        error_log("createRun called with adminId=$adminId, note=" . var_export($note, true) . ", periodKey=" . var_export($periodKey, true));

        if ($adminId <= 0) {
            error_log("createRun: Admin ID is invalid: $adminId");
            throw new Exception('Admin ID is required');
        }

        // Generate period_key if not provided (YYYY-MM-W1..W4 to match UI buckets)
        if (empty($periodKey)) {
            $now = new DateTime();
            $year = (int)$now->format('Y');
            $mon  = (int)$now->format('m');
            // Compute week-of-month bucket W1..W4, Sunday week start (matches frontend default)
            $first = new DateTime(sprintf('%04d-%02d-01', $year, $mon));
            $firstDow = (int)$first->format('w'); // 0=Sun..6=Sat
            $weekStartDow = 0; // Sunday
            $offset = ($firstDow - $weekStartDow + 7) % 7;
            $firstWeekStart = (clone $first)->modify(sprintf('-%d day', $offset));
            $wIndex = 1; $cursor = clone $firstWeekStart;
            while ((clone $cursor)->modify('+7 day') <= (new DateTime(sprintf('%04d-%02d-01', $year, $mon)))->modify('+1 month')){
                $next = (clone $cursor)->modify('+7 day');
                if ($now >= $cursor && $now < $next) break;
                $wIndex++; $cursor = $next;
            }
            $wIndex = max(1, min(4, (int)$wIndex));
            $periodKey = sprintf('%04d-%02d-W%d', $year, $mon, $wIndex);
            error_log("createRun: Generated period_key (bucket): $periodKey");
        }

        try {
            error_log("createRun: Upsert into allocation_runs (idempotent)");

            // Validate admin exists, otherwise use NULL to avoid FK violation
            $insAdmin = $adminId;
            try {
                $urow = $this->db->query('SELECT user_id FROM users WHERE user_id = ? LIMIT 1', [$adminId])->fetch();
                if (!$urow) { $insAdmin = null; }
            } catch (Exception $e) { $insAdmin = null; }

            // Derive Y/M/W from period_key (YYYY-MM-Wn)
            $yy = 0; $mm = 0; $ww = 0;
            if (preg_match('/^(\d{4})-(\d{2})-W([1-4])$/', $periodKey, $m)){
                $yy = (int)$m[1]; $mm = (int)$m[2]; $ww = (int)$m[3];
            }
            // Idempotent insert: on duplicate, preserve run_id
            $this->db->query(
                'INSERT INTO allocation_runs (period_key, year, month, week, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                   run_id = LAST_INSERT_ID(run_id)'
                , [$periodKey, $yy, $mm, $ww, $insAdmin]
            );

            $runId = (int)$this->db->lastInsertId();
            if ($runId <= 0) {
                // Fallback: fetch by period_key
                $row = $this->db->query('SELECT run_id FROM allocation_runs WHERE period_key = ? LIMIT 1', [$periodKey])->fetch();
                $runId = (int)($row['run_id'] ?? 0);
            }

            if ($runId <= 0) {
                error_log("createRun: Failed to resolve run_id for period_key=$periodKey");
                throw new Exception('Failed to create or fetch allocation run');
            }

            error_log("createRun: Successfully created run_id $runId for admin $adminId with period_key $periodKey");
            return $runId;
        } catch (Exception $e) {
            error_log("createRun: Database error: " . $e->getMessage());
            error_log("createRun: Error trace: " . $e->getTraceAsString());
            throw $e;
        }
    }

    // Deduct inventory for a saved allocation and mark it Delivered
    public function finalizeAllocation(int $allocationId, int $adminId = 0): bool
    {
        // Load allocation header
        $row = $this->db->query('SELECT recipient_id, status FROM allocations WHERE allocation_id = ? FOR UPDATE', [$allocationId])->fetch();
        if (!$row) return false;
        $recipientId = (int)$row['recipient_id'];
        $status = strtolower((string)($row['status'] ?? ''));
        if (!in_array($status, ['allocated', 'acknowledged'], true)) {
            // Only allow finalize from Allocated/Acknowledged
            return false;
        }
        // Load items to fulfill
        $items = $this->db->query('SELECT inventory_id, quantity FROM allocation_items WHERE allocation_id = ? ORDER BY id ASC', [$allocationId])->fetchAll();
        if (!$items) return false;

        $this->db->beginTransaction();
        try {
            foreach ($items as $it){
                $inventoryId = (int)($it['inventory_id'] ?? 0);
                $need = (int)($it['quantity'] ?? 0);
                if ($inventoryId <= 0 || $need <= 0) continue;

                // Get inventory details for this item
                $invRow = $this->db->query('SELECT product_name, product_category, unit FROM inventory WHERE inventory_id = ?', [$inventoryId])->fetch();
                if (!$invRow) continue;

                $name = (string)($invRow['product_name'] ?? '');
                $cat = (string)($invRow['product_category'] ?? '');
                $unit = (string)($invRow['unit'] ?? '');

                if ($name === '' || $need <= 0) continue;
                // Gather matching inventory rows FIFO (by inventory_id ASC) with quantity > 0
                $rows = $this->db->query(
                    'SELECT inventory_id, quantity, product_name, product_category, unit FROM inventory WHERE COALESCE(quantity,0) > 0 AND product_name = ? AND (product_category = ? OR (? = "" AND product_category IS NULL)) AND (unit = ? OR (? = "" AND (unit IS NULL OR unit = ""))) ORDER BY inventory_id ASC',
                    [$name, $cat, $cat, $unit, $unit]
                )->fetchAll();
                $idx = 0;
                while ($need > 0 && $idx < count($rows)){
                    $rowInv = $rows[$idx];
                    $invId = (int)$rowInv['inventory_id'];
                    $have = (int)$rowInv['quantity'];
                    if ($have <= 0) { $idx++; continue; }
                    $take = min($need, $have);
                    if ($take > 0){
                        // Deduct
                        $this->db->query('UPDATE inventory SET quantity = quantity - ? WHERE inventory_id = ?', [$take, $invId]);
                        // Log movement
                        try {
                            $this->db->query(
                                'INSERT INTO inventory_movements (inventory_id, direction, quantity, mode, recipient_id, performed_by, created_at) VALUES (?,?,?,?,?,?, NOW())',
                                [ $invId, 'out', $take, 'recipient', $recipientId, $adminId ?: null ]
                            );
                        } catch (Exception $e) {
                            // If inventory_movements table has issues, just log to error log
                            try { error_log("Inventory movement failed: " . $e->getMessage()); } catch(_) {}
                        }
                        $need -= $take;
                    }
                    $idx++;
                }
                if ($need > 0){
                    // Not enough stock to fulfill this item; rollback
                    if ($this->db->inTransaction()) $this->db->rollBack();
                    return false;
                }
            }
            // All items fulfilled; mark Delivered
            $this->db->query('UPDATE allocations SET status = "Delivered", delivered_at = NOW(), updated_at = NOW() WHERE allocation_id = ?', [$allocationId]);
            $this->db->commit();
            // Optional: notify admins about finalization
            try { $this->notifyAdmins('allocation_delivered', 'allocation', $allocationId, "Allocation #{$allocationId} delivered and inventory deducted."); } catch (Exception $e) { /* ignore */ }
            return true;
        } catch (Exception $e){
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }

    public function addAllocationItems(int $allocationId, array $items): void
    {
        foreach ($items as $it){
            // Support both old format (item_name, category, quantity) and new format (inventory_id, quantity)
            $inventoryId = (int)($it['inventory_id'] ?? $it['inventoryId'] ?? 0);

            // If no inventory_id provided, try to find inventory item by name and category
            if ($inventoryId <= 0) {
                $name = trim((string)($it['item_name'] ?? $it['name'] ?? ''));
                $category = trim((string)($it['category'] ?? $it['product_category'] ?? ''));

                if ($name !== '') {
                    // Find inventory item by name and category
                    $invRow = $this->db->query(
                        'SELECT inventory_id FROM inventory WHERE product_name = ? AND (product_category = ? OR (? = "" AND product_category IS NULL)) LIMIT 1',
                        [$name, $category, $category]
                    )->fetch();
                    if ($invRow) {
                        $inventoryId = (int)$invRow['inventory_id'];
                    }
                }
            }

            if ($inventoryId <= 0) continue;
            $qty = (int)($it['quantity'] ?? $it['qty'] ?? 0);
            if ($qty <= 0) continue;

            $this->db->query(
                'INSERT INTO allocation_items (allocation_id, inventory_id, quantity, created_at) VALUES (?, ?, ?, NOW())',
                [ $allocationId, $inventoryId, $qty ]
            );
        }
    }

    public function listByRecipient(int $recipientId): array
    {
        $rows = $this->db->query(
            'SELECT a.* FROM allocations a WHERE a.recipient_id = ? ORDER BY a.created_at DESC, a.allocation_id DESC',
            [ $recipientId ]
        )->fetchAll();
        $out = [];
        foreach ($rows as $r){
            $aid = (int)$r['allocation_id'];

            // Use new schema (inventory-linked)
            $items = $this->db->query('
                SELECT
                    ai.id,
                    ai.inventory_id,
                    ai.quantity,
                    i.product_name,
                    i.product_category,
                    i.unit
                FROM allocation_items ai
                LEFT JOIN inventory i ON ai.inventory_id = i.inventory_id
                WHERE ai.allocation_id = ?
                ORDER BY ai.id ASC
            ', [$aid])->fetchAll();

            $out[] = [
                'allocation_id' => $aid,
                'recipient_id' => (int)$r['recipient_id'],
                'status' => $r['status'] ?? 'Allocated',
                'scheduled_pickup_at' => $r['scheduled_pickup_at'] ?? null,
                'acknowledged_at' => $r['acknowledged_at'] ?? null,
                'cancelled_at' => $r['cancelled_at'] ?? null,
                'delivered_at' => $r['delivered_at'] ?? null,
                'cancel_reason' => $r['cancel_reason'] ?? null,
                'created_at' => $r['created_at'] ?? null,
                'updated_at' => $r['updated_at'] ?? null,
                'items' => array_map(function($it){
                    return [
                        'item_id' => (int)$it['id'],
                        'item_name' => $it['product_name'] ?? 'Unknown Item',
                        'category' => $it['product_category'] ?? null,
                        'quantity' => (int)$it['quantity'],
                        'unit' => $it['unit'] ?? null,
                    ];
                }, $items ?: [])
            ];
        }
        return $out;
    }

    // ==== Edits and Run operations ====
    public function updateItemQuantity(int $itemId, int $quantity): bool
    {
        if ($itemId <= 0 || $quantity < 0) return false;
        $this->db->query('UPDATE allocation_items SET quantity = ? WHERE id = ?', [$quantity, $itemId]);
        return true;
    }

    public function notifyRun(int $runId): bool
    {
        if ($runId <= 0) return false;
        $this->db->beginTransaction();
        try {
            $this->db->query('UPDATE allocations SET status = "Notified", updated_at = NOW() WHERE run_id = ? AND status IN ("Pending","Allocated","Acknowledged")', [$runId]);
            $this->db->commit();
            return true;
        } catch (Exception $e){ if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }

    public function cancelRun(int $runId): bool
    {
        if ($runId <= 0) return false;
        $this->db->beginTransaction();
        try {
            $this->db->query('UPDATE allocations SET status = "Cancelled", cancelled_at = NOW(), updated_at = NOW() WHERE run_id = ? AND status <> "Delivered"', [$runId]);
            $this->db->commit();
            return true;
        } catch (Exception $e){ if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }

    public function finalizeBulk(array $allocationIds, int $adminId = 0): array
    {
        $out = ['ok'=>[], 'fail'=>[]];
        foreach ($allocationIds as $aid){
            $aid = (int)$aid; if ($aid <= 0) continue;
            try {
                $ok = $this->finalizeAllocation($aid, $adminId);
                if ($ok) $out['ok'][] = $aid; else $out['fail'][] = $aid;
            } catch (Exception $e){ $out['fail'][] = $aid; }
        }
        return $out;
    }

    // === Item CRUD ===
    public function addItem(int $allocationId, int $inventoryId, int $quantity): int
    {
        $allocationId = (int)$allocationId;
        $inventoryId = (int)$inventoryId;
        $quantity = (int)$quantity;

        if ($allocationId <= 0 || $inventoryId <= 0 || $quantity <= 0) return 0;

        // Verify inventory item exists
        $invRow = $this->db->query('SELECT inventory_id FROM inventory WHERE inventory_id = ?', [$inventoryId])->fetch();
        if (!$invRow) return 0;

        $this->db->query(
            'INSERT INTO allocation_items (allocation_id, inventory_id, quantity, created_at) VALUES (?, ?, ?, NOW())',
            [ $allocationId, $inventoryId, $quantity ]
        );
        $row = $this->db->query('SELECT id FROM allocation_items WHERE allocation_id = ? ORDER BY id DESC LIMIT 1', [$allocationId])->fetch();
        return (int)($row['id'] ?? 0);
    }

    public function updateItem(int $itemId, ?int $inventoryId = null, ?int $quantity = null): bool
    {
        $itemId = (int)$itemId;
        if ($itemId <= 0) return false;

        $sets = []; $vals = [];

        if ($inventoryId !== null){
            if ($inventoryId <= 0) return false;
            // Verify inventory item exists
            $invRow = $this->db->query('SELECT inventory_id FROM inventory WHERE inventory_id = ?', [$inventoryId])->fetch();
            if (!$invRow) return false;
            $sets[] = 'inventory_id = ?';
            $vals[] = $inventoryId;
        }

        if ($quantity !== null){
            $sets[] = 'quantity = ?';
            $vals[] = max(0, (int)$quantity);
        }

        if (empty($sets)) return true;

        $sql = 'UPDATE allocation_items SET ' . implode(', ', $sets) . ' WHERE id = ?';
        $vals[] = $itemId;
        $this->db->query($sql, $vals);
        return true;
    }

    public function deleteItem(int $itemId): bool
    {
        $itemId = (int)$itemId; if ($itemId <= 0) return false;
        $this->db->query('DELETE FROM allocation_items WHERE id = ?', [$itemId]);
        return true;
    }

    // Recent allocation runs (newest first)
    public function listRuns(int $limit = 20): array
    {
        $limit = max(1, min(100, (int)$limit));
        $rows = $this->db->query("SELECT run_id, period_key, created_by, created_at FROM allocation_runs ORDER BY run_id DESC LIMIT {$limit}", [])->fetchAll();
        return $rows ?: [];
    }

    public function latestRun(): ?array
    {
        $row = $this->db->query('SELECT run_id, period_key, created_by, created_at FROM allocation_runs ORDER BY run_id DESC LIMIT 1', [])->fetch();
        return $row ?: null;
    }

    public function getRunByPeriod(string $periodKey): ?array
    {
        $periodKey = trim($periodKey);
        if ($periodKey === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $periodKey)) return null;
        $row = $this->db->query('SELECT run_id, period_key, created_by, created_at FROM allocation_runs WHERE period_key = ? LIMIT 1', [ $periodKey ])->fetch();
        return $row ?: null;
    }

    // Ensure a run exists for the given period_key; create it idempotently if missing
    public function ensureRun(string $periodKey, int $adminId): ?array
    {
        $periodKey = trim($periodKey);
        if ($periodKey === '' || !preg_match('/^\d{4}-\d{2}-W[1-4]$/', $periodKey)) return null;
        $row = $this->getRunByPeriod($periodKey);
        if ($row) return $row;
        // Create and re-fetch
        $runId = $this->createRun(max(1, (int)$adminId), null, $periodKey);
        if ($runId > 0){
            $row2 = $this->getRunByPeriod($periodKey);
            if ($row2) return $row2;
            // Fallback shape if immediate read not visible yet
            return [ 'run_id'=>$runId, 'period_key'=>$periodKey, 'created_by'=>$adminId, 'created_at'=>date('Y-m-d H:i:s') ];
        }
        return null;
    }

    // List allocations and their items for a given run
    public function listByRun(int $runId): array
    {
        $rows = $this->db->query('SELECT * FROM allocations WHERE run_id = ? ORDER BY created_at DESC, allocation_id DESC', [$runId])->fetchAll();
        $out = [];
        foreach ($rows as $r){
            $aid = (int)$r['allocation_id'];

            // Use new schema (inventory-linked)
            $items = $this->db->query('
                SELECT
                    ai.id,
                    ai.inventory_id,
                    ai.quantity,
                    i.product_name,
                    i.product_category,
                    i.unit
                FROM allocation_items ai
                LEFT JOIN inventory i ON ai.inventory_id = i.inventory_id
                WHERE ai.allocation_id = ?
                ORDER BY ai.id ASC
            ', [$aid])->fetchAll();

            $out[] = [
                'allocation_id' => $aid,
                'run_id' => (int)$r['run_id'],
                'recipient_id' => (int)$r['recipient_id'],
                'status' => $r['status'] ?? 'Allocated',
                'created_at' => $r['created_at'] ?? null,
                'updated_at' => $r['updated_at'] ?? null,
                'items' => array_map(function($it){
                    return [
                        'item_id' => (int)$it['id'],
                        'item_name' => $it['product_name'] ?? 'Unknown Item',
                        'category' => $it['product_category'] ?? null,
                        'quantity' => (int)$it['quantity'],
                        'unit' => $it['unit'] ?? null,
                    ];
                }, $items ?: [])
            ];
        }
        return $out;
    }

    public function listByIds(array $allocationIds): array
    {
        $ids = array_values(array_unique(array_map('intval', array_filter($allocationIds, fn($v)=>$v>0))));
        if (empty($ids)) return [];
        $place = implode(',', array_fill(0, count($ids), '?'));
        $rows = $this->db->query(
            "SELECT * FROM allocations WHERE allocation_id IN ($place) ORDER BY created_at DESC, allocation_id DESC",
            $ids
        )->fetchAll();
        $out = [];
        foreach ($rows as $r){
            $aid = (int)$r['allocation_id'];

            // Use new schema (inventory-linked)
            $items = $this->db->query('
                SELECT
                    ai.id,
                    ai.inventory_id,
                    ai.quantity,
                    i.product_name,
                    i.product_category,
                    i.unit
                FROM allocation_items ai
                LEFT JOIN inventory i ON ai.inventory_id = i.inventory_id
                WHERE ai.allocation_id = ?
                ORDER BY ai.id ASC
            ', [$aid])->fetchAll();

            $out[] = [
                'allocation_id' => $aid,
                'recipient_id' => (int)$r['recipient_id'],
                'status' => $r['status'] ?? 'Allocated',
                'scheduled_pickup_at' => $r['scheduled_pickup_at'] ?? null,
                'acknowledged_at' => $r['acknowledged_at'] ?? null,
                'cancelled_at' => $r['cancelled_at'] ?? null,
                'delivered_at' => $r['delivered_at'] ?? null,
                'cancel_reason' => $r['cancel_reason'] ?? null,
                'created_at' => $r['created_at'] ?? null,
                'updated_at' => $r['updated_at'] ?? null,
                'items' => array_map(function($it){
                    return [
                        'item_name' => $it['product_name'] ?? 'Unknown Item',
                        'category' => $it['product_category'] ?? null,
                        'quantity' => (int)$it['quantity'],
                        'unit' => $it['unit'] ?? null,
                    ];
                }, $items ?: [])
            ];
        }
        return $out;
    }

    public function acknowledge(int $allocationId, int $recipientId): bool
    {
        // Only allow ack if owned by recipient and in Allocated status
        $row = $this->db->query('SELECT status, recipient_id FROM allocations WHERE allocation_id = ?', [$allocationId])->fetch();
        if (!$row || (int)$row['recipient_id'] !== $recipientId) return false;
        $st = strtolower((string)$row['status']);
        if (!in_array($st, ['allocated','notified'], true)) return false;
        $this->db->query('UPDATE allocations SET status = "Acknowledged", acknowledged_at = NOW(), updated_at = NOW() WHERE allocation_id = ?', [$allocationId]);
        // Notify admins
        try {
            $rec = $this->db->query('SELECT u.name, rp.organization_name FROM users u LEFT JOIN recipient_profiles rp ON u.user_id = rp.user_id WHERE u.user_id = ?', [$recipientId])->fetch();
            $rname = $rec && $rec['organization_name'] ? $rec['organization_name'] : ($rec ? ($rec['name'] ?? ('Recipient '.$recipientId)) : ('Recipient '.$recipientId));
            $msg = "Allocation acknowledged by {$rname} on " . date('Y-m-d H:i:s') . ".";
            $this->notifyAdmins('allocation_acknowledged', 'allocation', $allocationId, $msg);
        } catch (Exception $e) { /* ignore notification errors */ }
        return true;
    }

    public function cancel(int $allocationId, int $recipientId, string $reason): bool
    {
        $row = $this->db->query('SELECT status, recipient_id FROM allocations WHERE allocation_id = ?', [$allocationId])->fetch();
        if (!$row || (int)$row['recipient_id'] !== $recipientId) return false;
        $st = strtolower((string)$row['status']);
        // Allow cancellation before inventory is deducted: Allocated, Notified, or Acknowledged
        if (!in_array($st, ['allocated','notified','acknowledged'], true)) return false;
        $this->db->query('UPDATE allocations SET status = "Cancelled", cancel_reason = ?, cancelled_at = NOW(), updated_at = NOW() WHERE allocation_id = ?', [$reason, $allocationId]);
        // Notify admins
        try {
            $rec = $this->db->query('SELECT u.name, rp.organization_name FROM users u LEFT JOIN recipient_profiles rp ON u.user_id = rp.user_id WHERE u.user_id = ?', [$recipientId])->fetch();
            $rname = $rec && $rec['organization_name'] ? $rec['organization_name'] : ($rec ? ($rec['name'] ?? ('Recipient '.$recipientId)) : ('Recipient '.$recipientId));
            $msg = "Allocation cancelled by {$rname}. Reason: {$reason}";
            $this->notifyAdmins('allocation_cancelled', 'allocation', $allocationId, $msg);
        } catch (Exception $e) { /* ignore notification errors */ }
        return true;
    }

    public function schedule(int $allocationId, int $recipientId): bool
    {
        // Only allow schedule if owned by recipient and in Acknowledged status
        $row = $this->db->query('SELECT status, recipient_id FROM allocations WHERE allocation_id = ?', [$allocationId])->fetch();
        if (!$row || (int)$row['recipient_id'] !== $recipientId) return false;
        $st = strtolower((string)$row['status']);
        if ($st !== 'acknowledged') return false;

        // Get allocation items to deduct from inventory
        $items = $this->db->query('SELECT inventory_id, quantity FROM allocation_items WHERE allocation_id = ? ORDER BY id ASC', [$allocationId])->fetchAll();
        if (!$items) return false;

        $this->db->beginTransaction();
        try {
            // Try to deduct from inventory if table exists
            $inventoryExists = false;
            try {
                // First check if inventory table exists at all
                $this->db->query('SELECT 1 FROM inventory LIMIT 1')->fetch();
                $inventoryExists = true;
            } catch (Exception $e) {
                $inventoryExists = false;
                try { error_log("Inventory table check failed: " . $e->getMessage()); } catch(_) {}
            }

            if ($inventoryExists) {
                // Check if allocation_items has inventory_id column (new schema)
                $hasInventoryId = false;
                try {
                    // Test if we can access inventory_id column
                    $testQuery = $this->db->query('SELECT inventory_id FROM allocation_items WHERE allocation_id = ? LIMIT 1', [$allocationId])->fetch();
                    $hasInventoryId = true;
                } catch (Exception $e) {
                    $hasInventoryId = false;
                }

                if ($hasInventoryId) {
                    // New schema: allocation_items has inventory_id
                    foreach ($items as $it){
                        $inventoryId = (int)($it['inventory_id'] ?? 0);
                        $need = (int)($it['quantity'] ?? 0);
                        if ($inventoryId <= 0 || $need <= 0) continue;

                        // Get current inventory quantity
                        $invRow = $this->db->query('SELECT quantity, product_name, product_category, unit FROM inventory WHERE inventory_id = ?', [$inventoryId])->fetch();
                        if (!$invRow) {
                            // Inventory item not found
                            if ($this->db->inTransaction()) $this->db->rollBack();
                            return false;
                        }

                        $have = (int)$invRow['quantity'];
                        if ($have < $need) {
                            // Not enough stock
                            if ($this->db->inTransaction()) $this->db->rollBack();
                            return false;
                        }

                        // Deduct from inventory
                        $this->db->query('UPDATE inventory SET quantity = quantity - ? WHERE inventory_id = ?', [$need, $inventoryId]);

                        // Log movement
                        try {
                            $this->db->query(
                                'INSERT INTO inventory_movements (inventory_id, direction, quantity, mode, recipient_id, performed_by, created_at) VALUES (?,?,?,?,?,?, NOW())',
                                [ $inventoryId, 'out', $need, 'recipient', $recipientId, null ]
                            );
                        } catch (Exception $e) {
                            // If inventory_movements table has issues, just log to error log
                            try { error_log("Inventory movement failed: " . $e->getMessage()); } catch(_) {}
                        }
                    }
                } else {
                    // Old schema: allocation_items has item_name, category, unit - skip inventory deduction
                    // Just mark as picked up without inventory changes
                }
            }

            // All items fulfilled; mark as Picked Up
            $this->db->query('UPDATE allocations SET status = "Picked Up", updated_at = NOW() WHERE allocation_id = ?', [$allocationId]);
            $this->db->commit();

            // Notify admins
            try {
                $rec = $this->db->query('SELECT u.name, rp.organization_name FROM users u LEFT JOIN recipient_profiles rp ON u.user_id = rp.user_id WHERE u.user_id = ?', [$recipientId])->fetch();
                $rname = $rec && $rec['organization_name'] ? $rec['organization_name'] : ($rec ? ($rec['name'] ?? ('Recipient '.$recipientId)) : ('Recipient '.$recipientId));
                $msg = $inventoryExists ? "Allocation picked up by {$rname} and inventory deducted." : "Allocation picked up by {$rname}.";
                $this->notifyAdmins('allocation_picked_up', 'allocation', $allocationId, $msg);
            } catch (Exception $e) { /* ignore notification errors */ }
            return true;
        } catch (Exception $e){
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }

    public function acknowledgeByAdmin(int $allocationId, int $adminId): bool
    {
        $row = $this->db->query('SELECT status FROM allocations WHERE allocation_id = ?', [$allocationId])->fetch();
        if (!$row) return false;
        if (strtolower((string)$row['status']) !== 'allocated') return false;
        $this->db->query('UPDATE allocations SET status = "Acknowledged", acknowledged_at = NOW(), updated_at = NOW() WHERE allocation_id = ?', [$allocationId]);
        // Notify admins (info log)
        try {
            $msg = "Allocation acknowledged by admin #{$adminId}.";
            $this->notifyAdmins('allocation_acknowledged_admin', 'allocation', $allocationId, $msg);
        } catch (Exception $e) { /* ignore notification errors */ }
        return true;
    }

    private function notifyAdmins(string $type, string $refType, int $refId, string $message): void
    {
        try {
            $rows = $this->db->query("SELECT user_id FROM users WHERE role = 'admin'")->fetchAll();
            if (!$rows) return;
            $notif = new Notification();
            foreach ($rows as $r){
                $uid = (int)($r['user_id'] ?? 0);
                if ($uid <= 0) continue;
                try { $notif->create([ 'user_id'=>$uid, 'type'=>$type, 'reference_type'=>$refType, 'reference_id'=>$refId, 'message'=>$message ]); } catch (Exception $e) { /* per-user ignore */ }
            }
        } catch (Exception $e) { /* ignore */ }
    }
}
