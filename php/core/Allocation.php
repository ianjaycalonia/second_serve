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
        // If a limit list is provided, use it exactly; otherwise use the computed final weekly list
        if (is_array($limitRecipientIds) && !empty($limitRecipientIds)){
            $finalList = array_values(array_unique(array_map('intval', array_filter($limitRecipientIds, fn($v)=>$v>0))));
        } else {
            $finalList = $this->getFinalWeekList($periodKey);
        }
        if (empty($finalList)) return ['period_key'=>$periodKey, 'allocations'=>[], 'summary'=>['recipients'=>0,'allocated'=>0,'total_qty'=>0]];
        $inventory = $this->getInventoryCandidates();
        // Preload recipient tags and populations
        $recipientTagsMap = [];
        foreach ($finalList as $rid){ $recipientTagsMap[$rid] = $this->getRecipientTags($rid); }
        $popMap = $this->getRecipientPopulations($finalList);

        $allocations = [];
        $totalQtyAllocated = 0;

        // Group all inventory by product (name/category/unit) regardless of specialty
        $groups = [];
        foreach ($inventory as $it){
            $k = ($it['product_name'] ?? '') . "\u0001" . ($it['product_category'] ?? '') . "\u0001" . ($it['unit'] ?? '');
            if (!isset($groups[$k])){
                $groups[$k] = [ 'rows' => [], 'name' => ($it['product_name'] ?? ''), 'category' => ($it['product_category'] ?? ''), 'unit' => ($it['unit'] ?? ''), 'tags' => ($it['tag_list'] ?? []) ];
            }
            $groups[$k]['rows'][] = $it;
            // Combine tags (if any row has special tags, treat the product as special for eligibility purposes)
            if (!empty($it['tag_list'])){
                $groups[$k]['tags'] = array_values(array_unique(array_merge($groups[$k]['tags'], $it['tag_list'])));
            }
        }

        // Proportional allocation with largest remainder per grouped product
        foreach ($groups as $g){
            $rows = $g['rows'];
            $totalAvail = 0;
            foreach ($rows as $r){ $totalAvail += (int)($r['quantity'] ?? 0); }
            if ($totalAvail <= 0) continue;
            $A = (int)floor($totalAvail * 0.90); // hold back 10%
            if ($A <= 0) continue;

            // Determine eligible recipients: if product has specialty tags, filter; else all finalList
            $isSpecial = !empty($g['tags']);
            $eligible = $isSpecial ? $this->eligibleRecipientsForItem($finalList, ['tag_list'=>$g['tags']], $recipientTagsMap) : $finalList;
            if (empty($eligible)) continue;
            // If specialty item has only one eligible recipient, cap to half of the 90% pool
            if ($isSpecial && count($eligible) === 1){
                $A = (int)floor($A * 0.5);
                if ($A <= 0) continue;
            }

            // Build population vector with missing replaced by average of known if any
            $knownSum = 0; $knownCnt = 0;
            $pvec = [];
            foreach ($eligible as $rid){
                $p = (int)($popMap[$rid] ?? 0);
                if ($p > 0){ $knownSum += $p; $knownCnt++; }
                $pvec[$rid] = $p;
            }
            if ($knownCnt > 0){
                $avg = (float)$knownSum / (float)$knownCnt;
                foreach ($eligible as $rid){ if ($pvec[$rid] <= 0) $pvec[$rid] = $avg; }
            }
            // Compute S
            $S = 0.0; foreach ($eligible as $rid){ $S += (float)$pvec[$rid]; }

            $targets = [];
            if ($S <= 0.0){
                // Equal split
                $n = count($eligible);
                $base = (int)floor($A / $n);
                $rem = $A - ($base * $n);
                foreach ($eligible as $rid){ $targets[$rid] = $base; }
                for ($i=0; $i<$rem; $i++){ $rid = $eligible[$i % $n]; $targets[$rid] += 1; }
            } else {
                // Largest remainder method
                $floors = []; $fracs = []; $sumFloors = 0;
                foreach ($eligible as $rid){
                    $real = ($pvec[$rid] / $S) * $A;
                    $f = (int)floor($real);
                    $floors[$rid] = $f; $fracs[$rid] = $real - $f; $sumFloors += $f;
                }
                $R = $A - $sumFloors;
                // sort recipients by fractional part desc, tie-breaker by population desc
                $order = $eligible;
                usort($order, function($a,$b) use ($fracs, $pvec){
                    $dr = ($fracs[$b] <=> $fracs[$a]);
                    if ($dr !== 0) return $dr;
                    $dp = ($pvec[$b] <=> $pvec[$a]);
                    if ($dp !== 0) return $dp;
                    return $a <=> $b; // stable id tie-breaker
                });
                foreach ($eligible as $rid){ $targets[$rid] = $floors[$rid]; }
                $i=0; $n=count($order);
                while ($R > 0 && $n > 0){ $rid = $order[$i % $n]; $targets[$rid] += 1; $R--; $i++; }
            }

            // Map targets back to inventory rows FIFO
            $rowIdx = 0; $rowRemain = [];
            foreach ($rows as $idx => $r){ $rowRemain[$idx] = (int)($r['quantity'] ?? 0); }
            foreach ($eligible as $rid){
                $need = (int)($targets[$rid] ?? 0);
                while ($need > 0 && $rowIdx < count($rows)){
                    if ($rowRemain[$rowIdx] <= 0){ $rowIdx++; continue; }
                    $take = min($need, $rowRemain[$rowIdx]);
                    if ($take > 0){
                        $allocations[] = [
                            'recipient_id' => $rid,
                            'inventory_id' => (int)$rows[$rowIdx]['inventory_id'],
                            'product_name' => $rows[$rowIdx]['product_name'],
                            'product_category' => $rows[$rowIdx]['product_category'],
                            'unit' => $rows[$rowIdx]['unit'],
                            'quantity' => $take,
                            'tags_match' => $isSpecial ? ($g['tags'] ?? []) : [],
                        ];
                        $rowRemain[$rowIdx] -= $take;
                        $need -= $take;
                        $totalQtyAllocated += $take;
                    }
                    if ($rowRemain[$rowIdx] <= 0){ $rowIdx++; }
                }
            }
        }
        unset($item);

        // Summary: number of recipients touched and total quantity
        $recTouched = [];
        foreach ($allocations as $a){ $recTouched[$a['recipient_id']] = true; }
        return [ 'period_key'=>$periodKey, 'allocations'=>$allocations, 'summary'=>['recipients'=>count($finalList),'recipients_touched'=>count($recTouched),'total_qty'=>$totalQtyAllocated] ];
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
