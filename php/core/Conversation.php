<?php
/**
 * Conversation service
 */
class Conversation {
    private Database $db;

    public function __construct() {
        $this->db = Database::getInstance();
    }

    private function getUserRole(int $userId): ?string {
        $row = $this->db->query("SELECT role FROM users WHERE user_id = ?", [$userId])->fetch();
        return $row['role'] ?? null;
    }

    private function getUsersRoles(array $userIds): array {
        if (empty($userIds)) return [];
        $placeholders = implode(',', array_fill(0, count($userIds), '?'));
        $rows = $this->db->query("SELECT user_id, role FROM users WHERE user_id IN ($placeholders)", $userIds)->fetchAll();
        $map = [];
        foreach ($rows as $r) { $map[(int)$r['user_id']] = (string)$r['role']; }
        return $map;
    }

    /**
     * Create a conversation
     * @param string $type 'direct' or 'group'
     * @param int $createdBy user id
     * @param array $participantIds array of user IDs including creator
     * @param string|null $title optional title for group
     * @return array conversation row
     */
    public function create(string $type, int $createdBy, array $participantIds, ?string $title = null): array {
        $type = $type === 'group' ? 'group' : 'direct';
        $title = $title !== null ? trim($title) : null;
        $participantIds = array_values(array_unique(array_map('intval', $participantIds)));
        if (count($participantIds) < 2 && $type === 'direct') {
            throw new Exception('Direct conversation requires 2 participants');
        }
        if (!in_array($createdBy, $participantIds, true)) {
            $participantIds[] = $createdBy;
        }

        // Policy enforcement
        $creatorRole = $this->getUserRole($createdBy);
        $rolesMap = $this->getUsersRoles($participantIds);
        if (!$creatorRole) throw new Exception('Invalid creator');

        if ($creatorRole === 'donor') {
            // Donors: only 1:1 with an admin (food bank). No groups.
            if ($type !== 'direct') {
                throw new Exception('Donors can only create direct conversations with the food bank');
            }
            if (count($participantIds) !== 2) {
                throw new Exception('Donor conversations must be 1:1 with the food bank');
            }
            // The other participant must be an admin
            foreach ($participantIds as $uid) {
                if ($uid === $createdBy) continue;
                $role = $rolesMap[$uid] ?? null;
                if ($role !== 'admin') {
                    throw new Exception('Donors can only chat with the food bank');
                }
            }
            // Optional: sanitize title off for donor direct
            $title = null;
        } else if ($creatorRole !== 'admin') {
            // For non-admin (e.g., recipient), only allow direct with admin
            if ($type === 'group') {
                throw new Exception('Only the food bank (admin) can create group conversations');
            }
            if (count($participantIds) !== 2) {
                throw new Exception('Non-admin conversations must be 1:1 with the food bank');
            }
            foreach ($participantIds as $uid) {
                if ($uid === $createdBy) continue;
                $role = $rolesMap[$uid] ?? null;
                if ($role !== 'admin') {
                    throw new Exception('Non-admin users can only chat with the food bank');
                }
            }
            $title = null;
        }

        $this->db->beginTransaction();
        try {
            $this->db->query(
                "INSERT INTO conversations (type, created_by, title, created_at) VALUES (?, ?, ?, NOW())",
                [$type, $createdBy, $title]
            );
            $convId = (int)$this->db->lastInsertId();

            foreach ($participantIds as $uid) {
                $this->db->query(
                    "INSERT INTO conversation_participants (conversation_id, user_id, last_read_at, joined_at) VALUES (?, ?, NULL, NOW())",
                    [$convId, (int)$uid]
                );
            }

            // If direct, set up pair uniqueness
            if ($type === 'direct' && count($participantIds) === 2) {
                // Ensure pair table exists to avoid runtime errors
                $this->ensureDirectPairsTable();
                sort($participantIds);
                [$a, $b] = $participantIds;
                $this->db->query(
                    "INSERT INTO direct_conversation_pairs (conversation_id, user_a, user_b) VALUES (?, ?, ?)",
                    [$convId, (int)$a, (int)$b]
                );
            }

            $this->db->commit();

            return $this->getById($convId);
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Get existing direct conversation between two users or create a new one
     */
    public function getOrCreateDirect(int $userA, int $userB, int $createdBy): array {
        $a = min($userA, $userB);
        $b = max($userA, $userB);
        // Policy: donors can only create with admin
        $creatorRole = $this->getUserRole($createdBy);
        if ($creatorRole === 'donor' || $creatorRole === 'recipient') {
            $other = ($createdBy === $a) ? $b : $a;
            $otherRole = $this->getUserRole($other);
            if ($otherRole !== 'admin') {
                throw new Exception('Non-admin users can only chat with the food bank');
            }
        }
        // Ensure pair table exists before query
        $this->ensureDirectPairsTable();
        // Try find existing direct pair
        $row = $this->db->query(
            "SELECT c.id, c.type, c.created_by, c.title, c.created_at
             FROM direct_conversation_pairs d
             JOIN conversations c ON c.id = d.conversation_id
             WHERE d.user_a = ? AND d.user_b = ?",
            [$a, $b]
        )->fetch();
        if ($row) return $row;
        // Create a new one
        return $this->create('direct', $createdBy, [$userA, $userB], null);
    }

    /**
     * Ensure the direct_conversation_pairs helper table exists.
     * This avoids 500 errors if the DB schema missed this table.
     */
    private function ensureDirectPairsTable(): void {
        // Attempt a lightweight existence check; if it fails, create the table.
        try {
            $this->db->query("SELECT 1 FROM direct_conversation_pairs LIMIT 1");
            return; // exists
        } catch (Throwable $e) {
            // Create table with required constraints
            $sql = "CREATE TABLE IF NOT EXISTS direct_conversation_pairs (
                        id INT(11) NOT NULL AUTO_INCREMENT,
                        conversation_id INT(11) NOT NULL,
                        user_a INT(11) NOT NULL,
                        user_b INT(11) NOT NULL,
                        PRIMARY KEY (id),
                        UNIQUE KEY uniq_pair (user_a, user_b),
                        KEY dcp_conversation_idx (conversation_id),
                        CONSTRAINT dcp_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations (id)
                            ON DELETE CASCADE ON UPDATE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci";
            $this->db->query($sql);
        }
    }

    /**
     * Get conversation by id
     */
    public function getById(int $id): ?array {
        $conv = $this->db->query(
            "SELECT id, type, created_by, title, created_at FROM conversations WHERE id = ?",
            [$id]
        )->fetch();
        if (!$conv) return null;
        $participants = $this->db->query(
            "SELECT cp.user_id, u.name, u.role, cp.last_read_at, cp.joined_at
             FROM conversation_participants cp
             JOIN users u ON u.user_id = cp.user_id
             WHERE cp.conversation_id = ?
             ORDER BY cp.user_id",
            [$id]
        )->fetchAll();
        $conv['participants'] = $participants;
        return $conv;
    }

    /**
     * Ensure user is a participant
     */
    public function isParticipant(int $conversationId, int $userId): bool {
        $row = $this->db->query(
            "SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?",
            [$conversationId, $userId]
        )->fetch();
        return (bool)$row;
    }

    /**
     * List conversations for a user with last message preview and unread count
     */
    public function listForUser(int $userId, int $limit = 50, int $offset = 0): array {
        $limit = max(1, min(200, $limit));
        $offset = max(0, $offset);
        $sql = "
            SELECT 
                c.id, c.type, c.title, c.created_at,
                -- For direct conversations, identify the other participant
                CASE WHEN c.type = 'direct' THEN (
                    SELECT cp2.user_id FROM conversation_participants cp2
                    WHERE cp2.conversation_id = c.id AND cp2.user_id <> ?
                    ORDER BY cp2.user_id LIMIT 1
                ) ELSE NULL END AS other_user_id,
                -- Compute a user-tailored display title
                CASE 
                  WHEN c.type = 'direct' THEN (
                    SELECT CASE 
                        WHEN u.role = 'admin' AND (SELECT role FROM users WHERE user_id = ?) <> 'admin' 
                            THEN COALESCE(
                                NULLIF((SELECT ap.organization_name FROM admin_profiles ap WHERE ap.user_id = u.user_id), ''),
                                'Food Bank'
                            )
                        ELSE COALESCE(
                                NULLIF((SELECT ap.organization_name FROM admin_profiles ap WHERE ap.user_id = u.user_id), ''),
                                NULLIF((SELECT dp.organization_name FROM donor_profiles dp WHERE dp.user_id = u.user_id), ''),
                                NULLIF((SELECT rp.organization_name FROM recipient_profiles rp WHERE rp.user_id = u.user_id), ''),
                                u.name,
                                CONCAT('User #', u.user_id)
                            )
                    END 
                    FROM users u 
                    WHERE u.user_id = (
                        SELECT cp3.user_id FROM conversation_participants cp3
                        WHERE cp3.conversation_id = c.id AND cp3.user_id <> ?
                        ORDER BY cp3.user_id LIMIT 1
                    )
                  )
                  ELSE COALESCE(NULLIF(c.title, ''), CONCAT('Group #', c.id))
                END AS display_title,
                -- Last message as JSON blob for preview
                (SELECT JSON_OBJECT(
                        'id', m.id,
                        'body', SUBSTRING(m.body, 1, 500),
                        'sender_id', m.sender_id,
                        'created_at', m.created_at
                    )
                 FROM messages m
                 WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC, m.id DESC
                 LIMIT 1
                ) AS last_message,
                -- Unread count for the current user
                (SELECT COUNT(*) FROM messages m
                 JOIN conversation_participants cp2 ON cp2.conversation_id = m.conversation_id AND cp2.user_id = ?
                 WHERE m.conversation_id = c.id AND (cp2.last_read_at IS NULL OR m.created_at > cp2.last_read_at)
                ) AS unread_count
            FROM conversations c
            JOIN conversation_participants cp ON cp.conversation_id = c.id
            WHERE cp.user_id = ?
            ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at) DESC
            LIMIT ? OFFSET ?
        ";
        return $this->db->query($sql, [$userId, $userId, $userId, $userId, $userId, $limit, $offset])->fetchAll();
    }

    /**
     * Update last_read_at for a participant to now
     */
    public function markRead(int $conversationId, int $userId): bool {
        $this->db->query(
            "UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?",
            [$conversationId, $userId]
        );
        return $this->db->rowCount() > 0;
    }
}
