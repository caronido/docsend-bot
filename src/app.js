const { App } = require('@slack/bolt');
const { config, validateConfig } = require('./config');
const { logger } = require('./utils/logger');
const RateLimiter = require('./utils/rateLimiter');
const JobProcessor = require('./services/jobProcessor');

// Determine environment and configuration
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = !isProduction;

logger.info('Initializing Slack app', { 
  environment: isProduction ? 'production' : 'development',
  socketMode: isDevelopment,
  port: process.env.PORT || 3000
});

// Initialize the Slack app with conditional Socket Mode
const appConfig = {
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
};

// Only use Socket Mode in development
if (isDevelopment) {
  if (!config.slack.appToken) {
    logger.error('App token required for development mode (Socket Mode)');
    process.exit(1);
  }
  appConfig.socketMode = true;
  appConfig.appToken = config.slack.appToken;
  logger.info('🔌 Development mode: Using Socket Mode');
} else {
  // Production mode: Configure for HTTP endpoints
  // Don't set socketMode - let Bolt default to HTTP mode
  logger.info('🚀 Production mode: Using HTTP endpoints');
}

const app = new App(appConfig);

// Initialize services
const rateLimiter = new RateLimiter();
const jobProcessor = new JobProcessor();

// Validate configuration on startup
try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed', { error: error.message });
  process.exit(1);
}

// Handle the /docsend-bot slash command
app.command('/docsend-bot', async ({ command, ack, respond }) => {
  try {
    // Acknowledge the command immediately
    await ack();
    
    const { user_id, channel_id, text, response_url, thread_ts } = command;
    
    logger.info('Slash command received', {
      userId: user_id,
      channelId: channel_id,
      command: text,
      threadTs: thread_ts
    });

    // Check permissions
    if (!rateLimiter.hasPermission(user_id, channel_id)) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ You do not have permission to use this command in this channel.'
      });
      return;
    }

    // Check rate limits
    const rateLimitCheck = await rateLimiter.canStartJob(user_id);
    if (!rateLimitCheck.allowed) {
      await respond({
        response_type: 'ephemeral',
        text: `⏳ ${rateLimitCheck.reason}${rateLimitCheck.retryAfter ? ` Please try again in ${Math.ceil(rateLimitCheck.retryAfter / 1000)} seconds.` : ''}`
      });
      return;
    }

    // Validate command text (should be a DocSend URL)
    if (!text || !text.trim()) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please provide a DocSend URL. Usage: `/docsend-bot <docsend_url> [pages]`\n\nExamples:\n• `/docsend-bot https://docsend.com/view/abc123` (default: 15 pages)\n• `/docsend-bot https://docsend.com/view/abc123 5` (5 pages)\n• `/docsend-bot https://docsend.com/view/abc123 all` (all pages)'
      });
      return;
    }

    // Parse command text for URL and optional page count
    const commandParts = text.trim().split(/\s+/);
    const docsendUrl = commandParts[0];
    const pageParam = commandParts[1];
    
    // Parse page parameter
    let maxPages = 15; // Default
    if (pageParam) {
      if (pageParam.toLowerCase() === 'all') {
        maxPages = config.rateLimiting.maxPages; // Use config max (300)
      } else {
        const parsedPages = parseInt(pageParam);
        if (isNaN(parsedPages) || parsedPages < 1 || parsedPages > config.rateLimiting.maxPages) {
          await respond({
            response_type: 'ephemeral',
            text: `❌ Invalid page count. Please provide a number between 1 and ${config.rateLimiting.maxPages}, or use 'all' for all pages.\n\nUsage: \`/docsend-bot <docsend_url> [pages]\``
          });
          return;
        }
        maxPages = parsedPages;
      }
    }
    
    logger.info('Parsed command parameters', { 
      url: docsendUrl, 
      pageParam, 
      maxPages,
      defaultMax: config.rateLimiting.maxPages
    });

    const docsendPattern = /^https?:\/\/docsend\.com\/view\/[a-zA-Z0-9]+(\?[^\s]*)?$/;
    if (!docsendPattern.test(docsendUrl)) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Invalid DocSend URL. Please provide a valid URL in the format: `https://docsend.com/view/...`'
      });
      return;
    }

    // Start the job asynchronously
    const jobData = {
      userId: user_id,
      channelId: channel_id,
      url: docsendUrl,
      responseUrl: response_url,
      threadTs: thread_ts,
      maxPages: maxPages // Pass maxPages to job processor
    };

    // Mark job as started in rate limiter
    rateLimiter.startJob(`job-${user_id}-${Date.now()}`, user_id);

    // Process job in background (don't await)
    jobProcessor.processJob(jobData).catch(error => {
      logger.error('Background job processing failed', {
        userId: user_id,
        channelId: channel_id,
        url: docsendUrl,
        error: error.message
      });
    });

    // Send immediate response
    await respond({
      response_type: 'ephemeral',
      text: `🔄 Starting DocSend conversion...\n📄 **Page limit:** ${maxPages === config.rateLimiting.maxPages ? 'All pages' : maxPages + ' pages'}\n⏱️ You'll receive the PDF when it's ready!`
    });

  } catch (error) {
    logger.error('Slash command handling failed', {
      command: command.text,
      userId: command.user_id,
      error: error.message,
      stack: error.stack
    });

    try {
      await respond({
        response_type: 'ephemeral',
        text: '❌ An error occurred while processing your command. Please try again.'
      });
    } catch (respondError) {
      logger.error('Failed to send error response', { error: respondError.message });
    }
  }
});

// Handle app mentions
app.event('app_mention', async ({ event, say }) => {
  try {
    const { user, text, channel, thread_ts } = event;
    
    logger.info('App mention received', { userId: user, channelId: channel, text });

    // Check if the mention contains a DocSend URL
    const docsendUrlMatch = text.match(/https?:\/\/docsend\.com\/view\/[a-zA-Z0-9]+(\?[^\s]*)?/);
    
    if (docsendUrlMatch) {
      const docsendUrl = docsendUrlMatch[0];
      
      // Parse optional page parameter from the mention text
      let maxPages = 15; // Default
      const pageMatch = text.match(/(?:pages?|limit)\s*[:=]?\s*(\d+|all)/i);
      if (pageMatch) {
        const pageParam = pageMatch[1];
        if (pageParam.toLowerCase() === 'all') {
          maxPages = config.rateLimiting.maxPages;
        } else {
          const parsedPages = parseInt(pageParam);
          if (!isNaN(parsedPages) && parsedPages >= 1 && parsedPages <= config.rateLimiting.maxPages) {
            maxPages = parsedPages;
          }
        }
      }
      
      logger.info('Parsed mention parameters', { 
        url: docsendUrl, 
        maxPages,
        defaultMax: config.rateLimiting.maxPages
      });

      // Check permissions
      if (!rateLimiter.hasPermission(user, channel)) {
        await say({
          text: '❌ You do not have permission to use this bot in this channel.',
          thread_ts: thread_ts
        });
        return;
      }

      // Check rate limits
      const rateLimitCheck = await rateLimiter.canStartJob(user);
      if (!rateLimitCheck.allowed) {
        await say({
          text: `⏳ ${rateLimitCheck.reason}${rateLimitCheck.retryAfter ? ` Please try again in ${Math.ceil(rateLimitCheck.retryAfter / 1000)} seconds.` : ''}`,
          thread_ts: thread_ts
        });
        return;
      }

      // Start the job
      const jobData = {
        userId: user,
        channelId: channel,
        url: docsendUrl,
        responseUrl: null, // No response URL for mentions
        threadTs: thread_ts,
        maxPages: maxPages // Pass maxPages to job processor
      };

      // Mark job as started
      rateLimiter.startJob(`job-${user}-${Date.now()}`, user);

      // Send acknowledgment
      await say({
        text: `🔄 Starting DocSend conversion...\n📄 **Page limit:** ${maxPages === config.rateLimiting.maxPages ? 'All pages' : maxPages + ' pages'}\n⏱️ You'll receive the PDF when it's ready!`,
        thread_ts: thread_ts
      });

      // Process job in background
      jobProcessor.processJob(jobData).catch(error => {
        logger.error('Background job processing failed for mention', {
          userId: user,
          channelId: channel,
          url: docsendUrl,
          error: error.message
        });
      });
    } else {
      // No DocSend URL found
      await say({
        text: '👋 Hi! I can convert DocSend links to PDFs.\n\n**Usage:**\n• Mention me with a DocSend URL: `@docsend-bot https://docsend.com/view/abc123`\n• Use slash command: `/docsend-bot <url> [pages]`\n\n**Page Options:**\n• Default: 15 pages\n• Specify pages: `@docsend-bot https://docsend.com/view/abc123 pages:5`\n• All pages: `@docsend-bot https://docsend.com/view/abc123 pages:all`',
        thread_ts: thread_ts
      });
    }
  } catch (error) {
    logger.error('App mention handling failed', { error: error.message });
  }
});

// Note: Health check endpoint moved to separate Express server

// Error handling
app.error((error) => {
  logger.error('Slack app error', { error: error.message, stack: error.stack });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    await app.stop();
    logger.info('Slack app stopped successfully');
  } catch (error) {
    logger.error('Error stopping Slack app', { error: error.message });
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    await app.stop();
    logger.info('Slack app stopped successfully');
  } catch (error) {
    logger.error('Error stopping Slack app', { error: error.message });
  }
  
  process.exit(0);
});

module.exports = app; 