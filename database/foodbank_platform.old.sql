-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Sep 09, 2025 at 06:10 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `foodbank_platform`
--

-- --------------------------------------------------------

--
-- Table structure for table `donations`
--

CREATE TABLE `donations` (
  `id` int(11) NOT NULL,
  `donor_id` int(11) NOT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `type` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `quantity` int(11) NOT NULL,
  `expiry_date` date DEFAULT NULL,
  `status` enum('Pending','Acknowledged','Picked Up','Failed Safety','Cancelled','Completed') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `deleted_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `donations`
--

INSERT INTO `donations` (`id`, `donor_id`, `batch_id`, `type`, `name`, `quantity`, `expiry_date`, `status`, `created_at`, `deleted_at`) VALUES
(1, 2, '4f850fe6-b44b-4af8-baed-8c95b5f01ca6', 'Canned Goods', 'Sardines', 100, '2025-09-17', 'Completed', '2025-09-09 15:35:12', NULL),
(2, 2, '4f850fe6-b44b-4af8-baed-8c95b5f01ca6', 'Canned Goods', 'Beef Loaf', 100, '2025-09-17', 'Completed', '2025-09-09 15:35:12', NULL),
(3, 2, '1e32572a-a087-4845-9fa6-65c0702498ce', 'Frozen Meat', 'Lumpia', 1000, '2025-09-23', 'Failed Safety', '2025-09-09 15:37:22', NULL),
(4, 2, 'b31ed3fd-8e35-4ae0-af12-1194a617b240', 'Frozen Meat', 'Lumpia', 100, '2025-09-13', 'Failed Safety', '2025-09-09 15:53:18', NULL),
(5, 2, 'b31ed3fd-8e35-4ae0-af12-1194a617b240', 'Frozen Meat', 'Tocino', 100, '2025-09-13', 'Failed Safety', '2025-09-09 15:53:18', NULL),
(6, 2, '427b0833-b360-42ff-b536-705023fe02f4', 'Beverages', 'C2', 100, '2025-09-16', 'Pending', '2025-09-09 15:55:00', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `donation_cancellations`
--

CREATE TABLE `donation_cancellations` (
  `id` int(11) NOT NULL,
  `donation_id` int(11) DEFAULT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `reason` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `food_safety_checks`
--

CREATE TABLE `food_safety_checks` (
  `id` int(11) NOT NULL,
  `donation_id` int(11) DEFAULT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `packaging_ok` tinyint(1) DEFAULT NULL,
  `spoilage_ok` tinyint(1) DEFAULT NULL,
  `storage_temp` varchar(50) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `expiry_date_image` varchar(255) DEFAULT NULL,
  `receipt_image` varchar(255) NOT NULL,
  `result` enum('passed','failed') NOT NULL,
  `fail_reason` text DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `food_safety_checks`
--

INSERT INTO `food_safety_checks` (`id`, `donation_id`, `batch_id`, `packaging_ok`, `spoilage_ok`, `storage_temp`, `expiry_date`, `expiry_date_image`, `receipt_image`, `result`, `fail_reason`, `created_by`, `created_at`) VALUES
(1, NULL, '4f850fe6-b44b-4af8-baed-8c95b5f01ca6', 1, 1, '', NULL, NULL, 'images/uploads/food_safety/food_safety_20250909_233614_00c289bc.jpg', 'passed', NULL, 1, '2025-09-09 15:36:14'),
(2, 1, '4f850fe6-b44b-4af8-baed-8c95b5f01ca6', 1, 1, '', NULL, 'images/uploads/food_safety/food_safety_20250909_233615_ab6845e8.jpg', 'images/uploads/food_safety/food_safety_20250909_233614_00c289bc.jpg', 'passed', NULL, 1, '2025-09-09 15:36:15'),
(3, 2, '4f850fe6-b44b-4af8-baed-8c95b5f01ca6', 1, 1, '', NULL, 'images/uploads/food_safety/food_safety_20250909_233615_ca531b49.jpg', 'images/uploads/food_safety/food_safety_20250909_233614_00c289bc.jpg', 'passed', NULL, 1, '2025-09-09 15:36:15'),
(4, 3, NULL, 0, 0, '', NULL, NULL, '', 'failed', 'Signs of Spoilage', 1, '2025-09-09 15:37:47'),
(5, NULL, 'b31ed3fd-8e35-4ae0-af12-1194a617b240', 0, 0, '', NULL, NULL, '', 'failed', 'Thawed', 1, '2025-09-09 15:53:41');

-- --------------------------------------------------------

--
-- Table structure for table `inventory`
--

CREATE TABLE `inventory` (
  `id` int(11) NOT NULL,
  `item_name` varchar(255) NOT NULL,
  `category` varchar(50) DEFAULT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `expiry_date` date DEFAULT NULL,
  `donor_id` int(11) DEFAULT NULL,
  `source_donation_id` int(11) DEFAULT NULL,
  `source_batch_id` varchar(36) DEFAULT NULL,
  `added_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `inventory`
--

INSERT INTO `inventory` (`id`, `item_name`, `category`, `quantity`, `expiry_date`, `donor_id`, `source_donation_id`, `source_batch_id`, `added_at`) VALUES
(1, 'Sardines', 'Canned Goods', 100, '2025-09-17', 2, 1, '4f850fe6-b44b-4af8-baed-8c95b5f01ca6', '2025-09-09 15:36:15'),
(2, 'Beef Loaf', 'Canned Goods', 100, '2025-09-17', 2, 2, '4f850fe6-b44b-4af8-baed-8c95b5f01ca6', '2025-09-09 15:36:15');

-- --------------------------------------------------------

--
-- Table structure for table `inventory_movements`
--

CREATE TABLE `inventory_movements` (
  `id` int(11) NOT NULL,
  `inventory_id` int(11) NOT NULL,
  `direction` enum('in','out') NOT NULL,
  `quantity` int(11) NOT NULL,
  `mode` enum('recipient','onsite') DEFAULT NULL,
  `recipient_id` int(11) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `performed_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `type` varchar(100) NOT NULL,
  `reference_type` varchar(100) DEFAULT NULL,
  `reference_id` int(11) DEFAULT NULL,
  `message` varchar(255) NOT NULL,
  `read_status` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`id`, `user_id`, `type`, `reference_type`, `reference_id`, `message`, `read_status`, `created_at`) VALUES
(1, 1, 'donation_created', 'batch', NULL, 'No1Donor.org submitted a new donation batch (2 items)', 1, '2025-09-09 15:35:12'),
(2, 2, 'status_updated', 'batch', NULL, 'Your batch donation status updated to Acknowledged', 1, '2025-09-09 15:35:21'),
(3, 2, 'status_updated', 'batch', NULL, 'Your batch donation status updated to Picked Up', 1, '2025-09-09 15:36:15'),
(4, 2, 'status_updated', 'batch', NULL, 'Your batch donation status updated to Completed', 1, '2025-09-09 15:36:23'),
(5, 1, 'donation_created', 'batch', NULL, 'No1Donor.org submitted a new donation batch (1 items)', 1, '2025-09-09 15:37:22'),
(6, 2, 'status_updated', 'donation', 3, 'Donation \"Lumpia\" status updated to Acknowledged', 0, '2025-09-09 15:37:34'),
(7, 2, 'status_updated', 'donation', 3, 'Donation \"Lumpia\" status updated to Failed Safety. Reason: Signs of Spoilage', 0, '2025-09-09 15:37:47'),
(8, 1, 'donation_created', 'batch', NULL, 'No1Donor.org submitted a new donation batch (2 items)', 1, '2025-09-09 15:53:18'),
(9, 2, 'status_updated', 'batch', NULL, 'Your batch donation status updated to Acknowledged', 0, '2025-09-09 15:53:29'),
(10, 2, 'status_updated', 'batch', NULL, 'Your batch donation status updated to Failed Safety. Reason: Thawed', 0, '2025-09-09 15:53:41'),
(11, 1, 'donation_created', 'batch', NULL, 'No1Donor.org submitted a new donation batch (1 items)', 1, '2025-09-09 15:55:00');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `user_id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('donor','recipient','admin') NOT NULL,
  `organization_name` varchar(150) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `last_login` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`user_id`, `name`, `email`, `password_hash`, `role`, `organization_name`, `contact_number`, `address`, `status`, `created_at`, `last_login`) VALUES
(1, 'Ian Jay Calonia', 'icarusjay.lee@gmail.com', '$2y$10$nf2hc4LDryXah.oqAgjPBu49t2HII0Dex.0q3ZKxqSL/jfDRjy0hO', 'admin', 'Cebu Food Bank', NULL, 'Subangdaku, Mandaue City', 'approved', '2025-08-30 03:04:15', '2025-09-09 12:48:15'),
(2, 'Jay Piañar', 'babidi@gmail.com', '$2y$10$nl3jGWzN/BK5FmzVK0j3z.q4UMc7mY2NvQMiUieBPBaoDsFFOz.4a', 'donor', 'No1Donor.org', NULL, 'Tabok, Mandaue City', 'approved', '2025-08-30 05:09:37', '2025-09-09 10:23:23'),
(3, 'Kyle John Grengia', 'kylegwapo@gmail.com', '$2y$10$UdKbfVcKAWLqqQ7WZ2OYjOgtskIh/ji9qndf91Xg2NP7uAqG6oN7.', 'recipient', 'ABC corp', NULL, 'Labogon, Mandaue City', 'approved', '2025-08-30 08:09:38', '2025-09-08 03:35:43');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `donations`
--
ALTER TABLE `donations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `donor_id` (`donor_id`),
  ADD KEY `batch_id` (`batch_id`),
  ADD KEY `status` (`status`);

--
-- Indexes for table `donation_cancellations`
--
ALTER TABLE `donation_cancellations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `donation_id` (`donation_id`),
  ADD KEY `batch_id` (`batch_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `food_safety_checks`
--
ALTER TABLE `food_safety_checks`
  ADD PRIMARY KEY (`id`),
  ADD KEY `donation_id` (`donation_id`),
  ADD KEY `batch_id` (`batch_id`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `result` (`result`);

--
-- Indexes for table `inventory`
--
ALTER TABLE `inventory`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_source_donation` (`source_donation_id`),
  ADD KEY `donor_id` (`donor_id`),
  ADD KEY `source_batch_id` (`source_batch_id`);

--
-- Indexes for table `inventory_movements`
--
ALTER TABLE `inventory_movements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `inventory_id` (`inventory_id`),
  ADD KEY `recipient_id` (`recipient_id`),
  ADD KEY `performed_by` (`performed_by`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `read_status` (`read_status`),
  ADD KEY `created_at` (`created_at`),
  ADD KEY `type` (`type`),
  ADD KEY `ref_type_ref_id` (`reference_type`,`reference_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`user_id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `donations`
--
ALTER TABLE `donations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `donation_cancellations`
--
ALTER TABLE `donation_cancellations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `food_safety_checks`
--
ALTER TABLE `food_safety_checks`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `inventory`
--
ALTER TABLE `inventory`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `inventory_movements`
--
ALTER TABLE `inventory_movements`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `user_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `donations`
--
ALTER TABLE `donations`
  ADD CONSTRAINT `donations_ibfk_1` FOREIGN KEY (`donor_id`) REFERENCES `users` (`user_id`);

--
-- Constraints for table `food_safety_checks`
--
ALTER TABLE `food_safety_checks`
  ADD CONSTRAINT `food_safety_checks_ibfk_1` FOREIGN KEY (`donation_id`) REFERENCES `donations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `food_safety_checks_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON UPDATE CASCADE;

--
-- Constraints for table `inventory`
--
ALTER TABLE `inventory`
  ADD CONSTRAINT `inventory_ibfk_1` FOREIGN KEY (`donor_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_ibfk_2` FOREIGN KEY (`source_donation_id`) REFERENCES `donations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `inventory_movements`
--
ALTER TABLE `inventory_movements`
  ADD CONSTRAINT `inventory_movements_ibfk_1` FOREIGN KEY (`inventory_id`) REFERENCES `inventory` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_movements_ibfk_2` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `inventory_movements_ibfk_3` FOREIGN KEY (`performed_by`) REFERENCES `users` (`user_id`) ON UPDATE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
