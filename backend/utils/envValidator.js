const Joi = require('joi');
const { logger } = require('./logger');

// Define required environment variables schema
const envSchema = Joi.object({
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    PORT: Joi.number().port().default(5000),
    
    // Database
    POSTGRES_URL: Joi.string().uri().required(),
    
    // JWT
    JWT_SECRET: Joi.string().min(32).required(),
    JWT_EXPIRY: Joi.string().default('1h'),
    
    // OpenAI
    OPENAI_API_KEY: Joi.string().required(),
    OPENAI_API_ENDPOINT: Joi.string().uri().default('https://api.openai.com/v1/chat/completions'),
    
    // Suno
    SUNO_API_KEY: Joi.string().required(),
    SUNO_API_ENDPOINT: Joi.string().uri().required(),
    SUNO_CALLBACK_URL: Joi.string().uri().required(),
    
    // Email
    MAILERSEND_API_KEY: Joi.string().required(),
    
    // Stripe (optional)
    STRIPE_SECRET_KEY: Joi.string().allow(''),
    STRIPE_WEBHOOK_SECRET: Joi.string().allow(''),
    
    // Verification
    VERIFICATION_TOKEN_EXPIRES_IN_HOURS: Joi.number().min(1).max(168).default(24), // 1 hour to 1 week
    
    // Rate limiting
    ENABLE_RATE_LIMITING: Joi.boolean().default(true)
}).unknown(true); // Allow other env vars

/**
 * Validate environment variables
 * @returns {Object} Validated environment configuration
 */
const validateEnv = () => {
    const { error, value } = envSchema.validate(process.env, {
        abortEarly: false,
        stripUnknown: false
    });

    if (error) {
        const missingVars = error.details.map(detail => detail.path.join('.')).join(', ');
        logger.error('Environment validation failed', {
            missingOrInvalid: missingVars,
            details: error.details.map(d => ({
                variable: d.path.join('.'),
                message: d.message
            }))
        });
        
        console.error('❌ FATAL: Environment validation failed');
        console.error('Missing or invalid environment variables:', missingVars);
        console.error('Please check your .env file and ensure all required variables are set.');
        process.exit(1);
    }

    return value;
};

/**
 * Check if running in production environment
 * @returns {boolean}
 */
const isProduction = () => {
    return process.env.NODE_ENV === 'production';
};

/**
 * Check if running in development environment
 * @returns {boolean}
 */
const isDevelopment = () => {
    return process.env.NODE_ENV === 'development';
};

/**
 * Get database connection string with validation
 * @returns {string}
 */
const getDatabaseUrl = () => {
    const url = process.env.POSTGRES_URL;
    if (!url) {
        throw new Error('POSTGRES_URL environment variable is required');
    }
    return url;
};

/**
 * Validate API keys are present
 * @returns {Object}
 */
const getApiKeys = () => {
    const keys = {
        openai: process.env.OPENAI_API_KEY,
        suno: process.env.SUNO_API_KEY,
        mailersend: process.env.MAILERSEND_API_KEY,
        jwt: process.env.JWT_SECRET
    };

    const missing = Object.entries(keys)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        throw new Error(`Missing required API keys: ${missing.join(', ')}`);
    }

    return keys;
};

/**
 * Log environment status
 */
const logEnvironmentStatus = () => {
    const env = validateEnv();
    
    logger.info('Environment configuration loaded', {
        nodeEnv: env.NODE_ENV,
        port: env.PORT,
        hasDatabase: !!env.POSTGRES_URL,
        hasOpenAI: !!env.OPENAI_API_KEY,
        hasSuno: !!env.SUNO_API_KEY,
        hasMailer: !!env.MAILERSEND_API_KEY,
        hasStripe: !!env.STRIPE_SECRET_KEY,
        rateLimitingEnabled: env.ENABLE_RATE_LIMITING
    });
    
    if (isDevelopment()) {
        logger.debug('Running in development mode');
    } else if (isProduction()) {
        logger.info('Running in production mode');
    }
};

module.exports = {
    validateEnv,
    isProduction,
    isDevelopment,
    getDatabaseUrl,
    getApiKeys,
    logEnvironmentStatus
};