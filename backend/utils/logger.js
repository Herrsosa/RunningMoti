const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4
};

// Define colors for each level
const colors = {
    error: 'red',
    warn: 'yellow', 
    info: 'green',
    http: 'magenta',
    debug: 'white'
};

winston.addColors(colors);

// Create custom format
const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize({ all: true }),
    winston.format.printf((info) => {
        const { timestamp, level, message, stack, ...meta } = info;
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level}]: ${stack || message} ${metaStr}`;
    })
);

// Define transports
const transports = [
    new winston.transports.Console({
        level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
        format: format
    })
];

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
    transports.push(
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/error.log'),
            level: 'error',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            )
        }),
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/combined.log'),
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            )
        })
    );
}

// Create the logger
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    levels,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports,
    exceptionHandlers: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.colorize(),
                winston.format.printf((info) => `${info.timestamp} [${info.level}]: ${info.message}`)
            )
        })
    ],
    exitOnError: false
});

// HTTP request logging middleware
const httpLogger = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            userId: req.userId || null
        };

        if (res.statusCode >= 400) {
            logger.warn('HTTP Request', logData);
        } else {
            logger.http('HTTP Request', logData);
        }
    });

    next();
};

// Security event logger
const logSecurityEvent = (event, details = {}) => {
    logger.warn('Security Event', {
        event,
        timestamp: new Date().toISOString(),
        ...details
    });
};

// Database operation logger
const logDatabaseOperation = (operation, details = {}) => {
    logger.debug('Database Operation', {
        operation,
        timestamp: new Date().toISOString(),
        ...details
    });
};

module.exports = {
    logger,
    httpLogger,
    logSecurityEvent,
    logDatabaseOperation
};