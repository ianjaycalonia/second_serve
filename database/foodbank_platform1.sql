-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Sep 03, 2025 at 03:18 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

-- Disable FK checks for idempotent imports
SET FOREIGN_KEY_CHECKS=0;

--
-- Database: `foodbank_platform`
--

-- --------------------------------------------------------

--
-- Table structure for table `donations`
--

DROP TABLE IF EXISTS `donations`;
CREATE TABLE `donations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `donor_id` int(11) NOT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `type` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `quantity` int(11) NOT NULL,
  `expiry_date` date DEFAULT NULL,
  `packaging` varchar(100) DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `status` enum('Pending','Allocated','Picked Up','Failed Safety','Completed','Cancelled') DEFAULT 'Pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `donor_id` (`donor_id`),
  KEY `batch_id` (`batch_id`),
  KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `donation_monitoring`
--

-- (removed unused table donation_monitoring)

-- --------------------------------------------------------

--
-- Table structure for table `matches`
--

-- (removed unused table matches)

-- (removed duplicate early index block for food_safety_checks; see consolidated indexes later)

-- --------------------------------------------------------

--
-- Table structure for table `messages`
--

-- (removed unused table messages)

-- --------------------------------------------------------

--
-- Table structure for table `reports`
--

-- (removed unused table reports)

-- --------------------------------------------------------

--
-- Table structure for table `requests`
--

-- (removed unused table requests)

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('donor','recipient','admin') NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_login` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`user_id`, `name`, `email`, `password_hash`, `role`, `organization_name`, `contact_number`, `address`, `status`, `created_at`) VALUES
(1, 'Ian Jay Calonia', 'icarusjay.lee@gmail.com', '$2y$10$nf2hc4LDryXah.oqAgjPBu49t2HII0Dex.0q3ZKxqSL/jfDRjy0hO', 'admin', 'Cebu Food Bank', NULL, NULL, 'approved', '2025-08-30 03:04:15'),
(2, 'Jay Piañar', 'babidi@gmail.com', '$2y$10$nl3jGWzN/BK5FmzVK0j3z.q4UMc7mY2NvQMiUieBPBaoDsFFOz.4a', 'donor', 'Wowowin.org', NULL, NULL, 'approved', '2025-08-30 05:09:37'),
(3, 'Kyle John Grengia', 'kylegwapo@gmail.com', '$2y$10$UdKbfVcKAWLqqQ7WZ2OYjOgtskIh/ji9qndf91Xg2NP7uAqG6oN7.', 'recipient', 'ABC corp', NULL, NULL, 'approved', '2025-08-30 08:09:38');

--
-- (removed indexes for unused table reports)

-- (removed indexes for unused table requests)

--
-- (indexes moved inline in CREATE TABLE `users`)

--
-- (indexes will be defined inline or below after CREATEs)

--
-- AUTO_INCREMENT for dumped tables
--

--
-- (AUTO_INCREMENT moved inline in CREATE TABLE `donations`)

-- --------------------------------------------------------

--
-- Table structure for table `food_safety_checks`
--

DROP TABLE IF EXISTS `food_safety_checks`;
CREATE TABLE `food_safety_checks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `donation_id` int(11) DEFAULT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `packaging_ok` tinyint(1) DEFAULT NULL,
  `spoilage_ok` tinyint(1) DEFAULT NULL,
  `storage_temp` varchar(50) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `receipt_image` varchar(255) NOT NULL,
  `result` enum('passed','failed') NOT NULL,
  `fail_reason` text DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `donation_id` (`donation_id`),
  KEY `batch_id` (`batch_id`),
  KEY `created_by` (`created_by`),
  KEY `result` (`result`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `food_safety_item_photos`
--

DROP TABLE IF EXISTS `food_safety_item_photos`;
CREATE TABLE `food_safety_item_photos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `check_id` int(11) NOT NULL,
  `donation_item_id` int(11) DEFAULT NULL,
  `photo_url` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `check_id` (`check_id`),
  KEY `donation_item_id` (`donation_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- (indexes moved inline in CREATE TABLE statements above)

-- (removed auto_increment for unused table donation_monitoring)

-- (removed auto_increment for unused table matches)

-- (removed auto_increment for unused table messages)

-- (removed auto_increment for unused table reports)

-- (removed auto_increment for unused table requests)

--
-- (AUTO_INCREMENT moved inline in CREATE TABLE `users`)

--
-- (AUTO_INCREMENT moved inline in CREATE TABLE `food_safety_checks`)

--
-- (AUTO_INCREMENT moved inline in CREATE TABLE `food_safety_item_photos`)

--
-- Constraints for dumped tables
--

--
-- Constraints for table `donations`
--
ALTER TABLE `donations`
  ADD CONSTRAINT `donations_ibfk_1` FOREIGN KEY (`donor_id`) REFERENCES `users` (`user_id`);

-- (removed FKs for unused table donation_monitoring)

-- (removed FKs for unused table matches)

-- (removed FKs for unused table messages)

-- (removed FKs for unused table reports)

-- (removed FKs for unused table requests)

--
-- Constraints for table `food_safety_checks`
--
ALTER TABLE `food_safety_checks`
  ADD CONSTRAINT `food_safety_checks_ibfk_1` FOREIGN KEY (`donation_id`) REFERENCES `donations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `food_safety_checks_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

--
-- Constraints for table `food_safety_item_photos`
--
ALTER TABLE `food_safety_item_photos`
  ADD CONSTRAINT `food_safety_item_photos_ibfk_1` FOREIGN KEY (`check_id`) REFERENCES `food_safety_checks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `food_safety_item_photos_ibfk_2` FOREIGN KEY (`donation_item_id`) REFERENCES `donations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
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
  KEY `user_id` (`user_id`),
  KEY `read_status` (`read_status`),
  KEY `created_at` (`created_at`),
  KEY `type` (`type`),
  KEY `ref_type_ref_id` (`reference_type`,`reference_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
 SET FOREIGN_KEY_CHECKS=1;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
