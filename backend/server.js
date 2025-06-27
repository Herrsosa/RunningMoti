const path = require('path');
// Load environment variables as early as possible
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Validate environment before proceeding
const { validateEnv, logEnvironmentStatus } = require('./utils/envValidator');
const config = validateEnv();

// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Import utilities
const { logger, httpLogger } = require('./utils/logger');
const { sanitizeInput } = require('./middleware/validation');
const { apiLimiter } = require('./middleware/rateLimiter');

// --- Import Database Initialization ---
const { initializeDatabase } = require('./database'); // Import the init function

// --- Import Routes ---
const authRoutes = require('./routes/auth');
const generateRoutes = require('./routes/generate');
const libraryRoutes = require('./routes/library');
const stripeRoutes = require('./routes/stripe');

const app = express();
const PORT = config.PORT || 5000;

// --- Security Middleware ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://cdn.jsdelivr.net", "https://cdn.vercel-insights.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.stripe.com", "https://vitals.vercel-insights.com"],
            mediaSrc: ["'self'", "https:"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net"]
        }
    }
}));

// CORS configuration
const corsOptions = {
    origin: config.NODE_ENV === 'production' 
        ? ['https://running-moti.vercel.app', 'https://your-domain.com'] 
        : ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:5000'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting
if (config.ENABLE_RATE_LIMITING) {
    app.use('/api/', apiLimiter);
}

// Request logging
app.use(httpLogger);

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization
app.use(sanitizeInput);

// --- Serve Static Files for Local Development ---
// This will serve files from the 'public' directory at the root level
// e.g., a request to /audio/example.mp3 will serve ../public/audio/example.mp3
app.use(express.static(path.join(__dirname, '../public')));

// Special handling for Stripe webhooks
// Note: Ensure this path matches your Stripe webhook configuration if it's different
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// --- API Routes ---
// Vercel handles serving static files (index.html, etc.) from the root.
// Express only needs to handle the API endpoints.
app.use('/api/auth', (req, res, next) => {
    logger.debug(`Auth request received: ${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
}, authRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/stripe', stripeRoutes);

// --- Health Check Endpoint ---
app.get('/api/health', (req, res) => {
    const healthCheck = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.NODE_ENV,
        version: require('./package.json').version || '1.0.0',
        memory: process.memoryUsage(),
        database: 'connected' // You could add actual DB health check here
    };
    
    res.json(healthCheck);
});

// --- API Documentation endpoint (development only) ---
if (config.NODE_ENV === 'development') {
    app.get('/api/docs', (req, res) => {
        res.json({
            endpoints: {
                health: 'GET /api/health',
                auth: {
                    register: 'POST /api/auth/register',
                    login: 'POST /api/auth/login',
                    verify: 'GET /api/auth/verify-email',
                    resetRequest: 'POST /api/auth/request-password-reset',
                    resetPassword: 'POST /api/auth/reset-password'
                },
                generate: {
                    lyrics: 'POST /api/generate/generate-lyrics',
                    audio: 'POST /api/generate/generate-audio',
                    lyricsStatus: 'GET /api/generate/lyrics-status/:songId',
                    audioStatus: 'GET /api/generate/audio-status/:songId'
                },
                library: {
                    songs: 'GET /api/library/songs',
                    profile: 'GET /api/library/profile',
                    deleteSong: 'DELETE /api/library/songs/:songId'
                }
            }
        });
    });
}


// --- Catch-all for 404 API routes ---
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// --- Error Handling Middleware ---
app.use((err, req, res, next) => {
    logger.error('Unhandled Error', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    // Don't send stack trace to client in production
    const isDev = config.NODE_ENV === 'development';
    res.status(err.status || 500).json({
        error: isDev ? err.message : 'Internal server error',
        ...(isDev && { stack: err.stack })
    });
});

// --- Graceful Shutdown ---
const gracefulShutdown = (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    // Close server
    server.close(() => {
        logger.info('HTTP server closed');
        
        // Close database connections, etc.
        process.exit(0);
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
};

// --- Start Server Function ---
const startServer = async () => {
    try {
        // Log environment status
        logEnvironmentStatus();
        
        // Ensure database schema is initialized before starting the server
        await initializeDatabase();
        logger.info("Database initialization completed successfully");

        const server = app.listen(PORT, () => {
            logger.info(`Server started successfully`, {
                port: PORT,
                environment: config.NODE_ENV,
                pid: process.pid
            });
            
            if (config.NODE_ENV === 'development') {
                logger.info(`API Documentation available at: http://localhost:${PORT}/api/docs`);
                logger.info(`Health check available at: http://localhost:${PORT}/api/health`);
            }
        });

        // Graceful shutdown handlers
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        return server;

    } catch (error) {
        logger.error("Failed to start server", {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
};

// --- Handle Uncaught Exceptions ---
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason, promise });
    process.exit(1);
});

// --- Export for testing ---
module.exports = app;

// --- Start the server if this file is run directly ---
if (require.main === module) {
    startServer();
}
