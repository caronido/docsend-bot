const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
  },
  
  docsend: {
    viewerEmail: process.env.DOCSEND_VIEWER_EMAIL,
    emailProvider: process.env.DOCSEND_EMAIL_PROVIDER || 'gmail',
    emailCredentials: process.env.EMAIL_INBOX_CREDENTIALS ? 
      JSON.parse(process.env.EMAIL_INBOX_CREDENTIALS) : null,
  },
  
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    kmsKeyId: process.env.KMS_KEY_ID,
    s3Bucket: process.env.S3_BUCKET,
  },
  
  proxy: {
    url: process.env.PROXY_URL,
  },
  
  rateLimiting: {
    maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS) || 3,
    userCooldownSeconds: parseInt(process.env.USER_COOLDOWN_SECONDS) || 60,
    maxPages: parseInt(process.env.MAX_PAGES) || 300,
    timeoutSeconds: parseInt(process.env.TIMEOUT_SECONDS) || 600,
  },
  
  pdf: {
    pageSize: process.env.PDF_PAGE_SIZE || 'A4',
    dpi: parseInt(process.env.PDF_DPI) || 150,
    compressionQuality: parseInt(process.env.PDF_COMPRESSION_QUALITY) || 90,
  },
  
  email: {
    otpTimeoutSeconds: parseInt(process.env.OTP_TIMEOUT_SECONDS) || 60,
    otpPollIntervalMs: parseInt(process.env.OTP_POLL_INTERVAL_MS) || 2000,
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
  },
  
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY,
    allowedChannels: process.env.ALLOWED_CHANNELS ? 
      process.env.ALLOWED_CHANNELS.split(',') : null,
    allowedUsers: process.env.ALLOWED_USERS ? 
      process.env.ALLOWED_USERS.split(',') : null,
  },
  
  debug: {
    saveScreenshots: process.env.SAVE_SCREENSHOTS === 'true',
  },
};

// Validation
function validateConfig() {
  const required = [
    'slack.botToken',
    'slack.signingSecret',
    'slack.appToken',
    'docsend.viewerEmail',
  ];
  
  const missing = required.filter(key => {
    const value = key.split('.').reduce((obj, k) => obj?.[k], config);
    return !value;
  });
  
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
  
  if (!config.docsend.emailCredentials) {
    console.warn('Warning: EMAIL_INBOX_CREDENTIALS not configured. OTP retrieval will not work.');
  }
  
  return true;
}

module.exports = { config, validateConfig }; 