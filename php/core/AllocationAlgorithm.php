<?php
require_once __DIR__ . '/../includes/config.php';

class AllocationAlgorithm
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
            if ($t === 'medicine') { $t = 'medical'; }
            if ($t === 'med') { $t = 'medical'; }
            $norm[$t] = true;
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
        if (!preg_match('/^(\d{4})-(\d{2})-W([1-4])$/', $periodKey, $m)) return [];
        $year = (int)$m[1]; $mon = (int)$m[2]; $wIndex = (int)$m[3];
        $prevW = $wIndex - 1; $prevYear = $year; $prevMon = $mon;
        if ($prevW < 1){ $prevW = 4; $prevMon = $mon - 1; if ($prevMon < 1){ $prevMon = 12; $prevYear = $year - 1; } }
        $prevKey = sprintf('%04d-%02d-W%d', $prevYear, $prevMon, $prevW);

        $rowsPlan = $this->db->query(
            "SELECT recipient_id FROM recipient_plans WHERE period_key = ? AND source = 'planned' ORDER BY position ASC",
            [$periodKey]
        )->fetchAll();
        $planned = array_map(fn($r)=> (int)$r['recipient_id'], $rowsPlan ?: []);
        $plannedCount = count($planned);

        $rowsCo = $this->db->query(
            "SELECT recipient_id FROM recipient_attendance WHERE period_key = ? AND status = 'absent'",
            [$prevKey]
        )->fetchAll();
        $carryOvers = array_map(fn($r)=> (int)$r['recipient_id'], $rowsCo ?: []);
        $carryKeep = array_slice($carryOvers, 0, max(0, $plannedCount));

        $final = []; $seen = [];
        foreach ($carryKeep as $id){ if ($id>0 && !isset($seen[$id])){ $seen[$id]=true; $final[]=$id; if (count($final) >= $plannedCount) break; } }
        if (count($final) < $plannedCount){ foreach ($planned as $id){ if ($id>0 && !isset($seen[$id])){ $seen[$id]=true; $final[]=$id; if (count($final) >= $plannedCount) break; } } }
        return $final;
    }

    private function getInventoryCandidates(): array
    {
        $rows = $this->db->query(
            "SELECT i.inventory_id, i.product_id, i.product_name, i.product_category, i.unit, i.quantity,
                    COALESCE(NULLIF(TRIM(i.tags), ''), NULLIF(TRIM(p.tags), '')) AS tags
             FROM inventory i
             LEFT JOIN products p ON p.product_id = i.product_id
             WHERE COALESCE(i.quantity,0) > 0",
            []
        )->fetchAll();
        foreach ($rows as &$r){
            $full = $this->normalizeTags($r['tags'] ?? '');
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
        if (!$isSpecial) return $finalList;
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
        try {
            if (is_array($limitRecipientIds) && !empty($limitRecipientIds)){
                $finalList = array_values(array_unique(array_map('intval', array_filter($limitRecipientIds, fn($v)=>$v>0))));
            } else {
                $finalList = $this->getFinalWeekList($periodKey);
            }
            if (empty($finalList)) return ['period_key'=>$periodKey, 'allocations'=>[], 'summary'=>['recipients'=>0,'allocated'=>0,'total_qty'=>0]];
            $inventory = $this->getInventoryCandidates();
            $recipientTagsMap = [];
            foreach ($finalList as $rid){ $recipientTagsMap[$rid] = $this->getRecipientTags($rid); }
            $popMap = $this->getRecipientPopulations($finalList);

            $allocations = [];
            $totalQtyAllocated = 0;

            $groups = [];
            foreach ($inventory as $it){
                $k = ($it['product_name'] ?? '') . "\u0001" . ($it['product_category'] ?? '') . "\u0001" . ($it['unit'] ?? '');
                if (!isset($groups[$k])){
                    $groups[$k] = [ 'rows' => [], 'name' => ($it['product_name'] ?? ''), 'category' => ($it['product_category'] ?? ''), 'unit' => ($it['unit'] ?? ''), 'tags' => ($it['tag_list'] ?? []) ];
                }
                $groups[$k]['rows'][] = $it;
                if (!empty($it['tag_list'])){
                    $groups[$k]['tags'] = array_values(array_unique(array_merge($groups[$k]['tags'], $it['tag_list'])));
                }
            }

            foreach ($groups as $g){
                $rows = $g['rows'];
                $totalAvail = 0; foreach ($rows as $r){ $totalAvail += (int)($r['quantity'] ?? 0); }
                if ($totalAvail <= 0) continue;
                $A = (int)floor($totalAvail * 0.90);
                if ($A <= 0) continue;

                $isSpecial = !empty($g['tags']);
                $eligible = $isSpecial ? $this->eligibleRecipientsForItem($finalList, ['tag_list'=>$g['tags']], $recipientTagsMap) : $finalList;
                if (empty($eligible)) continue;
                if ($isSpecial && count($eligible) === 1){
                    $A = (int)floor($A * 0.5);
                    if ($A <= 0) continue;
                }

                $knownSum = 0; $knownCnt = 0; $pvec = [];
                foreach ($eligible as $rid){
                    $p = (int)($popMap[$rid] ?? 0);
                    if ($p > 0){ $knownSum += $p; $knownCnt++; }
                    $pvec[$rid] = $p;
                }
                if ($knownCnt > 0){
                    $avg = (float)$knownSum / (float)$knownCnt;
                    foreach ($eligible as $rid){ if ($pvec[$rid] <= 0) $pvec[$rid] = $avg; }
                }
                $S = 0.0; foreach ($eligible as $rid){ $S += (float)$pvec[$rid]; }

                $targets = [];
                if ($S <= 0.0){
                    $n = count($eligible); $base = (int)floor($A / $n); $rem = $A - ($base * $n);
                    foreach ($eligible as $rid){ $targets[$rid] = $base; }
                    for ($i=0; $i<$rem; $i++){ $rid = $eligible[$i % $n]; $targets[$rid] += 1; }
                } else {
                    $floors = []; $fracs = []; $sumFloors = 0;
                    foreach ($eligible as $rid){
                        $real = ($pvec[$rid] / $S) * $A;
                        $f = (int)floor($real);
                        $floors[$rid] = $f; $fracs[$rid] = $real - $f; $sumFloors += $f;
                    }
                    $R = $A - $sumFloors;
                    $order = $eligible;
                    usort($order, function($a,$b) use ($fracs, $pvec){
                        $dr = ($fracs[$b] <=> $fracs[$a]); if ($dr !== 0) return $dr;
                        $dp = ($pvec[$b] <=> $pvec[$a]); if ($dp !== 0) return $dp;
                        return $a <=> $b;
                    });
                    foreach ($eligible as $rid){ $targets[$rid] = $floors[$rid]; }
                    $i=0; $n=count($order);
                    while ($R > 0 && $n > 0){ $rid = $order[$i % $n]; $targets[$rid] += 1; $R--; $i++; }
                }

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

            $recTouched = [];
            foreach ($allocations as $a){ $recTouched[$a['recipient_id']] = true; }
            return [ 'period_key'=>$periodKey, 'allocations'=>$allocations, 'summary'=>['recipients'=>count($finalList),'recipients_touched'=>count($recTouched),'total_qty'=>$totalQtyAllocated] ];
        } catch (Exception $e) {
            error_log("AllocationAlgorithm preview error: " . $e->getMessage());
            return ['period_key'=>$periodKey, 'allocations'=>[], 'summary'=>['recipients'=>0,'allocated'=>0,'total_qty'=>0, 'error'=>$e->getMessage()]];
        }
    }
}
