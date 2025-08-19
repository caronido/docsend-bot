const app = require('./app');
const { logger } = require('./utils/logger');

// This file serves as the main entry point
// The app.js file already handles the startup logic

logger.info('DocSend Parser application starting...', { 
  environment: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000
});

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

// Start the application based on environment
const startApp = async () => {
  try {
    if (process.env.NODE_ENV === 'production') {
      // Production mode: Start HTTP server on Railway
      const port = process.env.PORT || 3000;
      await app.start(port);
      logger.info(`🚀 Production server started on port ${port}`);
    } else {
      // Development mode: Use Socket Mode for local development
      await app.start();
      logger.info('🔌 Development mode: Using Slack Socket Mode');
    }
  } catch (error) {
    logger.error('Failed to start application', { error: error.message });
    process.exit(1);
  }
};

// Start the application
startApp();

// Export the app for testing or external use
module.exports = app; 