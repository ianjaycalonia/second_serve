<?php
require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../core/AllocationService.php';

// CORS/preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    setCorsHeaders();
    exit(0);
}
setCorsHeaders();
header('Content-Type: application/json');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    // Only POST is supported
    if (strtoupper($method) !== 'POST') {
        sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
    }

    // Admin only for now (change to ['admin','donor'] if needed)
    requireRole(['admin']);

    // Parse JSON body
    $input = getJsonInput();
    if (!is_array($input)) { sendJson(['success'=>false,'error'=>'Invalid JSON body'], 400); }

    $items = isset($input['items']) && is_array($input['items']) ? $input['items'] : [];
    $recipients = isset($input['recipients']) && is_array($input['recipients']) ? $input['recipients'] : [];
    $options = isset($input['options']) && is_array($input['options']) ? $input['options'] : [];

    // Basic validation
    if (!$items) { sendJson(['success'=>false,'error'=>'items are required'], 400); }
    if (!$recipients) { sendJson(['success'=>false,'error'=>'recipients are required'], 400); }

    // 1) Frequency Prioritization: sort by received_count asc (least served first)
    $prioritized = AllocationService::frequencyPrioritize($recipients, [
        'carryover_ids' => $options['carryover_ids'] ?? [],
        'carryover_boost' => $options['carryover_boost'] ?? 1,
    ]);

    // 1b) Optional random sampling after prioritization (keep carryovers mandatory)
    if (!empty($options['random_count']) && (int)$options['random_count'] > 0) {
        $prioritized = AllocationService::samplePrioritized($prioritized, [
            'random_count' => (int)$options['random_count'],
            'random_seed' => $options['random_seed'] ?? null,
            'carryover_ids' => $options['carryover_ids'] ?? [],
        ]);
    }

    // 2) Demographic-aware Allocation over prioritized list
    $result = AllocationService::allocateItems($items, $prioritized, [
        'include_rationale' => !empty($options['include_rationale'])
    ]);

    // Structure output
    $out = [
        'success' => true,
        'data' => [
            'allocations' => $result['allocations'] ?? [],
            'updated_counts' => $result['updated_counts'] ?? [],
            'prioritized' => $prioritized, // for introspection/debugging
            'rationale' => $result['rationale'] ?? null,
        ],
        'meta' => [
            'note' => 'Frequency prioritization applied before demographic allocation; optional random sampling may have reduced recipient set',
            'sampled_count' => count($prioritized),
        ]
    ];
    sendJson($out);
}
catch (Exception $e) {
    error_log('Allocate items API error: ' . $e->getMessage());
    sendJson(['success' => false, 'error' => 'Internal server error'], 500);
}
