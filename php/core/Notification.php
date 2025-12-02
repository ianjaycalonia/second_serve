<?php
/**
 * Notification service
 */
class Notification {
    private Database $db;

    public function __construct() {
        $this->db = Database::getInstance();
    }

    /**
     * Create a notification
     * @param array $data
     *   - user_id: int
     *   - type: string
     *   - reference_type: string|null
     *   - reference_id: int|null
     *   - message: string
     * @return array created notification row
     */
    public function create(array $data): array {
        $userId = (int)($data['user_id'] ?? 0);
        $type = trim((string)($data['type'] ?? ''));
        $referenceType = isset($data['reference_type']) ? trim((string)$data['reference_type']) : null;
        $referenceId = isset($data['reference_id']) ? (int)$data['reference_id'] : null;
        $message = trim((string)($data['message'] ?? ''));

        if ($userId <= 0) throw new Exception('user_id is required');
        if ($type === '') throw new Exception('type is required');
        if ($message === '') throw new Exception('message is required');

        // Insert
        $sql = "INSERT INTO notifications (user_id, type, reference_type, reference_id, message, read_status, created_at)
                VALUES (?, ?, ?, ?, ?, 0, NOW())";
        $this->db->query($sql, [$userId, $type, $referenceType, $referenceId, $message]);
        $id = (int)$this->db->lastInsertId();

        return $this->getById($id);
    }

    /**
     * Replace (or optionally create) the most recent notification that matches the supplied context.
     * When a matching notification is found, the message, reference fields, read status and timestamp
     * are refreshed instead of inserting a brand-new entry.
     *
     * @param array $data Notification payload (same keys as create())
     * @param bool $requireExisting When true, do not create a new row if none match the criteria
     * @return array|null Updated notification row, or null if no row was updated and creation is skipped
     * @throws Exception When validation fails
     */
    public function replaceLatest(array $data, bool $requireExisting = false): ?array {
        $userId = (int)($data['user_id'] ?? 0);
        $type = trim((string)($data['type'] ?? ''));
        $referenceType = array_key_exists('reference_type', $data)
            ? trim((string)$data['reference_type'])
            : null;
        if ($referenceType === '') {
            $referenceType = null;
        }
        $referenceId = array_key_exists('reference_id', $data)
            ? ($data['reference_id'] !== null ? (int)$data['reference_id'] : null)
            : null;
        $message = trim((string)($data['message'] ?? ''));

        if ($userId <= 0) throw new Exception('user_id is required');
        if ($type === '') throw new Exception('type is required');
        if ($message === '') throw new Exception('message is required');

        $sql = 'SELECT id FROM notifications WHERE user_id = ? AND type = ?';
        $params = [$userId, $type];
        if ($referenceType !== null) {
            $sql .= ' AND reference_type = ?';
            $params[] = $referenceType;
        }
        if ($referenceId !== null) {
            $sql .= ' AND reference_id = ?';
            $params[] = $referenceId;
        }
        $sql .= ' ORDER BY created_at DESC, id DESC LIMIT 1';

        $row = $this->db->query($sql, $params)->fetch();

        if (!$row && ($referenceType !== null || $referenceId !== null)) {
            // Fallback: match by user + type only if specific reference combo not found
            $row = $this->db->query(
                'SELECT id FROM notifications WHERE user_id = ? AND type = ? ORDER BY created_at DESC, id DESC LIMIT 1',
                [$userId, $type]
            )->fetch();
        }

        if ($row && isset($row['id'])) {
            $id = (int)$row['id'];
            $this->db->query(
                'UPDATE notifications
                 SET message = ?, reference_type = ?, reference_id = ?, read_status = 0, created_at = NOW()
                 WHERE id = ?',
                [$message, $referenceType, $referenceId, $id]
            );
            return $this->getById($id);
        }

        if ($requireExisting) {
            return null;
        }

        return $this->create($data);
    }

    /**
     * Fetch all notifications for a user ordered by created_at desc
     */
    public function listByUser(int $userId): array {
        $sql = "SELECT id, user_id, type, reference_type, reference_id, message, read_status, created_at
                FROM notifications
                WHERE user_id = ?
                ORDER BY created_at DESC, id DESC";
        return $this->db->query($sql, [$userId])->fetchAll();
    }

    /**
     * Get a single notification
     */
    public function getById(int $id): ?array {
        $row = $this->db->query(
            "SELECT id, user_id, type, reference_type, reference_id, message, read_status, created_at
             FROM notifications WHERE id = ?",
            [$id]
        )->fetch();
        return $row ?: null;
    }

    /**
     * Mark a notification as read
     */
    public function markRead(int $id): bool {
        $this->db->query("UPDATE notifications SET read_status = 1 WHERE id = ?", [$id]);
        return $this->db->rowCount() > 0;
    }

    /**
     * Mark all notifications as read for a specific user
     */
    public function markAllReadByUser(int $userId): int {
        $this->db->query("UPDATE notifications SET read_status = 1 WHERE user_id = ? AND read_status = 0", [$userId]);
        return $this->db->rowCount();
    }
}
