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
        // Fetch user by email + role, require approved status
        $user = $this->db->query(
            "SELECT user_id, name, email, password_hash, role, organization_name, contact_number, address, status, created_at
             FROM users WHERE email = ? AND role = ?",
            [$email, $role]
        )->fetch();

        if (!$user || !password_verify($password, (string)$user['password_hash'])) {
            throw new Exception('Invalid email or password');
        }

        if ($user['status'] !== 'approved') {
            throw new Exception('Account not approved');
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

        unset($user['password_hash']);
        return $user;
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
            $data['contact_number'] ?? null,
            $data['address'] ?? null
        );

        // Auto-login newly registered and approved users
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

    public function register(string $name, string $email, string $password, string $role, ?string $organization_name = null, ?string $contact_number = null, ?string $address = null): array {
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
            $this->db->query(
                "INSERT INTO users (name, email, password_hash, role, organization_name, contact_number, address, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', NOW())",
                [$name, $email, $hashed, $role, $organization_name, $contact_number, $address]
            );
            $userId = $this->db->lastInsertId();
            $user = $this->db->query(
                'SELECT user_id, name, email, role, status, organization_name, contact_number, address, created_at FROM users WHERE user_id = ?',
                [$userId]
            )->fetch();
            $this->db->commit();
            return $user;
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
}
