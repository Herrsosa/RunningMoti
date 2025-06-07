const rateLimit = require('express-rate-limit');
const { logSecurityEvent } = require('../utils/logger');

// General API rate limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        logSecurityEvent('RATE_LIMIT_EXCEEDED', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
            limit: 'API_GENERAL'
        });
        res.status(options.statusCode).json(options.message);
    }
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 auth requests per windowMs
    message: {
        error: 'Too many authentication attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful requests
    handler: (req, res, next, options) => {
        logSecurityEvent('AUTH_RATE_LIMIT_EXCEEDED', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path,
            email: req.body?.email || 'unknown'
        });
        res.status(options.statusCode).json(options.message);
    }
});

// Rate limiter for password reset requests
const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Limit each IP to 3 password reset requests per hour
    message: {
        error: 'Too many password reset attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        logSecurityEvent('PASSWORD_RESET_RATE_LIMIT_EXCEEDED', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            email: req.body?.email || 'unknown'
        });
        res.status(options.statusCode).json(options.message);
    }
});

// Rate limiter for song generation
const generationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 2, // Limit each IP to 2 generation requests per minute
    message: {
        error: 'Too many song generation requests, please wait a moment.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        logSecurityEvent('GENERATION_RATE_LIMIT_EXCEEDED', {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            userId: req.userId || 'unknown'
        });
        res.status(options.statusCode).json(options.message);
    }
});

// Account lockout tracking
const failedAttempts = new Map();

const trackFailedLogin = (email, ip) => {
    const key = `${email}:${ip}`;
    const attempts = failedAttempts.get(key) || { count: 0, lastAttempt: Date.now() };
    
    // Reset counter if last attempt was more than 1 hour ago
    if (Date.now() - attempts.lastAttempt > 60 * 60 * 1000) {
        attempts.count = 0;
    }
    
    attempts.count++;
    attempts.lastAttempt = Date.now();
    failedAttempts.set(key, attempts);
    
    if (attempts.count >= 5) {
        logSecurityEvent('ACCOUNT_LOCKOUT', {
            email,
            ip,
            attempts: attempts.count
        });
        return true; // Account should be locked
    }
    
    return false;
};

const clearFailedAttempts = (email, ip) => {
    const key = `${email}:${ip}`;
    failedAttempts.delete(key);
};

const isAccountLocked = (email, ip) => {
    const key = `${email}:${ip}`;
    const attempts = failedAttempts.get(key);
    
    if (!attempts) return false;
    
    // Auto-unlock after 1 hour
    if (Date.now() - attempts.lastAttempt > 60 * 60 * 1000) {
        failedAttempts.delete(key);
        return false;
    }
    
    return attempts.count >= 5;
};

module.exports = {
    apiLimiter,
    authLimiter,
    passwordResetLimiter,
    generationLimiter,
    trackFailedLogin,
    clearFailedAttempts,
    isAccountLocked
};