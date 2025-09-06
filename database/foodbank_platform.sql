
-- Modified Foodbank Platform Schema

-- -----------------------------------------------------
-- Table `users`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('admin','donor','recipient') NOT NULL,
  `email` varchar(100) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Keep existing user data
INSERT INTO `users` (`id`, `username`, `password`, `role`, `email`, `created_at`) VALUES
(1, 'admin', 'hashed_password', 'admin', 'admin@example.com', '2025-09-06 00:00:00');

-- -----------------------------------------------------
-- Table `donations`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `donations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `donor_id` int(11) DEFAULT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `type` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `quantity` int(11) NOT NULL,
  `expiry_date` date NOT NULL,
  `status` enum('Pending','Allocated','Picked Up','Arrived at warehouse','Failed Safety','Completed','Cancelled') NOT NULL DEFAULT 'Pending',
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- -----------------------------------------------------
-- Table `food_safety_checks`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `food_safety_checks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `donation_id` int(11) DEFAULT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `packaging_ok` tinyint(1) NOT NULL,
  `spoilage_ok` tinyint(1) NOT NULL,
  `storage_temp` varchar(50) NOT NULL,
  `expiry_date_image` varchar(255) DEFAULT NULL,
  `receipt_image` varchar(255) DEFAULT NULL,
  `result` enum('Passed','Failed') NOT NULL,
  `fail_reason` text DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
