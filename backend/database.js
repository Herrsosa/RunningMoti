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
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            credits INTEGER DEFAULT 5 NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error("Error creating users table", err);
            else console.log("Users table checked/created.");
        });

        // Songs Table
        db.run(`CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            workout_input TEXT,
            style_input TEXT,
            name_input TEXT,
            lyrics TEXT,
            suno_task_id TEXT UNIQUE, -- Make Task ID unique if possible from Suno
            audio_url TEXT,
            title TEXT,
            status TEXT DEFAULT 'pending', -- pending, processing, complete, error
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )`, (err) => {
            if (err) console.error("Error creating songs table", err);
             else console.log("Songs table checked/created.");
        });
    });
};

// Helper to hash password
const hashPassword = async (password) => {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
};

// Helper to compare password
const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};


module.exports = { db, hashPassword, comparePassword };