const { logger } = require('./logger');

class URLValidator {
  // Validate DocSend URL format
  static validateDocSendURL(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'URL must be a string' };
    }

    const trimmedUrl = url.trim();
    
    if (trimmedUrl.length === 0) {
      return { valid: false, error: 'URL cannot be empty' };
    }

    // Check if it's a valid URL format
    try {
      const urlObj = new URL(trimmedUrl);
      
      // Validate protocol
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
      }

      // Validate domain
      if (urlObj.hostname !== 'docsend.com') {
        return { valid: false, error: 'URL must be from docsend.com domain' };
      }

      // Validate path format
      const pathPattern = /^\/view\/[a-zA-Z0-9]+$/;
      if (!pathPattern.test(urlObj.pathname)) {
        return { valid: false, error: 'Invalid DocSend path format. Expected: /view/{id}' };
      }

      // Extract document ID
      const pathParts = urlObj.pathname.split('/');
      const documentId = pathParts[2];
      
      if (!documentId || documentId.length < 3) {
        return { valid: false, error: 'Document ID appears to be invalid' };
      }

      return {
        valid: true,
        documentId,
        cleanUrl: urlObj.origin + urlObj.pathname,
        fullUrl: trimmedUrl
      };

    } catch (error) {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  // Check if URL might be expired or invalid
  static async checkURLValidity(url) {
    try {
      const response = await fetch(url, { 
        method: 'HEAD',
        timeout: 10000 
      });
      
      if (response.status === 404) {
        return { valid: false, error: 'Document not found (404). The link may be expired or invalid.' };
      }
      
      if (response.status >= 400) {
        return { valid: false, error: `Document access error (${response.status}). The link may be restricted or expired.` };
      }
      
      return { valid: true };
    } catch (error) {
      logger.warn('URL validation check failed', { url: this.redactUrl(url), error: error.message });
      // Don't fail validation for network errors, just log them
      return { valid: true, warning: 'Could not verify URL accessibility' };
    }
  }

  // Sanitize URL for logging (remove sensitive parts)
  static redactUrl(url) {
    if (!url) return '[NO_URL]';
    
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      
      if (pathParts.length >= 3) {
        // Keep first few characters of document ID for debugging
        const docId = pathParts[2];
        const redactedId = docId.length > 4 ? 
          docId.substring(0, 4) + '...' : 
          docId;
        
        return `${urlObj.origin}/view/${redactedId}`;
      }
      
      return urlObj.origin + urlObj.pathname;
    } catch (error) {
      return '[INVALID_URL]';
    }
  }

  // Extract document ID from URL
  static extractDocumentId(url) {
    const validation = this.validateDocSendURL(url);
    return validation.valid ? validation.documentId : null;
  }

  // Check if URL is a DocSend link
  static isDocSendURL(url) {
    if (!url) return false;
    
    try {
      const urlObj = new URL(url);
      return urlObj.hostname === 'docsend.com' && 
             urlObj.pathname.startsWith('/view/');
    } catch (error) {
      return false;
    }
  }

  // Validate and clean URL
  static cleanAndValidateURL(url) {
    const validation = this.validateDocSendURL(url);
    
    if (!validation.valid) {
      return validation;
    }

    // Remove any unnecessary query parameters
    try {
      const urlObj = new URL(validation.fullUrl);
      const cleanUrl = urlObj.origin + urlObj.pathname;
      
      return {
        ...validation,
        cleanUrl,
        originalUrl: validation.fullUrl
      };
    } catch (error) {
      return validation;
    }
  }
}

module.exports = URLValidator; 