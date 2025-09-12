<?php
require_once __DIR__ . '/../includes/config.php';

class User
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    // Fetch a single user profile by user_id
    public function getProfile(int $userId): array
    {
        $user = $this->db->query(
            "SELECT user_id, name, email, role, status, organization_name, contact_number, address, created_at
             FROM users WHERE user_id = ?",
            [$userId]
        )->fetch();
        if (!$user) {
            throw new Exception('User not found');
        }
        return $user;
    }

    // Update editable profile fields for a user (self-service)
    public function updateProfile(int $userId, array $data): void
    {
        $fields = [];
        $params = [];
        $allowed = ['name', 'organization_name', 'contact_number', 'address'];
        foreach ($allowed as $col) {
            if (array_key_exists($col, $data)) {
                $fields[] = "$col = ?";
                $params[] = $data[$col];
            }
        }
        if (empty($fields)) {
            return; // nothing to update
        }
        $params[] = $userId;
        $sql = "UPDATE users SET " . implode(', ', $fields) . " WHERE user_id = ?";
        $this->db->query($sql, $params);
    }

    // Admin: list users with optional filters
    public function listUsers(array $filters = []): array
    {
        $where = [];
        $params = [];
        // Normalize status: treat 'active' as 'approved' to align with DB enum
        if (!empty($filters['status'])) {
            $status = $filters['status'];
            if ($status === 'active') { $status = 'approved'; }
            $where[] = 'status = ?';
            $params[] = $status;
        }
        if (!empty($filters['role'])) { $where[] = 'role = ?'; $params[] = $filters['role']; }
        if (!empty($filters['q'])) {
            $where[] = '(name LIKE ? OR email LIKE ? OR organization_name LIKE ?)';
            $q = '%' . $filters['q'] . '%';
            array_push($params, $q, $q, $q);
        }
        $sql = "SELECT user_id, name, email, role, status, organization_name, contact_number, address, created_at FROM users";
        if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
        $sql .= ' ORDER BY created_at DESC LIMIT 200';
        return $this->db->query($sql, $params)->fetchAll();
    }

    // Admin: approve a user
    public function approveUser(int $userId): void
    {
        $this->db->query("UPDATE users SET status = 'approved' WHERE user_id = ?", [$userId]);
    }

    // Admin: reject a user
    public function rejectUser(int $userId, ?string $reason = null): void
    {
        $this->db->query("UPDATE users SET status = 'rejected' WHERE user_id = ?", [$userId]);
        // Optional: store reason in a separate audit table in the future
    }
}
