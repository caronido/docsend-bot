const { WebClient } = require('@slack/web-api');
const { config } = require('../config');
const { logger } = require('../utils/logger');

class SlackService {
  constructor() {
    this.client = new WebClient(config.slack.botToken);
  }

  // Send immediate acknowledgment response
  async sendAcknowledgment(responseUrl, message = 'Working on your DocSend conversion...') {
    try {
      const response = await fetch(responseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          response_type: 'ephemeral',
          text: message
        })
      });

      if (!response.ok) {
        logger.error('Failed to send acknowledgment', { 
          status: response.status, 
          statusText: response.statusText 
        });
      } else {
        logger.info('Acknowledgment sent successfully');
      }
    } catch (error) {
      logger.error('Error sending acknowledgment', { error: error.message });
    }
  }

  // Upload PDF to Slack channel
  async uploadPDF(channelId, pdfBuffer, filename, originalUrl, threadTs = null) {
    try {
      // Debug: Log what we received
      logger.info('PDF buffer received in Slack service', {
        type: typeof pdfBuffer,
        isBuffer: Buffer.isBuffer(pdfBuffer),
        length: pdfBuffer ? pdfBuffer.length : 'null/undefined',
        constructor: pdfBuffer ? pdfBuffer.constructor.name : 'null/undefined'
      });
      
      logger.info('Uploading PDF to Slack', { 
        channelId, 
        filename, 
        size: pdfBuffer.length,
        threadTs 
      });

      const uploadParams = {
        channels: channelId,
        file: pdfBuffer,
        filename: filename,
        title: 'DocSend PDF',
        initial_comment: this.formatUploadComment(originalUrl),
        thread_ts: threadTs
      };

      const result = await this.client.files.uploadV2(uploadParams);
      
      logger.info('PDF uploaded successfully', { 
        fileId: result.file?.id,
        channelId,
        filename 
      });

      return result;
    } catch (error) {
      logger.error('Failed to upload PDF to Slack', { 
        error: error.message, 
        channelId, 
        filename 
      });
      throw error;
    }
  }

  // Send error message to Slack
  async sendErrorMessage(channelId, error, originalUrl, threadTs = null) {
    try {
      const errorMessage = this.formatErrorMessage(error, originalUrl);
      
      const params = {
        channel: channelId,
        text: errorMessage,
        thread_ts: threadTs,
        unfurl_links: false
      };

      const result = await this.client.chat.postMessage(params);
      
      logger.info('Error message sent to Slack', { 
        channelId, 
        messageTs: result.ts,
        error: error.message 
      });

      return result;
    } catch (slackError) {
      logger.error('Failed to send error message to Slack', { 
        error: slackError.message, 
        originalError: error.message 
      });
      throw slackError;
    }
  }

  // Send success message to Slack
  async sendSuccessMessage(channelId, message, threadTs = null) {
    try {
      const params = {
        channel: channelId,
        text: message,
        thread_ts: threadTs,
        unfurl_links: false
      };

      const result = await this.client.chat.postMessage(params);
      
      logger.info('Success message sent to Slack', { 
        channelId, 
        messageTs: result.ts 
      });

      return result;
    } catch (error) {
      logger.error('Failed to send success message to Slack', { 
        error: error.message, 
        channelId 
      });
      throw error;
    }
  }

  // Format upload comment
  formatUploadComment(originalUrl) {
    return `📄 *DocSend PDF Generated*\n\n` +
           `Original link: ${originalUrl}\n` +
           `Generated at: ${new Date().toLocaleString()}\n` +
           `Using viewer email: ${config.docsend.viewerEmail}`;
  }

  // Format error message based on error type
  formatErrorMessage(error, originalUrl) {
    const baseMessage = `❌ *DocSend Conversion Failed*\n\n` +
                       `Original link: ${originalUrl}\n` +
                       `Error: ${error.message}\n\n`;

    let specificMessage = '';
    
    if (error.message.includes('invalid URL')) {
      specificMessage = 'Please provide a valid DocSend URL, e.g., https://docsend.com/view/...';
    } else if (error.message.includes('email')) {
      specificMessage = `This link is restricted to a different viewer email. We're using ${config.docsend.viewerEmail}. Ask the sender to grant access to that email or update the configured email.`;
    } else if (error.message.includes('OTP') || error.message.includes('verification')) {
      specificMessage = 'We couldn\'t get the verification code in time. Re-run the command after the sender re-shares the link.';
    } else if (error.message.includes('blocked') || error.message.includes('automated')) {
      specificMessage = 'DocSend blocked automated rendering. Try a different link or ask the owner to disable advanced link protection.';
    } else if (error.message.includes('expired') || error.message.includes('404')) {
      specificMessage = 'This DocSend link appears to be expired or invalid. Please check the link and try again.';
    } else if (error.message.includes('rate limit') || error.message.includes('throttle')) {
      specificMessage = 'DocSend is rate limiting requests. Please wait a few minutes and try again.';
    } else {
      specificMessage = 'An unexpected error occurred. Please try again or contact support if the issue persists.';
    }

    return baseMessage + specificMessage;
  }

  // Get user info from Slack
  async getUserInfo(userId) {
    try {
      const result = await this.client.users.info({ user: userId });
      return result.user;
    } catch (error) {
      logger.error('Failed to get user info', { userId, error: error.message });
      return null;
    }
  }

  // Get channel info from Slack
  async getChannelInfo(channelId) {
    try {
      const result = await this.client.conversations.info({ channel: channelId });
      return result.channel;
    } catch (error) {
      logger.error('Failed to get channel info', { channelId, error: error.message });
      return null;
    }
  }

  // Check if user has permission to use the bot
  hasPermission(userId, channelId) {
    // Check allowed users
    if (config.security.allowedUsers && config.security.allowedUsers.length > 0) {
      if (!config.security.allowedUsers.includes(userId)) {
        logger.warn('User not in allowed users list', { userId, allowedUsers: config.security.allowedUsers });
        return false;
      }
    }

    // Check allowed channels
    if (config.security.allowedChannels && config.security.allowedChannels.length > 0) {
      if (!config.security.allowedChannels.includes(channelId)) {
        logger.warn('Channel not in allowed channels list', { channelId, allowedChannels: config.security.allowedChannels });
        return false;
      }
    }

    return true;
  }

  // Send rate limit message
  async sendRateLimitMessage(channelId, reason, retryAfter = null, threadTs = null) {
    try {
      let message = `⏳ *Rate Limited*\n\n${reason}`;
      
      if (retryAfter) {
        const retrySeconds = Math.ceil(retryAfter / 1000);
        message += `\n\nPlease try again in ${retrySeconds} seconds.`;
      }

      const params = {
        channel: channelId,
        text: message,
        thread_ts: threadTs,
        response_type: 'ephemeral'
      };

      const result = await this.client.chat.postMessage(params);
      
      logger.info('Rate limit message sent', { 
        channelId, 
        reason, 
        retryAfter 
      });

      return result;
    } catch (error) {
      logger.error('Failed to send rate limit message', { 
        error: error.message, 
        channelId 
      });
      throw error;
    }
  }

  // Update message (useful for progress updates)
  async updateMessage(channelId, messageTs, newText) {
    try {
      const params = {
        channel: channelId,
        ts: messageTs,
        text: newText
      };

      const result = await this.client.chat.update(params);
      
      logger.info('Message updated successfully', { 
        channelId, 
        messageTs, 
        newText: newText.substring(0, 100) + '...' 
      });

      return result;
    } catch (error) {
      logger.error('Failed to update message', { 
        error: error.message, 
        channelId, 
        messageTs 
      });
      throw error;
    }
  }
}

module.exports = SlackService; 