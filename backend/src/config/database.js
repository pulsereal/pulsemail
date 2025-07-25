const { Pool } = require("pg");
require("dotenv").config();

// Database connection pool for Pulsemail PostgreSQL database
const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || "vmail",
    user: process.env.DB_USER || "vmail",
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test connection
pool.on("connect", () => {
    console.log("Connected to PostgreSQL database");
});

pool.on("error", (err) => {
    console.error("Database connection error:", err);
});

// Custom query function with error handling
const query = async (text, params) => {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log("Executed query", { text, duration, rows: res.rowCount });
        return res;
    } catch (error) {
        console.error("Database query error:", error);
        throw error;
    }
};

// Get client for transactions
const getClient = async () => {
    const client = await pool.connect();
    const query = client.query;
    const release = client.release;

    // Set a timeout of 5 seconds
    const timeout = setTimeout(() => {
        client.release(true);
    }, 5000);

    // Monkey patch the query method to keep track of the last query executed
    client.query = (...args) => {
        client.lastQuery = args;
        return query.apply(client, args);
    };

    client.release = () => {
        clearTimeout(timeout);
        client.query = query;
        client.release = release;
        return release.apply(client);
    };

    return client;
};

module.exports = {
    pool,
    query,
    getClient,
};
