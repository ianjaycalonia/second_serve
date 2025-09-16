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

-- conversations
CREATE TABLE `conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `type` enum('direct','group') NOT NULL,
  `created_by` int(11) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `conversations_created_by_idx` (`created_by`),
  CONSTRAINT `conversations_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- conversation_participants
CREATE TABLE `conversation_participants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `last_read_at` timestamp NULL DEFAULT NULL,
  `joined_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_conversation_user` (`conversation_id`,`user_id`),
  KEY `conversation_participants_user_idx` (`user_id`),
  CONSTRAINT `cp_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `cp_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- distribution_period_status
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
  CONSTRAINT `dps_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- distribution_selection_logs
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
  CONSTRAINT `dsl_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
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

-- inventory_movements
CREATE TABLE `inventory_movements` (
  `movement_id` int(11) NOT NULL AUTO_INCREMENT,
  `inventory_id` int(11) DEFAULT NULL,
  `date` timestamp NOT NULL DEFAULT current_timestamp(),
  `recipient_id` int(11) DEFAULT NULL,
  `beneficiary_agency` varchar(150) DEFAULT NULL,
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
  CONSTRAINT `movements_admin_fk` FOREIGN KEY (`admin_in_charge`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `movements_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `movements_inventory_fk` FOREIGN KEY (`inventory_id`) REFERENCES `inventory`(`inventory_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `movements_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- messages
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
  CONSTRAINT `messages_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `messages_sender_fk` FOREIGN KEY (`sender_id`) REFERENCES `users`(`user_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

-- message_reads
CREATE TABLE `message_reads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `message_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `read_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_message_user` (`message_id`,`user_id`),
  KEY `message_reads_user_idx` (`user_id`),
  CONSTRAINT `message_reads_message_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `message_reads_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_GENERAL_CI;

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

-- recipient_month_assignments
CREATE TABLE `recipient_month_assignments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `month` date NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `assigned_by` int(11) DEFAULT NULL,
  `assigned_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_month_recipient` (`month`,`recipient_id`),
  KEY `rma_recipient_idx` (`recipient_id`),
  KEY `rma_assigned_by_idx` (`assigned_by`),
  CONSTRAINT `rma_assigned_by_fk` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `rma_recipient_fk` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
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

-- Removed recipient_profile_effective view; code joins recipient_profiles and recipient_contacts directly.

-- Seed minimal data consistent with code expectations
INSERT INTO `users` (`user_id`, `name`, `email`, `password_hash`, `role`, `status`, `created_at`, `last_login`) VALUES
(1, 'Ian Jay Calonia', 'admin@simplyshare.org', '$2y$10$6tp9korSSS8o7wqtSfuxJOG1bgiRYkWNHkBndnoLsXXomlCVUiiru', 'admin', 'approved', NOW(), NOW()),
(2, 'Jay Piañar', 'testdonor@simplyshare.org', '$2y$10$oURfajvoYjiYIoJtNA8/MOTrzSveBLam35ucrlwWVMcj9aPDrJ22O', 'donor', 'approved', NOW(), NOW());

INSERT INTO `admin_profiles` (`user_id`, `organization_name`, `contact_number`, `address`) VALUES
(1, 'Simply Share', '09910071270', 'Subangdaku, Mandaue City');

INSERT INTO `donor_profiles` (`user_id`, `organization_name`, `donor_category`, `contact_number`, `address`, `notes`) VALUES
(2, 'TestDonor', NULL, '09910071271', 'Tabok, Mandaue City', NULL);
SET FOREIGN_KEY_CHECKS=1;
