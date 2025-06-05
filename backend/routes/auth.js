// backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, hashPassword, comparePassword } = require('../database');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/emailSender');
const { logger, logSecurityEvent } = require('../utils/logger');
const { validateSchema, schemas } = require('../middleware/validation');
const { 
    authLimiter, 
    passwordResetLimiter, 
    trackFailedLogin, 
    clearFailedAttempts, 
    isAccountLocked 
} = require('../middleware/rateLimiter');
const router = express.Router();

const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h'; // Use environment variable or default
const RESET_TOKEN_EXPIRY_HOURS = 1; // Password reset token valid for 1 hour

// Register User
router.post('/register', authLimiter, validateSchema(schemas.register), async (req, res) => {
    const { username, email, password } = req.body;

    try {
        logger.info('Registration attempt', { 
            username, 
            email: email.substring(0, 3) + '***', 
            ip: req.ip 
        });
        const emailCheckResult = await query("SELECT id, is_verified FROM users WHERE email = $1", [email]);
        const existingVerifiedUser = emailCheckResult.rows.find(user => user.is_verified);
        const existingUnverifiedUser = emailCheckResult.rows.find(user => !user.is_verified);

        if (existingVerifiedUser) {
            logSecurityEvent('DUPLICATE_REGISTRATION_ATTEMPT', {
                email: email.substring(0, 3) + '***',
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            return res.status(409).json({ error: "Email is already registered and verified." });
        }

        const usernameCheckResult = await query("SELECT id FROM users WHERE username = $1", [username]);
        const existingUsername = usernameCheckResult.rows[0];

        if (existingUsername && existingUsername.id !== existingUnverifiedUser?.id) {
            logSecurityEvent('DUPLICATE_USERNAME_ATTEMPT', {
                username,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            return res.status(409).json({ error: "Username already taken." });
        }

        const hashedPassword = await hashPassword(password);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiryHours = parseInt(process.env.VERIFICATION_TOKEN_EXPIRES_IN_HOURS || '24', 10);
        const expiresAt = new Date(Date.now() + tokenExpiryHours * 60 * 60 * 1000);

        let userId;
        if (existingUnverifiedUser) {
            userId = existingUnverifiedUser.id;
            const updateSql = `
                UPDATE users
                SET password_hash = $1, verification_token = $2, verification_token_expires = $3, username = $4 
                WHERE id = $5`; // Also update username in case it changed
            await query(updateSql, [hashedPassword, verificationToken, expiresAt, username, userId]);
            console.log(`Updated existing unverified user ID: ${userId} for re-verification.`);
        } else {
            const insertSql = `
                INSERT INTO users (username, email, password_hash, verification_token, verification_token_expires, is_verified, credits)
                VALUES ($1, $2, $3, $4, $5, FALSE, 2) 
                RETURNING id`;
            const insertResult = await query(insertSql, [username, email, hashedPassword, verificationToken, expiresAt]);
            userId = insertResult.rows[0].id;
            logger.info('New user registered', { userId, username, email: email.substring(0, 3) + '***' });
        }

        const emailSent = await sendVerificationEmail(email, verificationToken);

        if (!emailSent) {
            logger.error('Failed to send verification email', { 
                userId, 
                email: email.substring(0, 3) + '***' 
            });
            return res.status(201).json({
                 message: "Registration successful, but failed to send verification email. Please contact support or try verifying later.",
                 userId: userId
            });
        }

        logger.info('Registration completed successfully', { userId, username });
        res.status(201).json({
            message: "Registration successful! Please check your email (and spam folder) for a verification link.",
            userId: userId
        });

    } catch (error) {
        logger.error('Registration error', { 
            error: error.message, 
            email: email?.substring(0, 3) + '***',
            ip: req.ip 
        });
        res.status(500).json({ error: "Server error during registration. Please try again later." });
    }
});

// Login User
router.post('/login', authLimiter, validateSchema(schemas.login), async (req, res) => {
    const { email, password } = req.body;

    // Check if account is locked
    if (isAccountLocked(email, req.ip)) {
        logSecurityEvent('LOGIN_ATTEMPT_LOCKED_ACCOUNT', {
            email: email.substring(0, 3) + '***',
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
        return res.status(423).json({ 
            error: "Account temporarily locked due to too many failed attempts. Please try again later." 
        });
    }

    try {
        logger.debug('Login attempt', { 
            email: email.substring(0, 3) + '***', 
            ip: req.ip 
        });
        const sql = `SELECT id, username, password_hash, credits, is_verified FROM users WHERE email = $1`;
        const result = await query(sql, [email]);
        const user = result.rows[0];

        if (!user) {
            trackFailedLogin(email, req.ip);
            logSecurityEvent('LOGIN_FAILED_USER_NOT_FOUND', {
                email: email.substring(0, 3) + '***',
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            return res.status(401).json({ error: "Invalid email or password." });
        }

        if (!user.is_verified) {
            logger.warn('Login attempt by unverified user', { 
                email: email.substring(0, 3) + '***',
                userId: user.id,
                ip: req.ip 
            });
            return res.status(403).json({ 
                error: "Please verify your email address before logging in. Check your inbox (and spam folder)." 
            });
        }
        
        const match = await comparePassword(password, user.password_hash);

        if (match) {
            // Clear failed attempts on successful login
            clearFailedAttempts(email, req.ip);
            
            const token = jwt.sign(
                { id: user.id, username: user.username },
                process.env.JWT_SECRET,
                { expiresIn: JWT_EXPIRY }
            );
            
            logger.info('Login successful', { 
                userId: user.id, 
                username: user.username,
                ip: req.ip 
            });
            
            res.json({
                message: "Login successful.",
                token,
                userId: user.id,
                username: user.username,
                credits: user.credits
            });
        } else {
            const isLocked = trackFailedLogin(email, req.ip);
            logSecurityEvent('LOGIN_FAILED_INVALID_PASSWORD', {
                email: email.substring(0, 3) + '***',
                userId: user.id,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                accountLocked: isLocked
            });
            res.status(401).json({ error: "Invalid email or password." });
        }

    } catch (error) {
        logger.error('Login error', { 
            error: error.message, 
            email: email?.substring(0, 3) + '***',
            ip: req.ip 
        });
        res.status(500).json({ error: "Server error during login. Please try again later." });
    }
});

// Verify Email Endpoint
router.get('/verify-email', async (req, res) => {
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

        const now = new Date();
        if (now > new Date(user.verification_token_expires)) { // Ensure comparison is with Date objects
            console.log(`Verification attempt failed: Token expired for user ID: ${user.id}`);
            return res.redirect('/verification-result.html?status=error&message=Expired_link');
        }

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


// ---- NEW: Request Password Reset Endpoint ----
router.post('/request-password-reset', passwordResetLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: "Email is required." });
    }

    try {
        const userResult = await query("SELECT id, email, is_verified FROM users WHERE email = $1", [email]);
        const user = userResult.rows[0];

        if (!user) {
            // Important: Don't reveal if an email address is registered or not for security reasons.
            // Send a generic success message even if the user doesn't exist.
            console.log(`Password reset requested for non-existent or unverified email: ${email}`);
            return res.status(200).json({ message: "If your email address is in our system, you will receive a password reset link shortly." });
        }

        // Optionally, only allow password reset for verified users
        if (!user.is_verified) {
            console.log(`Password reset requested for unverified email: ${email}. Instructing to verify first.`);
             return res.status(200).json({ message: "Your email address is not verified. Please verify your email before attempting a password reset. If you need a new verification link, please try signing up again or contact support." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

        const updateSql = `
            UPDATE users 
            SET reset_password_token = $1, reset_password_expires = $2 
            WHERE id = $3`;
        await query(updateSql, [resetToken, expiresAt, user.id]);

        const emailSent = await sendPasswordResetEmail(user.email, resetToken);

        if (!emailSent) {
            console.error(`Failed to send password reset email to ${user.email}.`);
            // Still send a generic success to the user, but log the error for admin.
            return res.status(200).json({ message: "If your email address is in our system, you will receive a password reset link shortly. There might be a delay." });
        }

        res.status(200).json({ message: "If your email address is in our system, you will receive a password reset link shortly." });

    } catch (error) {
        console.error("Request Password Reset Error:", error);
        // Generic message to prevent leaking information
        res.status(200).json({ message: "An error occurred. If the problem persists, please contact support." });
    }
});

// ---- NEW: Reset Password Endpoint ----
router.post('/reset-password', validateSchema(schemas.passwordReset), async (req, res) => {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password || !confirmPassword) {
        return res.status(400).json({ error: "Token, new password, and confirm password are required." });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match." });
    }
    // Add password strength validation here if desired (e.g., minimum length)
    if (password.length < 6) { // Example: Minimum 6 characters
        return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    try {
        const userResult = await query(
            "SELECT id, reset_password_expires FROM users WHERE reset_password_token = $1",
            [token]
        );
        const user = userResult.rows[0];

        if (!user) {
            return res.status(400).json({ error: "Invalid or expired password reset token. Please request a new one." });
        }

        const now = new Date();
        if (now > new Date(user.reset_password_expires)) {
            // Clear the expired token
            await query("UPDATE users SET reset_password_token = NULL, reset_password_expires = NULL WHERE id = $1", [user.id]);
            return res.status(400).json({ error: "Password reset token has expired. Please request a new one." });
        }

        const hashedPassword = await hashPassword(password);
        const updateSql = `
            UPDATE users 
            SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL 
            WHERE id = $2`;
        await query(updateSql, [hashedPassword, user.id]);

        // Optionally, log the user in by issuing a new JWT token here, or just confirm success.
        // For simplicity, we'll just confirm success.
        res.status(200).json({ message: "Password has been reset successfully. You can now log in with your new password." });

    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({ error: "Server error during password reset. Please try again later." });
    }
});


module.exports = router;
