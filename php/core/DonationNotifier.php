<?php
/**
 * DonationNotifier centralizes notification emission for donation status changes.
 */
class DonationNotifier {
    private Database $db;

    public function __construct() {
        $this->db = Database::getInstance();
    }

    /**
     * Notify for a single donation's status change
     * @param int $donationId
     * @param string $newStatus
     * @param array $context Optional context: ['actor_role' => 'admin'|'donor', 'reason' => string|null]
     */
    public function notifyDonationStatus(int $donationId, string $newStatus, array $context = []): void {
        $row = $this->db->query(
            "SELECT d.donation_id AS id, d.product_name AS name, d.donor_id, d.batch_id, u.name AS donor_name, u.organization_name
             FROM donations d JOIN users u ON u.user_id = d.donor_id WHERE d.donation_id = ?",
            [$donationId]
        )->fetch();
        if (!$row) return;

        $notif = new Notification();
        $donorId = (int)($row['donor_id'] ?? 0);
        $donationName = $row['name'] ?? ('#' . $donationId);
        $actor = strtolower((string)($context['actor_role'] ?? ''));
        $reason = isset($context['reason']) ? trim((string)$context['reason']) : '';

        // Cancellation: special routing and message
        if (strcasecmp($newStatus, 'Cancelled') === 0) {
            if ($actor === 'admin') {
                // Notify donor
                if ($donorId > 0) {
                    $msg = 'Your donation "' . $donationName . '" was cancelled by admin' . ($reason !== '' ? (': ' . $reason) : '');
                    $notif->create([
                        'user_id' => $donorId,
                        'type' => 'donation_cancelled',
                        'reference_type' => 'donation',
                        'reference_id' => (int)$donationId,
                        'message' => $msg,
                    ]);
                }
            } else {
                // Actor is donor (or unknown): notify all approved admins
                $admins = $this->db->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll();
                if ($admins) {
                    $donorDisplay = '';
                    if (!empty($row['organization_name'])) { $donorDisplay = $row['organization_name']; }
                    else if (!empty($row['donor_name'])) { $donorDisplay = $row['donor_name']; }
                    foreach ($admins as $admin) {
                        $msg = ($donorDisplay ? ($donorDisplay . ' ') : '') . 'cancelled donation "' . $donationName . '"' . ($reason !== '' ? (': ' . $reason) : '');
                        $notif->create([
                            'user_id' => (int)$admin['user_id'],
                            'type' => 'donation_cancelled',
                            'reference_type' => 'donation',
                            'reference_id' => (int)$donationId,
                            'message' => $msg,
                        ]);
                    }
                }
            }
            return;
        }

        // Generic status update -> notify donor
        if ($donorId > 0) {
            $msg = 'Donation "' . $donationName . '" status updated to ' . $newStatus;
            if ($reason !== '') { $msg .= '. Reason: ' . $reason; }
            $notif->create([
                'user_id' => $donorId,
                'type' => 'status_updated',
                'reference_type' => 'donation',
                'reference_id' => (int)$donationId,
                'message' => $msg,
            ]);
        }
    }

    /**
     * Notify for a batch status change (not cancellation; cancellation is per-item in current flows)
     * @param string $batchId UUID
     * @param string $newStatus
     * @param array $context Optional: ['reason' => string|null]
     */
    public function notifyBatchStatus(string $batchId, string $newStatus, array $context = []): void {
        $rows = $this->db->query(
            "SELECT DISTINCT d.donor_id
             FROM donations d
             WHERE d.batch_id = ?",
            [$batchId]
        )->fetchAll();
        if (!$rows) return;
        $reason = isset($context['reason']) ? trim((string)$context['reason']) : '';
        $notif = new Notification();
        foreach ($rows as $r) {
            if (empty($r['donor_id'])) continue;
            $msg = 'Your batch donation status updated to ' . $newStatus;
            if ($reason !== '') { $msg .= '. Reason: ' . $reason; }
            $notif->create([
                'user_id' => (int)$r['donor_id'],
                'type' => 'status_updated',
                'reference_type' => 'batch',
                'reference_id' => null,
                'message' => $msg,
            ]);
        }
    }

    /**
     * Notify all approved admins when the donor edits a single donation
     */
    public function notifyDonationEdited(int $donationId, int $editorUserId, string $details = ''): void {
        // Only fire if editor is the donor (not admin)
        $role = (string)(currentUserRole() ?? '');
        if (strtolower($role) !== 'donor') return;
        $row = $this->db->query(
            "SELECT d.donation_id AS id, d.product_name AS name, d.donor_id, u.name AS donor_name, u.organization_name
             FROM donations d JOIN users u ON u.user_id = d.donor_id WHERE d.donation_id = ?",
            [$donationId]
        )->fetch();
        if (!$row) return;
        if ((int)$row['donor_id'] !== (int)$editorUserId) return; // ensure ownership
        $admins = $this->db->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll();
        if (!$admins) return;
        $donorDisplay = '';
        if (!empty($row['organization_name'])) { $donorDisplay = $row['organization_name']; }
        else if (!empty($row['donor_name'])) { $donorDisplay = $row['donor_name']; }
        $donationName = $row['name'] ?? ('#' . $donationId);
        $notif = new Notification();
        foreach ($admins as $admin) {
            $message = ($donorDisplay ? ($donorDisplay . ' ') : '') . 'updated donation "' . $donationName . '"';
            if ($details !== '') { $message .= ' (' . $details . ')'; }
            $notif->create([
                'user_id' => (int)$admin['user_id'],
                'type' => 'donation_edited',
                'reference_type' => 'donation',
                'reference_id' => (int)$donationId,
                'message' => $message,
            ]);
        }
    }

    /**
     * Notify all approved admins when the donor edits a batch
     */
    public function notifyBatchEdited(string $batchId, int $editorUserId, int $itemsCount = 0, string $details = ''): void {
        $role = (string)(currentUserRole() ?? '');
        if (strtolower($role) !== 'donor') return;
        // Verify the batch belongs to the donor
        $own = $this->db->query(
            "SELECT donor_id FROM donations WHERE batch_id = ? LIMIT 1",
            [$batchId]
        )->fetch();
        if (!$own || (int)$own['donor_id'] !== (int)$editorUserId) return;
        $u = $this->db->query("SELECT name, organization_name FROM users WHERE user_id = ?", [$editorUserId])->fetch();
        $donorDisplay = '';
        if ($u) {
            if (!empty($u['organization_name'])) { $donorDisplay = $u['organization_name']; }
            else if (!empty($u['name'])) { $donorDisplay = $u['name']; }
        }
        $admins = $this->db->query("SELECT user_id FROM users WHERE role = 'admin' AND status = 'approved'")->fetchAll();
        if (!$admins) return;
        $notif = new Notification();
        $msg = ($donorDisplay ? ($donorDisplay . ' ') : '') . 'updated a donation batch' . ($itemsCount > 0 ? (' (' . $itemsCount . ' items)') : '');
        if ($details !== '') { $msg .= ': ' . $details; }
        foreach ($admins as $admin) {
            $notif->create([
                'user_id' => (int)$admin['user_id'],
                'type' => 'donation_edited',
                'reference_type' => 'batch',
                'reference_id' => null,
                'message' => $msg,
            ]);
        }
    }
}
