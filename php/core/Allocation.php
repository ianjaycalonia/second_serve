<?php
require_once __DIR__ . '/../includes/config.php';

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
            $norm[$t] = true;
        }
        return array_keys($norm);
    }

    private function getRecipientTags(int $recipientId): array
    {
        $row = $this->db->query('SELECT tags FROM recipient_profiles WHERE user_id = ?', [$recipientId])->fetch();
        $tags = $row ? ($row['tags'] ?? '') : '';
        return $this->normalizeTags($tags);
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
            // keep only specialty triad for matching
            $triad = ['infant'=>true,'elderly'=>true,'medical'=>true];
            $r['tag_list'] = array_values(array_filter($full, fn($t)=> isset($triad[$t])));
        }
        unset($r);
        return $rows;
    }

    private function matchBestInventory(array $recipientTags, array &$inventory): ?array
    {
        // Specialty-first: intersect recipient specialty triad with item specialty triad
        $triad = ['infant'=>true,'elderly'=>true,'medical'=>true];
        $recSpec = array_values(array_filter($recipientTags, fn($t)=> isset($triad[$t])));
        $best = null; $bestScore = -1; $bestIdx = -1;
        foreach ($inventory as $idx => $item){
            if ((int)$item['quantity'] <= 0) continue;
            $itTags = $item['tag_list'] ?? [];
            $score = 0;
            if (!empty($recSpec)){
                // require at least one specialty intersection
                $inter = array_intersect($recSpec, $itTags);
                if (!empty($inter)){
                    // exact-all within triad gets higher score
                    $all = true; foreach ($recSpec as $t){ if (!in_array($t, $itTags, true)) { $all=false; break; } }
                    $score = $all ? 3 : 2;
                } else {
                    $score = -1; // no specialty match
                }
            } else {
                // recipient has no specialty → neutral; prefer untagged item or any
                $score = empty($itTags) ? 1 : 0;
            }
            if ($score > $bestScore){ $bestScore = $score; $best = $item; $bestIdx = $idx; }
        }
        if ($bestScore < 0) return null; // no candidate
        // Reserve one unit from this item in-memory
        if ($bestIdx >= 0){ $inventory[$bestIdx]['quantity'] = (int)$inventory[$bestIdx]['quantity'] - 1; }
        // Return chosen item plus allocated qty
        $best['alloc_qty'] = 1;
        return $best;
    }

    public function previewAllocation(string $periodKey): array
    {
        $finalList = $this->getFinalWeekList($periodKey);
        if (empty($finalList)) return ['period_key'=>$periodKey, 'allocations'=>[], 'summary'=>['recipients'=>0,'allocated'=>0]];
        $inventory = $this->getInventoryCandidates();
        $allocations = [];
        $allocatedCount = 0;
        foreach ($finalList as $rid){
            $rtags = $this->getRecipientTags($rid);
            $chosen = $this->matchBestInventory($rtags, $inventory);
            if ($chosen){
                $allocations[] = [
                    'recipient_id' => $rid,
                    'inventory_id' => (int)$chosen['inventory_id'],
                    'product_name' => $chosen['product_name'],
                    'product_category' => $chosen['product_category'],
                    'unit' => $chosen['unit'],
                    'quantity' => (int)$chosen['alloc_qty'],
                    'tags_match' => $chosen['tag_list'] ?? [],
                ];
                $allocatedCount++;
            } else {
                $allocations[] = [ 'recipient_id' => $rid, 'inventory_id' => null, 'product_name' => null, 'quantity' => 0, 'note' => 'No matching item'];
            }
        }
        return [ 'period_key'=>$periodKey, 'allocations'=>$allocations, 'summary'=>['recipients'=>count($finalList),'allocated'=>$allocatedCount] ];
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
                $this->db->query('INSERT INTO allocation_runs (period_key, created_by, created_at) VALUES (?,?, NOW())', [$periodKey, $adminId ?: null]);
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
                    'INSERT INTO inventory_movements (inventory_id, recipient_id, product_name, product_category, quantity, unit, admin_in_charge, created_at) VALUES (?,?,?,?,?,?,?, NOW())',
                    [ $invId, $rid, ($cur['product_name'] ?? $a['product_name']), ($cur['product_category'] ?? $a['product_category']), $qty, ($cur['unit'] ?? $a['unit']), $adminId ?: null ]
                );
                // Log run item
                $this->db->query('INSERT INTO allocation_run_items (run_id, recipient_id, inventory_id, quantity) VALUES (?,?,?,?)', [ $runId, $rid, $invId, $qty ]);
                $allocated++;
            }
            $this->db->commit();
        } catch (Exception $e){
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
        return ['allocated'=>$allocated, 'already_allocated'=>false, 'run_id'=>($runId ?? null)];
    }
}
