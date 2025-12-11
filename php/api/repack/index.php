<?php
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../core/Repack.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$override = $_GET['_method'] ?? $_POST['_method'] ?? ($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '');
if ($override) {
    $ov = strtoupper(trim($override));
    if (in_array($ov, ['PUT', 'PATCH', 'DELETE'])) {
        $method = $ov;
    }
}

$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH);
$pos = strpos($path, '/api/repack');
$sub = $pos !== false ? substr($path, $pos + strlen('/api/repack')) : '/';
$sub = $sub === '' ? '/' : $sub;
if (strpos($sub, '/index.php') === 0) {
    $sub = substr($sub, strlen('/index.php')) ?: '/';
}
$segments = array_values(array_filter(explode('/', trim($sub, '/')), 'strlen'));

function parse_bool_param($value): bool
{
    if (is_bool($value)) {
        return $value;
    }
    $value = strtolower(trim((string)$value));
    return in_array($value, ['1', 'true', 'yes', 'on'], true);
}

try {
    requireRole(['admin']);

    $service = new RepackService();
    $currentUserId = (int)(currentUserId() ?? 0);

    if (empty($segments)) {
        sendJson(['success' => false, 'error' => 'Endpoint not specified'], 404);
    }

    $root = strtolower($segments[0]);

    if ($root === 'templates') {
        // /templates
        if (count($segments) === 1) {
            if ($method === 'GET') {
                $filters = [];
                if (isset($_GET['active']) && $_GET['active'] !== '') {
                    $filters['active'] = parse_bool_param($_GET['active']);
                }
                if (isset($_GET['q']) && $_GET['q'] !== '') {
                    $filters['q'] = trim((string)$_GET['q']);
                }
                $templates = $service->listTemplates($filters);
                sendJson(['success' => true, 'data' => ['items' => $templates]]);
            }

            if ($method === 'POST') {
                $payload = getJsonInput();
                if (!is_array($payload) || empty($payload)) {
                    sendJson(['success' => false, 'error' => 'Invalid or empty payload'], 400);
                }
                $template = $service->createTemplate($payload, $currentUserId);
                sendJson(['success' => true, 'data' => $template], 201);
            }

            sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
        }

        // /templates/{id}
        $templateId = (int)$segments[1];
        if ($templateId <= 0) {
            sendJson(['success' => false, 'error' => 'Invalid template id'], 404);
        }

        if (count($segments) === 2) {
            if ($method === 'GET') {
                $template = $service->getTemplate($templateId);
                sendJson(['success' => true, 'data' => $template]);
            }

            if ($method === 'PUT') {
                $payload = getJsonInput();
                if (!is_array($payload) || empty($payload)) {
                    sendJson(['success' => false, 'error' => 'Invalid or empty payload'], 400);
                }
                $template = $service->updateTemplate($templateId, $payload, $currentUserId);
                sendJson(['success' => true, 'data' => $template]);
            }

            if ($method === 'DELETE') {
                $service->deleteTemplate($templateId);
                sendJson(['success' => true, 'data' => ['template_id' => $templateId, 'deleted' => true]]);
            }

            sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
        }

        // /templates/{id}/status
        if (isset($segments[2]) && strtolower($segments[2]) === 'status') {
            if (!in_array($method, ['POST', 'PATCH'], true)) {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            $payload = getJsonInput();
            if (!is_array($payload) || !array_key_exists('is_active', $payload)) {
                sendJson(['success' => false, 'error' => 'is_active is required'], 400);
            }
            $service->setTemplateActive($templateId, parse_bool_param($payload['is_active']), $currentUserId);
            $template = $service->getTemplate($templateId);
            sendJson(['success' => true, 'data' => $template]);
        }

        // /templates/{id}/produce
        if (isset($segments[2]) && strtolower($segments[2]) === 'produce') {
            if ($method !== 'POST') {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            $payload = getJsonInput();
            if (!is_array($payload)) {
                sendJson(['success' => false, 'error' => 'Invalid payload'], 400);
            }
            $kitsProduced = isset($payload['kits_produced']) ? (int)$payload['kits_produced'] : 0;
            $note = isset($payload['note']) ? trim((string)$payload['note']) : null;
            $components = $payload['components'] ?? [];
            if ($kitsProduced <= 0) {
                sendJson(['success' => false, 'error' => 'kits_produced must be greater than zero'], 400);
            }
            if (!is_array($components) || empty($components)) {
                sendJson(['success' => false, 'error' => 'components array is required'], 400);
            }
            $operation = $service->produceFromTemplate($templateId, $kitsProduced, $currentUserId, $note, $components);
            sendJson(['success' => true, 'data' => $operation]);
        }

        sendJson(['success' => false, 'error' => 'Endpoint not found'], 404);
    }

    if ($root === 'operations') {
        if (count($segments) === 1) {
            if ($method !== 'GET') {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            $filters = [];
            if (isset($_GET['limit']) && is_numeric($_GET['limit'])) {
                $filters['limit'] = (int)$_GET['limit'];
            }
            $operations = $service->listOperations($filters);
            sendJson(['success' => true, 'data' => ['items' => $operations]]);
        }

        if (count($segments) === 2) {
            if ($method !== 'GET') {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            $repackId = (int)$segments[1];
            if ($repackId <= 0) {
                sendJson(['success' => false, 'error' => 'Invalid repack id'], 404);
            }
            $operation = $service->getOperation($repackId);
            sendJson(['success' => true, 'data' => $operation]);
        }

        sendJson(['success' => false, 'error' => 'Endpoint not found'], 404);
    }

    if ($root === 'lookup') {
        if (count($segments) === 2 && strtolower($segments[1]) === 'template-by-output') {
            if ($method !== 'GET') {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            $itemName = trim((string)($_GET['item_name'] ?? ''));
            $category = isset($_GET['category']) ? trim((string)$_GET['category']) : '';
            if ($itemName === '') {
                sendJson(['success' => false, 'error' => 'item_name is required'], 400);
            }
            $template = $service->findTemplateForOutputItem($itemName, $category === '' ? null : $category);
            if (!$template) {
                sendJson(['success' => true, 'data' => null]);
            }
            sendJson(['success' => true, 'data' => ['template' => $template]]);
        }

        if (count($segments) === 2 && strtolower($segments[1]) === 'template-by-output-lot') {
            if ($method !== 'GET') {
                sendJson(['success' => false, 'error' => 'Method not allowed'], 405);
            }
            $inventoryIdRaw = $_GET['inventory_id'] ?? ($_GET['lot_id'] ?? null);
            $inventoryId = is_numeric($inventoryIdRaw) ? (int)$inventoryIdRaw : 0;
            if ($inventoryId <= 0) {
                sendJson(['success' => false, 'error' => 'inventory_id is required'], 400);
            }
            $template = $service->findTemplateForOutputLot($inventoryId);
            if (!$template) {
                sendJson(['success' => true, 'data' => null]);
            }
            sendJson(['success' => true, 'data' => ['template' => $template]]);
        }

        sendJson(['success' => false, 'error' => 'Endpoint not found'], 404);
    }

    sendJson(['success' => false, 'error' => 'Endpoint not found'], 404);
} catch (Exception $e) {
    $status = ($e->getCode() >= 400 && $e->getCode() <= 599) ? (int)$e->getCode() : 500;
    sendJson(['success' => false, 'error' => $e->getMessage()], $status);
}
