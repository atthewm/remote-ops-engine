/**
 * Structured logger for the ops engine.
 * Uses winston for consistent formatting and level control.
 */
import winston from 'winston';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
export const logger = winston.createLogger({
    level: LOG_LEVEL,
    format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length > 0
            ? ` ${JSON.stringify(meta)}`
            : '';
        return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
    })),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            filename: 'logs/ops-engine.log',
            maxsize: 10 * 1024 * 1024, // 10 MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: 'logs/ops-engine-error.log',
            level: 'error',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 3,
        }),
    ],
});
//# sourceMappingURL=logger.js.map