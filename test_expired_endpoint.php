<?php
require_once __DIR__ . '/php/includes/config.php';
require_once __DIR__ . '/php/includes/Database.php';

header('Content-Type: application/json');

$db = Database::getInstance();

try {
    // Check for expired items
    $expiredItems = $db->query(
        "SELECT inv.inventory_id, inv.quantity, di.*, d.donor_id, d.batch_id
         FROM inventory inv
         JOIN donation_items di ON di.donation_item_id = inv.donation_item_id
         JOIN donations d ON d.donation_id = di.donation_id
         LEFT JOIN expired_inventory ei ON ei.inventory_id = inv.inventory_id
         WHERE di.expiry_date < CURDATE() 
         AND inv.quantity > 0
         AND ei.inventory_id IS NULL"
    )->fetchAll();

    echo json_encode([
        'success' => true,
        'expired_items' => $expiredItems,
        'expired_items_count' => count($expiredItems)
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
