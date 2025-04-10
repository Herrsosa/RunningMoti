// backend/database.js
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Vercel automatically sets POSTGRES_URL environment variable
// when the database is connected to the project.
const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
    console.error("FATAL: POSTGRES_URL environment variable is not set.");
    console.error("Ensure the Vercel Postgres/Neon database is connected to the project in the Vercel dashboard.");
    // Optionally, exit or prevent server start if critical
    // process.exit(1);
}

// Create a connection pool
const pool = new Pool({
    connectionString: connectionString,
    // Recommended settings for Vercel Serverless Functions
    // Adjust max/idleTimeoutMillis based on expected load and Vercel plan limits
    max: 10, // Max number of clients in the pool
    idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
    connectionTimeoutMillis: 20000, // How long to wait for a connection attempt to succeed
    ssl: connectionString ? { rejectUnauthorized: false } : false // Required for Vercel Postgres/Neon
});

pool.on('connect', () => {
    console.log('Connected to PostgreSQL database via pool.');
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    // process.exit(-1); // Consider if errors are fatal
});

// --- Database Initialization ---
const initializeDatabase = async () => {
    console.log("Checking/Initializing database schema...");
    const client = await pool.connect();
    try {
        // Use IF NOT EXISTS for idempotency
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                credits INTEGER DEFAULT 5 NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                is_verified BOOLEAN DEFAULT FALSE NOT NULL,
                verification_token TEXT,
                verification_token_expires TIMESTAMPTZ
            );
        `);
        console.log("Users table checked/created.");

        await client.query(`
            CREATE TABLE IF NOT EXISTS songs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                workout_input TEXT,
                style_input TEXT,
                name_input TEXT,
                lyrics TEXT,
                suno_task_id TEXT UNIQUE,
                audio_url TEXT,
                title TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Songs table checked/created.");

        // Add columns if they don't exist (Postgres version)
        await addColumnIfNotExistsPg(client, 'users', 'is_verified', 'BOOLEAN DEFAULT FALSE NOT NULL');
        await addColumnIfNotExistsPg(client, 'users', 'verification_token', 'TEXT');
        await addColumnIfNotExistsPg(client, 'users', 'verification_token_expires', 'TIMESTAMPTZ');

        console.log("Database schema initialization complete.");

    } catch (err) {
        console.error("Error initializing database schema:", err);
        // Depending on the error, you might want to exit or handle differently
    } finally {
        client.release(); // Release the client back to the pool
    }
};

// Helper function for Postgres to add columns if they don't exist
const addColumnIfNotExistsPg = async (client, tableName, columnName, columnDefinition) => {
    try {
        const res = await client.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = $1
              AND column_name = $2;
        `, [tableName, columnName]);

        if (res.rowCount === 0) {
            await client.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
            console.log(`Column ${columnName} added to ${tableName}.`);
        }
    } catch (err) {
        // Ignore errors like "column already exists" if running concurrently,
        // but log others. Check error code/message if needed for robustness.
        if (!err.message.includes('already exists')) {
             console.error(`Error checking/adding column ${columnName} to ${tableName}:`, err);
        }
    }
};

// Call initialization function - runs once when the module is loaded
initializeDatabase().catch(err => {
    console.error("Failed to initialize database on startup:", err);
    // Consider exiting if DB init is critical for server start
    // process.exit(1);
});


// --- Password Hashing (Keep as is) ---
const SALT_ROUNDS = 10;

const hashPassword = async (password) => {
    if (!password) {
        throw new Error("Password cannot be empty");
    }
    try {
        const salt = await bcrypt.genSalt(SALT_ROUNDS);
        const hash = await bcrypt.hash(password, salt);
        return hash;
    } catch (error) {
        console.error("Error hashing password:", error);
        throw new Error("Failed to hash password.");
    }
};

const comparePassword = async (password, hash) => {
    if (!password || !hash) {
        return false;
    }
    try {
        const match = await bcrypt.compare(password, hash);
        return match;
    } catch (error) {
        console.error("Error comparing password:", error);
        return false;
    }
};

// --- Export Query Function and Hashing Utils ---
// Export a function to execute queries using the pool, handling client release
const query = async (text, params) => {
    const start = Date.now();
    const client = await pool.connect();
    try {
        const res = await client.query(text, params);
        const duration = Date.now() - start;
        // console.log('Executed query', { text, duration, rows: res.rowCount }); // Optional logging
        return res;
    } finally {
        client.release(); // Ensure client is always released
    }
};

module.exports = {
    query, // Use this function for all database interactions
    hashPassword,
    comparePassword
};
