const { App } = require('@slack/bolt');
const { config } = require('../config');
const { logger } = require('../utils/logger');
const RateLimiter = require('../utils/rateLimiter');
const JobProcessor = require('../services/jobProcessor');

// Initialize the Slack app for Lambda
const app = new App({
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
  processBeforeResponse: true
});

// Initialize services
const rateLimiter = new RateLimiter();
const jobProcessor = new JobProcessor();

// Handle slash commands
app.command('/docsend-bot', async ({ command, ack, respond }) => {
  try {
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

    // Validate command text
    if (!text || !text.trim()) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Please provide a DocSend URL. Usage: `/docsend-bot <docsend_url>`'
      });
      return;
    }

    const docsendUrl = text.trim();
    
    // Validate URL format
    const docsendPattern = /^https?:\/\/docsend\.com\/view\/[a-zA-Z0-9]+(\/[a-zA-Z0-9\/]+)?(\?[^\s]*)?$/;
    if (!docsendPattern.test(docsendUrl)) {
      await respond({
        response_type: 'ephemeral',
        text: '❌ Invalid DocSend URL. Please provide a valid URL in the format: `https://docsend.com/view/...`\n\nSupported formats:\n• `https://docsend.com/view/abc123`\n• `https://docsend.com/view/abc123/d/xyz789`'
      });
      return;
    }

    // Start the job
    const jobData = {
      userId: user_id,
      channelId: channel_id,
      url: docsendUrl,
      responseUrl: response_url,
      threadTs: thread_ts
    };

    rateLimiter.startJob(`job-${user_id}-${Date.now()}`, user_id);

    // Process job in background
    jobProcessor.processJob(jobData).catch(error => {
      logger.error('Background job processing failed', {
        userId: user_id,
        channelId: channel_id,
        url: docsendUrl,
        error: error.message
      });
    });

    await respond({
      response_type: 'ephemeral',
      text: '🔄 Starting DocSend conversion... You\'ll receive the PDF when it\'s ready!'
    });

  } catch (error) {
    logger.error('Slash command handling failed', {
      command: command.text,
      userId: command.user_id,
      error: error.message
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

    const docsendUrlMatch = text.match(/https?:\/\/docsend\.com\/view\/[a-zA-Z0-9]+(\?[^\s]*)?/);
    
    if (docsendUrlMatch) {
      const docsendUrl = docsendUrlMatch[0];
      
      if (!rateLimiter.hasPermission(user, channel)) {
        await say({
          text: '❌ You do not have permission to use this bot in this channel.',
          thread_ts: thread_ts
        });
        return;
      }

      const rateLimitCheck = await rateLimiter.canStartJob(user);
      if (!rateLimitCheck.allowed) {
        await say({
          text: `⏳ ${rateLimitCheck.reason}${rateLimitCheck.retryAfter ? ` Please try again in ${Math.ceil(rateLimitCheck.retryAfter / 1000)} seconds.` : ''}`,
          thread_ts: thread_ts
        });
        return;
      }

      const jobData = {
        userId: user,
        channelId: channel,
        url: docsendUrl,
        responseUrl: null,
        threadTs: thread_ts
      };

      rateLimiter.startJob(`job-${user}-${Date.now()}`, user);

      await say({
        text: '🔄 Starting DocSend conversion... You\'ll receive the PDF when it\'s ready!',
        thread_ts: thread_ts
      });

      jobProcessor.processJob(jobData).catch(error => {
        logger.error('Background job processing failed for mention', {
          userId: user,
          channelId: channel,
          url: docsendUrl,
          error: error.message
        });
      });
    } else {
      await say({
        text: '👋 Hi! I can convert DocSend links to PDFs. Just mention me with a DocSend URL, or use `/docsend-bot <url>`.',
        thread_ts: thread_ts
      });
    }
  } catch (error) {
    logger.error('App mention handling failed', { error: error.message });
  }
});

// Lambda handler
module.exports.handler = async (event, context) => {
  try {
    // Handle different event types
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      
      if (body.type === 'url_verification') {
        // Slack URL verification
        return {
          statusCode: 200,
          body: JSON.stringify({ challenge: body.challenge })
        };
      }
      
      // Process Slack event/command
      await app.processEvent(body);
      
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true })
      };
    }
    
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid request method' })
    };
    
  } catch (error) {
    logger.error('Lambda handler error', { error: error.message, stack: error.stack });
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}; 