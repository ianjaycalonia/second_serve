<?php
/**
 * Auth core: handles authentication-related business logic
 */
class Auth {
    private Database $db;

    public function __construct() {
        $this->db = Database::getInstance();
    }

    /**
     * Handle login from request payload (validates and manages session/CSRF)
     */
    public function loginWithRequest(array $data): array {
        // Basic validation (keep same behavior as before: only required fields)
        if (empty($data['email']) || empty($data['password']) || empty($data['role'])) {
            throw new Exception('All fields are required');
        }

        $user = $this->login($data['email'], $data['password'], $data['role']);

        // Session handling and CSRF generation
        $_SESSION['user_id'] = $user['user_id'];
        $_SESSION['user_role'] = $user['role'];
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        return [
            'user' => $user,
            'csrf_token' => $_SESSION['csrf_token'],
            'redirect' => self::dashboardUrl($user['role'])
        ];
    }

    public function login(string $email, string $password, string $role): array {
        // Provide granular feedback: check email first, then role, then password
        // Try to include optional must_change_password; if column is missing, fall back
        try {
            $userAnyRole = $this->db->query(
                "SELECT user_id, name, email, password_hash, role, status, created_at, last_login, must_change_password
                 FROM users WHERE email = ?",
                [$email]
            )->fetch();
        } catch (Exception $e) {
            $userAnyRole = $this->db->query(
                "SELECT user_id, name, email, password_hash, role, status, created_at, last_login
                 FROM users WHERE email = ?",
                [$email]
            )->fetch();
            if ($userAnyRole) { $userAnyRole['must_change_password'] = 0; }
        }

        if (!$userAnyRole) {
            throw new Exception('Email not found');
        }

        if (strtolower((string)$userAnyRole['role']) !== strtolower($role)) {
            throw new Exception('Selected role does not match this account');
        }

        $user = $userAnyRole; // role matches; no need to re-query

        if (!password_verify($password, (string)$user['password_hash'])) {
            throw new Exception('Incorrect password');
        }

        if ($user['status'] !== 'approved') {
            throw new Exception('Account not approved');
        }

        // If the user is required to change password, block normal login
        if (!empty($user['must_change_password'])) {
            throw new Exception('Password change required');
        }

        // Update last_login if column exists; ignore if not present
        try {
            $this->db->query(
                "UPDATE users SET last_login = NOW() WHERE user_id = ?",
                [$user['user_id']]
            );
        } catch (Exception $e) {
            // last_login optional in schema; ignore failures
        }

        // Merge profile fields according to role for convenience
        $profile = [];
        if ($user['role'] === 'recipient') {
            // Align with schema: recipient_profiles has organization_name, address, primary_contact_id
            try {
                $p = $this->db->query(
                    'SELECT rp.organization_name, rp.address,
                            pc.position_designation, pc.contact_number, pc.email
                     FROM recipient_profiles rp
                     LEFT JOIN recipient_contacts pc ON pc.id = rp.primary_contact_id
                     WHERE rp.user_id = ?',
                    [$user['user_id']]
                )->fetch();
            } catch (Exception $e) {
                $p = $this->db->query(
                    'SELECT organization_name, address FROM recipient_profiles WHERE user_id = ?',
                    [$user['user_id']]
                )->fetch();
                $p['position_designation'] = $p['position_designation'] ?? null;
                $p['contact_number'] = $p['contact_number'] ?? null;
                $p['email'] = $p['email'] ?? null;
            }
            $profile = $p ?: [];
        } elseif ($user['role'] === 'donor') {
            // Schema uses donor_category_id; keep null if not set
            try {
                $p = $this->db->query(
                    'SELECT organization_name, donor_category_id AS donor_category, contact_number, address FROM donor_profiles WHERE user_id = ?',
                    [$user['user_id']]
                )->fetch();
            } catch (Exception $e) {
                $p = $this->db->query(
                    'SELECT organization_name, contact_number, address FROM donor_profiles WHERE user_id = ?',
                    [$user['user_id']]
                )->fetch();
                if ($p && !array_key_exists('donor_category', $p)) { $p['donor_category'] = null; }
            }
            $profile = $p ?: [];
        } elseif ($user['role'] === 'admin') {
            $p = $this->db->query(
                'SELECT organization_name, contact_number, address FROM admin_profiles WHERE user_id = ?',
                [$user['user_id']]
            )->fetch();
            $profile = $p ?: [];
        }
        unset($user['password_hash']);
        return array_merge($user, $profile);
    }

    /**
     * Handle registration from request payload (validates and manages session/CSRF)
     */
    public function registerWithRequest(array $data): array {
        // Validation (same rules as previously in API)
        $required = ['name', 'email', 'password', 'confirmPassword', 'role'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                throw new Exception(ucfirst($field) . ' is required');
            }
        }
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            throw new Exception('Invalid email format');
        }
        if (strlen($data['password']) < 8) {
            throw new Exception('Password must be at least 8 characters long');
        }
        if ($data['password'] !== $data['confirmPassword']) {
            throw new Exception('Passwords do not match');
        }
        if (!in_array($data['role'], ['donor', 'recipient'])) {
            throw new Exception('Invalid user role');
        }

        $user = $this->register(
            $data['name'],
            $data['email'],
            $data['password'],
            $data['role'],
            $data['organization_name'] ?? null,
            null,
            $data['contact_number'] ?? null,
            $data['address'] ?? null,
            isset($data['donor_category_id']) ? (int)$data['donor_category_id'] : null,
            isset($data['beneficiary_category_id']) ? (int)$data['beneficiary_category_id'] : null
        );

        // Auto-login only if status is approved; otherwise return pending status
        if (($user['status'] ?? '') === 'approved') {
            $loggedIn = $this->login($data['email'], $data['password'], $data['role']);
            $_SESSION['user_id'] = $loggedIn['user_id'];
            $_SESSION['user_role'] = $loggedIn['role'];
            if (empty($_SESSION['csrf_token'])) {
                $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
            }
            return [
                'user' => $loggedIn,
                'csrf_token' => $_SESSION['csrf_token'],
                'redirect' => self::dashboardUrl($loggedIn['role'])
            ];
        }

        // Not approved (e.g., recipient pending)
        return [
            'user' => $user,
            'csrf_token' => null,
            'redirect' => null
        ];
    }

    public function register(string $name, string $email, string $password, string $role, ?string $organization_name = null, ?string $organization_type = null, ?string $contact_number = null, ?string $address = null, ?int $donor_category_id = null, ?int $beneficiary_category_id = null): array {
        // Ensure email not taken
        $existing = $this->db->query(
            'SELECT user_id FROM users WHERE email = ?',
            [$email]
        )->fetch();
        if ($existing) {
            throw new Exception('Email already registered');
        }

        $this->db->beginTransaction();
        try {
            $hashed = password_hash($password, PASSWORD_DEFAULT);
            // Compute next user_id explicitly in case AUTO_INCREMENT is not set
            $row = $this->db->query('SELECT COALESCE(MAX(user_id),0)+1 AS next_id FROM users')->fetch();
            $userId = (int)($row['next_id'] ?? 1);
            // Insert minimal user with explicit user_id
            // New recipients require admin approval; donors are auto-approved
            $status = ($role === 'recipient') ? 'pending' : 'approved';
            $this->db->query(
                "INSERT INTO users (user_id, name, email, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
                [$userId, $name, $email, $hashed, $role, $status]
            );
            // Insert profile according to role
            if ($role === 'recipient') {
                // Insert base recipient profile (align to schema: no organization_type column)
                if ($beneficiary_category_id) {
                    $this->db->query(
                        'INSERT INTO recipient_profiles (user_id, organization_name, beneficiary_category_id, address) VALUES (?,?,?,?)',
                        [$userId, $organization_name, $beneficiary_category_id, $address]
                    );
                } else {
                    $this->db->query(
                        'INSERT INTO recipient_profiles (user_id, organization_name, address) VALUES (?,?,?)',
                        [$userId, $organization_name, $address]
                    );
                }
                // If contact info provided, create a primary recipient contact and set primary_contact_id
                if (!empty($contact_number)) {
                    $this->db->query(
                        'INSERT INTO recipient_contacts (user_id, contact_name, position_designation, contact_number, email, is_primary) VALUES (?,?,?,?,?,1)',
                        [$userId, $name, null, $contact_number, null]
                    );
                    $pcId = (int)$this->db->lastInsertId();
                    $this->db->query('UPDATE recipient_profiles SET primary_contact_id = ? WHERE user_id = ?', [$pcId, $userId]);
                }
                $profile = $this->db->query(
                    'SELECT organization_name, address FROM recipient_profiles WHERE user_id = ?',
                    [$userId]
                )->fetch() ?: [];
            } elseif ($role === 'donor') {
                $this->db->query(
                    $donor_category_id
                        ? 'INSERT INTO donor_profiles (user_id, organization_name, donor_category_id, contact_number, address) VALUES (?,?,?,?,?)'
                        : 'INSERT INTO donor_profiles (user_id, organization_name, contact_number, address) VALUES (?,?,?,?)',
                    $donor_category_id
                        ? [$userId, $organization_name, $donor_category_id, $contact_number, $address]
                        : [$userId, $organization_name, $contact_number, $address]
                );
                $profile = $this->db->query(
                    'SELECT organization_name, donor_category_id AS donor_category, contact_number, address FROM donor_profiles WHERE user_id = ?',
                    [$userId]
                )->fetch() ?: [];
            } else {
                // For admin registration paths (if ever used)
                $this->db->query(
                    'INSERT INTO admin_profiles (user_id, organization_name, contact_number, address) VALUES (?,?,?,?)',
                    [$userId, $organization_name, $contact_number, $address]
                );
                $profile = $this->db->query(
                    'SELECT organization_name, contact_number, address FROM admin_profiles WHERE user_id = ?',
                    [$userId]
                )->fetch() ?: [];
            }

            // Base user fields
            $base = $this->db->query(
                'SELECT user_id, name, email, role, status, created_at, last_login FROM users WHERE user_id = ?',
                [$userId]
            )->fetch();
            $this->db->commit();

            // Notify all admins of new registration (donor/recipient)
            try {
                if (in_array($role, ['donor','recipient'])) {
                    $admins = $this->db->query('SELECT user_id FROM users WHERE role = \"admin\"')->fetchAll();
                    if ($admins) {
                        $type = $role === 'recipient' ? 'new_recipient' : 'new_donor';
                        $msg = ($role === 'recipient' ? 'New recipient registered: ' : 'New donor registered: ') . ($name ?: $email);
                        foreach ($admins as $a) {
                            $this->db->query(
                                'INSERT INTO notifications (user_id, type, reference_type, reference_id, message, read_status, created_at) VALUES (?,?,?,?,?,0,NOW())',
                                [(int)$a['user_id'], $type, 'user', $userId, $msg]
                            );
                        }
                    }
                }
            } catch (Exception $e) { /* non-fatal */ }

            return array_merge($base ?: [], $profile ?: []);
        } catch (Exception $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    public static function dashboardUrl(string $role): string {
        $baseUrl = rtrim(APP_URL, '/');
        switch ($role) {
            case 'admin':
                return $baseUrl . '/AdminDashboard.html';
            case 'donor':
                return $baseUrl . '/DonorDashboard.html';
            case 'recipient':
                return $baseUrl . '/recipientDashboard.html';
            default:
                return $baseUrl . '/index.html';
        }
    }

    /**
     * Logout: clear session and cookie
     */
    public function logout(): void {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        session_start();
    }

    public function changePassword(int $userId, string $currentPassword, string $newPassword, string $confirmPassword): void {
        if ($userId <= 0) { throw new Exception('Unauthorized'); }
        if ($newPassword === '' || $confirmPassword === '' || $currentPassword === '') { throw new Exception('All password fields are required'); }
        if (strlen($newPassword) < 8) { throw new Exception('Password must be at least 8 characters long'); }
        if ($newPassword !== $confirmPassword) { throw new Exception('Passwords do not match'); }

        $row = $this->db->query('SELECT password_hash FROM users WHERE user_id = ? LIMIT 1', [$userId])->fetch();
        if (!$row || empty($row['password_hash'])) { throw new Exception('User not found'); }
        if (!password_verify($currentPassword, (string)$row['password_hash'])) { throw new Exception('Incorrect current password'); }
        if (password_verify($newPassword, (string)$row['password_hash'])) { throw new Exception('New password must be different from current'); }

        $hash = password_hash($newPassword, PASSWORD_DEFAULT);
        $this->db->query('UPDATE users SET password_hash = ? WHERE user_id = ?', [$hash, $userId]);
        try { $this->db->query('UPDATE users SET must_change_password = 0 WHERE user_id = ?', [$userId]); } catch (Exception $e) { /* ignore */ }
    }
}
