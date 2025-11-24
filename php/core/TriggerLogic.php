<?php
require_once __DIR__ . '/../includes/config.php';

/**
 * TriggerLogic class
 * 
 * This class implements the logic that was previously handled by database triggers
 * in the simply_share.sql file. It provides methods to synchronize product categories
 * and enforce inventory movement constraints.
 */
class TriggerLogic
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Synchronize product category when a product is inserted or updated
     * Replaces the products_bi_sync_category and products_bu_sync_category triggers
     * 
     * @param int $productId The product ID
     * @param int|null $categoryId The category ID
     * @return bool Success status
     */
    public function syncProductCategory(int $productId, ?int $categoryId): bool
    {
        try {
            // Update all donation_items with this product_name to have the same category_id
            if ($productId > 0) {
                $product = $this->db->query(
                    "SELECT product_name FROM products WHERE product_id = ?",
                    [$productId]
                )->fetch();
                
                if ($product && isset($product['product_name'])) {
                    $this->db->query(
                        "UPDATE donation_items SET category_id = ? 
                         WHERE product_name = ? AND (category_id IS NULL OR category_id <> ?)",
                        [$categoryId, $product['product_name'], $categoryId]
                    );
                }
            }
            return true;
        } catch (Exception $e) {
            error_log('Error in syncProductCategory: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Synchronize products when a category is updated
     * Replaces the categories_au_sync_products trigger
     * 
     * @param int $categoryId The category ID
     * @return bool Success status
     */
    public function syncCategoryProducts(int $categoryId): bool
    {
        try {
            if ($categoryId > 0) {
                // Get all products with this category_id
                $products = $this->db->query(
                    "SELECT product_id, product_name FROM products WHERE category_id = ?",
                    [$categoryId]
                )->fetchAll();
                
                // Update all donation_items with these product names
                foreach ($products as $product) {
                    $this->db->query(
                        "UPDATE donation_items SET category_id = ? 
                         WHERE product_name = ? AND (category_id IS NULL OR category_id <> ?)",
                        [$categoryId, $product['product_name'], $categoryId]
                    );
                }
            }
            return true;
        } catch (Exception $e) {
            error_log('Error in syncCategoryProducts: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Enforce donation_item_id consistency with inventory for inventory movements
     * Replaces the im_bi_set_donation_item and im_bu_set_donation_item triggers
     * 
     * @param int $movementId The inventory movement ID
     * @param int $inventoryId The inventory ID
     * @return bool Success status
     */
    public function syncInventoryMovementDonationItem(int $movementId, int $inventoryId): bool
    {
        try {
            if ($movementId > 0 && $inventoryId > 0) {
                // Get the donation_item_id from the inventory table
                $inventory = $this->db->query(
                    "SELECT donation_item_id FROM inventory WHERE inventory_id = ?",
                    [$inventoryId]
                )->fetch();
                
                if ($inventory && isset($inventory['donation_item_id'])) {
                    // Update the inventory_movement with the correct donation_item_id
                    $this->db->query(
                        "UPDATE inventory_movements SET donation_item_id = ? WHERE id = ?",
                        [$inventory['donation_item_id'], $movementId]
                    );
                }
            }
            return true;
        } catch (Exception $e) {
            error_log('Error in syncInventoryMovementDonationItem: ' . $e->getMessage());
            return false;
        }
    }
}