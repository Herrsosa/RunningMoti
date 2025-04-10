// backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // For token generation
// Import the new query function and hashing utils
const { query, hashPassword, comparePassword } = require('../database');
const { sendVerificationEmail } = require('../utils/emailSender'); // Import email sender
const router = express.Router();

const JWT_EXPIRY = '1h'; // Consider making this an environment variable

// Register User - REFACTORED for PostgreSQL
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, email, and password are required." });
    }

    try {
        // Use $1, $2 etc. for placeholders in pg
        // Check if email exists and is verified
        const emailCheckResult = await query("SELECT id, is_verified FROM users WHERE email = $1", [email]);
        const existingVerifiedUser = emailCheckResult.rows.find(user => user.is_verified);
        const existingUnverifiedUser = emailCheckResult.rows.find(user => !user.is_verified);

        if (existingVerifiedUser) {
            return res.status(409).json({ error: "Email is already registered and verified." });
        }

        // Check if username exists (and doesn't belong to the potentially existing unverified user)
        const usernameCheckResult = await query("SELECT id FROM users WHERE username = $1", [username]);
        const existingUsername = usernameCheckResult.rows[0];

        if (existingUsername && existingUsername.id !== existingUnverifiedUser?.id) {
            return res.status(409).json({ error: "Username already taken." });
        }

        const hashedPassword = await hashPassword(password);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiryHours = parseInt(process.env.VERIFICATION_TOKEN_EXPIRES_IN_HOURS || '24', 10);
        const expiresAt = new Date(Date.now() + tokenExpiryHours * 60 * 60 * 1000);

        let userId;
        if (existingUnverifiedUser) {
            // Update existing unverified user record
            userId = existingUnverifiedUser.id;
            const updateSql = `
                UPDATE users
                SET password_hash = $1, verification_token = $2, verification_token_expires = $3
                WHERE id = $4`;
            await query(updateSql, [hashedPassword, verificationToken, expiresAt, userId]); // Use expiresAt directly (TIMESTAMPTZ)
            console.log(`Updated existing unverified user ID: ${userId} for re-verification.`);
        } else {
            // Insert new user
            const insertSql = `
                INSERT INTO users (username, email, password_hash, verification_token, verification_token_expires, is_verified)
                VALUES ($1, $2, $3, $4, $5, FALSE)
                RETURNING id`; // Get the new ID back
            const insertResult = await query(insertSql, [username, email, hashedPassword, verificationToken, expiresAt]);
            userId = insertResult.rows[0].id;
            console.log(`Registered new user ID: ${userId}`);
        }

        // Send verification email (keep this logic)
        const emailSent = await sendVerificationEmail(email, verificationToken);

        if (!emailSent) {
            console.error(`Failed to send verification email to ${email} for user ID ${userId}. User needs to verify manually or request resend.`);
            return res.status(201).json({
                 message: "Registration successful, but failed to send verification email. Please contact support or try verifying later.",
                 userId: userId
            });
        }

        res.status(201).json({
            message: "Registration successful! Please check your email (and spam folder) for a verification link.",
            userId: userId
        });

    } catch (error) {
        console.error("Registration Error:", error);
        // Provide a more generic error in production
        res.status(500).json({ error: "Server error during registration. Please try again later." });
    }
});

// Login User - REFACTORED for PostgreSQL
router.post('/login', async (req, res) => { // Make async
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    try {
        const sql = `SELECT id, username, password_hash, credits, is_verified FROM users WHERE email = $1`;
        const result = await query(sql, [email]);
        const user = result.rows[0]; // Get the first row if it exists

        if (!user) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const match = await comparePassword(password, user.password_hash);

        if (match) {
            // Check verification status
            if (!user.is_verified) {
                console.log(`Login attempt failed for unverified user: ${email}`);
                return res.status(403).json({ error: "Please verify your email address before logging in. Check your inbox (and spam folder)." });
            }

            // Issue token if password matches and user is verified
            const token = jwt.sign(
                { id: user.id, username: user.username },
                process.env.JWT_SECRET,
                { expiresIn: JWT_EXPIRY }
            );
            res.json({
                message: "Login successful.",
                token,
                userId: user.id,
                username: user.username,
                credits: user.credits
            });
        } else {
            // Password doesn't match
            res.status(401).json({ error: "Invalid email or password." });
        }

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: "Server error during login. Please try again later." });
    }
});

// Verify Email Endpoint - REFACTORED for PostgreSQL
router.get('/verify-email', async (req, res) => { // Already async
    const { token } = req.query;

    if (!token) {
        return res.redirect('/verification-result.html?status=error&message=Missing_token');
    }

    try {
        const sql = `SELECT id, is_verified, verification_token_expires FROM users WHERE verification_token = $1`;
        const result = await query(sql, [token]);
        const user = result.rows[0];

        if (!user) {
            console.log(`Verification attempt failed: Token ${token} not found.`);
            return res.redirect('/verification-result.html?status=error&message=Invalid_or_expired_link');
        }

        if (user.is_verified) {
            console.log(`Verification attempt for already verified user ID: ${user.id}`);
            return res.redirect('/verification-result.html?status=success&message=Already_verified');
        }

        // Check expiry (Postgres TIMESTAMPTZ is directly comparable)
        const now = new Date();
        if (now > user.verification_token_expires) { // Direct comparison works
            console.log(`Verification attempt failed: Token expired for user ID: ${user.id}`);
            // Optional: Clean up expired token?
            // await query("UPDATE users SET verification_token = NULL, verification_token_expires = NULL WHERE id = $1", [user.id]);
            return res.redirect('/verification-result.html?status=error&message=Expired_link');
        }

        // Verify the user
        const updateSql = `
            UPDATE users
            SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL
            WHERE id = $1`;
        await query(updateSql, [user.id]);

        console.log(`User ID ${user.id} successfully verified.`);
        return res.redirect('/verification-result.html?status=success');

    } catch (error) {
        console.error("Verification Error:", error);
        return res.redirect('/verification-result.html?status=error&message=Verification_failed');
    }
});

module.exports = router;
