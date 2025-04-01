// backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { db, hashPassword, comparePassword } = require('../database');
const router = express.Router();

const JWT_EXPIRY = '1h'; // Token expiry time

// Register User
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, email, and password are required." });
    }

    try {
        const existingUser = await new Promise((resolve, reject) => {
            db.get("SELECT id FROM users WHERE username = ? OR email = ?", [username, email], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingUser) {
            return res.status(409).json({ error: "Username or email already exists." });
        }

        const hashedPassword = await hashPassword(password);
        const sql = `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`;

        db.run(sql, [username, email, hashedPassword], function (err) {
            if (err) {
                console.error("Registration DB Error:", err);
                return res.status(500).json({ error: "Failed to register user." });
            }
            const userId = this.lastID;
            // Issue JWT token upon successful registration
            const token = jwt.sign({ id: userId, username: username }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
            res.status(201).json({ message: "User registered successfully.", token, userId, username, credits: 5 }); // Return initial credits
        });
    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ error: "Server error during registration." });
    }
});

// Login User
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    const sql = `SELECT id, username, password_hash, credits FROM users WHERE email = ?`;
    db.get(sql, [email], async (err, user) => {
        if (err) {
            console.error("Login DB Error:", err);
            return res.status(500).json({ error: "Database error during login." });
        }
        if (!user) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        try {
            const match = await comparePassword(password, user.password_hash);
            if (match) {
                const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
                res.json({ message: "Login successful.", token, userId: user.id, username: user.username, credits: user.credits });
            } else {
                res.status(401).json({ error: "Invalid email or password." });
            }
        } catch (error) {
            console.error("Password comparison error:", error);
            res.status(500).json({ error: "Server error during login." });
        }
    });
});

module.exports = router;