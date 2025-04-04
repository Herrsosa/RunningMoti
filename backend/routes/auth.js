// backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // For token generation
const { db, hashPassword, comparePassword } = require('../database');
const { sendVerificationEmail } = require('../utils/emailSender'); // Import email sender
const router = express.Router();

const JWT_EXPIRY = '1h';

// Register User - MODIFIED
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, email, and password are required." });
    }

    try {
        // Check if user exists (can be combined)
        const existingUser = await new Promise((resolve, reject) => {
             db.get("SELECT id, is_verified FROM users WHERE email = ?", [email], (err, row) => {
                if (err) reject(err);
                // Allow re-registration attempt if email exists BUT is not verified yet
                else resolve(row);
            });
        });

        if (existingUser && existingUser.is_verified) {
            return res.status(409).json({ error: "Email is already registered and verified." });
        }
         // Optional: Check username uniqueness separately if needed
        const existingUsername = await new Promise((resolve, reject) => {
             db.get("SELECT id FROM users WHERE username = ?", [username], (err, row) => {
                  if (err) reject(err);
                  else resolve(row);
             });
         });
          if (existingUsername && existingUsername.id !== existingUser?.id) { // Ensure it's not the same unverified user
              return res.status(409).json({ error: "Username already taken." });
          }


        const hashedPassword = await hashPassword(password);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiryHours = parseInt(process.env.VERIFICATION_TOKEN_EXPIRES_IN_HOURS || '24', 10);
        const expiresAt = new Date(Date.now() + tokenExpiryHours * 60 * 60 * 1000);

        let userId;
        if (existingUser && !existingUser.is_verified) {
            // Update existing unverified user record with new password, token, expiry
            userId = existingUser.id;
            const updateSql = `UPDATE users SET password_hash = ?, verification_token = ?, verification_token_expires = ? WHERE id = ?`;
             await new Promise((resolve, reject) => {
                db.run(updateSql, [hashedPassword, verificationToken, expiresAt.toISOString(), userId], function(err) {
                     if (err) reject(new Error(`Failed to update existing user for verification. SQLite error: ${err.message}`)); // Include SQLite error
                     else resolve();
                });
            });
            console.log(`Updated existing unverified user ID: ${userId} for re-verification.`);
        } else {
             // Insert new user
             const insertSql = `INSERT INTO users (username, email, password_hash, verification_token, verification_token_expires, is_verified) VALUES (?, ?, ?, ?, ?, 0)`;
             userId = await new Promise((resolve, reject) => {
                 db.run(insertSql, [username, email, hashedPassword, verificationToken, expiresAt.toISOString()], function (err) {
                     if (err) reject(new Error(`Failed to register user. SQLite error: ${err.message}`)); // Include SQLite error
                     else resolve(this.lastID);
                 });
             });
             console.log(`Registered new user ID: ${userId}`);
        }


        // Send verification email
        const emailSent = await sendVerificationEmail(email, verificationToken);

        if (!emailSent) {
            // Don't fail the whole registration, but log it. User might retry later.
            console.error(`Failed to send verification email to ${email} for user ID ${userId}. User needs to verify manually or request resend.`);
            // You might want to return a specific status or message indicating email failure
            return res.status(201).json({
                 message: "Registration successful, but failed to send verification email. Please contact support or try verifying later.",
                 userId: userId // Still return user ID if needed
            });
        }

        res.status(201).json({
            message: "Registration successful! Please check your email (and spam folder) for a verification link.",
            userId: userId // Send back user ID if needed frontend side
        });
        // DO NOT send JWT token here

    } catch (error) {
        console.error("Registration Error:", error);
        res.status(500).json({ error: error.message || "Server error during registration." });
    }
});

// Login User - MODIFIED
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    // Include is_verified in the select
    const sql = `SELECT id, username, password_hash, credits, is_verified FROM users WHERE email = ?`;
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
                // --- ADD VERIFICATION CHECK ---
                if (!user.is_verified) {
                    console.log(`Login attempt failed for unverified user: ${email}`);
                    // Optional: Offer to resend verification?
                    return res.status(403).json({ error: "Please verify your email address before logging in. Check your inbox (and spam folder)." });
                }
                // --- END VERIFICATION CHECK ---

                // If password matches AND user is verified, issue token
                const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRY });
                res.json({ message: "Login successful.", token, userId: user.id, username: user.username, credits: user.credits });
            } else {
                res.status(401).json({ error: "Invalid email or password." });
            }
        } catch (error) {
            console.error("Password comparison or verification check error:", error);
            res.status(500).json({ error: "Server error during login." });
        }
    });
});

// NEW: Verify Email Endpoint
router.get('/verify-email', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        // Redirect to an error page on the frontend
        return res.redirect('/verification-result.html?status=error&message=Missing_token');
    }

    const sql = `SELECT id, is_verified, verification_token_expires FROM users WHERE verification_token = ?`;

    db.get(sql, [token], async (err, user) => {
        if (err) {
            console.error("Verification DB Error:", err);
             return res.redirect('/verification-result.html?status=error&message=Database_error');
        }

        if (!user) {
            console.log(`Verification attempt failed: Token ${token} not found.`);
            // Token not found (already used or invalid)
             return res.redirect('/verification-result.html?status=error&message=Invalid_or_expired_link');
        }

        if (user.is_verified) {
             console.log(`Verification attempt for already verified user ID: ${user.id}`);
             // Already verified - maybe redirect to login?
             return res.redirect('/verification-result.html?status=success&message=Already_verified');
        }

        // Check expiry
        const now = new Date();
        const expires = new Date(user.verification_token_expires);
        if (now > expires) {
             console.log(`Verification attempt failed: Token expired for user ID: ${user.id}`);
             // Optional: Delete expired token? Or allow resend?
             return res.redirect('/verification-result.html?status=error&message=Expired_link');
        }

        // If token is valid, not expired, and user not verified -> Verify the user!
        const updateSql = `UPDATE users SET is_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?`;
        db.run(updateSql, [user.id], function (updateErr) {
            if (updateErr) {
                console.error(`Failed to update user ${user.id} to verified status:`, updateErr);
                 return res.redirect('/verification-result.html?status=error&message=Verification_failed');
            }
            console.log(`User ID ${user.id} successfully verified.`);
             // Redirect to a success page on the frontend
             return res.redirect('/verification-result.html?status=success');
        });
    });
});


module.exports = router;
