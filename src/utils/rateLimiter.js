const { RateLimiterMemory } = require('rate-limiter-flexible');
const { config } = require('../config');
const { logger } = require('./logger');

class RateLimiter {
  constructor() {
    // Global concurrent jobs limiter
    this.globalLimiter = new RateLimiterMemory({
      keyGenerator: () => 'global',
      points: config.rateLimiting.maxConcurrentJobs,
      duration: 1,
    });

    // Per-user cooldown limiter
    this.userLimiter = new RateLimiterMemory({
      keyPrefix: 'user_',
      points: 1,
      duration: config.rateLimiting.userCooldownSeconds,
    });

    this.activeJobs = new Set();
  }

  // Check if a new job can be started
  async canStartJob(userId) {
    try {
      logger.info('Rate limiter check started', { userId });
      
      // Check global concurrent limit
      const globalResult = await this.globalLimiter.consume('global');
      logger.info('Global rate limit check', { 
        userId, 
        remainingPoints: globalResult.remainingPoints,
        totalHits: globalResult.totalHits
      });
      
      if (globalResult.remainingPoints < 0) {
        logger.warn('Global concurrent job limit exceeded', {
          userId,
          activeJobs: this.activeJobs.size
        });
        return { allowed: false, reason: 'Too many concurrent jobs', retryAfter: globalResult.msBeforeNext };
      }

      // Check user cooldown - pass userId as the key
      const userKey = `user_${userId}`;
      const userResult = await this.userLimiter.consume(userKey);
      logger.info('User rate limit check', { 
        userId, 
        userKey,
        remainingPoints: userResult.remainingPoints,
        totalHits: userResult.totalHits
      });
      
      if (userResult.remainingPoints < 0) {
        logger.warn('User cooldown active', {
          userId,
          retryAfter: userResult.msBeforeNext
        });
        return { allowed: false, reason: 'Please wait before starting another job', retryAfter: userResult.msBeforeNext };
      }

      logger.info('Rate limiter check passed', { userId });
      return { allowed: true };
    } catch (error) {
      logger.error('Rate limiter error', { 
        error: error.message, 
        userId,
        stack: error.stack 
      });
      return { allowed: false, reason: 'Rate limiter error' };
    }
  }

  // Start tracking a job
  startJob(jobId, userId) {
    this.activeJobs.add(jobId);
    logger.info('Job started', { jobId, userId, activeJobs: this.activeJobs.size });
  }

  // Stop tracking a job
  finishJob(jobId, userId) {
    this.activeJobs.delete(jobId);
    logger.info('Job finished', { jobId, userId, activeJobs: this.activeJobs.size });
  }

  // Get current status
  getStatus() {
    return {
      activeJobs: this.activeJobs.size,
      maxConcurrentJobs: config.rateLimiting.maxConcurrentJobs,
      userCooldownSeconds: config.rateLimiting.userCooldownSeconds
    };
  }

  // Reset all limiters (useful for testing)
  reset() {
    this.globalLimiter.reset();
    this.userLimiter.reset();
    this.activeJobs.clear();
  }

  // Check if user has permission to use the bot
  hasPermission(userId, channelId) {
    // Temporarily allow all users for testing
    logger.info('Permission check bypassed for testing', { userId, channelId });
    return true;
    
    // TODO: Re-enable permission checking after testing
    /*
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
    */
  }
}

module.exports = RateLimiter; 