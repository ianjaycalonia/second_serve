<?php
/**
 * Message service
 */
class Message {
    private Database $db;

    public function __construct() {
        $this->db = Database::getInstance();
    }

    /**
     * Send a message to an existing conversation
     * @return array created message row
     */
    public function send(int $conversationId, int $senderId, string $body, ?string $attachmentUrl = null): array {
        $body = trim($body);
        $attachmentUrl = $attachmentUrl !== null ? trim($attachmentUrl) : null;
        if ($conversationId <= 0) throw new Exception('conversation_id is required');
        if ($senderId <= 0) throw new Exception('sender_id is required');
        if ($body === '' && ($attachmentUrl === null || $attachmentUrl === '')) {
            throw new Exception('Message body or attachment is required');
        }

        // Permission: must be participant
        $isParticipant = $this->db->query(
            "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
            [$conversationId, $senderId]
        )->fetch();
        if (!$isParticipant) throw new Exception('Forbidden: not a participant');

        // Policy enforcement: donors may only send in a 1:1 conversation with an admin
        $sender = $this->db->query("SELECT role FROM users WHERE user_id = ?", [$senderId])->fetch();
        $senderRole = $sender['role'] ?? null;
        if ($senderRole === 'donor') {
            // Conversation must be direct and exactly two participants: sender + admin
            $conv = $this->db->query("SELECT type FROM conversations WHERE id = ?", [$conversationId])->fetch();
            $convType = $conv['type'] ?? null;
            if ($convType !== 'direct') {
                throw new Exception('Donors can only message the food bank (direct chat)');
            }
            $parts = $this->db->query(
                "SELECT cp.user_id, u.role FROM conversation_participants cp JOIN users u ON u.user_id = cp.user_id WHERE cp.conversation_id = ?",
                [$conversationId]
            )->fetchAll();
            if (count($parts) !== 2) {
                throw new Exception('Donors can only message the food bank in a 1:1 conversation');
            }
            $otherIsAdmin = false;
            foreach ($parts as $p) {
                if ((int)$p['user_id'] !== (int)$senderId && $p['role'] === 'admin') { $otherIsAdmin = true; break; }
            }
            if (!$otherIsAdmin) {
                throw new Exception('Donors can only chat with the food bank');
            }
        }

        $this->db->beginTransaction();
        try {
            $this->db->query(
                "INSERT INTO messages (conversation_id, sender_id, body, attachment_url, created_at, deleted_at)
                 VALUES (?, ?, ?, ?, NOW(), NULL)",
                [$conversationId, $senderId, $body, $attachmentUrl]
            );
            $messageId = (int)$this->db->lastInsertId();

            // Optionally update sender last_read_at (consider message as read for sender)
            $this->db->query(
                "UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?",
                [$conversationId, $senderId]
            );

            // Intentionally do NOT create notifications for messages.
            // Unread state is handled by the messaging subsystem via last_read_at and its own badges.

            $this->db->commit();
            return $this->getById($messageId);
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * List messages in a conversation ordered by created_at asc, with pagination
     */
    public function list(int $conversationId, int $userId, int $limit = 50, ?int $afterId = null): array {
        // Permission check
        $isParticipant = $this->db->query(
            "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
            [$conversationId, $userId]
        )->fetch();
        if (!$isParticipant) throw new Exception('Forbidden: not a participant');

        $limit = max(1, min(200, $limit));
        $params = [$conversationId];
        $where = '';
        if ($afterId !== null && $afterId > 0) {
            $where = ' AND m.id > ?';
            $params[] = $afterId;
        }
        $params[] = $limit;

        $rows = $this->db->query(
            "SELECT m.id, m.conversation_id, m.sender_id, u.name AS sender_name, m.body, m.attachment_url, m.created_at
             FROM messages m
             JOIN users u ON u.user_id = m.sender_id
             WHERE m.conversation_id = ? $where
             ORDER BY m.id ASC
             LIMIT ?",
            $params
        )->fetchAll();
        return $rows;
    }

    /**
     * Get a message by id
     */
    public function getById(int $id): ?array {
        $row = $this->db->query(
            "SELECT m.id, m.conversation_id, m.sender_id, u.name AS sender_name, m.body, m.attachment_url, m.created_at
             FROM messages m
             JOIN users u ON u.user_id = m.sender_id
             WHERE m.id = ?",
            [$id]
        )->fetch();
        return $row ?: null;
    }
}
