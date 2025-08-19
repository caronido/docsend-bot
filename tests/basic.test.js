const { config, validateConfig } = require('../src/config');
const URLValidator = require('../src/utils/urlValidator');
const { redactPII } = require('../src/utils/logger');

describe('DocSend Parser Tests', () => {
  describe('Configuration', () => {
    test('should validate required configuration', () => {
      // Mock required environment variables
      process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
      process.env.SLACK_SIGNING_SECRET = 'test-secret';
      process.env.SLACK_APP_TOKEN = 'xapp-test-token';
      process.env.DOCSEND_VIEWER_EMAIL = 'test@example.com';
      
      expect(() => validateConfig()).not.toThrow();
    });

    test('should fail with missing required configuration', () => {
      // Clear required environment variables
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.SLACK_SIGNING_SECRET;
      delete process.env.SLACK_APP_TOKEN;
      delete process.env.DOCSEND_VIEWER_EMAIL;
      
      expect(() => validateConfig()).toThrow();
    });
  });

  describe('URL Validation', () => {
    test('should validate correct DocSend URLs', () => {
      const validUrls = [
        'https://docsend.com/view/abc123',
        'https://docsend.com/view/ABC123',
        'https://docsend.com/view/123abc',
        'https://docsend.com/view/abc123?param=value'
      ];

      validUrls.forEach(url => {
        const result = URLValidator.validateDocSendURL(url);
        expect(result.valid).toBe(true);
        expect(result.documentId).toBeTruthy();
      });
    });

    test('should reject invalid URLs', () => {
      const invalidUrls = [
        'https://docsend.com/view/',
        'https://docsend.com/view',
        'https://example.com/view/abc123',
        'http://docsend.com/view/abc123',
        'not-a-url',
        '',
        null
      ];

      invalidUrls.forEach(url => {
        const result = URLValidator.validateDocSendURL(url);
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
      });
    });

    test('should extract document ID correctly', () => {
      const url = 'https://docsend.com/view/abc123def';
      const documentId = URLValidator.extractDocumentId(url);
      expect(documentId).toBe('abc123def');
    });

    test('should redact URLs for logging', () => {
      const url = 'https://docsend.com/view/abc123def?param=value';
      const redacted = URLValidator.redactUrl(url);
      expect(redacted).toContain('docsend.com/view/');
      expect(redacted).not.toContain('abc123def');
    });
  });

  describe('PII Redaction', () => {
    test('should redact email addresses', () => {
      const message = 'User email@example.com requested conversion';
      const redacted = redactPII(message);
      expect(redacted).toContain('[EMAIL]');
      expect(redacted).not.toContain('email@example.com');
    });

    test('should redact Slack tokens', () => {
      const message = 'Bot token: xoxb-abc123-def456';
      const redacted = redactPII(message);
      expect(redacted).toContain('[SLACK_TOKEN]');
      expect(redacted).not.toContain('xoxb-abc123-def456');
    });

    test('should redact DocSend URLs', () => {
      const message = 'Processing https://docsend.com/view/abc123';
      const redacted = redactPII(message);
      expect(redacted).toContain('[DOCSEND_URL]');
      expect(redacted).not.toContain('abc123');
    });

    test('should redact OTP codes', () => {
      const message = 'Verification code: 123456';
      const redacted = redactPII(message);
      expect(redacted).toContain('[OTP]');
      expect(redacted).not.toContain('123456');
    });
  });

  describe('Configuration Defaults', () => {
    test('should use default values when not specified', () => {
      // Clear optional environment variables
      delete process.env.PDF_PAGE_SIZE;
      delete process.env.PDF_DPI;
      delete process.env.MAX_CONCURRENT_JOBS;
      
      // Reload config
      delete require.cache[require.resolve('../src/config')];
      const { config: reloadedConfig } = require('../src/config');
      
      expect(reloadedConfig.pdf.pageSize).toBe('A4');
      expect(reloadedConfig.pdf.dpi).toBe(150);
      expect(reloadedConfig.rateLimiting.maxConcurrentJobs).toBe(3);
    });
  });
}); 