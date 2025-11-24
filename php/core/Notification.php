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
