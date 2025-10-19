-- Clean rebuild SQL for simply_share with no ALTER statements
-- Drop-and-import friendly: drops DB, recreates with all constraints inline

DROP DATABASE IF EXISTS `simply_share`;
CREATE DATABASE `simply_share` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `simply_share`;

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";
/*!40101 SET NAMES utf8mb4 */;
SET FOREIGN_KEY_CHECKS=0;

-- =========================
-- Weeks and Week Recipients
-- =========================
-- Model monthly weeks (1..5) and per-recipient weekly states with carryover/replacement tracking
CREATE TABLE IF NOT EXISTS `weeks` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `year` INT NOT NULL,
  `month` INT NOT NULL,
  `week_number` TINYINT NOT NULL, -- 1..5 within the selected month
  `capacity` INT NOT NULL DEFAULT 10, -- guideline minimum; admins may overfill manually
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_weeks_ymw` (`year`,`month`,`week_number`),
  KEY `ix_weeks_start` (`start_date`),
  KEY `ix_weeks_end` (`end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `week_recipients` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `week_id` INT NOT NULL,
  `recipient_id` INT NOT NULL,
  `status` ENUM('Scheduled','Served','Absent','Cancelled','CarriedOver','RolledOver','Replacement') NOT NULL DEFAULT 'Scheduled',
  `replacement_for` INT NULL,
  `rationale` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_wr_week` (`week_id`),
  KEY `ix_wr_recipient` (`recipient_id`),
  KEY `ix_wr_status` (`status`),
  CONSTRAINT `fk_wr_week` FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- users (must be created first for FK references)
CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('donor','recipient','admin') NOT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_login` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- donor_categories (lookup for donor org categories)
CREATE TABLE `donor_categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(128) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_donor_category_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- beneficiary_categories (lookup for recipient/agency categories)
CREATE TABLE `beneficiary_categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(128) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_beneficiary_category_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- Seed donor & beneficiary category lookups (idempotent via UNIQUE name)
INSERT IGNORE INTO donor_categories (`name`) VALUES
 ('Manufacturer/Processor'),
 ('Retailer'),
 ('Supply Chain Intermediaries'),
 ('Packer/Shipper/Wholesaler'),
 ('Agriculture'),
 ('Food Donation Drive'),
 ('Others');

INSERT IGNORE INTO beneficiary_categories (`name`,`description`) VALUES
 ('Child-specific programs/school, daycare, group home, orphanage', NULL),
 ('Congregate meal site/organizations that offer meals to be eaten on site', NULL),
 ('Food pantry/food/shelter/grocery distributor/organization', NULL),
 ('Health/Medical: clinics, hospitals, nutrition hubs', NULL),
 ('Mixed: offering a combination of multiple services/programs', NULL),
 ('Shelter: temporary housing/shelter, homeless shelter, abuse shelter', NULL),
 ('Food Donation Drive', NULL),
 ('Others', NULL);

-- donation_items (line items per donation)
CREATE TABLE `donation_items` (
  `donation_item_id` INT NOT NULL AUTO_INCREMENT,
  `donation_id` INT NOT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `product_category` VARCHAR(100) DEFAULT NULL,
  `category_id` INT(11) DEFAULT NULL,
  `quantity` INT NOT NULL,
  `unit` VARCHAR(50) DEFAULT NULL,
  `total_weight` DECIMAL(14,3) DEFAULT NULL,
  `total_cost` DECIMAL(16,2) DEFAULT NULL,
  `expiry_date` DATE DEFAULT NULL,
  `tags` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`donation_item_id`),
  KEY `di_donation_idx` (`donation_id`),
  KEY `di_category_idx` (`category_id`),
  CONSTRAINT `di_donation_fk` FOREIGN KEY (`donation_id`) REFERENCES `donations`(`donation_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `di_category_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- admin_profiles
CREATE TABLE `admin_profiles` (
  `user_id` int(11) NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `ack_next_steps_dont_show` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `ap_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- batches
CREATE TABLE `batches` (
  `batch_id` varchar(36) NOT NULL,
  `donor_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `status` enum('Pending','Acknowledged','Picked Up','Failed Safety','Cancelled','Completed') NOT NULL DEFAULT 'Pending',
  `total_items` int(11) DEFAULT NULL,
  `total_weight` decimal(14,3) DEFAULT NULL,
  `total_cost` decimal(16,2) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`batch_id`),
  KEY `batches_donor_idx` (`donor_id`),
  CONSTRAINT `batches_donor_fk` FOREIGN KEY (`donor_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- (Legacy messaging schema removed: conversations, conversation_participants)

-- recipient_plans (weekly planning; normalized order and source)
CREATE TABLE `recipient_plans` (
  `period_key` char(10) NOT NULL COMMENT 'YYYY-MM-Wn',
  `year` smallint NOT NULL,
  `month` tinyint NOT NULL,
  `week` tinyint NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `source` enum('planned','carryover') NOT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `week_start_date` date NOT NULL COMMENT 'Start date of the 7-day window',
  `week_basis` enum('sunday','monday') DEFAULT NULL COMMENT 'Deprecated: retained for backward compatibility',
  `run_id` bigint(20) unsigned NOT NULL COMMENT 'FK to allocation_runs.run_id',
  PRIMARY KEY (`period_key`, `recipient_id`),
  KEY `rp_period_position_idx` (`period_key`, `position`),
  KEY `rp_week_start_idx` (`week_start_date`),
  KEY `rp_ymw_idx` (`year`, `month`, `week`),
  KEY `rp_run_idx` (`run_id`),
  CONSTRAINT `rp_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- recipient_attendance (weekly served vs absent)
CREATE TABLE `recipient_attendance` (
  `period_key` char(10) NOT NULL COMMENT 'YYYY-MM-Wn',
  `year` smallint NOT NULL,
  `month` tinyint NOT NULL,
  `week` tinyint NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `status` enum('served','absent') NOT NULL,
  `served_count` int(11) NOT NULL DEFAULT 0,
  `last_served_at` timestamp NULL DEFAULT NULL,
  `week_start_date` date NOT NULL COMMENT 'Start date of the 7-day window',
  `week_basis` enum('sunday','monday') DEFAULT NULL COMMENT 'Deprecated: retained for backward compatibility',
  PRIMARY KEY (`period_key`, `recipient_id`),
  KEY `ra_recipient_idx` (`recipient_id`),
  KEY `ra_week_start_idx` (`week_start_date`),
  KEY `ra_ymw_idx` (`year`, `month`, `week`),
  CONSTRAINT `ra_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- allocation_runs (idempotency and audit for weekly allocations)
CREATE TABLE `allocation_runs` (
  `run_id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `period_key` char(10) NOT NULL COMMENT 'YYYY-MM-Wn',
  `year` smallint NOT NULL,
  `month` tinyint NOT NULL,
  `week` tinyint NOT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`run_id`),
  UNIQUE KEY `uniq_ar_period` (`period_key`),
  UNIQUE KEY `uniq_ar_ymw` (`year`,`month`,`week`),
  KEY `ar_created_by_idx` (`created_by`),
  CONSTRAINT `ar_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Link recipient_plans to allocation_runs via run_id (created after both tables exist)
ALTER TABLE `recipient_plans`
  ADD CONSTRAINT `rp_run_fk`
  FOREIGN KEY (`run_id`) REFERENCES `allocation_runs`(`run_id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- donations (header-only)
CREATE TABLE `donations` (
  `donation_id` int(11) NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(36) DEFAULT NULL,
  `donor_id` int(11) DEFAULT NULL,
  `admin_in_charge` int(11) DEFAULT NULL,
  `procurement_type` enum('purchased','donated') NOT NULL DEFAULT 'donated',
  `donor_name` varchar(150) DEFAULT NULL,
  `entry_date` timestamp NULL DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `status` enum('Pending','Acknowledged','Picked Up','Failed Safety','Cancelled','Completed') NOT NULL DEFAULT 'Pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`donation_id`),
  KEY `donations_batch_idx` (`batch_id`),
  KEY `donations_donor_idx` (`donor_id`),
  KEY `donations_admin_idx` (`admin_in_charge`),
  CONSTRAINT `donations_admin_fk` FOREIGN KEY (`admin_in_charge`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `donations_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `donations_donor_fk` FOREIGN KEY (`donor_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- donation_cancellations
CREATE TABLE `donation_cancellations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `donation_id` int(11) DEFAULT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `reason` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `dc_donation_idx` (`donation_id`),
  KEY `dc_batch_idx` (`batch_id`),
  KEY `dc_user_idx` (`user_id`),
  CONSTRAINT `dc_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `dc_donation_fk` FOREIGN KEY (`donation_id`) REFERENCES `donations`(`donation_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `dc_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- donor_profiles (normalized donor_category via FK)
CREATE TABLE `donor_profiles` (
  `user_id` int(11) NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `donor_category_id` INT(11) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  KEY `dp_donor_category_idx` (`donor_category_id`),
  CONSTRAINT `dp_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `dp_donor_category_fk` FOREIGN KEY (`donor_category_id`) REFERENCES `donor_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- food_safety_checks
CREATE TABLE `food_safety_checks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `donation_id` int(11) DEFAULT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `packaging_ok` tinyint(1) DEFAULT NULL,
  `spoilage_ok` tinyint(1) DEFAULT NULL,
  `storage_temp` varchar(50) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `expiry_date_image` varchar(255) DEFAULT NULL,
  `receipt_image` varchar(255) DEFAULT NULL,
  `result` enum('passed','failed') DEFAULT NULL,
  `fail_reason` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fsc_donation_idx` (`donation_id`),
  KEY `fsc_batch_idx` (`batch_id`),
  KEY `fsc_created_by_idx` (`created_by`),
  CONSTRAINT `fsc_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fsc_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fsc_donation_fk` FOREIGN KEY (`donation_id`) REFERENCES `donations`(`donation_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- categories (taxonomy for products/inventory/donations)
CREATE TABLE `categories` (
  `category_id` int(11) NOT NULL AUTO_INCREMENT,
  `primary_name` varchar(128) NOT NULL,
  `secondary_name` varchar(128) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`category_id`),
  UNIQUE KEY `uq_categories_primary_secondary` (`primary_name`, `secondary_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- category_aliases: maps messy/raw labels from files to canonical categories
CREATE TABLE `category_aliases` (
  `alias_id` INT NOT NULL AUTO_INCREMENT,
  `category_id` INT NOT NULL,
  `raw_label` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`alias_id`),
  UNIQUE KEY `uq_alias_label` (`raw_label`),
  KEY `ca_category_idx` (`category_id`),
  CONSTRAINT `ca_category_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- Attach FK now that categories exists
-- (donations no longer references categories at header level)

-- products (must be created before inventory)
CREATE TABLE `products` (
  `product_id` int(11) NOT NULL AUTO_INCREMENT,
  `product_name` varchar(255) NOT NULL,
  `product_category` varchar(100) DEFAULT NULL,
  `category_id` int(11) DEFAULT NULL,
  `default_unit` varchar(50) DEFAULT NULL,
  `tags` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`product_id`),
  UNIQUE KEY `uniq_product_name` (`product_name`),
  KEY `products_category_idx` (`category_id`),
  CONSTRAINT `products_category_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- inventory (lot-level, normalized)
CREATE TABLE `inventory` (
  `inventory_id` int(11) NOT NULL AUTO_INCREMENT,
  `donation_item_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `added_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`inventory_id`),
  KEY `inventory_donation_item_idx` (`donation_item_id`),
  CONSTRAINT `inventory_donation_item_fk` FOREIGN KEY (`donation_item_id`) REFERENCES `donation_items`(`donation_item_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;
-- inventory_movements (aligned with Inventory::ensureTables)
CREATE TABLE `inventory_movements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `inventory_id` int(11) NOT NULL,
  `donation_item_id` int(11) DEFAULT NULL,
  `direction` enum('in','out') NOT NULL,
  `quantity` int(11) NOT NULL,
  `mode` varchar(32) NOT NULL,
  `recipient_id` int(11) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `performed_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `im_inventory_idx` (`inventory_id`),
  KEY `im_donation_item_idx` (`donation_item_id`),
  KEY `im_recipient_idx` (`recipient_id`),
  KEY `im_performed_by_idx` (`performed_by`),
  CONSTRAINT `im_inventory_fk` FOREIGN KEY (`inventory_id`) REFERENCES `inventory` (`inventory_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `im_donation_item_fk` FOREIGN KEY (`donation_item_id`) REFERENCES `donation_items` (`donation_item_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `im_performed_by_fk` FOREIGN KEY (`performed_by`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `im_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- Minimal messages table (direct messages only) with role-based trigger
CREATE TABLE `messages` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sender_id` INT NOT NULL,
  `receiver_id` INT NOT NULL,
  `content` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `receiver_read_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `messages_sender_receiver_idx` (`sender_id`, `receiver_id`),
  KEY `messages_inbox_unread_idx` (`receiver_id`, `sender_id`, `receiver_read_at`),
  KEY `messages_conv_idx` (`sender_id`, `receiver_id`, `id`),
  CONSTRAINT `messages_sender_fk` FOREIGN KEY (`sender_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `messages_receiver_fk` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- notifications
CREATE TABLE `notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `type` varchar(100) NOT NULL,
  `reference_type` varchar(100) DEFAULT NULL,
  `reference_id` int(11) DEFAULT NULL,
  `message` varchar(255) NOT NULL,
  `read_status` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `notifications_user_idx` (`user_id`),
  CONSTRAINT `notifications_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- (products table moved above)

-- recipient_contacts
CREATE TABLE `recipient_contacts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `contact_name` varchar(150) DEFAULT NULL,
  `position_designation` varchar(150) DEFAULT NULL,
  `contact_number` varchar(30) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `rc_user_idx` (`user_id`),
  KEY `rc_user_primary_idx` (`user_id`, `is_primary`),
  CONSTRAINT `rc_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- recipient_profiles (normalized; FK to beneficiary_categories)
CREATE TABLE `recipient_profiles` (
  `user_id` int(11) NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `beneficiary_category_id` INT(11) DEFAULT NULL,
  `tags` varchar(255) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `total_residents` int(11) DEFAULT NULL,
  `age_group` varchar(100) DEFAULT NULL,
  `male_count` int(11) DEFAULT NULL,
  `female_count` int(11) DEFAULT NULL,
  `external_id` varchar(100) DEFAULT NULL,
  `primary_contact_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  KEY `rp_beneficiary_category_idx` (`beneficiary_category_id`),
  KEY `rp_primary_contact_idx` (`primary_contact_id`),
  CONSTRAINT `rp_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rp_primary_contact_fk` FOREIGN KEY (`primary_contact_id`) REFERENCES `recipient_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `rp_beneficiary_category_fk` FOREIGN KEY (`beneficiary_category_id`) REFERENCES `beneficiary_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;


INSERT INTO `users` (`user_id`, `name`, `email`, `password_hash`, `role`, `status`, `created_at`, `last_login`) VALUES
(1, 'Admin One', 'admin1@simplyshare.org', '$2y$10$6tp9korSSS8o7wqtSfuxJOG1bgiRYkWNHkBndnoLsXXomlCVUiiru', 'admin', 'approved', NOW(), NOW()),
(2, 'Admin Two', 'admin2@simplyshare.org', '$2y$10$6tp9korSSS8o7wqtSfuxJOG1bgiRYkWNHkBndnoLsXXomlCVUiiru', 'admin', 'approved', NOW(), NOW()),
(3, 'Admin Three', 'admin3@simplyshare.org', '$2y$10$6tp9korSSS8o7wqtSfuxJOG1bgiRYkWNHkBndnoLsXXomlCVUiiru', 'admin', 'approved', NOW(), NOW()),
(4, 'Foodbank (On-site)', 'onsite@invalid.local', '', 'recipient', 'approved', NOW(), NOW()),
(5, 'Test Donor', 'testdonor@simplyshare.org', '$2y$10$oURfajvoYjiYIoJtNA8/MOTrzSveBLam35ucrlwWVMcj9aPDrJ22O', 'donor', 'approved', NOW(), NOW());

INSERT INTO `admin_profiles` (`user_id`, `organization_name`, `contact_number`, `address`) VALUES
(1, 'Simply Share', '09910071270', 'Subangdaku, Mandaue City'),
(2, 'Simply Share', '09910071271', 'Subangdaku, Mandaue City'),
(3, 'Simply Share', '09910071272', 'Subangdaku, Mandaue City');

-- Recipient profile for Foodbank (On-site)
INSERT INTO `recipient_profiles` (`user_id`, `organization_name`, `beneficiary_category_id`, `tags`, `address`, `total_residents`, `age_group`, `male_count`, `female_count`, `external_id`, `primary_contact_id`) VALUES
(4, 'Foodbank (On-site)', NULL, 'onsite', 'Subangdaku, Mandaue City', NULL, NULL, NULL, NULL, NULL, NULL);

-- Donor profile for TestDonor
INSERT INTO `donor_profiles` (`user_id`, `organization_name`, `donor_category_id`, `contact_number`, `address`, `notes`) VALUES
(5, 'TestDonor', NULL, '09910071273', 'Tabok, Mandaue City', NULL);

-- settings (key-value store for global app settings)
CREATE TABLE `settings` (
  `key` varchar(64) NOT NULL,
  `value` varchar(255) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- Seed default week start to sunday (can be 'sunday' or 'monday')
INSERT INTO `settings` (`key`, `value`) VALUES ('week_start', 'sunday')
ON DUPLICATE KEY UPDATE `value`=VALUES(`value`);

-- user_preferences (per-user UI/UX preferences)
CREATE TABLE `user_preferences` (
  `user_id` int(11) NOT NULL,
  `pref_key` varchar(64) NOT NULL,
  `pref_value` varchar(255) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`, `pref_key`),
  CONSTRAINT `user_prefs_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

CREATE TABLE `allocations` (
  `allocation_id` int(11) NOT NULL AUTO_INCREMENT,
  `recipient_id` int(11) NOT NULL,
  `run_id` bigint(20) unsigned DEFAULT NULL COMMENT 'optional link to allocation_runs.period_key',
  `status` enum('Pending','Notified','Acknowledged','Updated','Picked Up','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  `scheduled_pickup_at` datetime DEFAULT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `cancel_reason` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`allocation_id`),
  KEY `alloc_recipient_idx` (`recipient_id`),
  KEY `alloc_status_idx` (`status`),
  KEY `alloc_run_idx` (`run_id`),
  CONSTRAINT `alloc_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `alloc_run_fk` FOREIGN KEY (`run_id`) REFERENCES `allocation_runs`(`run_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- allocation_items (distribution results details - now linked to inventory)
CREATE TABLE `allocation_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `allocation_id` int(11) NOT NULL,
  `inventory_id` int(11) NOT NULL COMMENT 'References the actual inventory item being allocated',
  `quantity` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ai_allocation_idx` (`allocation_id`),
  KEY `ai_inventory_idx` (`inventory_id`),
  CONSTRAINT `ai_allocation_fk` FOREIGN KEY (`allocation_id`) REFERENCES `allocations`(`allocation_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ai_inventory_fk` FOREIGN KEY (`inventory_id`) REFERENCES `inventory`(`inventory_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- distribution_period_status (weekly/monthly/quarterly fairness tracking; uses period_key for compatibility)
CREATE TABLE `distribution_period_status` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_key` varchar(12) NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `served_count` int(11) NOT NULL DEFAULT 0,
  `last_served_at` timestamp NULL DEFAULT NULL,
  `skipped_pending` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_period_recipient` (`period_key`,`recipient_id`),
  KEY `dps_recipient_idx` (`recipient_id`),
  CONSTRAINT `dps_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- distribution_selection_logs (audit log for suggestion results)
CREATE TABLE `distribution_selection_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_key` varchar(12) NOT NULL,
  `period_type` enum('weekly','monthly','quarterly') NOT NULL,
  `pool_type` enum('general','specialty') NOT NULL,
  `specialty_key` varchar(64) DEFAULT NULL,
  `round_size` int(11) NOT NULL,
  `selected_ids_json` text NOT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `dsl_period_idx` (`period_key`,`period_type`),
  KEY `dsl_created_by_idx` (`created_by`),
  CONSTRAINT `dsl_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =========================
-- Seed: minimal inventory sample so UI has data on fresh import
-- =========================
-- Create a donation header (donated, picked up)
INSERT INTO `donations` (`donor_id`, `admin_in_charge`, `procurement_type`, `donor_name`, `entry_date`, `remarks`, `status`, `created_at`)
VALUES (NULL, 1, 'donated', 'Sample Donor', NOW(), NULL, 'Picked Up', NOW());
SET @seed_donation_id := LAST_INSERT_ID();

-- Create a donation item
INSERT INTO `donation_items` (
  `donation_id`, `product_name`, `product_category`, `category_id`, `quantity`, `unit`, `total_weight`, `total_cost`, `expiry_date`, `tags`, `created_at`
) VALUES (
  @seed_donation_id, 'Bottled Water', 'Beverage - Water', NULL, 10, 'bottle', NULL, NULL, DATE_ADD(CURDATE(), INTERVAL 365 DAY), NULL, NOW()
);
SET @seed_donation_item_id := LAST_INSERT_ID();

-- Create the inventory lot referencing the donation item
INSERT INTO `inventory` (`donation_item_id`, `quantity`, `added_at`) VALUES (@seed_donation_item_id, 10, NOW());

SET FOREIGN_KEY_CHECKS=1;
