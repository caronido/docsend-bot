const app = require('./app');
const { logger } = require('./utils/logger');

// This file serves as the main entry point
// The app.js file already handles the startup logic

logger.info('DocSend Parser application starting...');

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Export the app for testing or external use
module.exports = app; 