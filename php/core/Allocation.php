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
        // Try the most recent snapshot for this period
        $row = $this->db->query(
            "SELECT selected_ids_json FROM distribution_selection_logs WHERE period_type='weekly' AND period_key = ? ORDER BY id DESC LIMIT 1",
            [$periodKey]
        )->fetch();
        if ($row && !empty($row['selected_ids_json'])){
            $ids = json_decode($row['selected_ids_json'], true);
            if (is_array($ids)){
                return array_values(array_filter(array_map('intval', $ids), fn($v)=>$v>0));
            }
        }
        return [];
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
            $r['tag_list'] = $this->normalizeTags($r['tags'] ?? '');
        }
        unset($r);
        return $rows;
    }

    private function matchBestInventory(array $recipientTags, array &$inventory): ?array
    {
        // Compute a simple score: 2 for exact-all, 1 for partial-any, 0 for fallback (no tags on recipient or item)
        $recSet = array_flip($recipientTags);
        $best = null; $bestScore = -1; $bestIdx = -1;
        foreach ($inventory as $idx => $item){
            if ((int)$item['quantity'] <= 0) continue;
            $itTags = $item['tag_list'] ?? [];
            $score = 0;
            if (!empty($recipientTags)){
                if (!empty($itTags)){
                    // exact-all: all recipient tags are present in item tags
                    $all = true;
                    foreach ($recipientTags as $t){ if (!in_array($t, $itTags, true)) { $all = false; break; } }
                    if ($all) $score = 2; else {
                        // partial-any
                        $intersect = array_intersect($recipientTags, $itTags);
                        if (!empty($intersect)) $score = 1; else $score = -1; // no match
                    }
                } else {
                    $score = 0; // fallback candidate
                }
            } else {
                // Recipient has no tags → general allocation
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
