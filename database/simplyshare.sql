-- =======================================================
-- SQL Dump: Simply Share  (merged schema, hybrid model)
-- Created for: user (keeps existing users data)
-- Note: Fixed for MySQL/MariaDB import
--  - Removed DEFAULT NULL from TEXT columns
--  - Removed invalid AUTO_INCREMENT on batches (varchar PK)
-- =======================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

-- Create DB if not exists (do NOT drop to preserve existing data)
CREATE DATABASE IF NOT EXISTS `simply_share` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `simply_share`;

-- =======================================================
-- 1) users table (preserve original data exactly)
-- =======================================================
CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('donor','recipient','admin') NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `address` text,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_login` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Seed initial users (admin, donor, recipient)
INSERT INTO `users` (`user_id`, `name`, `email`, `password_hash`, `role`, `organization_name`, `contact_number`, `address`, `status`, `created_at`, `last_login`) VALUES
(1, 'Ian Jay Calonia', 'icarusjay.lee@gmail.com', '$2y$10$nf2hc4LDryXah.oqAgjPBu49t2HII0Dex.0q3ZKxqSL/jfDRjy0hO', 'admin', 'Cebu Food Bank', NULL, 'Subangdaku, Mandaue City', 'approved', '2025-08-30 03:04:15', '2025-09-09 12:48:15'),
(2, 'Jay Piañar', 'babidi@gmail.com', '$2y$10$nl3jGWzN/BK5FmzVK0j3z.q4UMc7mY2NvQMiUieBPBaoDsFFOz.4a', 'donor', 'No1Donor.org', NULL, 'Tabok, Mandaue City', 'approved', '2025-08-30 05:09:37', '2025-09-09 10:23:23'),
(3, 'Kyle John Grengia', 'kylegwapo@gmail.com', '$2y$10$UdKbfVcKAWLqqQ7WZ2OYjOgtskIh/ji9qndf91Xg2NP7uAqG6oN7.', 'recipient', 'ABC corp', NULL, 'Labogon, Mandaue City', 'approved', '2025-08-30 08:09:38', '2025-09-08 03:35:43');

-- =======================================================
-- 2) donor_profiles (optional donor-specific details)
-- =======================================================
CREATE TABLE `donor_profiles` (
  `user_id` int(11) NOT NULL,
  `donor_category` varchar(100) DEFAULT NULL, -- e.g., individual, corporate, org
  `notes` text,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `dp_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 3) recipient_profiles (optional recipient-specific details)
-- =======================================================
CREATE TABLE `recipient_profiles` (
  `user_id` int(11) NOT NULL,
  `agency_type` varchar(100) DEFAULT NULL, -- e.g., school, NGO, barangay
  `position_designation` varchar(150) DEFAULT NULL,
  `total_residents` int(11) DEFAULT NULL,
  `age_group` varchar(100) DEFAULT NULL,
  `male_count` int(11) DEFAULT NULL,
  `female_count` int(11) DEFAULT NULL,
  `external_id` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `rp_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 4) products (master list to avoid repeating names/categories)
-- =======================================================
-- Recipient contacts (multiple contacts per recipient org)
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
  CONSTRAINT `rc_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 4) products (master list to avoid repeating names/categories)
-- =======================================================
CREATE TABLE `products` (
  `product_id` int(11) NOT NULL AUTO_INCREMENT,
  `product_name` varchar(255) NOT NULL,
  `product_category` varchar(100) DEFAULT NULL,
  `default_unit` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`product_id`),
  UNIQUE KEY `uniq_product_name` (`product_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 5) batches (grouping for donations)
-- =======================================================
CREATE TABLE `batches` (
  `batch_id` varchar(36) NOT NULL,
  `donor_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `status` enum('Pending','Acknowledged','Picked Up','Failed Safety','Cancelled','Completed') NOT NULL DEFAULT 'Pending',
  `total_items` int(11) DEFAULT NULL,
  `total_weight` decimal(14,3) DEFAULT NULL,
  `total_cost` decimal(16,2) DEFAULT NULL,
  `notes` text,
  PRIMARY KEY (`batch_id`),
  KEY `batches_donor_idx` (`donor_id`),
  CONSTRAINT `batches_donor_fk` FOREIGN KEY (`donor_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 6) donations (product IN) — includes attributes you specified
-- =======================================================
CREATE TABLE `donations` (
  `donation_id` int(11) NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(36) DEFAULT NULL,
  `donor_id` int(11) DEFAULT NULL,                -- FK to users
  `entry_date` timestamp NULL DEFAULT NULL,       -- entry date
  `procurement_type` enum('purchased','donated') NOT NULL DEFAULT 'donated',
  `donor_name` varchar(150) DEFAULT NULL,         -- free-text donor name (report may include it)
  `product_name` varchar(255) NOT NULL,
  `product_category` varchar(100) DEFAULT NULL,
  `quantity` int(11) NOT NULL,
  `unit` varchar(50) DEFAULT NULL,
  `pack_by` int(11) DEFAULT NULL,                 -- FK users (who packed)
  `total_weight` decimal(14,3) DEFAULT NULL,
  `total_cost` decimal(16,2) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `remarks` text,
  `admin_in_charge` int(11) DEFAULT NULL,        -- FK users
  `status` enum('Pending','Acknowledged','Picked Up','Failed Safety','Cancelled','Completed') NOT NULL DEFAULT 'Pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`donation_id`),
  KEY `donations_batch_idx` (`batch_id`),
  KEY `donations_donor_idx` (`donor_id`),
  KEY `donations_pack_by_idx` (`pack_by`),
  KEY `donations_admin_idx` (`admin_in_charge`),
  CONSTRAINT `donations_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `donations_donor_fk` FOREIGN KEY (`donor_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `donations_pack_by_fk` FOREIGN KEY (`pack_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `donations_admin_fk` FOREIGN KEY (`admin_in_charge`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 7) inventory (current stock)
-- =======================================================
CREATE TABLE `inventory` (
  `inventory_id` int(11) NOT NULL AUTO_INCREMENT,
  `donation_id` int(11) DEFAULT NULL,             -- origin donation (nullable)
  `product_id` int(11) DEFAULT NULL,              -- optional FK to products
  `product_name` varchar(255) NOT NULL,
  `product_category` varchar(100) DEFAULT NULL,
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
  CONSTRAINT `inventory_donation_fk` FOREIGN KEY (`donation_id`) REFERENCES `donations` (`donation_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_product_fk` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_donor_fk` FOREIGN KEY (`donor_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_batch_fk` FOREIGN KEY (`source_batch_id`) REFERENCES `batches` (`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_admin_fk` FOREIGN KEY (`admin_in_charge`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_pack_by_fk` FOREIGN KEY (`pack_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 8) inventory_movements (product OUT / distributions)
-- =======================================================
CREATE TABLE `inventory_movements` (
  `movement_id` int(11) NOT NULL AUTO_INCREMENT,
  `inventory_id` int(11) DEFAULT NULL,
  `date` timestamp NOT NULL DEFAULT current_timestamp(),     -- distribution date
  `recipient_id` int(11) DEFAULT NULL,                      -- FK users (recipient account)
  `beneficiary_agency` varchar(150) DEFAULT NULL,           -- free-text agency name (from reports)
  `product_name` varchar(255) NOT NULL,
  `product_category` varchar(100) DEFAULT NULL,
  `quantity` int(11) NOT NULL,
  `unit` varchar(50) DEFAULT NULL,
  `total_weight` decimal(14,3) DEFAULT NULL,
  `admin_in_charge` int(11) DEFAULT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`movement_id`),
  KEY `movements_inventory_idx` (`inventory_id`),
  KEY `movements_recipient_idx` (`recipient_id`),
  KEY `movements_admin_idx` (`admin_in_charge`),
  KEY `movements_batch_idx` (`batch_id`),
  CONSTRAINT `movements_inventory_fk` FOREIGN KEY (`inventory_id`) REFERENCES `inventory` (`inventory_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `movements_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `movements_admin_fk` FOREIGN KEY (`admin_in_charge`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `movements_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 9) food_safety_checks (preserve existing semantics - empty)
-- =======================================================
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
  `fail_reason` text,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fsc_donation_idx` (`donation_id`),
  KEY `fsc_batch_idx` (`batch_id`),
  KEY `fsc_created_by_idx` (`created_by`),
  CONSTRAINT `fsc_donation_fk` FOREIGN KEY (`donation_id`) REFERENCES `donations` (`donation_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fsc_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fsc_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 10) donation_cancellations (empty)
-- =======================================================
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
  CONSTRAINT `dc_donation_fk` FOREIGN KEY (`donation_id`) REFERENCES `donations` (`donation_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `dc_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `dc_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 11) notifications (kept minimal and empty)
-- =======================================================
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
  CONSTRAINT `notifications_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- 12) messaging tables (optional - created for compatibility)
-- =======================================================
CREATE TABLE `conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` enum('direct','group') NOT NULL,
  `created_by` int(11) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `conversations_created_by_idx` (`created_by`),
  CONSTRAINT `conversations_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `conversation_participants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `last_read_at` timestamp NULL DEFAULT NULL,
  `joined_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_conversation_user` (`conversation_id`,`user_id`),
  KEY `conversation_participants_user_idx` (`user_id`),
  CONSTRAINT `cp_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `cp_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `sender_id` int(11) NOT NULL,
  `body` text NOT NULL,
  `attachment_url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `messages_conversation_idx` (`conversation_id`),
  KEY `messages_sender_idx` (`sender_id`),
  CONSTRAINT `messages_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `messages_sender_fk` FOREIGN KEY (`sender_id`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `message_reads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `message_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `read_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_message_user` (`message_id`,`user_id`),
  KEY `message_reads_user_idx` (`user_id`),
  CONSTRAINT `message_reads_message_fk` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `message_reads_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =======================================================
-- Set appropriate AUTO_INCREMENTs where applicable
-- =======================================================
ALTER TABLE `users`        AUTO_INCREMENT = 4;
ALTER TABLE `donations`    AUTO_INCREMENT = 1;
ALTER TABLE `inventory`    AUTO_INCREMENT = 1;
ALTER TABLE `inventory_movements` AUTO_INCREMENT = 1;
ALTER TABLE `products`     AUTO_INCREMENT = 1;
ALTER TABLE `food_safety_checks` AUTO_INCREMENT = 1;
ALTER TABLE `donation_cancellations` AUTO_INCREMENT = 1;
-- Removed: ALTER TABLE `batches`      AUTO_INCREMENT = 1; -- invalid (no AI column)
ALTER TABLE `conversations` AUTO_INCREMENT = 1;
ALTER TABLE `conversation_participants` AUTO_INCREMENT = 1;
ALTER TABLE `messages` AUTO_INCREMENT = 1;
ALTER TABLE `message_reads` AUTO_INCREMENT = 1;
ALTER TABLE `notifications` AUTO_INCREMENT = 1;

COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
