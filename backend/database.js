// backend/database.js
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
    console.error("FATAL: POSTGRES_URL environment variable is not set.");
    console.error("Ensure the Vercel Postgres/Neon database is connected to the project in the Vercel dashboard.");
    // In a real app, you might throw an error here to prevent startup
}

// Create a connection pool
const pool = new Pool({
    connectionString: connectionString,
    // Increase timeouts slightly for serverless environments
    max: 10,
    idleTimeoutMillis: 40000, // Increased
    connectionTimeoutMillis: 30000, // Increased
    // Remove insecure SSL setting - Vercel/Neon connection strings handle SSL
});

pool.on('connect', () => {
    console.log('DB Pool: Connection established.');
});

pool.on('error', (err, client) => {
    console.error('DB Pool: Unexpected error on idle client', err);
});

// --- Database Initialization Function ---
// We will call this explicitly from server.js before starting the server
const initializeDatabase = async () => {
    console.log("Attempting database schema initialization...");
    let client; // Define client outside try block for finally scope
    try {
        client = await pool.connect();
        console.log("DB Init: Client connected.");

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
        console.log("DB Init: Users table checked/created.");

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
                status TEXT DEFAULT 'lyrics_pending', -- Default status for new requests
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("DB Init: Songs table checked/created (default status 'lyrics_pending').");

        // Add columns if they don't exist (Postgres version)
        await addColumnIfNotExistsPg(client, 'users', 'is_verified', 'BOOLEAN DEFAULT FALSE NOT NULL');
        await addColumnIfNotExistsPg(client, 'users', 'verification_token', 'TEXT');
        await addColumnIfNotExistsPg(client, 'users', 'verification_token_expires', 'TIMESTAMPTZ');

        console.log("Database schema initialization successful.");
        return true; // Indicate success

    } catch (err) {
        console.error("FATAL: Error initializing database schema:", err);
        // Throw the error so server.js knows initialization failed
        throw err;
    } finally {
        if (client) {
            client.release(); // Release the client back to the pool
            console.log("DB Init: Client released.");
        }
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
            console.log(`DB Init Helper: Column ${columnName} added to ${tableName}.`);
        } else {
             // console.log(`DB Init Helper: Column ${columnName} already exists in ${tableName}.`);
        }
    } catch (err) {
        if (!err.message.includes('already exists')) {
             console.error(`DB Init Helper: Error checking/adding column ${columnName} to ${tableName}:`, err);
             throw err; // Re-throw significant errors
        } else {
             // console.log(`DB Init Helper: Column ${columnName} already exists (concurrent add attempt?).`);
        }
    }
};

// --- Password Hashing (Keep as is) ---
const SALT_ROUNDS = 10;
const hashPassword = async (password) => {
    if (!password) throw new Error("Password cannot be empty");
    try {
        const salt = await bcrypt.genSalt(SALT_ROUNDS);
        return await bcrypt.hash(password, salt);
    } catch (error) {
        console.error("Error hashing password:", error);
        throw new Error("Failed to hash password.");
    }
};
const comparePassword = async (password, hash) => {
    if (!password || !hash) return false;
    try {
        return await bcrypt.compare(password, hash);
    } catch (error) {
        console.error("Error comparing password:", error);
        return false;
    }
};

// --- Export Query Function, Hashing Utils, and Initialization Function ---
const query = async (text, params) => {
    const start = Date.now();
    let client;
    try {
        client = await pool.connect();
        const res = await client.query(text, params);
        const duration = Date.now() - start;
        // console.log('Executed query', { text, params, duration, rows: res.rowCount });
        return res;
    } catch (err) {
         console.error('Database query error', { text, params, error: err });
         throw err; // Re-throw error for route handlers to catch
    } finally {
        if (client) client.release();
    }
};

module.exports = {
    query,
    initializeDatabase, // Export the init function
    hashPassword,
    comparePassword
};
