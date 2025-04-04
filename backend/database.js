// backend/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Error opening database", err.message);
    } else {
        console.log("Connected to the SQLite database.");
        initializeDatabase();
    }
});

const initializeDatabase = () => {
    db.serialize(() => {
        // Users Table - ADDED is_verified, verification_token, verification_token_expires
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            credits INTEGER DEFAULT 5 NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_verified BOOLEAN DEFAULT 0 NOT NULL,
            verification_token TEXT,
            verification_token_expires DATETIME
        )`, (err) => {
            if (err) console.error("Error creating/altering users table", err);
            else console.log("Users table checked/created.");
            // NOTE: In production, you'd use migration tools for schema changes
            // For development with SQLite, sometimes you might need to delete the .sqlite file
            // if you drastically change the schema AFTER it was already created.
             // Add columns if they don't exist (safer than dropping table)
            addColumnIfNotExists('users', 'is_verified', 'BOOLEAN DEFAULT 0 NOT NULL');
            addColumnIfNotExists('users', 'verification_token', 'TEXT');
            addColumnIfNotExists('users', 'verification_token_expires', 'DATETIME');
        });

        // Songs Table (Keep as is)
        db.run(`CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            workout_input TEXT, style_input TEXT, name_input TEXT, lyrics TEXT,
            suno_task_id TEXT UNIQUE, audio_url TEXT, title TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )`, (err) => {
            if (err) console.error("Error creating songs table", err);
             else console.log("Songs table checked/created.");
        });
    });
};

// Helper function to add columns without error if they exist
const addColumnIfNotExists = (tableName, columnName, columnDefinition) => {
    // Use db.all to get info for ALL columns, not just the first one
    db.all(`PRAGMA table_info(${tableName})`, (err, results) => {
        if (err) {
            console.error(`Error getting table info for ${tableName}:`, err);
            return;
        }
        // PRAGMA table_info returns an array of objects, one for each column
        // Need to check if any object in the array has a 'name' property equal to columnName
        if (Array.isArray(results)) {
             if (!results.some(column => column.name === columnName)) {
                db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`, (alterErr) => {
                    if (alterErr) console.error(`Error adding column ${columnName} to ${tableName}:`, alterErr);
                    else console.log(`Column ${columnName} added to ${tableName}.`);
                });
            }
        } else {
             console.error(`Unexpected result format for PRAGMA table_info(${tableName}):`, results);
        }
    });
};


// --- Password Hashing ---
const SALT_ROUNDS = 10; // Standard practice, adjust if needed

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
        throw new Error("Failed to hash password."); // Propagate error
    }
};

const comparePassword = async (password, hash) => {
    if (!password || !hash) {
        // Avoid bcrypt error with empty inputs, return false directly
        return false;
    }
    try {
        const match = await bcrypt.compare(password, hash);
        return match;
    } catch (error) {
        console.error("Error comparing password:", error);
        // Treat comparison errors as non-match for security
        return false;
    }
};

module.exports = { db, hashPassword, comparePassword };
