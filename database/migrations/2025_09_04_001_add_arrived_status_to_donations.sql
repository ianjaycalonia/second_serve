-- Migration: Add 'Arrived at warehouse' to donations.status ENUM
-- Run this in your MySQL (phpMyAdmin) for the active database

ALTER TABLE `donations`
  MODIFY COLUMN `status` ENUM('Pending','Allocated','Picked Up','Arrived at warehouse','Failed Safety','Completed','Cancelled') NOT NULL DEFAULT 'Pending';

-- Optional: Inspect any rows that may have become empty-string status due to earlier invalid updates
-- SELECT id, donor_id, name, quantity, created_at, status FROM donations WHERE status = '';

-- Optional: If appropriate, correct them in bulk (use with caution; review the SELECT above first)
-- UPDATE donations SET status = 'Arrived at warehouse' WHERE status = '';
