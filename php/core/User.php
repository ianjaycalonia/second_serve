<?php
require_once __DIR__ . '/../includes/config.php';

class User
{
    private Database $db;
    private ?string $beneficiaryCategoryPk = null;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    private function getBeneficiaryCategoryPkColumn(): string
    {
        if ($this->beneficiaryCategoryPk !== null) {
            return $this->beneficiaryCategoryPk;
        }
        try {
            $row = $this->db->query('SHOW COLUMNS FROM beneficiary_categories LIKE "beneficiary_category_id"')->fetch();
            if ($row) {
                $this->beneficiaryCategoryPk = 'beneficiary_category_id';
                return $this->beneficiaryCategoryPk;
            }
        } catch (Throwable $e) {
            // ignore; fallback handled below
        }
        $this->beneficiaryCategoryPk = 'id';
        return $this->beneficiaryCategoryPk;
    }

    // Normalize a free-form tags string/array into a canonical, unique, comma-separated string
    private function normalizeTags($tags): string
    {
        $arr = [];
        if (is_string($tags)) {
            $arr = preg_split('/[,;]+/', strtolower($tags));
        } elseif (is_array($tags)) {
            $arr = array_map(function($t){ return strtolower((string)$t); }, $tags);
        }
        $norm = [];
        foreach ($arr as $t) {
            $t = trim($t);
            if ($t === '') continue;
            // replace spaces and slashes with hyphens, collapse repeats
            $t = preg_replace('/[\s\/]+/', '-', $t);
            $t = preg_replace('/-+/', '-', $t);
            $norm[$t] = true;
        }
        return implode(',', array_keys($norm));
    }

    // Derive simple tags from recipient data as a safety net (not authoritative)
    private function deriveRecipientTags(array $data): string
    {
        $tags = [];
        // 1) First tag: organization type (if present)
        $ot = $data['organization_type'] ?? null;
        if (is_string($ot) && trim($ot) !== '') {
            $tags[] = $ot; // keep original type as first tag
            if (strcasecmp(trim($ot), 'mixed') === 0) {
                // Special rule: mixed implies both infant and elderly coverage
                $tags[] = 'infant';
                $tags[] = 'elderly';
            }
        }

        // 2) Age group: compute the lowest age found and tag accordingly
        $ag = $data['age_group'] ?? null;
        if (is_string($ag) && trim($ag) !== '') {
            // Extract all integers from the string (handles formats like "0-3", "3 to 7", "5, 12", etc.)
            if (preg_match_all('/\d+/', $ag, $mNums) && !empty($mNums[0])) {
                $nums = array_map('intval', $mNums[0]);
                $minAge = min($nums);
                if ($minAge <= 3) { $tags[] = 'infant'; }
                if ($minAge >= 40) { $tags[] = 'elderly'; }
            }
        }

        // 3) Gender composition rules
        $m = isset($data['male_count']) ? (int)$data['male_count'] : null;
        $f = isset($data['female_count']) ? (int)$data['female_count'] : null;
        if ($m !== null && $m === 0) { $tags[] = 'all girls'; }
        if ($f !== null && $f === 0) { $tags[] = 'all boys'; }

        // 4) Merge any user-supplied tags (optional), then normalize
        if (!empty($data['tags'])) {
            if (is_string($data['tags'])) { $tags = array_merge($tags, preg_split('/[,;]+/', $data['tags'])); }
            elseif (is_array($data['tags'])) { $tags = array_merge($tags, $data['tags']); }
        }
        return $this->normalizeTags($tags);
    }

    // Fetch a single user profile by user_id, merging role-specific profile fields
    public function getProfile(int $userId): array
    {
        $u = $this->db->query(
            "SELECT user_id, name, email, role, status, created_at, last_login FROM users WHERE user_id = ?",
            [$userId]
        )->fetch();
        if (!$u) { throw new Exception('User not found'); }
        $profile = [];
        if ($u['role'] === 'recipient') {
            // Read normalized profile and join primary contact directly (and map category)
            $bcPk = $this->getBeneficiaryCategoryPkColumn();
            $sql = "SELECT rp.organization_name, rp.beneficiary_category_id, bc.name AS beneficiary_category,
                           rp.advocacy, rp.address, rp.total_residents, rp.age_group, rp.male_count, rp.female_count, rp.external_id,
                           pc.position_designation, pc.contact_number, pc.email
                    FROM recipient_profiles rp
                    LEFT JOIN beneficiary_categories bc ON bc.`$bcPk` = rp.beneficiary_category_id
                    LEFT JOIN recipient_contacts pc ON pc.id = rp.primary_contact_id
                    WHERE rp.user_id = ?";
            $p = $this->db->query($sql, [$userId])->fetch();
            $profile = $p ?: [];
        } elseif ($u['role'] === 'donor') {
            // Expose donor_category_id; UI may map it to a name via donor_categories table
            $p = $this->db->query("SELECT organization_name, donor_category_id, contact_number, address, notes FROM donor_profiles WHERE user_id = ?", [$userId])->fetch();
            $profile = $p ?: [];
        } elseif ($u['role'] === 'admin') {
            $p = $this->db->query("SELECT organization_name, contact_number, address FROM admin_profiles WHERE user_id = ?", [$userId])->fetch();
            $profile = $p ?: [];
        }
        return array_merge($u, $profile);
    }

    // Update editable profile fields for a user (self-service)
    public function updateProfile(int $userId, array $data): void
    {
        $u = $this->db->query('SELECT role FROM users WHERE user_id = ?', [$userId])->fetch();
        if (!$u) throw new Exception('User not found');
        // Always allow updating name on users
        if (array_key_exists('name', $data)) {
            $this->db->query('UPDATE users SET name = ? WHERE user_id = ?', [$data['name'], $userId]);
        }
        // Allow updating email with validation and uniqueness
        if (array_key_exists('email', $data) && $data['email'] !== null && $data['email'] !== '') {
            $email = (string)$data['email'];
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new Exception('Invalid email format');
            }
            $exists = $this->db->query('SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1', [$email, $userId])->fetch();
            if ($exists) {
                throw new Exception('Email already in use');
            }
            $this->db->query('UPDATE users SET email = ? WHERE user_id = ?', [$email, $userId]);
        }
        $role = $u['role'];
        if ($role === 'recipient') {
            // Upsert recipient_profiles (no contact fields here; contacts are normalized into recipient_contacts)
            $this->db->query('INSERT IGNORE INTO recipient_profiles (user_id) VALUES (?)', [$userId]);
            $fields = [];$params=[];
            foreach (['organization_name','beneficiary_category_id','advocacy','address','total_residents','age_group','male_count','female_count','external_id'] as $col){
                if (array_key_exists($col,$data)){ $fields[] = "$col = ?"; $params[] = $data[$col]; }
            }
            if ($fields){ $params[]=$userId; $this->db->query('UPDATE recipient_profiles SET '.implode(', ',$fields).' WHERE user_id = ?', $params); }

            // Handle primary contact updates if provided
            $contactUpdates = [];
            foreach (['contact_person','position_designation','contact_number','email'] as $k) {
                if (array_key_exists($k, $data) && $data[$k] !== null) {
                    $contactUpdates[$k] = $data[$k];
                }
            }
            if ($contactUpdates) {
                $row = $this->db->query('SELECT primary_contact_id FROM recipient_profiles WHERE user_id = ?', [$userId])->fetch();
                $pcId = $row && !empty($row['primary_contact_id']) ? (int)$row['primary_contact_id'] : null;
                if ($pcId) {
                    // Update existing primary contact
                    $cFields=[];$cParams=[];
                    if (isset($contactUpdates['contact_person'])){ $cFields[]='contact_name = ?'; $cParams[]=$contactUpdates['contact_person']; }
                    if (isset($contactUpdates['position_designation'])){ $cFields[]='position_designation = ?'; $cParams[]=$contactUpdates['position_designation']; }
                    if (isset($contactUpdates['contact_number'])){ $cFields[]='contact_number = ?'; $cParams[]=$contactUpdates['contact_number']; }
                    if (isset($contactUpdates['email'])){ $cFields[]='email = ?'; $cParams[]=$contactUpdates['email']; }
                    if ($cFields){ $cParams[]=$pcId; $this->db->query('UPDATE recipient_contacts SET '.implode(', ',$cFields).' WHERE id = ?', $cParams); }
                } else {
                    // Create new primary contact and set as primary
                    $name = $contactUpdates['contact_person'] ?? ($data['name'] ?? null);
                    $position = $contactUpdates['position_designation'] ?? null;
                    $number = $contactUpdates['contact_number'] ?? null;
                    $email = $contactUpdates['email'] ?? null;
                    $this->db->query(
                        'INSERT INTO recipient_contacts (user_id, contact_name, position_designation, contact_number, email, is_primary) VALUES (?,?,?,?,?,1)',
                        [$userId, $name, $position, $number, $email]
                    );
                    $newId = (int)$this->db->lastInsertId();
                    $this->db->query('UPDATE recipient_profiles SET primary_contact_id = ? WHERE user_id = ?', [$newId, $userId]);
                }
            }
        } elseif ($role === 'donor') {
            $this->db->query('INSERT IGNORE INTO donor_profiles (user_id) VALUES (?)', [$userId]);
            $fields=[];$params=[];
            // Map legacy key donor_category -> donor_category_id if present
            if (array_key_exists('donor_category', $data) && !array_key_exists('donor_category_id', $data)) {
                $data['donor_category_id'] = $data['donor_category'];
            }
            foreach (['organization_name','donor_category_id','contact_number','address','notes'] as $col){ if(array_key_exists($col,$data)){ $fields[]="$col = ?"; $params[]=$data[$col]; } }
            if ($fields){ $params[]=$userId; $this->db->query('UPDATE donor_profiles SET '.implode(', ',$fields).' WHERE user_id = ?', $params); }
        } elseif ($role === 'admin') {
            $this->db->query('INSERT IGNORE INTO admin_profiles (user_id) VALUES (?)', [$userId]);
            $fields=[];$params=[];
            foreach (['organization_name','contact_number','address'] as $col){ if(array_key_exists($col,$data)){ $fields[]="$col = ?"; $params[]=$data[$col]; } }
            if ($fields){ $params[]=$userId; $this->db->query('UPDATE admin_profiles SET '.implode(', ',$fields).' WHERE user_id = ?', $params); }
        }
    }

    // Admin: list users with optional filters
    public function listUsers(array $filters = []): array
    {
        $where = [];$params=[];
        if (!empty($filters['status'])){ $status = $filters['status']==='active'?'approved':$filters['status']; $where[]='u.status = ?'; $params[]=$status; }
        if (!empty($filters['role'])){ $where[]='u.role = ?'; $params[]=$filters['role']; }
        $role = $filters['role'] ?? null;
        if ($role === 'recipient') {
            // Join recipient_profiles with primary contact and category lookup; expose tags and age_group
            $bcPk = $this->getBeneficiaryCategoryPkColumn();
            $sql = "SELECT u.user_id, u.name, u.email, u.status,
                           rp.organization_name, rp.beneficiary_category_id, bc.name AS beneficiary_category,
                           rp.advocacy, rp.address, rp.total_residents, rp.age_group, rp.male_count, rp.female_count,
                           rp.external_id, rp.tags,
                           pc.position_designation, pc.contact_number
                    FROM users u
                    LEFT JOIN recipient_profiles rp ON rp.user_id = u.user_id
                    LEFT JOIN beneficiary_categories bc ON bc.`$bcPk` = rp.beneficiary_category_id
                    LEFT JOIN recipient_contacts pc ON pc.id = rp.primary_contact_id";
            if (!empty($filters['q'])){ $where[]='(u.name LIKE ? OR u.email LIKE ? OR rp.organization_name LIKE ?)'; $q='%'.$filters['q'].'%'; array_push($params,$q,$q,$q); }
        } elseif ($role === 'donor') {
            $sql = "SELECT u.user_id, u.name, u.email, u.role, u.status, u.created_at,
                           dp.organization_name, dp.donor_category_id,
                           dc.name AS donor_category,
                           dp.contact_number, dp.address
                    FROM users u
                    LEFT JOIN donor_profiles dp ON dp.user_id = u.user_id
                    LEFT JOIN donor_categories dc ON dc.id = dp.donor_category_id";
            if (!empty($filters['q'])){ $where[]='(u.name LIKE ? OR u.email LIKE ? OR dp.organization_name LIKE ?)'; $q='%'.$filters['q'].'%'; array_push($params,$q,$q,$q); }
        } elseif ($role === 'admin') {
            $sql = "SELECT u.user_id, u.name, u.email, u.role, u.status, u.created_at,
                           ap.organization_name, ap.contact_number, ap.address
                    FROM users u
                    LEFT JOIN admin_profiles ap ON ap.user_id = u.user_id";
            if (!empty($filters['q'])){ $where[]='(u.name LIKE ? OR u.email LIKE ? OR ap.organization_name LIKE ?)'; $q='%'.$filters['q'].'%'; array_push($params,$q,$q,$q); }
        } else {
            $sql = "SELECT u.user_id, u.name, u.email, u.role, u.status, u.created_at FROM users u";
            if (!empty($filters['q'])){ $where[]='(u.name LIKE ? OR u.email LIKE ?)'; $q='%'.$filters['q'].'%'; array_push($params,$q,$q); }
        }
        if ($where){ $sql .= ' WHERE '.implode(' AND ',$where); }
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

    // Admin: set arbitrary user status (e.g., inactive) without removing visibility
    public function setStatus(int $userId, string $status): void
    {
        $allowed = ['approved','pending','rejected','inactive'];
        $s = strtolower(trim($status));
        if (!in_array($s, $allowed, true)) {
            throw new Exception('Invalid status: ' . $status);
        }
        $this->db->query('UPDATE users SET status = ? WHERE user_id = ?', [$s, $userId]);
    }

    public function deleteUser(int $userId): void
    {
        if ($userId <= 0) {
            throw new Exception('Invalid user_id');
        }
        $row = $this->db->query('SELECT user_id, role FROM users WHERE user_id = ? LIMIT 1', [$userId])->fetch();
        if (!$row) {
            throw new Exception('User not found');
        }
        $role = strtolower((string)($row['role'] ?? ''));
        if ($role === 'admin') {
            $count = $this->db->query('SELECT COUNT(*) AS c FROM users WHERE role = "admin" AND user_id <> ?', [$userId])->fetch();
            $remaining = (int)($count['c'] ?? 0);
            if ($remaining <= 0) {
                throw new Exception('Cannot delete the last admin account');
            }
        }
        $this->db->beginTransaction();
        try {
            $this->db->query('DELETE FROM users WHERE user_id = ?', [$userId]);
            $this->db->commit();
        } catch (Exception $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
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
    private function createRecipient(array $data, ?string &$plainPassword = null): int
    {
        // Prefer explicit name; if missing, fall back to contact_person; else organization_name
        $name = $data['name'] ?? ($data['contact_person'] ?? ($data['organization_name'] ?? 'Recipient'));
        $organization = $data['organization_name'] ?? ($data['agency_name'] ?? null);
        $organizationType = $data['organization_type'] ?? ($data['agency_type'] ?? null); // used for tags derivation only
        $contactNumber = $data['contact_number'] ?? null;
        $address = $data['address'] ?? null;
        $advocacy = $data['advocacy'] ?? null;

        // Placeholder email: use organization name sans spaces if no email provided
        if (isset($data['email']) && trim((string)$data['email']) !== '') {
            $email = trim((string)$data['email']);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new Exception('Invalid email format');
            }
            $exists = $this->db->query('SELECT 1 FROM users WHERE email = ? LIMIT 1', [$email])->fetch();
            if ($exists) {
                throw new Exception('Email already in use');
            }
        } else {
            $email = $this->generatePlaceholderEmail($organization);
            $email = $this->ensureUniqueEmail($email);
        }
        // Use a fixed default password for imported recipients per requirements
        $plain = 'recipient123';
        $hash = password_hash($plain, PASSWORD_DEFAULT);
        $plainPassword = $plain;

        // Compute next user_id explicitly (schema may not have AUTO_INCREMENT)
        $row = $this->db->query('SELECT COALESCE(MAX(user_id),0)+1 AS next_id FROM users')->fetch();
        $userId = (int)($row['next_id'] ?? 1);
        $this->db->query(
            "INSERT INTO users (user_id, name, email, password_hash, role, status) VALUES (?,?,?,?,?, 'approved')",
            [ $userId, $name, $email, $hash, 'recipient' ]
        );

        // Flag for required password change on first login (if column exists)
        try {
            $this->db->query('UPDATE users SET must_change_password = 1 WHERE user_id = ?', [$userId]);
        } catch (Exception $e) {
            // Column may not exist yet; ignore
        }

        // Insert recipient profile (no contact fields here)
        $position = $data['position_designation'] ?? null;
        $totalResidents = isset($data['total_residents']) && $data['total_residents'] !== '' ? (int)$data['total_residents'] : null;
        $ageGroup = $data['age_group'] ?? null;
        $maleCount = isset($data['male_count']) && $data['male_count'] !== '' ? (int)$data['male_count'] : null;
        $femaleCount = isset($data['female_count']) && $data['female_count'] !== '' ? (int)$data['female_count'] : null;
        $externalId = $data['external_id'] ?? null;
        $beneficiaryCategoryId = isset($data['beneficiary_category_id']) && $data['beneficiary_category_id'] !== ''
            ? (int)$data['beneficiary_category_id']
            : null;
        // Derive tags automatically (behind-the-scenes; editable later by admin)
        $derivedTags = $this->deriveRecipientTags([
            'organization_type' => $organizationType,
            'age_group' => $ageGroup,
            'male_count' => $maleCount,
            'female_count' => $femaleCount,
            'tags' => $data['tags'] ?? null,
        ]);
        $this->db->query(
            "INSERT INTO recipient_profiles (user_id, organization_name, beneficiary_category_id, tags, advocacy, address, total_residents, age_group, male_count, female_count, external_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [$userId, $organization, $beneficiaryCategoryId, $derivedTags, $advocacy, $address, $totalResidents, $ageGroup, $maleCount, $femaleCount, $externalId]
        );

        // Create a primary contact if contact info is provided and set as primary
        if (!empty($data['contact_person']) || !empty($contactNumber) || !empty($data['email']) || !empty($position)) {
            $this->db->query(
                'INSERT INTO recipient_contacts (user_id, contact_name, position_designation, contact_number, email, is_primary) VALUES (?,?,?,?,?,1)',
                [$userId, ($data['contact_person'] ?? ($data['name'] ?? null)), $position, $contactNumber, ($data['email'] ?? null)]
            );
            $cid = (int)$this->db->lastInsertId();
            $this->db->query('UPDATE recipient_profiles SET primary_contact_id = ? WHERE user_id = ?', [$cid, $userId]);
        }

        return $userId;
    }

    public function adminCreateDonor(array $data): array
    {
        $org = isset($data['organization_name']) ? trim((string)$data['organization_name']) : '';
        $name = isset($data['name']) ? trim((string)$data['name']) : '';
        if ($org === '' && $name === '') {
            throw new Exception('organization_name or name is required');
        }
        if (isset($data['donor_category_id']) && !isset($data['donor_category'])) {
            $data['donor_category'] = $data['donor_category_id'];
        }
        $plain = null;
        $userId = $this->createDonor($data, $plain);
        return [
            'user_id' => $userId,
            'temporary_password' => $plain,
        ];
    }

    public function adminCreateRecipient(array $data): array
    {
        $org = isset($data['organization_name']) ? trim((string)$data['organization_name']) : '';
        $name = isset($data['name']) ? trim((string)$data['name']) : '';
        if ($org === '' && $name === '') {
            throw new Exception('organization_name or name is required');
        }
        $plain = null;
        $userId = $this->createRecipient($data, $plain);
        return [
            'user_id' => $userId,
            'temporary_password' => $plain,
        ];
    }

    // Create a recipient contact row
    private function createRecipientContact(int $userId, array $contact, bool $isPrimary = false): int
    {
        $name = $contact['contact_person'] ?? ($contact['name'] ?? null);
        $position = $contact['position_designation'] ?? null;
        $number = $contact['contact_number'] ?? null;
        $email = $contact['email'] ?? null;
        $this->db->query(
            "INSERT INTO recipient_contacts (user_id, contact_name, position_designation, contact_number, email, is_primary) VALUES (?,?,?,?,?,?)",
            [$userId, $name, $position, $number, $email, $isPrimary ? 1 : 0]
        );
        return (int)$this->db->lastInsertId();
    }

    // Canonicalize headers: lowercase and strip spaces, dots, underscores and hyphens
    private function canonKeys(array $row): array
    {
        $out = [];
        foreach ($row as $k => $v) {
            $ck = strtolower(trim((string)$k));
            $ck = preg_replace('/[\s._-]+/','', $ck); // remove spaces, dots, underscores, hyphens
            // Decode HTML entities that may have been introduced by sanitize() upstream
            if (is_string($v)) {
                $v = html_entity_decode($v, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            }
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

        // Preload beneficiary categories to map imported "type" values to lookup IDs
        $categoryRows = [];
        $categoryIdField = 'beneficiary_category_id';
        try {
            $categoryRows = $this->db->query('SELECT beneficiary_category_id AS category_id_lookup, name FROM beneficiary_categories')->fetchAll();
        } catch (Throwable $e) {
            // Fallback for legacy schema where primary key column is still named `id`
            $categoryIdField = 'id';
            $categoryRows = $this->db->query('SELECT id AS category_id_lookup, name FROM beneficiary_categories')->fetchAll();
        }
        $categoryExactMap = [];
        $categoryNormalizedMap = [];
        foreach ($categoryRows as $catRow) {
            if (!isset($catRow['category_id_lookup'], $catRow['name'])) {
                continue;
            }
            $nameLower = strtolower(trim((string)$catRow['name']));
            if ($nameLower === '') {
                continue;
            }
            $categoryExactMap[$nameLower] = (int)$catRow['category_id_lookup'];
            $normalized = preg_replace('/[^a-z0-9]+/', '', $nameLower);
            if ($normalized !== '') {
                $categoryNormalizedMap[$normalized] = (int)$catRow['category_id_lookup'];
            }
        }
        $resolveCategoryId = function (?string $label) use ($categoryExactMap, $categoryNormalizedMap, $categoryRows): ?int {
            if ($label === null) {
                return null;
            }
            $labelTrim = trim((string)$label);
            if ($labelTrim === '') {
                return null;
            }
            $labelLower = strtolower($labelTrim);
            if (isset($categoryExactMap[$labelLower])) {
                return $categoryExactMap[$labelLower];
            }
            $normalizedLabel = preg_replace('/[^a-z0-9]+/', '', $labelLower);
            if ($normalizedLabel !== '' && isset($categoryNormalizedMap[$normalizedLabel])) {
                return $categoryNormalizedMap[$normalizedLabel];
            }
            foreach ($categoryRows as $catRow) {
                $name = isset($catRow['name']) ? (string)$catRow['name'] : '';
                if ($name === '') {
                    continue;
                }
                if (stripos($name, $labelTrim) !== false || stripos($labelTrim, $name) !== false) {
                    return (int)$catRow['category_id_lookup'];
                }
            }
            return null;
        };
        // Step 1: normalize rows and group by organization
        $groups = [];
        foreach ($rows as $idx => $row) {
            try {
                $r = $this->canonKeys($row);
                $data = [
                    'organization_name' => $r['organizationname']
                        ?? ($r['agencyname'] ?? ($r['recipientname'] ?? ($r['nameofbeneficiary'] ?? ($r['beneficiaryname'] ?? null)))),
                    // Map incoming org type variants to organization_type
                    'organization_type' => $r['organizationtype']
                        ?? ($r['organization_type'] ?? ($r['orgtype'] ?? ($r['org_type'] ?? ($r['agencytype'] ?? ($r['advocacy'] ?? null))))),
                    'advocacy' => $r['advocacy'] ?? null,
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
                $providedCategoryId = null;
                if (isset($r['beneficiarycategoryid']) && $r['beneficiarycategoryid'] !== '') {
                    $tmpId = (int)$r['beneficiarycategoryid'];
                    if ($tmpId > 0) {
                        $providedCategoryId = $tmpId;
                    }
                } elseif (isset($r['beneficiarycategory']) && trim((string)$r['beneficiarycategory']) !== '') {
                    $providedCategoryId = $resolveCategoryId($r['beneficiarycategory']);
                }
                if ($providedCategoryId === null) {
                    $candidateLabel = $r['type'] ?? ($data['organization_type'] ?? null);
                    $providedCategoryId = $resolveCategoryId($candidateLabel);
                }
                $data['beneficiary_category_id'] = $providedCategoryId;
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
                        "SELECT u.user_id FROM users u JOIN recipient_profiles rp ON rp.user_id = u.user_id WHERE u.role = 'recipient' AND rp.organization_name = ? LIMIT 1",
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

                    $advocacyVal = null;
                    foreach ($items as $itAdv) {
                        if (isset($itAdv['advocacy']) && trim((string)$itAdv['advocacy']) !== '') {
                            $advocacyVal = trim((string)$itAdv['advocacy']);
                            break;
                        }
                    }
                    if ($advocacyVal !== null) {
                        $this->db->query('UPDATE recipient_profiles SET advocacy = ? WHERE user_id = ?', [$advocacyVal, $userId]);
                    }

                    $categoryId = null;
                    foreach ($items as $itCat) {
                        if (isset($itCat['beneficiary_category_id'])) {
                            $candidate = (int)$itCat['beneficiary_category_id'];
                            if ($candidate > 0) {
                                $categoryId = $candidate;
                                break;
                            }
                        }
                    }
                    if ($categoryId !== null) {
                        $this->db->query('UPDATE recipient_profiles SET beneficiary_category_id = ? WHERE user_id = ?', [$categoryId, $userId]);
                    }

                    // Insert contacts for all items in the group; mark first with email/number as primary
                    $primarySet = false; $primaryId = null;
                    foreach ($items as $i => $it) {
                        $isPrimary = false;
                        if (!$primarySet && (!empty($it['email']) || !empty($it['contact_number']))) { $isPrimary = true; $primarySet = true; }
                        $cid = $this->createRecipientContact($userId, $it, $isPrimary);
                        if ($isPrimary && !$primaryId) { $primaryId = $cid; }
                    }
                    if ($primaryId) { $this->db->query('UPDATE recipient_profiles SET primary_contact_id = ? WHERE user_id = ?', [$primaryId, $userId]); }
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
    private function createDonor(array $data, ?string &$plainPassword = null): int
    {
        $organization = $data['organization_name'] ?? ($data['donor_name'] ?? ($data['company'] ?? null));
        $name = $data['name'] ?? ($data['contact_person'] ?? ($organization ?? 'Donor'));
        $contactNumber = $data['contact_number'] ?? null;
        $address = $data['address'] ?? null;
        if (isset($data['email']) && trim((string)$data['email']) !== '') {
            $email = trim((string)$data['email']);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new Exception('Invalid email format');
            }
            $exists = $this->db->query('SELECT 1 FROM users WHERE email = ? LIMIT 1', [$email])->fetch();
            if ($exists) {
                throw new Exception('Email already in use');
            }
        } else {
            $email = $this->generatePlaceholderEmail($organization);
            $email = $this->ensureUniqueEmail($email);
        }

        $plain = 'donor123';
        $hash = password_hash($plain, PASSWORD_DEFAULT);
        $plainPassword = $plain;

        // Compute next user_id explicitly (schema may not have AUTO_INCREMENT)
        $row = $this->db->query('SELECT COALESCE(MAX(user_id),0)+1 AS next_id FROM users')->fetch();
        $userId = (int)($row['next_id'] ?? 1);
        $this->db->query(
            "INSERT INTO users (user_id, name, email, password_hash, role, status) VALUES (?,?,?,?,?, 'approved')",
            [ $userId, $name, $email, $hash, 'donor' ]
        );

        // Flag for required password change on first login (if column exists)
        try {
            $this->db->query('UPDATE users SET must_change_password = 1 WHERE user_id = ?', [$userId]);
        } catch (Exception $e) {
            // Column may not exist; ignore
        }

        // donor_profiles
        $donorCategory = $data['donor_category'] ?? ($data['type'] ?? null);
        $donorCategoryId = null;
        if (isset($data['donor_category_id']) && $data['donor_category_id'] !== '') {
            $donorCategoryId = (int)$data['donor_category_id'];
        } elseif ($donorCategory !== null && $donorCategory !== '') {
            if (is_numeric($donorCategory)) {
                $donorCategoryId = (int)$donorCategory;
            } else {
                try {
                    $catRow = $this->db->query('SELECT id FROM donor_categories WHERE name = ? LIMIT 1', [$donorCategory])->fetch();
                    if ($catRow && isset($catRow['id'])) {
                        $donorCategoryId = (int)$catRow['id'];
                    }
                } catch (Exception $e) {
                    // ignore lookup failures and default to null
                }
            }
        }
        $notes = $data['notes'] ?? null;
        $this->db->query(
            "INSERT INTO donor_profiles (user_id, organization_name, donor_category_id, contact_number, address, notes) VALUES (?,?,?,?,?,?)",
            [$userId, $organization, $donorCategoryId, $contactNumber, $address, $notes]
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

                    $orgName = isset($data['organization_name']) ? trim((string)$data['organization_name']) : '';
                    $personName = isset($data['name']) ? trim((string)$data['name']) : '';
                    $email = isset($data['email']) ? trim((string)$data['email']) : '';

                    if ($orgName === '' && $personName === '') {
                        throw new Exception('Missing donor name/organization');
                    }

                    // If an existing donor matches by email or organization name, skip creating a duplicate
                    $existingUser = null;
                    if ($email !== '') {
                        $existingUser = $this->db->query(
                            'SELECT u.user_id FROM users u WHERE u.role = ? AND u.email = ? LIMIT 1',
                            ['donor', $email]
                        )->fetch();
                    }
                    if (!$existingUser && $orgName !== '') {
                        $existingUser = $this->db->query(
                            'SELECT u.user_id FROM users u JOIN donor_profiles dp ON dp.user_id = u.user_id WHERE u.role = ? AND dp.organization_name = ? LIMIT 1',
                            ['donor', $orgName]
                        )->fetch();
                    }
                    if ($existingUser) {
                        // Duplicate donor; treat as a no-op for import (skip without error)
                        continue;
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
