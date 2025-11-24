<?php
/**
 * Database Handler
 * Handles database connections and common database operations
 */
class Database {
    private static $instance = null;
    private $pdo;
    private $stmt;

    /**
     * Get database instance (Singleton)
     */
    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructor - establish database connection
     */
    private function __construct() {
        try {
            error_log("=== DATABASE CONNECTION DEBUG ===");
            error_log("DB_HOST: " . DB_HOST);
            error_log("DB_NAME: " . DB_NAME);
            error_log("DB_USER: " . DB_USER);

            $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";
            error_log("DSN: " . $dsn);

            $options = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ];

            error_log("About to create PDO connection...");
            $this->pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
            error_log("PDO connection created successfully");

            // Test the connection
            $this->pdo->query("SELECT 1");
            error_log("Database connection test successful");
        } catch (PDOException $e) {
            error_log("Database connection failed: " . $e->getMessage());
            error_log("Error code: " . $e->getCode());
            throw new Exception('Connection failed: ' . $e->getMessage());
        }
    }

    /**
     * Execute a query with parameters
     */
    public function query($sql, $params = []) {
        try {
            error_log("=== DATABASE QUERY DEBUG ===");
            error_log("SQL: " . $sql);
            error_log("Params: " . json_encode($params));

            $this->stmt = $this->pdo->prepare($sql);
            error_log("Statement prepared successfully");

            $result = $this->stmt->execute($params);
            error_log("Query executed successfully");

            return $this;
        } catch (PDOException $e) {
            error_log("Query failed: " . $e->getMessage());
            error_log("SQL: " . $sql);
            error_log("Params: " . json_encode($params));
            error_log("Error code: " . $e->getCode());
            throw new Exception('Query failed: ' . $e->getMessage());
        }
    }

    /**
     * Get single record
     */
    public function fetch() {
        return $this->stmt->fetch();
    }

    /**
     * Get all records
     */
    public function fetchAll() {
        return $this->stmt->fetchAll();
    }

    /**
     * Get row count
     */
    public function rowCount() {
        return $this->stmt->rowCount();
    }

    /**
     * Get last insert ID
     */
    public function lastInsertId() {
        return $this->pdo->lastInsertId();
    }

    /**
     * Begin transaction
     */
    public function beginTransaction() {
        return $this->pdo->beginTransaction();
    }

    /**
     * Commit transaction
     */
    public function commit() {
        return $this->pdo->commit();
    }

    /**
     * Rollback transaction
     */
    public function rollBack() {
        try {
            if (!$this->pdo->inTransaction()) {
                error_log("Rollback requested but no active transaction.");
                return false;
            }
            return $this->pdo->rollBack();
        } catch (PDOException $e) {
            error_log("Rollback failed: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Check if a transaction is currently active
     */
    public function inTransaction() {
        return $this->pdo->inTransaction();
    }
}
