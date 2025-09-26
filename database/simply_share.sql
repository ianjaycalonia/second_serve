-- Clean rebuild SQL for simply_share with no ALTER statements
-- Drop-and-import friendly: drops DB, recreates with all constraints inline

DROP DATABASE IF EXISTS `simply_share`;
CREATE DATABASE `simply_share` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `simply_share`;

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";
/*!40101 SET NAMES utf8mb4 */;
SET FOREIGN_KEY_CHECKS=0;

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

-- admin_profiles
CREATE TABLE `admin_profiles` (
  `user_id` int(11) NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
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
  `recipient_id` int(11) NOT NULL,
  `source` enum('planned','carryover') NOT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `week_start_date` date DEFAULT NULL COMMENT 'Calculated start date of the week based on settings',
  `week_basis` enum('sunday','monday') DEFAULT NULL COMMENT 'Week computation basis at time of save',
  PRIMARY KEY (`period_key`, `recipient_id`),
  KEY `rp_period_position_idx` (`period_key`, `position`),
  KEY `rp_week_start_idx` (`week_start_date`),
  CONSTRAINT `rp_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- recipient_attendance (weekly served vs absent)
CREATE TABLE `recipient_attendance` (
  `period_key` char(10) NOT NULL COMMENT 'YYYY-MM-Wn',
  `recipient_id` int(11) NOT NULL,
  `status` enum('served','absent') NOT NULL,
  `served_count` int(11) NOT NULL DEFAULT 0,
  `last_served_at` timestamp NULL DEFAULT NULL,
  `week_start_date` date DEFAULT NULL COMMENT 'Calculated start date of the week based on settings',
  `week_basis` enum('sunday','monday') DEFAULT NULL COMMENT 'Week computation basis at time of mark',
  PRIMARY KEY (`period_key`, `recipient_id`),
  KEY `ra_recipient_idx` (`recipient_id`),
  KEY `ra_week_start_idx` (`week_start_date`),
  CONSTRAINT `ra_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- allocation_runs (idempotency and audit for weekly allocations)
CREATE TABLE `allocation_runs` (
  `run_id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `period_key` char(10) NOT NULL COMMENT 'YYYY-MM-Wn',
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`run_id`),
  UNIQUE KEY `uniq_ar_period` (`period_key`),
  KEY `ar_created_by_idx` (`created_by`),
  CONSTRAINT `ar_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- donations
CREATE TABLE `donations` (
  `donation_id` int(11) NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(36) DEFAULT NULL,
  `donor_id` int(11) DEFAULT NULL,
  `entry_date` timestamp NULL DEFAULT NULL,
  `procurement_type` enum('purchased','donated') NOT NULL DEFAULT 'donated',
  `donor_name` varchar(150) DEFAULT NULL,
  `product_name` varchar(255) NOT NULL,
  `product_category` varchar(100) DEFAULT NULL,
  `quantity` int(11) NOT NULL,
  `unit` varchar(50) DEFAULT NULL,
  `pack_by` int(11) DEFAULT NULL,
  `total_weight` decimal(14,3) DEFAULT NULL,
  `total_cost` decimal(16,2) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `admin_in_charge` int(11) DEFAULT NULL,
  `status` enum('Pending','Acknowledged','Picked Up','Failed Safety','Cancelled','Completed') NOT NULL DEFAULT 'Pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`donation_id`),
  KEY `donations_batch_idx` (`batch_id`),
  KEY `donations_donor_idx` (`donor_id`),
  KEY `donations_pack_by_idx` (`pack_by`),
  KEY `donations_admin_idx` (`admin_in_charge`),
  CONSTRAINT `donations_admin_fk` FOREIGN KEY (`admin_in_charge`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `donations_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `donations_donor_fk` FOREIGN KEY (`donor_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `donations_pack_by_fk` FOREIGN KEY (`pack_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
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

-- donor_profiles
CREATE TABLE `donor_profiles` (
  `user_id` int(11) NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `donor_category` varchar(100) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `dp_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
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

-- products (must be created before inventory)
CREATE TABLE `products` (
  `product_id` int(11) NOT NULL AUTO_INCREMENT,
  `product_name` varchar(255) NOT NULL,
  `product_category` varchar(100) DEFAULT NULL,
  `default_unit` varchar(50) DEFAULT NULL,
  `tags` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`product_id`),
  UNIQUE KEY `uniq_product_name` (`product_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- inventory
CREATE TABLE `inventory` (
  `inventory_id` int(11) NOT NULL AUTO_INCREMENT,
  `donation_id` int(11) DEFAULT NULL,
  `product_id` int(11) DEFAULT NULL,
  `product_name` varchar(255) NOT NULL,
  `product_category` varchar(100) DEFAULT NULL,
  `tags` varchar(255) DEFAULT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `unit` varchar(50) DEFAULT NULL,
  `total_weight` decimal(14,3) DEFAULT NULL,
  `total_cost` decimal(16,2) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `donor_id` int(11) DEFAULT NULL,
  `source_batch_id` varchar(36) DEFAULT NULL,
  `admin_in_charge` int(11) DEFAULT NULL,
  `pack_by` int(11) DEFAULT NULL,
  `added_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`inventory_id`),
  KEY `inventory_donation_idx` (`donation_id`),
  KEY `inventory_product_idx` (`product_id`),
  KEY `inventory_donor_idx` (`donor_id`),
  KEY `inventory_batch_idx` (`source_batch_id`),
  KEY `inventory_admin_fk` (`admin_in_charge`),
  KEY `inventory_pack_by_fk` (`pack_by`),
  CONSTRAINT `inventory_admin_fk` FOREIGN KEY (`admin_in_charge`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_batch_fk` FOREIGN KEY (`source_batch_id`) REFERENCES `batches`(`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_donation_fk` FOREIGN KEY (`donation_id`) REFERENCES `donations`(`donation_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_donor_fk` FOREIGN KEY (`donor_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_pack_by_fk` FOREIGN KEY (`pack_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_product_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`product_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- Seed initial inventory items
INSERT INTO `inventory`
  (`donation_id`, `product_id`, `product_name`, `product_category`, `tags`, `quantity`, `unit`, `total_weight`, `total_cost`, `expiry_date`, `donor_id`, `source_batch_id`, `admin_in_charge`, `pack_by`, `added_at`)
VALUES
  (NULL, NULL, 'Infant Formula',      'Dairy',        'infant',   30,  NULL, NULL, NULL, '2025-11-17', NULL, NULL, NULL, NULL, NOW()),
  (NULL, NULL, 'Elderly Milk',         'Dairy',        'elderly',  50,  NULL, NULL, NULL, '2025-12-17', NULL, NULL, NULL, NULL, NOW()),
  (NULL, NULL, 'Rice',                 'Grains/Grain Products',       '',            100,  NULL, NULL, NULL, '2026-03-17', NULL, NULL, NULL, NULL, NOW()),
  (NULL, NULL, 'Canned Sardines',      'Canned Goods', '',           200,  NULL, NULL, NULL, '2026-09-18', NULL, NULL, NULL, NULL, NOW()),
  (NULL, NULL, 'Instant Noodles',      'Dry Goods',    '',         300,  NULL, NULL, NULL, '2026-09-18', NULL, NULL, NULL, NULL, NOW()),
  (NULL, NULL, 'Paracetamol 500mg',    'Medicine',     'medicine',100,  NULL, NULL, NULL, '2026-09-18', NULL, NULL, NULL, NULL, NOW()),
  (NULL, NULL, 'Vitamin C 500mg',      'Medicine',     'medicine',120,  NULL, NULL, NULL, '2026-09-18', NULL, NULL, NULL, NULL, NOW());

-- inventory_movements (aligned with Inventory::ensureTables)
CREATE TABLE `inventory_movements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `inventory_id` int(11) NOT NULL,
  `direction` enum('in','out') NOT NULL,
  `quantity` int(11) NOT NULL,
  `mode` enum('recipient','onsite') NOT NULL,
  `recipient_id` int(11) DEFAULT NULL,
  `note` text DEFAULT NULL,
  `performed_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `im_inventory_idx` (`inventory_id`),
  KEY `im_recipient_idx` (`recipient_id`),
  KEY `im_performed_by_idx` (`performed_by`),
  CONSTRAINT `im_inventory_fk` FOREIGN KEY (`inventory_id`) REFERENCES `inventory` (`inventory_id`) ON DELETE CASCADE ON UPDATE CASCADE,
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
  PRIMARY KEY (`id`),
  KEY `messages_sender_receiver_idx` (`sender_id`, `receiver_id`),
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

-- recipient_profiles (normalized; no contact fields; FK to primary contact)
CREATE TABLE `recipient_profiles` (
  `user_id` int(11) NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `organization_type` varchar(100) DEFAULT NULL,
  `tags` varchar(255) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `total_residents` int(11) DEFAULT NULL,
  `age_group` varchar(100) DEFAULT NULL,
  `male_count` int(11) DEFAULT NULL,
  `female_count` int(11) DEFAULT NULL,
  `external_id` varchar(100) DEFAULT NULL,
  `primary_contact_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  KEY `rp_org_type_idx` (`organization_type`),
  KEY `rp_primary_contact_idx` (`primary_contact_id`),
  CONSTRAINT `rp_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rp_primary_contact_fk` FOREIGN KEY (`primary_contact_id`) REFERENCES `recipient_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;


INSERT INTO `users` (`user_id`, `name`, `email`, `password_hash`, `role`, `status`, `created_at`, `last_login`) VALUES
(1, 'Ian Jay Calonia', 'admin@simplyshare.org', '$2y$10$6tp9korSSS8o7wqtSfuxJOG1bgiRYkWNHkBndnoLsXXomlCVUiiru', 'admin', 'approved', NOW(), NOW()),
(2, 'Jay Piañar', 'testdonor@simplyshare.org', '$2y$10$oURfajvoYjiYIoJtNA8/MOTrzSveBLam35ucrlwWVMcj9aPDrJ22O', 'donor', 'approved', NOW(), NOW());

INSERT INTO `admin_profiles` (`user_id`, `organization_name`, `contact_number`, `address`) VALUES
(1, 'Simply Share', '09910071270', 'Subangdaku, Mandaue City');

INSERT INTO `donor_profiles` (`user_id`, `organization_name`, `donor_category`, `contact_number`, `address`, `notes`) VALUES
(2, 'TestDonor', NULL, '09910071271', 'Tabok, Mandaue City', NULL);

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
  `status` enum('Allocated','Acknowledged','Picked Up','Completed','Cancelled') NOT NULL DEFAULT 'Allocated',
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

SET FOREIGN_KEY_CHECKS=1;
