<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/Inventory.php';

class RepackService
{
    private Database $db;
    private Inventory $inventory;

    public function __construct()
    {
        $this->db = Database::getInstance();
        $this->inventory = new Inventory();
    }

    /**
     * List kit templates with optional filters.
     */
    public function listTemplates(array $filters = []): array
    {
        $params = [];
        $where = '1=1';
        if (array_key_exists('active', $filters)) {
            $where .= ' AND kt.is_active = ?';
            $params[] = $filters['active'] ? 1 : 0;
        }
        if (!empty($filters['q'])) {
            $where .= ' AND (kt.name LIKE ? OR kt.code LIKE ?)';
            $q = '%' . $filters['q'] . '%';
            $params[] = $q;
            $params[] = $q;
        }

        $rows = $this->db->query(
            "SELECT kt.*, u.name AS created_by_name
             FROM kit_templates kt
             LEFT JOIN users u ON u.user_id = kt.created_by
             WHERE {$where}
             ORDER BY kt.is_active DESC, kt.name ASC",
            $params
        )->fetchAll();

        if (!$rows) {
            return [];
        }

        $ids = array_map(fn($r) => (int)$r['kit_template_id'], $rows);
        $componentsByTemplate = $this->fetchComponentsForTemplates($ids);

        $templates = [];
        foreach ($rows as $row) {
            $id = (int)$row['kit_template_id'];
            $row['components'] = $componentsByTemplate[$id] ?? [];
            $row['output_category_label'] = $this->getCategoryLabel($row['output_category_id'] ?? null);
            $row['output_unit_label'] = $this->getUnitLabel($row['output_unit_id'] ?? null);
            $templates[] = $this->normalizeTemplateRow($row);
        }

        return $templates;
    }

    /**
     * Retrieve a single kit template with components.
     */
    public function getTemplate(int $templateId): array
    {
        $row = $this->db->query(
            "SELECT kt.*, u.name AS created_by_name
             FROM kit_templates kt
             LEFT JOIN users u ON u.user_id = kt.created_by
             WHERE kt.kit_template_id = ?",
            [$templateId]
        )->fetch();

        if (!$row) {
            throw new Exception('Kit template not found');
        }

        $row['components'] = $this->fetchComponentsForTemplates([$templateId])[$templateId] ?? [];
        $row['output_category_label'] = $this->getCategoryLabel($row['output_category_id'] ?? null);
        $row['output_unit_label'] = $this->getUnitLabel($row['output_unit_id'] ?? null);

        return $this->normalizeTemplateRow($row);
    }

    /**
     * Create a new kit template with components.
     */
    public function createTemplate(array $data, int $userId): array
    {
        $this->db->beginTransaction();
        try {
            $templateId = $this->persistTemplate(null, $data, $userId);
            $this->db->commit();
            return $this->getTemplate($templateId);
        } catch (Exception $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Update an existing kit template (full replace of components).
     */
    public function updateTemplate(int $templateId, array $data, int $userId): array
    {
        $this->db->beginTransaction();
        try {
            $this->persistTemplate($templateId, $data, $userId);
            $this->db->commit();
            return $this->getTemplate($templateId);
        } catch (Exception $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }

    public function setTemplateActive(int $templateId, bool $isActive, int $userId): void
    {
        $exists = $this->db->query(
            'SELECT kit_template_id FROM kit_templates WHERE kit_template_id = ? LIMIT 1',
            [$templateId]
        )->fetch();
        if (!$exists) {
            throw new Exception('Kit template not found');
        }
        $this->db->query(
            'UPDATE kit_templates SET is_active = ?, updated_at = NOW() WHERE kit_template_id = ?',
            [$isActive ? 1 : 0, $templateId]
        );
    }

    public function deleteTemplate(int $templateId): void
    {
        $this->setTemplateActive($templateId, false, (int)currentUserId());
    }

    /**
     * Record a repack operation and adjust inventory accordingly.
     *
     * $componentsInput format:
     * [
     *   {
     *     'kit_component_id' => int,
     *     'lots' => [ {'inventory_id': int, 'quantity': int}, ... ]
     *   }, ...
     * ]
     */
    public function produceFromTemplate(int $templateId, int $kitsProduced, int $userId, ?string $note, array $componentsInput): array
    {
        if ($kitsProduced <= 0) {
            throw new Exception('kits_produced must be positive');
        }

        $template = $this->getTemplate($templateId);
        if (!(int)$template['is_active']) {
            throw new Exception('Kit template is inactive');
        }

        if (!is_array($componentsInput) || empty($componentsInput)) {
            throw new Exception('components input is required');
        }

        $componentsMap = [];
        foreach ($template['components'] as $component) {
            $componentsMap[(int)$component['kit_component_id']] = $component;
        }

        $inputMap = [];
        foreach ($componentsInput as $entry) {
            if (!isset($entry['kit_component_id'])) {
                throw new Exception('kit_component_id missing in components input');
            }
            $cid = (int)$entry['kit_component_id'];
            if (!isset($componentsMap[$cid])) {
                throw new Exception('Unknown kit component id: ' . $cid);
            }
            $lots = $entry['lots'] ?? null;
            if (!is_array($lots) || empty($lots)) {
                throw new Exception('Lots are required for component ' . $cid);
            }
            $inputMap[$cid] = $lots;
        }

        $this->db->beginTransaction();
        try {
            $this->db->query(
                'INSERT INTO repack_operations (kit_template_id, performed_by, kits_produced, notes, created_at, updated_at)
                 VALUES (?, ?, ?, ?, NOW(), NOW())',
                [$templateId, $userId, $kitsProduced, $note]
            );
            $repackId = (int)$this->db->lastInsertId();
            if ($repackId <= 0) {
                throw new Exception('Failed to create repack operation');
            }

            foreach ($componentsMap as $componentId => $component) {
                $requiredFloat = (float)$component['quantity_per_kit'] * $kitsProduced;
                $required = $this->assertIntegerQuantity($requiredFloat, 'component ' . $componentId);
                $lots = $inputMap[$componentId] ?? [];
                $allocated = 0;

                foreach ($lots as $lot) {
                    $inventoryId = isset($lot['inventory_id']) ? (int)$lot['inventory_id'] : 0;
                    $quantityFloat = isset($lot['quantity']) ? (float)$lot['quantity'] : 0.0;
                    $quantity = $this->assertIntegerQuantity($quantityFloat, 'component lot quantity');
                    if ($inventoryId <= 0 || $quantity <= 0) {
                        throw new Exception('Invalid lot data for component ' . $componentId);
                    }

                    $snapshot = $this->fetchInventorySnapshot($inventoryId);
                    if ($quantity > (int)$snapshot['quantity']) {
                        throw new Exception('Insufficient quantity in inventory lot ' . $inventoryId);
                    }

                    $this->inventory->moveOut($inventoryId, $quantity, $userId, 'repack', null, $note);

                    $this->db->query(
                        'INSERT INTO repack_inputs (repack_id, inventory_id, donation_item_id, product_name_snapshot, category_id_snapshot, unit_id_snapshot, quantity_used, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
                        [
                            $repackId,
                            $inventoryId,
                            $snapshot['donation_item_id'],
                            $snapshot['product_name'],
                            $snapshot['category_id'],
                            $snapshot['unit_id'],
                            $quantity,
                        ]
                    );

                    $allocated += $quantity;
                }

                if ($allocated !== $required) {
                    throw new Exception('Component ' . $component['product_name'] . ' allocation mismatch. Required ' . $required . ', provided ' . $allocated);
                }
            }

            // Create donation + inventory lot for produced kits
            $outputQuantityFloat = (float)$template['output_quantity_per_kit'] * $kitsProduced;
            $outputQuantity = $this->assertIntegerQuantity($outputQuantityFloat, 'output quantity');
            if ($outputQuantity <= 0) {
                throw new Exception('Output quantity must be positive');
            }

            $this->db->query(
                "INSERT INTO donations (batch_id, donor_id, admin_in_charge, procurement_type, donor_name, entry_date, remarks, status, created_at)
                 VALUES (NULL, NULL, ?, 'donated', ?, NOW(), ?, 'Completed', NOW())",
                [
                    $userId > 0 ? $userId : null,
                    $template['name'],
                    $note !== null ? $note : ('Generated by repack #' . $repackId),
                ]
            );
            $donationId = (int)$this->db->lastInsertId();
            if ($donationId <= 0) {
                throw new Exception('Failed to create repack donation header');
            }

            $this->db->query(
                'INSERT INTO donation_items (donation_id, product_name, category_id, quantity, unit_id, total_weight, total_cost, expiry_date, tags, created_at)
                 VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NOW())',
                [
                    $donationId,
                    $template['output_product_name'],
                    $template['output_category_id'] ?: null,
                    $outputQuantity,
                    $template['output_unit_id'] ?: null,
                    'Repack Kit',
                ]
            );
            $donationItemId = (int)$this->db->lastInsertId();
            if ($donationItemId <= 0) {
                throw new Exception('Failed to create repack donation item');
            }

            $this->db->query(
                'INSERT INTO inventory (donation_item_id, quantity, added_at) VALUES (?, ?, NOW())',
                [$donationItemId, $outputQuantity]
            );
            $outputInventoryId = (int)$this->db->lastInsertId();
            if ($outputInventoryId <= 0) {
                throw new Exception('Failed to create output inventory');
            }

            $this->db->query(
                'INSERT INTO inventory_movements (inventory_id, donation_item_id, direction, quantity, mode, recipient_id, note, performed_by, created_at)
                 VALUES (?, ?, ' . "'in'" . ', ?, ?, NULL, ?, ?, NOW())',
                [
                    $outputInventoryId,
                    $donationItemId,
                    $outputQuantity,
                    'repack',
                    $note,
                    $userId,
                ]
            );

            $this->db->query(
                'INSERT INTO repack_outputs (repack_id, inventory_id, donation_item_id, product_name_snapshot, category_id_snapshot, unit_id_snapshot, quantity_produced, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $repackId,
                    $outputInventoryId,
                    $donationItemId,
                    $template['output_product_name'],
                    $template['output_category_id'] ?: null,
                    $template['output_unit_id'] ?: null,
                    $outputQuantity,
                ]
            );

            $this->db->commit();

            return $this->getOperation($repackId);
        } catch (Exception $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }

    /**
     * List repack operations (most recent first).
     */
    public function listOperations(array $filters = []): array
    {
        $limit = isset($filters['limit']) ? (int)$filters['limit'] : 50;
        if ($limit <= 0) {
            $limit = 50;
        }
        $limit = min($limit, 200);

        $rows = $this->db->query(
            "SELECT ro.*, kt.name AS kit_name, u.name AS performed_by_name
             FROM repack_operations ro
             LEFT JOIN kit_templates kt ON kt.kit_template_id = ro.kit_template_id
             LEFT JOIN users u ON u.user_id = ro.performed_by
             ORDER BY ro.created_at DESC
             LIMIT {$limit}"
        )->fetchAll();

        if (!$rows) {
            return [];
        }

        $ids = array_map(fn($r) => (int)$r['repack_id'], $rows);
        $inputsAgg = $this->fetchInputTotals($ids);
        $outputsAgg = $this->fetchOutputTotals($ids);

        $operations = [];
        foreach ($rows as $row) {
            $id = (int)$row['repack_id'];
            $row['total_input_quantity'] = $inputsAgg[$id] ?? 0;
            $row['total_output_quantity'] = $outputsAgg[$id] ?? 0;
            $operations[] = $this->normalizeOperationRow($row);
        }

        return $operations;
    }

    /**
     * Fetch a single operation with detailed inputs/outputs.
     */
    public function getOperation(int $repackId): array
    {
        $row = $this->db->query(
            "SELECT ro.*, kt.name AS kit_name, u.name AS performed_by_name
             FROM repack_operations ro
             LEFT JOIN kit_templates kt ON kt.kit_template_id = ro.kit_template_id
             LEFT JOIN users u ON u.user_id = ro.performed_by
             WHERE ro.repack_id = ?",
            [$repackId]
        )->fetch();

        if (!$row) {
            throw new Exception('Repack operation not found');
        }

        $inputs = $this->db->query(
            "SELECT ri.*, cat.primary_name AS category_primary, cat.secondary_name,
                    COALESCE(un.label, un.code) AS unit_label
             FROM repack_inputs ri
             LEFT JOIN categories cat ON cat.category_id = ri.category_id_snapshot
             LEFT JOIN units un ON un.unit_id = ri.unit_id_snapshot
             WHERE ri.repack_id = ?
             ORDER BY ri.id ASC",
            [$repackId]
        )->fetchAll();

        $outputs = $this->db->query(
            "SELECT ro.*, cat.primary_name AS category_primary, cat.secondary_name,
                    COALESCE(un.label, un.code) AS unit_label
             FROM repack_outputs ro
             LEFT JOIN categories cat ON cat.category_id = ro.category_id_snapshot
             LEFT JOIN units un ON un.unit_id = ro.unit_id_snapshot
             WHERE ro.repack_id = ?
             ORDER BY ro.id ASC",
            [$repackId]
        )->fetchAll();

        $row['inputs'] = array_map(function ($item) {
            $item['category_label'] = $this->composeCategoryLabel($item['category_primary'] ?? null, $item['secondary_name'] ?? null);
            return $item;
        }, $inputs);

        $row['outputs'] = array_map(function ($item) {
            $item['category_label'] = $this->composeCategoryLabel($item['category_primary'] ?? null, $item['secondary_name'] ?? null);
            return $item;
        }, $outputs);

        $row['total_input_quantity'] = array_sum(array_column($inputs, 'quantity_used'));
        $row['total_output_quantity'] = array_sum(array_column($outputs, 'quantity_produced'));

        return $this->normalizeOperationRow($row);
    }

    // ---------------------
    // Internal helper methods
    // ---------------------

    private function persistTemplate(?int $templateId, array $data, int $userId): int
    {
        $name = trim((string)($data['name'] ?? ''));
        $outputName = trim((string)($data['output_product_name'] ?? ''));
        $outputQtyPerKit = isset($data['output_quantity_per_kit']) ? (float)$data['output_quantity_per_kit'] : 0.0;
        $code = isset($data['code']) ? trim((string)$data['code']) : null;
        $description = isset($data['description']) ? trim((string)$data['description']) : null;
        $outputCategoryId = isset($data['output_category_id']) ? (int)$data['output_category_id'] : null;
        $outputUnitId = isset($data['output_unit_id']) ? (int)$data['output_unit_id'] : null;
        $outputProductId = isset($data['output_product_id']) ? (int)$data['output_product_id'] : null;
        $isActive = isset($data['is_active']) ? (int)((bool)$data['is_active']) : 1;

        if ($name === '') {
            throw new Exception('Template name is required');
        }
        if ($outputName === '') {
            throw new Exception('Output product name is required');
        }
        if ($outputQtyPerKit <= 0) {
            throw new Exception('output_quantity_per_kit must be positive');
        }
        $this->assertIntegerQuantity($outputQtyPerKit, 'output quantity per kit');

        $components = $data['components'] ?? [];
        if (!is_array($components) || empty($components)) {
            throw new Exception('At least one component is required');
        }

        $now = date('Y-m-d H:i:s');
        if ($templateId === null) {
            $this->db->query(
                'INSERT INTO kit_templates (code, name, description, output_product_id, output_product_name, output_category_id, output_unit_id, output_quantity_per_kit, is_active, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $code ?: null,
                    $name,
                    $description ?: null,
                    $outputProductId ?: null,
                    $outputName,
                    $outputCategoryId ?: null,
                    $outputUnitId ?: null,
                    $outputQtyPerKit,
                    $isActive,
                    $userId ?: null,
                    $now,
                    $now,
                ]
            );
            $templateId = (int)$this->db->lastInsertId();
            if ($templateId <= 0) {
                throw new Exception('Failed to create kit template');
            }
        } else {
            $exists = $this->db->query(
                'SELECT kit_template_id FROM kit_templates WHERE kit_template_id = ? LIMIT 1',
                [$templateId]
            )->fetch();
            if (!$exists) {
                throw new Exception('Kit template not found');
            }
            $this->db->query(
                'UPDATE kit_templates
                 SET code = ?, name = ?, description = ?, output_product_id = ?, output_product_name = ?, output_category_id = ?, output_unit_id = ?, output_quantity_per_kit = ?, is_active = ?, updated_at = NOW()
                 WHERE kit_template_id = ?',
                [
                    $code ?: null,
                    $name,
                    $description ?: null,
                    $outputProductId ?: null,
                    $outputName,
                    $outputCategoryId ?: null,
                    $outputUnitId ?: null,
                    $outputQtyPerKit,
                    $isActive,
                    $templateId,
                ]
            );
            $this->db->query('DELETE FROM kit_components WHERE kit_template_id = ?', [$templateId]);
        }

        $position = 1;
        foreach ($components as $component) {
            $productName = trim((string)($component['product_name'] ?? ''));
            $quantityPerKit = isset($component['quantity_per_kit']) ? (float)$component['quantity_per_kit'] : 0.0;
            $productId = isset($component['product_id']) ? (int)$component['product_id'] : null;
            $categoryId = isset($component['category_id']) ? (int)$component['category_id'] : null;
            $unitId = isset($component['unit_id']) ? (int)$component['unit_id'] : null;
            $notes = isset($component['notes']) ? trim((string)$component['notes']) : null;

            if ($productName === '') {
                throw new Exception('Component product_name is required');
            }
            if ($quantityPerKit <= 0) {
                throw new Exception('quantity_per_kit must be positive for component ' . $productName);
            }
            $this->assertIntegerQuantity($quantityPerKit, 'component quantity per kit');

            $this->db->query(
                'INSERT INTO kit_components (kit_template_id, position, product_id, product_name, category_id, unit_id, quantity_per_kit, notes, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $templateId,
                    $position++,
                    $productId ?: null,
                    $productName,
                    $categoryId ?: null,
                    $unitId ?: null,
                    $quantityPerKit,
                    $notes ?: null,
                ]
            );
        }

        return $templateId;
    }

    private function fetchComponentsForTemplates(array $templateIds): array
    {
        if (empty($templateIds)) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($templateIds), '?'));
        $rows = $this->db->query(
            "SELECT kc.*, cat.primary_name AS category_primary, cat.secondary_name,
                    COALESCE(un.label, un.code) AS unit_label
             FROM kit_components kc
             LEFT JOIN categories cat ON cat.category_id = kc.category_id
             LEFT JOIN units un ON un.unit_id = kc.unit_id
             WHERE kc.kit_template_id IN ({$placeholders})
             ORDER BY kc.kit_template_id ASC, kc.position ASC",
            $templateIds
        )->fetchAll();

        $grouped = [];
        foreach ($rows as $row) {
            $tid = (int)$row['kit_template_id'];
            $row['category_label'] = $this->composeCategoryLabel($row['category_primary'] ?? null, $row['secondary_name'] ?? null);
            $grouped[$tid][] = $row;
        }
        return $grouped;
    }

    private function fetchInputTotals(array $repackIds): array
    {
        if (empty($repackIds)) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($repackIds), '?'));
        $rows = $this->db->query(
            "SELECT repack_id, SUM(quantity_used) AS total
             FROM repack_inputs
             WHERE repack_id IN ({$placeholders})
             GROUP BY repack_id",
            $repackIds
        )->fetchAll();
        $map = [];
        foreach ($rows as $row) {
            $map[(int)$row['repack_id']] = (int)$row['total'];
        }
        return $map;
    }

    private function fetchOutputTotals(array $repackIds): array
    {
        if (empty($repackIds)) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($repackIds), '?'));
        $rows = $this->db->query(
            "SELECT repack_id, SUM(quantity_produced) AS total
             FROM repack_outputs
             WHERE repack_id IN ({$placeholders})
             GROUP BY repack_id",
            $repackIds
        )->fetchAll();
        $map = [];
        foreach ($rows as $row) {
            $map[(int)$row['repack_id']] = (int)$row['total'];
        }
        return $map;
    }

    private function fetchInventorySnapshot(int $inventoryId): array
    {
        $row = $this->db->query(
            "SELECT inv.inventory_id, inv.quantity, di.donation_item_id, di.product_name, di.category_id, di.unit_id,
                    cat.primary_name AS category_primary, cat.secondary_name,
                    COALESCE(un.label, un.code) AS unit_label
             FROM inventory inv
             INNER JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
             LEFT JOIN categories cat ON cat.category_id = di.category_id
             LEFT JOIN units un ON un.unit_id = di.unit_id
             WHERE inv.inventory_id = ?",
            [$inventoryId]
        )->fetch();

        if (!$row) {
            throw new Exception('Inventory lot not found: ' . $inventoryId);
        }

        $row['category_label'] = $this->composeCategoryLabel($row['category_primary'] ?? null, $row['secondary_name'] ?? null);
        return $row;
    }

    private function getCategoryLabel(?int $categoryId): ?string
    {
        if (!$categoryId) {
            return null;
        }
        static $cache = [];
        if (array_key_exists($categoryId, $cache)) {
            return $cache[$categoryId];
        }
        $row = $this->db->query(
            'SELECT primary_name, secondary_name FROM categories WHERE category_id = ? LIMIT 1',
            [$categoryId]
        )->fetch();
        if (!$row) {
            $cache[$categoryId] = null;
            return null;
        }
        $label = null;
        if (!empty($row['primary_name'])) {
            $label = $row['primary_name'];
            if (!empty($row['secondary_name'])) {
                $label .= ' - ' . $row['secondary_name'];
            }
        }
        $cache[$categoryId] = $label;
        return $label;
    }

    private function getUnitLabel(?int $unitId): ?string
    {
        if (!$unitId) {
            return null;
        }
        static $cache = [];
        if (array_key_exists($unitId, $cache)) {
            return $cache[$unitId];
        }
        $row = $this->db->query('SELECT COALESCE(label, code) AS label FROM units WHERE unit_id = ? LIMIT 1', [$unitId])->fetch();
        $cache[$unitId] = $row['label'] ?? null;
        return $cache[$unitId];
    }

    private function composeCategoryLabel(?string $primary, ?string $secondary): ?string
    {
        if ($primary === null || $primary === '') {
            return null;
        }
        if ($secondary === null || $secondary === '') {
            return $primary;
        }
        return $primary . ' - ' . $secondary;
    }

    private function assertIntegerQuantity(float $value, string $context): int
    {
        $rounded = (int)round($value);
        if (abs($value - $rounded) > 0.0001) {
            throw new Exception('Non-integer quantity encountered for ' . $context . '. Value: ' . $value);
        }
        if ($rounded < 0) {
            throw new Exception('Negative quantity encountered for ' . $context);
        }
        return $rounded;
    }

    private function normalizeTemplateRow(array $row): array
    {
        return $row;
    }

    private function normalizeOperationRow(array $row): array
    {
        return $row;
    }
}
