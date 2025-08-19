const { google } = require('googleapis');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { config } = require('../config');
const { logger } = require('../utils/logger');

class EmailService {
  constructor() {
    this.credentials = config.docsend.emailCredentials;
    this.provider = config.docsend.emailProvider;
    this.otpTimeout = config.email.otpTimeoutSeconds * 1000;
    this.otpPollInterval = config.email.otpPollIntervalMs;
  }

  // Extract OTP code from email content
  extractOTP(content) {
    // Common OTP patterns: 4-6 digit codes
    const otpPatterns = [
      /\b(\d{4,6})\b/g,
      /verification code[:\s]*(\d{4,6})/gi,
      /code[:\s]*(\d{4,6})/gi,
      /(\d{4,6})/g
    ];

    for (const pattern of otpPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        // Return the first match that looks like an OTP
        for (const match of matches) {
          const code = match.replace(/\D/g, '');
          if (code.length >= 4 && code.length <= 6) {
            return code;
          }
        }
      }
    }

    return null;
  }

  // Gmail API implementation
  async getOTPFromGmail() {
    if (!this.credentials || this.credentials.type !== 'gmail') {
      throw new Error('Gmail credentials not configured');
    }

    try {
      const auth = new google.auth.OAuth2(
        this.credentials.client_id,
        this.credentials.client_secret
      );
      
      auth.setCredentials({
        refresh_token: this.credentials.refresh_token
      });

      const gmail = google.gmail({ version: 'v1', auth });
      
      // Search for recent DocSend emails
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: 'from:docsend.com subject:(verification OR code OR access) newer_than:1d',
        maxResults: 10
      });

      if (!response.data.messages || response.data.messages.length === 0) {
        return null;
      }

      // Get the most recent email
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: response.data.messages[0].id
      });

      const body = message.data.payload.body.data;
      if (body) {
        const content = Buffer.from(body, 'base64').toString();
        return this.extractOTP(content);
      }

      return null;
    } catch (error) {
      logger.error('Gmail API error', { error: error.message });
      throw new Error('Failed to retrieve OTP from Gmail');
    }
  }

  // IMAP implementation
  async getOTPFromIMAP() {
    if (!this.credentials || this.credentials.type !== 'imap') {
      throw new Error('IMAP credentials not configured');
    }

    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: this.credentials.username,
        password: this.credentials.password,
        host: this.credentials.host,
        port: this.credentials.port || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false }
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          // Search for recent DocSend emails
          const searchCriteria = [
            ['FROM', 'docsend.com'],
            ['SINCE', new Date(Date.now() - 24 * 60 * 60 * 1000)]
          ];

          imap.search(searchCriteria, (err, results) => {
            if (err || results.length === 0) {
              imap.end();
              return resolve(null);
            }

            // Get the most recent email
            const fetch = imap.fetch(results[results.length - 1], { bodies: '' });
            
            fetch.on('message', (msg, seqno) => {
              msg.on('body', (stream, info) => {
                simpleParser(stream, (err, parsed) => {
                  if (err) return;
                  
                  const content = parsed.text || parsed.html || '';
                  const otp = this.extractOTP(content);
                  if (otp) {
                    imap.end();
                    resolve(otp);
                  }
                });
              });
            });

            fetch.once('error', (err) => {
              imap.end();
              reject(err);
            });

            fetch.once('end', () => {
              imap.end();
              resolve(null);
            });
          });
        });
      });

      imap.once('error', (err) => {
        reject(err);
      });

      imap.once('end', () => {
        // Connection ended
      });

      imap.connect();
    });
  }

  // Main OTP retrieval method
  async getOTP() {
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.otpTimeout) {
      try {
        let otp = null;
        
        switch (this.provider) {
          case 'gmail':
            otp = await this.getOTPFromGmail();
            break;
          case 'imap':
            otp = await this.getOTPFromIMAP();
            break;
          default:
            throw new Error(`Unsupported email provider: ${this.provider}`);
        }

        if (otp) {
          logger.info('OTP retrieved successfully', { provider: this.provider, otpLength: otp.length });
          return otp;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, this.otpPollInterval));
        
      } catch (error) {
        logger.error('OTP retrieval error', { error: error.message, provider: this.provider });
        // Continue polling unless it's a fatal error
        if (error.message.includes('credentials') || error.message.includes('authentication')) {
          throw error;
        }
      }
    }

    throw new Error('OTP retrieval timeout');
  }

  // Test email connection
  async testConnection() {
    try {
      switch (this.provider) {
        case 'gmail':
          await this.getOTPFromGmail();
          break;
        case 'imap':
          await this.getOTPFromIMAP();
          break;
        default:
          throw new Error(`Unsupported email provider: ${this.provider}`);
      }
      return true;
    } catch (error) {
      logger.error('Email connection test failed', { error: error.message, provider: this.provider });
      return false;
    }
  }
}

module.exports = EmailService; 