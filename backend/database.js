// backend/database.js
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto'); // Added for token generation, though tokens are generated in auth.js

const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
    console.error("FATAL: POSTGRES_URL environment variable is not set.");
    console.error("Ensure the Vercel Postgres/Neon database is connected to the project in the Vercel dashboard.");
}

const pool = new Pool({
    connectionString: connectionString,
    max: 10,
    idleTimeoutMillis: 40000,
    connectionTimeoutMillis: 30000,
});

pool.on('connect', () => {
    console.log('DB Pool: Connection established.');
});

pool.on('error', (err, client) => {
    console.error('DB Pool: Unexpected error on idle client', err);
});

const initializeDatabase = async () => {
    console.log("Attempting database schema initialization...");
    let client;
    try {
        client = await pool.connect();
        console.log("DB Init: Client connected.");

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                credits INTEGER DEFAULT 2 NOT NULL, -- Ensuring new users get 2 credits as per signup form
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                is_verified BOOLEAN DEFAULT FALSE NOT NULL,
                verification_token TEXT,
                verification_token_expires TIMESTAMPTZ,
                reset_password_token TEXT,          -- ADDED
                reset_password_expires TIMESTAMPTZ   -- ADDED
            );
        `);
        console.log("DB Init: Users table checked/created.");

        await client.query(`
            CREATE TABLE IF NOT EXISTS songs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                workout_input TEXT,
                style_input TEXT,
                custom_style TEXT, -- Added custom_style from generate.js logic
                tone_input TEXT, -- Added tone_input from generate.js logic
                language_input TEXT, -- Added language_input from generate.js logic
                name_input TEXT,
                lyrics TEXT,
                suno_task_id TEXT UNIQUE,
                audio_url TEXT,
                title TEXT,
                status TEXT DEFAULT 'lyrics_pending' CHECK(status IN (
                    'lyrics_pending', 'lyrics_processing', 'lyrics_complete', 'lyrics_error',
                    'audio_pending', 'audio_processing', 'processing', 'complete', 'error'
                )) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("DB Init: Songs table checked/created (with custom_style, tone_input, language_input).");

        // Add columns if they don't exist (Postgres version)
        await addColumnIfNotExistsPg(client, 'users', 'is_verified', 'BOOLEAN DEFAULT FALSE NOT NULL');
        await addColumnIfNotExistsPg(client, 'users', 'verification_token', 'TEXT');
        await addColumnIfNotExistsPg(client, 'users', 'verification_token_expires', 'TIMESTAMPTZ');
        await addColumnIfNotExistsPg(client, 'users', 'reset_password_token', 'TEXT'); // ADDED
        await addColumnIfNotExistsPg(client, 'users', 'reset_password_expires', 'TIMESTAMPTZ'); // ADDED
        
        // Ensure songs table has the newer columns if they were missed before
        await addColumnIfNotExistsPg(client, 'songs', 'custom_style', 'TEXT');
        await addColumnIfNotExistsPg(client, 'songs', 'tone_input', 'TEXT');
        await addColumnIfNotExistsPg(client, 'songs', 'language_input', 'TEXT');


        // Update default credits for existing users if they are at 5 (old default)
        // This is a one-time-ish migration logic.
        try {
            await client.query(`
                UPDATE users 
                SET credits = 2 
                WHERE credits = 5 AND NOT EXISTS (SELECT 1 FROM songs WHERE songs.user_id = users.id);
            `);
            console.log("DB Init: Attempted to normalize initial credit amounts for users without songs from 5 to 2.");
        } catch(updateErr) {
            console.warn("DB Init: Warning during credit normalization, possibly harmless:", updateErr.message);
        }


        console.log("Database schema initialization successful.");
        return true;

    } catch (err) {
        console.error("FATAL: Error initializing database schema:", err);
        throw err;
    } finally {
        if (client) {
            client.release();
            console.log("DB Init: Client released.");
        }
    }
};

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
        }
    } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('multiple primary keys for table')) { // Added check for multiple primary keys error
             console.error(`DB Init Helper: Error checking/adding column ${columnName} to ${tableName}:`, err);
             // Do not re-throw for "already exists" or "multiple primary keys" as these are not critical if the column is there.
             // For other errors, consider if re-throwing is appropriate or if logging is sufficient.
             // For now, we will log and continue, assuming it might be a concurrent creation attempt.
        } else {
             // console.log(`DB Init Helper: Column ${columnName} already exists in ${tableName} or harmless error.`);
        }
    }
};

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
         throw err;
    } finally {
        if (client) client.release();
    }
};

module.exports = {
    query,
    initializeDatabase,
    hashPassword,
    comparePassword,
    // crypto is a built-in Node module, no need to export it from here unless you wrap it
};
