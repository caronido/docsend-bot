const { v4: uuidv4 } = require('uuid');
const DocSendService = require('./docsendService');
const PDFService = require('./pdfService');
const SlackService = require('./slackService');
const { logger, logJobProgress } = require('../utils/logger');
const { config } = require('../config');

class JobProcessor {
  constructor() {
    this.docSendService = new DocSendService();
    this.pdfService = new PDFService();
    this.slackService = new SlackService();
    this.activeJobs = new Map();
  }

  // Process a DocSend conversion job
  async processJob(jobData) {
    const jobId = uuidv4();
    const startTime = Date.now();
    
    try {
      // Initialize job tracking
      this.activeJobs.set(jobId, {
        id: jobId,
        status: 'initializing',
        startTime,
        data: jobData
      });

      logJobProgress(jobId, 'started', { 
        userId: jobData.userId, 
        channelId: jobData.channelId,
        url: jobData.url 
      });

      // Validate URL
      this.validateDocSendUrl(jobData.url);

      // Send acknowledgment (only if responseUrl exists)
      if (jobData.responseUrl) {
        await this.slackService.sendAcknowledgment(
          jobData.responseUrl, 
          '🔄 Converting your DocSend to PDF... This may take a few minutes.'
        );
      }

      // Update job status
      this.updateJobStatus(jobId, 'processing');

      // Initialize browser
      logJobProgress(jobId, 'browser_init', {});
      await this.docSendService.initializeBrowser();

      // Navigate to DocSend
      logJobProgress(jobId, 'navigating', {});
      await this.docSendService.navigateToDocSend(jobData.url);

      // Capture all pages
      logJobProgress(jobId, 'capturing_pages', {});
      const screenshots = await this.docSendService.captureAllPages(jobData.pageNumbers);

      // Update job status
      this.updateJobStatus(jobId, 'creating_pdf');

      // Create PDF
      logJobProgress(jobId, 'creating_pdf', { pageCount: screenshots.length });
      const pdfBuffer = await this.pdfService.createPDF(screenshots);
      
      // Debug: Log PDF buffer details
      logger.info('PDF buffer details', {
        type: typeof pdfBuffer,
        isBuffer: Buffer.isBuffer(pdfBuffer),
        length: pdfBuffer ? pdfBuffer.length : 'null/undefined',
        constructor: pdfBuffer ? pdfBuffer.constructor.name : 'null/undefined'
      });

      // Check if PDF is within Slack limits
      if (this.pdfService.isWithinSlackLimit(pdfBuffer)) {
        // Upload directly to Slack
        logJobProgress(jobId, 'uploading_to_slack', {});
        const filename = `docsend-${Date.now()}.pdf`;
        
        await this.slackService.uploadPDF(
          jobData.channelId,
          pdfBuffer,
          filename,
          jobData.url,
          jobData.threadTs
        );

        // Send success message
        const fileSize = this.pdfService.getFileSizeMB(pdfBuffer);
        await this.slackService.sendSuccessMessage(
          jobData.channelId,
          `✅ *DocSend PDF Generated Successfully!*\n\n` +
          `📄 **${screenshots.length} pages** converted to PDF\n` +
          `📏 **File size:** ${fileSize} MB\n` +
          `⏱️ **Processing time:** ${Math.round((Date.now() - startTime) / 1000)}s`,
          jobData.threadTs
        );

        logJobProgress(jobId, 'completed', { 
          pageCount: screenshots.length, 
          fileSize,
          duration: Date.now() - startTime 
        });

      } else {
        // PDF is too large, upload to S3 and provide link
        logJobProgress(jobId, 'uploading_to_s3', {});
        const s3Url = await this.uploadToS3(pdfBuffer, jobId);
        
        await this.slackService.sendSuccessMessage(
          jobData.channelId,
          `✅ *DocSend PDF Generated Successfully!*\n\n` +
          `📄 **${screenshots.length} pages** converted to PDF\n` +
          `📏 **File size:** ${this.pdfService.getFileSizeMB(pdfBuffer)} MB (too large for Slack)\n` +
          `🔗 **Download:** ${s3Url}\n` +
          `⏱️ **Processing time:** ${Math.round((Date.now() - startTime) / 1000)}s\n\n` +
          `*Note: This link expires in 24 hours*`,
          jobData.threadTs
        );

        logJobProgress(jobId, 'completed_s3', { 
          pageCount: screenshots.length, 
          s3Url,
          duration: Date.now() - startTime 
        });
      }

      // Update final job status
      this.updateJobStatus(jobId, 'completed');

    } catch (error) {
      // Handle errors
      await this.handleJobError(jobId, error, jobData);
      this.updateJobStatus(jobId, 'failed');
    } finally {
      // Cleanup
      await this.cleanupJob(jobId);
    }
  }

  // Validate DocSend URL
  validateDocSendUrl(url) {
    const docsendPattern = /^https?:\/\/docsend\.com\/view\/[a-zA-Z0-9]+(\/[a-zA-Z0-9\/]+)?(\?[^\s]*)?$/;
    
    if (!docsendPattern.test(url)) {
      throw new Error('Invalid DocSend URL. Please provide a valid URL in the format: https://docsend.com/view/...\n\nSupported formats:\n• https://docsend.com/view/abc123\n• https://docsend.com/view/abc123/d/xyz789');
    }
  }

  // Handle job errors
  async handleJobError(jobId, error, jobData) {
    logJobProgress(jobId, 'error', { error: error.message });

    // Log the error
    logger.error('Job processing failed', {
      jobId,
      userId: jobData.userId,
      channelId: jobData.channelId,
      url: jobData.url,
      error: error.message,
      stack: error.stack
    });

    // Send error message to Slack
    try {
      await this.slackService.sendErrorMessage(
        jobData.channelId,
        error,
        jobData.url,
        jobData.threadTs
      );
    } catch (slackError) {
      logger.error('Failed to send error message to Slack', {
        jobId,
        slackError: slackError.message,
        originalError: error.message
      });
    }
  }

  // Cleanup job resources
  async cleanupJob(jobId) {
    try {
      const job = this.activeJobs.get(jobId);
      if (job) {
        // Cleanup browser resources
        await this.docSendService.cleanup();
        
        // Remove from active jobs
        this.activeJobs.delete(jobId);
        
        logJobProgress(jobId, 'cleaned_up', {});
        logger.info('Job cleanup completed', { jobId });
      }
    } catch (error) {
      logger.error('Job cleanup failed', { jobId, error: error.message });
    }
  }

  // Update job status
  updateJobStatus(jobId, status, details = {}) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.status = status;
      job.lastUpdate = Date.now();
      Object.assign(job, details);
      
      logJobProgress(jobId, status, details);
    }
  }

  // Upload large PDF to S3
  async uploadToS3(pdfBuffer, jobId) {
    try {
      // This would integrate with AWS S3
      // For now, return a placeholder URL
      logger.info('S3 upload placeholder', { jobId, size: pdfBuffer.length });
      
      // In a real implementation, you would:
      // 1. Upload to S3 with proper metadata
      // 2. Generate pre-signed URL with 24h expiry
      // 3. Return the pre-signed URL
      
      return `https://example-s3-bucket.s3.amazonaws.com/docsend-${jobId}.pdf?expires=${Date.now() + 24 * 60 * 60 * 1000}`;
    } catch (error) {
      logger.error('S3 upload failed', { jobId, error: error.message });
      throw new Error('Failed to upload PDF to cloud storage');
    }
  }

  // Get job status
  getJobStatus(jobId) {
    return this.activeJobs.get(jobId);
  }

  // Get all active jobs
  getActiveJobs() {
    return Array.from(this.activeJobs.values());
  }

  // Cancel a job
  async cancelJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (job && job.status === 'processing') {
      try {
        await this.docSendService.cleanup();
        this.updateJobStatus(jobId, 'cancelled');
        logger.info('Job cancelled', { jobId });
        return true;
      } catch (error) {
        logger.error('Failed to cancel job', { jobId, error: error.message });
        return false;
      }
    }
    return false;
  }

  // Get job statistics
  getJobStats() {
    const jobs = Array.from(this.activeJobs.values());
    const stats = {
      total: jobs.length,
      byStatus: {},
      averageDuration: 0
    };

    jobs.forEach(job => {
      stats.byStatus[job.status] = (stats.byStatus[job.status] || 0) + 1;
      
      if (job.status === 'completed' && job.startTime) {
        const duration = Date.now() - job.startTime;
        stats.averageDuration = (stats.averageDuration + duration) / 2;
      }
    });

    return stats;
  }
}

module.exports = JobProcessor; 