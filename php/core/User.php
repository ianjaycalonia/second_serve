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
            $where[] = 'u.status = ?';
            $params[] = $status;
        }
        if (!empty($filters['role'])) { $where[] = 'u.role = ?'; $params[] = $filters['role']; }
        if (!empty($filters['q'])) {
            $where[] = '(u.name LIKE ? OR u.email LIKE ? OR u.organization_name LIKE ?)';
            $q = '%' . $filters['q'] . '%';
            array_push($params, $q, $q, $q);
        }
        $joinRecipient = (!empty($filters['role']) && $filters['role'] === 'recipient');
        if ($joinRecipient) {
            $sql = "SELECT u.user_id, u.name, u.email, u.role, u.status, u.organization_name, u.contact_number, u.address, u.created_at,
                           rp.agency_type, rp.position_designation
                    FROM users u
                    LEFT JOIN recipient_profiles rp ON rp.user_id = u.user_id";
        } else {
            $sql = "SELECT u.user_id, u.name, u.email, u.role, u.status, u.organization_name, u.contact_number, u.address, u.created_at
                    FROM users u";
        }
        if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
        $sql .= ' ORDER BY u.created_at DESC LIMIT 200';
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

    // Generate a placeholder email from organization name (sanitized) with a non-routable domain
    private function generatePlaceholderEmail(?string $organizationName = null): string
    {
        $base = '';
        if (!empty($organizationName)) {
            // Lowercase, remove spaces and non-alphanumeric chars
            $base = strtolower($organizationName);
            $base = preg_replace('/[^a-z0-9]+/', '', $base);
        }
        if ($base === '') {
            $base = 'imported' . bin2hex(random_bytes(4));
        }
        // Ensure it looks like an email address
        return $base . '@noemail.local';
    }

    // Ensure an email is unique in the users table by appending a numeric suffix if necessary
    private function ensureUniqueEmail(string $email): string
    {
        $exists = function(string $em){
            return (bool)$this->db->query('SELECT 1 FROM users WHERE email = ? LIMIT 1', [$em])->fetch();
        };
        if (!$exists($email)) return $email;
        // Insert numeric suffix before the @ part
        $at = strpos($email, '@');
        $local = $at !== false ? substr($email, 0, $at) : $email;
        $domain = $at !== false ? substr($email, $at) : '';
        for ($i = 1; $i <= 50; $i++) {
            $candidate = $local . "+$i" . $domain;
            if (!$exists($candidate)) return $candidate;
        }
        // Last resort: add random hex
        $candidate = $local . '+' . bin2hex(random_bytes(3)) . $domain;
        return $candidate;
    }

    // Create a recipient user and optional recipient profile. Returns new user_id
    private function createRecipient(array $data): int
    {
        // Prefer explicit name; if missing, fall back to contact_person; else organization_name
        $name = $data['name'] ?? ($data['contact_person'] ?? ($data['organization_name'] ?? 'Recipient'));
        $organization = $data['organization_name'] ?? ($data['agency_name'] ?? null);
        $contactNumber = $data['contact_number'] ?? null;
        $address = $data['address'] ?? null;

        // Placeholder email: use organization name sans spaces if no email provided
        $email = $data['email'] ?? $this->generatePlaceholderEmail($organization);
        $email = $this->ensureUniqueEmail($email);
        // Use a fixed default password for imported recipients per requirements
        $plain = 'recipient123';
        $hash = password_hash($plain, PASSWORD_DEFAULT);

        $this->db->query(
            "INSERT INTO users (name, email, password_hash, role, organization_name, contact_number, address, status) VALUES (?,?,?,?,?,?,?, 'approved')",
            [
                $name,
                $email,
                $hash,
                'recipient',
                $organization,
                $contactNumber,
                $address
            ]
        );
        $userId = (int)$this->db->lastInsertId();

        // Flag for required password change on first login (if column exists)
        try {
            $this->db->query('UPDATE users SET must_change_password = 1 WHERE user_id = ?', [$userId]);
        } catch (Exception $e) {
            // Column may not exist yet; ignore
        }

        // Insert recipient profile (recipient-specific fields only; shared fields live in users)
        $agencyType = $data['agency_type'] ?? null;
        $position = $data['position_designation'] ?? null;
        $totalResidents = isset($data['total_residents']) && $data['total_residents'] !== '' ? (int)$data['total_residents'] : null;
        $ageGroup = $data['age_group'] ?? null;
        $maleCount = isset($data['male_count']) && $data['male_count'] !== '' ? (int)$data['male_count'] : null;
        $femaleCount = isset($data['female_count']) && $data['female_count'] !== '' ? (int)$data['female_count'] : null;
        $externalId = $data['external_id'] ?? null;
        $this->db->query(
            "INSERT INTO recipient_profiles (user_id, agency_type, position_designation, total_residents, age_group, male_count, female_count, external_id) VALUES (?,?,?,?,?,?,?,?)",
            [$userId, $agencyType, $position, $totalResidents, $ageGroup, $maleCount, $femaleCount, $externalId]
        );

        return $userId;
    }

    // Create a recipient contact row
    private function createRecipientContact(int $userId, array $contact, bool $isPrimary = false): void
    {
        $name = $contact['contact_person'] ?? ($contact['name'] ?? null);
        $position = $contact['position_designation'] ?? null;
        $number = $contact['contact_number'] ?? null;
        $email = $contact['email'] ?? null;
        $this->db->query(
            "INSERT INTO recipient_contacts (user_id, contact_name, position_designation, contact_number, email, is_primary) VALUES (?,?,?,?,?,?)",
            [$userId, $name, $position, $number, $email, $isPrimary ? 1 : 0]
        );
    }

    // Canonicalize headers: lowercase and strip spaces, dots, underscores and hyphens
    private function canonKeys(array $row): array
    {
        $out = [];
        foreach ($row as $k => $v) {
            $ck = strtolower(trim((string)$k));
            $ck = preg_replace('/[\s._-]+/','', $ck); // remove spaces, dots, underscores, hyphens
            $out[$ck] = $v;
        }
        return $out;
    }

    // Bulk import recipients. Returns summary
    public function importRecipients(array $rows): array
    {
        if (empty($rows)) { return ['inserted' => 0, 'errors' => []]; }
        $inserted = 0; // number of organizations created
        $errors = [];
        // Step 1: normalize rows and group by organization
        $groups = [];
        foreach ($rows as $idx => $row) {
            try {
                $r = $this->canonKeys($row);
                $data = [
                    'organization_name' => $r['organizationname']
                        ?? ($r['agencyname'] ?? ($r['recipientname'] ?? ($r['nameofbeneficiary'] ?? ($r['beneficiaryname'] ?? null)))),
                    'agency_type' => $r['agencytype'] ?? ($r['advocacy'] ?? null),
                    'contact_person' => $r['contactperson'] ?? ($r['contact'] ?? null),
                    'contact_number' => $r['contactnumber'] ?? ($r['phone'] ?? ($r['contactno'] ?? null)),
                    'address' => $r['address'] ?? ($r['location'] ?? ($r['addresss'] ?? null)),
                    'name' => $r['name'] ?? null,
                    'email' => $r['email'] ?? ($r['emailaddress'] ?? null),
                    'position_designation' => $r['position/designation'] ?? ($r['positiondesignation'] ?? ($r['position'] ?? null)),
                    'total_residents' => $r['totalresidents'] ?? null,
                    'age_group' => $r['agegroup'] ?? null,
                    'male_count' => $r['noofmale'] ?? ($r['male'] ?? null),
                    'female_count' => $r['nooffemale'] ?? ($r['female'] ?? null),
                    'external_id' => $r['id'] ?? ($r['externalid'] ?? null),
                ];
                if (empty($data['organization_name']) && empty($data['name'])) {
                    throw new Exception('Missing name/organization');
                }
                $org = trim((string)($data['organization_name'] ?? ''));
                if (!$org) { $org = trim((string)($data['name'] ?? '')); }
                $groups[$org] = $groups[$org] ?? [];
                $groups[$org][] = $data;
            } catch (Exception $e) {
                $errors[] = ['row' => $idx + 1, 'error' => $e->getMessage()];
            }
        }

        // Step 2: create one user per group and multiple contacts per org
        $this->db->beginTransaction();
        try {
            foreach ($groups as $orgName => $items) {
                try {
                    // Try to find existing recipient with same organization
                    $existing = $this->db->query(
                        "SELECT user_id FROM users WHERE role = 'recipient' AND organization_name = ? LIMIT 1",
                        [$orgName]
                    )->fetch();
                    $userId = 0;
                    if ($existing) {
                        $userId = (int)$existing['user_id'];
                    } else {
                        // Use first item to create the recipient account
                        $base = $items[0];
                        $base['organization_name'] = $orgName;
                        // Prefer using contact person as account holder name if name missing
                        if (empty($base['name']) && !empty($base['contact_person'])) {
                            $base['name'] = $base['contact_person'];
                        }
                        $userId = $this->createRecipient($base);
                        $inserted++;
                    }

                    // Insert contacts for all items in the group; mark first with email/number as primary
                    $primarySet = false;
                    foreach ($items as $i => $it) {
                        $isPrimary = false;
                        if (!$primarySet && (!empty($it['email']) || !empty($it['contact_number']))) { $isPrimary = true; $primarySet = true; }
                        $this->createRecipientContact($userId, $it, $isPrimary);
                    }
                } catch (Exception $e) {
                    $errors[] = ['group' => $orgName, 'error' => $e->getMessage()];
                }
            }
            $this->db->commit();
        } catch (Exception $e) {
            if ($this->db->inTransaction()) { $this->db->rollBack(); }
            throw $e;
        }
        return ['inserted' => $inserted, 'errors' => $errors];
    }

    // Create a donor user and optional donor profile. Returns new user_id
    private function createDonor(array $data): int
    {
        $organization = $data['organization_name'] ?? ($data['donor_name'] ?? ($data['company'] ?? null));
        $name = $data['name'] ?? ($data['contact_person'] ?? ($organization ?? 'Donor'));
        $contactNumber = $data['contact_number'] ?? null;
        $address = $data['address'] ?? null;
        $email = $data['email'] ?? $this->generatePlaceholderEmail($organization);
        $email = $this->ensureUniqueEmail($email);

        $plain = bin2hex(random_bytes(6));
        $hash = password_hash($plain, PASSWORD_DEFAULT);

        $this->db->query(
            "INSERT INTO users (name, email, password_hash, role, organization_name, contact_number, address, status) VALUES (?,?,?,?,?,?,?, 'approved')",
            [ $name, $email, $hash, 'donor', $organization, $contactNumber, $address ]
        );
        $userId = (int)$this->db->lastInsertId();

        // Flag for required password change on first login (if column exists)
        try {
            $this->db->query('UPDATE users SET must_change_password = 1 WHERE user_id = ?', [$userId]);
        } catch (Exception $e) {
            // Column may not exist; ignore
        }

        // donor_profiles: keep only donor_category and notes; shared fields live in users
        $donorCategory = $data['donor_category'] ?? ($data['type'] ?? null);
        $notes = $data['notes'] ?? null;
        $this->db->query(
            "INSERT INTO donor_profiles (user_id, donor_category, notes) VALUES (?,?,?)",
            [$userId, $donorCategory, $notes]
        );

        return $userId;
    }

    // Bulk import donors. Returns summary
    public function importDonors(array $rows): array
    {
        if (empty($rows)) { return ['inserted' => 0, 'errors' => []]; }
        $inserted = 0; $errors = [];
        $this->db->beginTransaction();
        try {
            foreach ($rows as $idx => $row) {
                try {
                    $r = $this->canonKeys($row);
                    $data = [
                        'organization_name' => $r['organizationname'] ?? ($r['donorname'] ?? ($r['company'] ?? ($r['nameofdonor'] ?? null))),
                        'name' => $r['name'] ?? null,
                        'contact_person' => $r['contactperson'] ?? ($r['contact'] ?? null),
                        'contact_number' => $r['contactnumber'] ?? ($r['phone'] ?? ($r['contactno'] ?? null)),
                        'address' => $r['address'] ?? ($r['location'] ?? null),
                        'email' => $r['email'] ?? ($r['emailaddress'] ?? null),
                        'donor_category' => $r['donorcategory'] ?? ($r['type'] ?? null),
                        'notes' => $r['notes'] ?? null,
                    ];
                    if (empty($data['organization_name']) && empty($data['name'])) {
                        throw new Exception('Missing donor name/organization');
                    }
                    $this->createDonor($data);
                    $inserted++;
                } catch (Exception $e) {
                    $errors[] = ['row' => $idx + 1, 'error' => $e->getMessage()];
                }
            }
            $this->db->commit();
        } catch (Exception $e) {
            if ($this->db->inTransaction()) { $this->db->rollBack(); }
            throw $e;
        }
        return ['inserted' => $inserted, 'errors' => $errors];
    }
}
