const Joi = require('joi');
const { body, validationResult } = require('express-validator');

// Joi schemas for complex validation
const schemas = {
    register: Joi.object({
        username: Joi.string().alphanum().min(3).max(30).required()
            .pattern(/^[a-zA-Z0-9_]+$/)
            .messages({
                'string.pattern.base': 'Username can only contain letters, numbers, and underscores'
            }),
        email: Joi.string().email().required().max(255),
        password: Joi.string()
            .min(8)
            .max(128)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .required()
            .messages({
                'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
            })
    }),

    login: Joi.object({
        email: Joi.string().email().required().max(255),
        password: Joi.string().required().max(128)
    }),

    songGeneration: Joi.object({
        workout: Joi.string().max(500).required().trim(),
        musicStyle: Joi.string().max(200).allow('').trim(),
        customStyle: Joi.string().max(200).allow('').trim(),
        tone: Joi.string().max(100).allow('').trim(),
        language: Joi.string().max(100).allow('').trim(),
        name: Joi.string().max(100).allow('').trim(),
        trackName: Joi.string().max(100).allow('').trim()
    }).custom((value, helpers) => {
        // At least one of musicStyle or customStyle must be provided
        if (!value.musicStyle && !value.customStyle) {
            return helpers.error('any.custom', { 
                message: 'Either musicStyle or customStyle must be provided' 
            });
        }
        return value;
    }),

    passwordReset: Joi.object({
        token: Joi.string().hex().length(64).required(),
        password: Joi.string()
            .min(8)
            .max(128)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .required(),
        confirmPassword: Joi.string().valid(Joi.ref('password')).required()
            .messages({ 'any.only': 'Passwords do not match' })
    })
};

// Generic Joi validation middleware
const validateSchema = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));
            
            return res.status(400).json({
                error: 'Validation failed',
                details: errors
            });
        }

        // Replace req.body with sanitized/validated data
        req.body = value;
        next();
    };
};

// Express-validator rules for simple validations
const validationRules = {
    email: () => [
        body('email')
            .isEmail()
            .normalizeEmail()
            .withMessage('Must be a valid email address')
            .isLength({ max: 255 })
            .withMessage('Email too long')
    ],

    songId: () => [
        body('songId')
            .isInt({ min: 1 })
            .withMessage('Song ID must be a positive integer')
    ]
};

// Middleware to check validation results
const checkValidationResult = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    next();
};

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
    const sanitizeString = (str) => {
        if (typeof str !== 'string') return str;
        return str.trim().replace(/[<>]/g, ''); // Basic XSS prevention
    };

    const sanitizeObject = (obj) => {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                obj[key] = sanitizeString(obj[key]);
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitizeObject(obj[key]);
            }
        }
    };

    if (req.body) sanitizeObject(req.body);
    if (req.query) sanitizeObject(req.query);
    if (req.params) sanitizeObject(req.params);

    next();
};

module.exports = {
    schemas,
    validateSchema,
    validationRules,
    checkValidationResult,
    sanitizeInput
};