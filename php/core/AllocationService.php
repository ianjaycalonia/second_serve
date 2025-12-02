<?php

class AllocationService {
    /**
     * Map age to age group key
     */
    public static function ageGroup(?int $age): string {
        if ($age === null) return 'unknown';
        if ($age < 18) return 'child';
        if ($age < 60) return 'adult';
        return 'senior';
    }

    /**
     * Frequency Prioritization Algorithm
     * Sort recipients by received_count ascending, then by id to stabilize
     * Input recipient format: ['id'=>int, 'age'=>int|null, 'gender'=>'male'|'female'|..., 'received_count'=>int]
     */
    public static function frequencyPrioritize(array $recipients, array $options = []): array {
        $carryover = array_map('intval', $options['carryover_ids'] ?? []);
        $carrySet = array_fill_keys($carryover, true);
        $carryBoost = isset($options['carryover_boost']) ? (int)$options['carryover_boost'] : 1; // lower is better
        usort($recipients, function($a, $b) use ($carrySet, $carryBoost){
            $ra = isset($a['received_count']) ? (int)$a['received_count'] : 0;
            $rb = isset($b['received_count']) ? (int)$b['received_count'] : 0;
            // Apply carryover boost (reduce effective received_count)
            if (!empty($carrySet[(int)($a['id'] ?? 0)])) { $ra -= $carryBoost; }
            if (!empty($carrySet[(int)($b['id'] ?? 0)])) { $rb -= $carryBoost; }
            if ($ra === $rb) {
                $ia = isset($a['id']) ? (int)$a['id'] : 0;
                $ib = isset($b['id']) ? (int)$b['id'] : 0;
                return $ia <=> $ib;
            }
            return $ra <=> $rb;
        });
        return $recipients;
    }

    /**
     * Item Allocation Algorithm (demographic-aware)
     * items: [ { name:string, category?:string, quantity:int }, ... ]
     * recipients: prioritized list (least served first)
     * Returns array with 'allocations' and 'updated_counts'.
     * Allocation format per recipient: [ recipient_id => [ item_name => qty, ... ], ... ]
     */
    public static function allocateItems(array $items, array $recipients, array $options = []): array {
        $returnRationale = !empty($options['include_rationale']);
        // Normalize recipients and build demographics
        $normalized = [];
        $genderCounts = [];
        $ageCounts = [];
        foreach ($recipients as $r) {
            $id = (int)($r['id'] ?? 0);
            if ($id <= 0) continue;
            $age = isset($r['age']) && $r['age'] !== '' ? (int)$r['age'] : null;
            $gender = strtolower(trim((string)($r['gender'] ?? 'unknown')));
            if ($gender === '') $gender = 'unknown';
            $rc = isset($r['received_count']) ? (int)$r['received_count'] : 0;
            $ag = self::ageGroup($age);
            $normalized[] = [ 'id' => $id, 'age' => $age, 'age_group' => $ag, 'gender' => $gender, 'received_count' => $rc ];
            $genderCounts[$gender] = ($genderCounts[$gender] ?? 0) + 1;
            $ageCounts[$ag] = ($ageCounts[$ag] ?? 0) + 1;
        }
        $recipients = $normalized;
        $totalRecipients = count($recipients);
        $allocations = [];
        $updatedCounts = [];
        foreach ($recipients as $r) { $updatedCounts[$r['id']] = $r['received_count']; }

        $rationales = [];
        foreach ($items as $item) {
            $name = (string)($item['name'] ?? 'item');
            $qty = (int)($item['quantity'] ?? 0);
            if ($qty <= 0 || $totalRecipients === 0) continue;

            // Quotas per demographic group based on proportions
            $genderQuota = [];
            foreach ($genderCounts as $g => $cnt) {
                $genderQuota[$g] = (int)floor(($cnt / $totalRecipients) * $qty);
            }
            // Distribute any remainder for gender quotas
            $genderRemainder = $qty - array_sum($genderQuota);
            if ($genderRemainder > 0) {
                // Give extra to groups with largest fractional share (approx by count)
                arsort($genderCounts);
                foreach (array_keys($genderCounts) as $g) {
                    if ($genderRemainder <= 0) break;
                    $genderQuota[$g] = ($genderQuota[$g] ?? 0) + 1;
                    $genderRemainder--;
                }
            }

            $ageQuota = [];
            foreach ($ageCounts as $ag => $cnt) {
                $ageQuota[$ag] = (int)floor(($cnt / $totalRecipients) * $qty);
            }
            $ageRemainder = $qty - array_sum($ageQuota);
            if ($ageRemainder > 0) {
                arsort($ageCounts);
                foreach (array_keys($ageCounts) as $ag) {
                    if ($ageRemainder <= 0) break;
                    $ageQuota[$ag] = ($ageQuota[$ag] ?? 0) + 1;
                    $ageRemainder--;
                }
            }

            // Track allocated counts per group
            $genderAllocated = array_fill_keys(array_keys($genderCounts), 0);
            $ageAllocated = array_fill_keys(array_keys($ageCounts), 0);

            // Two passes: first pass tries to satisfy both gender and age quotas; second pass distributes remaining round-robin
            $remaining = $qty;
            $round = 0;
            while ($remaining > 0 && $round < 2) {
                foreach ($recipients as $r) {
                    if ($remaining <= 0) break;
                    $rid = $r['id'];
                    $g = $r['gender'];
                    $ag = $r['age_group'];

                    $allow = false;
                    if ($round === 0) {
                        $allow = ($genderAllocated[$g] ?? 0) < ($genderQuota[$g] ?? 0)
                              && ($ageAllocated[$ag] ?? 0) < ($ageQuota[$ag] ?? 0);
                    } else {
                        // Round 2: fill remaining regardless of quotas
                        $allow = true;
                    }

                    if ($allow) {
                        // Allocate 1 unit at a time to maintain fairness
                        $allocations[$rid] = $allocations[$rid] ?? [];
                        $allocations[$rid][$name] = ($allocations[$rid][$name] ?? 0) + 1;
                        $updatedCounts[$rid] = ($updatedCounts[$rid] ?? 0) + 1;
                        if (isset($genderAllocated[$g])) $genderAllocated[$g] += 1;
                        if (isset($ageAllocated[$ag])) $ageAllocated[$ag] += 1;
                        $remaining--;
                    }
                }
                $round++;
            }

            if ($returnRationale) {
                $rationales[$name] = [
                    'gender_quota' => $genderQuota,
                    'age_quota' => $ageQuota,
                    'gender_counts' => $genderCounts,
                    'age_counts' => $ageCounts,
                    'total' => $qty,
                ];
            }
        }

        // Normalize allocations to ensure all recipients exist in map
        foreach ($recipients as $r) {
            $rid = $r['id'];
            if (!isset($allocations[$rid])) $allocations[$rid] = [];
        }

        $out = [
            'allocations' => $allocations,
            'updated_counts' => $updatedCounts,
        ];
        if ($returnRationale) { $out['rationale'] = $rationales; }
        return $out;
    }

    /**
     * Optionally sample a random subset from an already prioritized list.
     * Ensures carryover_ids are always included (if present) and fills the rest randomly.
     * Options:
     *  - random_count: int > 0 number of recipients to keep (cap by list size)
     *  - random_seed: string|int for deterministic selection (optional)
     *  - carryover_ids: int[] always include if present
     */
    public static function samplePrioritized(array $recipients, array $options = []): array {
        $count = isset($options['random_count']) ? (int)$options['random_count'] : 0;
        if ($count <= 0 || $count >= count($recipients)) { return $recipients; }

        $carrySet = array_fill_keys(array_map('intval', $options['carryover_ids'] ?? []), true);
        $mandatory = [];
        $others = [];
        foreach ($recipients as $r) {
            $id = (int)($r['id'] ?? 0);
            if ($id && !empty($carrySet[$id])) { $mandatory[] = $r; }
            else { $others[] = $r; }
        }
        // If mandatory exceeds count, trim to first N (they are already prioritized order)
        if (count($mandatory) >= $count) {
            return array_slice($mandatory, 0, $count);
        }
        $need = $count - count($mandatory);
        // Deterministic shuffle of others if seed provided
        if (isset($options['random_seed'])) {
            $seed = is_int($options['random_seed']) ? $options['random_seed'] : crc32((string)$options['random_seed']);
            // Use mt_srand locally by shuffling indices
            $idx = range(0, count($others)-1);
            mt_srand($seed);
            for ($i = count($idx)-1; $i > 0; $i--) {
                $j = mt_rand(0, $i);
                [$idx[$i], $idx[$j]] = [$idx[$j], $idx[$i]];
            }
            $shuffled = [];
            foreach ($idx as $i) { $shuffled[] = $others[$i]; }
            $others = $shuffled;
        } else {
            // Non-deterministic shuffle
            shuffle($others);
        }
        $pick = array_slice($others, 0, $need);
        return array_merge($mandatory, $pick);
    }
}
