const winston = require('winston');
const { config } = require('../config');

// PII redaction patterns
const PII_PATTERNS = [
  { pattern: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, replacement: '[EMAIL]' },
  { pattern: /(https?:\/\/docsend\.com\/view\/[a-zA-Z0-9]+)(\?[^\\s]*)?/g, replacement: '[DOCSEND_URL]' },
  { pattern: /(xoxb-[a-zA-Z0-9-]+)/g, replacement: '[SLACK_TOKEN]' },
  { pattern: /(xoxp-[a-zA-Z0-9-]+)/g, replacement: '[SLACK_TOKEN]' },
  { pattern: /(xoxa-[a-zA-Z0-9-]+)/g, replacement: '[SLACK_TOKEN]' },
  { pattern: /(xoxr-[a-zA-Z0-9-]+)/g, replacement: '[SLACK_TOKEN]' },
  { pattern: /(\b\d{4,6}\b)/g, replacement: '[OTP]' },
];

// Redact PII from log messages
function redactPII(message) {
  let redacted = message;
  PII_PATTERNS.forEach(({ pattern, replacement }) => {
    redacted = redacted.replace(pattern, replacement);
  });
  return redacted;
}

// Custom format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const redactedMessage = redactPII(message);
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase()}]: ${redactedMessage} ${metaStr}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'docsend-parser' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    })
  ]
});

// Add request context to logger
function createRequestLogger(requestId, userId, channelId) {
  return logger.child({
    requestId,
    userId,
    channelId,
    timestamp: new Date().toISOString()
  });
}

// Log job progress
function logJobProgress(jobId, status, details = {}) {
  logger.info('Job progress', {
    jobId,
    status,
    ...details
  });
}

// Log error with context
function logError(error, context = {}) {
  logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    ...context
  });
}

// Log security events
function logSecurityEvent(event, details = {}) {
  logger.warn('Security event', {
    event,
    ...details
  });
}

module.exports = {
  logger,
  createRequestLogger,
  logJobProgress,
  logError,
  logSecurityEvent,
  redactPII
}; 