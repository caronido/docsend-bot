const { chromium } = require('playwright');
const { config } = require('../config');
const { logger } = require('../utils/logger');
const EmailService = require('./emailService');

class DocSendService {
  constructor() {
    this.emailService = new EmailService();
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  // Initialize browser with stealth settings
  async initializeBrowser() {
    try {
      const launchOptions = {
        headless: true,
        timeout: 60000, // 60 seconds timeout for browser launch
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update',
          '--disable-client-side-phishing-detection',
          '--disable-hang-monitor',
          '--disable-prompt-on-repost',
          '--disable-domain-reliability',
          '--disable-component-extensions-with-background-pages',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=TranslateUI,BlinkGenPropertyTrees',
          '--disable-ipc-flooding-protection',
          '--single-process',
          '--no-zygote',
          '--disable-dev-shm-usage',
          '--memory-pressure-off',
          '--max_old_space_size=4096'
        ]
      };

      // Force system Chromium in production
      if (process.env.NODE_ENV === 'production') {
        // Try multiple possible paths for system Chromium
        const possiblePaths = [
          process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable'
        ].filter(Boolean);

        let chromiumPath = null;
        for (const path of possiblePaths) {
          try {
            const fs = require('fs');
            if (fs.existsSync(path)) {
              chromiumPath = path;
              break;
            }
          } catch (e) {
            // Continue to next path
          }
        }

        if (chromiumPath) {
          launchOptions.executablePath = chromiumPath;
          logger.info('Using system Chromium for production', { path: chromiumPath });
        } else {
          logger.warn('No system Chromium found, will try to use Playwright bundled browser');
        }
      }

      if (config.proxy.url) {
        launchOptions.proxy = { server: config.proxy.url };
      }

      // Try to launch browser with retry logic
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          logger.info(`Attempting browser launch (attempt ${retryCount + 1}/${maxRetries})`);
          this.browser = await chromium.launch(launchOptions);
          logger.info('Browser launched successfully');
          break;
        } catch (error) {
          retryCount++;
          logger.warn(`Browser launch attempt ${retryCount} failed`, { 
            error: error.message,
            retryCount,
            maxRetries
          });
          
          if (retryCount >= maxRetries) {
            // If launch fails and we're in production, try to install browsers
            if (process.env.NODE_ENV === 'production' && error.message.includes('ENOENT')) {
              logger.warn('Browser launch failed, attempting to install Playwright browsers...');
              try {
                const { execSync } = require('child_process');
                execSync('npx playwright install chromium', { stdio: 'inherit' });
                logger.info('Playwright browsers installed successfully, retrying launch...');
                this.browser = await chromium.launch(launchOptions);
                break;
              } catch (installError) {
                logger.error('Failed to install Playwright browsers', { error: installError.message });
                throw new Error('Browser initialization failed and browser installation failed. Please ensure Chromium is available.');
              }
            } else {
              // Try one more time with minimal options if all retries failed
              logger.warn('All retries failed, trying with minimal browser options...');
              try {
                const minimalOptions = {
                  headless: true,
                  timeout: 30000,
                  args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process']
                };
                this.browser = await chromium.launch(minimalOptions);
                logger.info('Browser launched successfully with minimal options');
              } catch (minimalError) {
                throw new Error(`Browser launch failed after ${maxRetries} attempts and minimal fallback: ${error.message}. Minimal fallback error: ${minimalError.message}`);
              }
            }
          } else {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
          }
        }
      }
      
      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
        geolocation: { latitude: 40.7128, longitude: -74.0060 },
        // Set timeouts for context operations
        timeout: 30000, // 30 seconds for page operations
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        }
      });

      this.page = await this.context.newPage();
      
      // Set stealth properties
      await this.page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
      });

      logger.info('Browser initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize browser', { error: error.message });
      throw error;
    }
  }

  // Navigate to DocSend URL and handle authentication
  async navigateToDocSend(url) {
    try {
      logger.info('Navigating to DocSend URL', { url: this.redactUrl(url) });
      
      // Set page timeout for navigation
      this.page.setDefaultTimeout(30000); // 30 seconds
      this.page.setDefaultNavigationTimeout(30000); // 30 seconds
      
      // Special handling for known problematic URLs
      const isProblematicUrl = url.includes('8g32qgh6feph3ttm');
      if (isProblematicUrl) {
        logger.warn('Detected potentially problematic URL, using extended timeout');
        this.page.setDefaultTimeout(60000); // 60 seconds for problematic URLs
        this.page.setDefaultNavigationTimeout(60000);
      }
      
      await this.page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: isProblematicUrl ? 60000 : 30000 
      });
      
      // Wait for page to load and give it a moment to stabilize
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(2000);
      
      // Check for various authentication gates
      await this.handleAuthentication();
      
      // Wait for viewer to be ready
      await this.waitForViewerReady();
      
      logger.info('Successfully navigated to DocSend');
      return true;
    } catch (error) {
      logger.error('Failed to navigate to DocSend', { error: error.message, url: this.redactUrl(url) });
      throw error;
    }
  }

  // Handle different types of authentication gates
  async handleAuthentication() {
    try {
      // Check for email gate - try multiple selectors for different DocSend layouts
      // Prioritize the authentication form selectors first
      const emailSelectors = [
        'input[name="link_auth_form[email]"]',
        'input[id="link_auth_form_email"]',
        'input.js-auth-form_email-field',
        'input.js-viewer-email_input',
        'form.js-email-sniffing-auth-form input[type="email"]',
        'input[type="email"]'
      ];
      
      let emailInput = null;
      let foundSelector = null;
      for (const selector of emailSelectors) {
        try {
          // Try to find the email input within the authentication form context
          if (selector.includes('form.js-email-sniffing-auth-form')) {
            emailInput = await this.page.$('form.js-email-sniffing-auth-form input[type="email"]');
          } else {
            emailInput = await this.page.$(selector);
          }
          
          if (emailInput) {
            // Verify this is actually the auth form email field
            const isInAuthForm = await emailInput.evaluate(el => {
              const form = el.closest('form');
              return form && form.classList.contains('js-email-sniffing-auth-form');
            });
            
            if (isInAuthForm) {
              foundSelector = selector;
              logger.info(`Email gate detected with selector: ${selector} in auth form`);
              break;
            } else {
              logger.info(`Found email input but not in auth form, trying next selector`);
              emailInput = null;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (emailInput) {
        logger.info('Email gate detected, entering viewer email');
        
        // Wait for the input to be visible and ready
        await this.page.waitForSelector(foundSelector, { state: 'visible', timeout: 10000 });
        
        // Clear any existing text and fill the email
        await emailInput.fill('');
        await emailInput.fill(config.docsend.viewerEmail);
        
        // Look for submit button with multiple selectors
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Continue")',
          'button:has-text("Submit")',
          'button.dig-Button--primary',
          'button[data-dig-button="true"]',
          '.js-auth-form_submit-button button'
        ];
        
        let submitButton = null;
        let foundSubmitSelector = null;
        for (const submitSelector of submitSelectors) {
          try {
            submitButton = await this.page.$(submitSelector);
            if (submitButton) {
              foundSubmitSelector = submitSelector;
              logger.info(`Submit button found with selector: ${submitSelector}`);
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (submitButton) {
          logger.info('Attempting form submission');
          // Try to submit the form directly using JavaScript, which is more reliable
          try {
            logger.info('Attempting JavaScript form submission...');
            const formSubmitted = await this.page.evaluate(() => {
              const form = document.querySelector('form.js-email-sniffing-auth-form');
              if (form) {
                form.submit();
                return true;
              }
              return false;
            });
            
            logger.info('JavaScript evaluation result:', { formSubmitted });
            
            if (formSubmitted) {
              logger.info('Form submitted via JavaScript, waiting for page load...');
              // Use a more lenient wait strategy instead of networkidle
              await this.page.waitForLoadState('domcontentloaded');
              await this.page.waitForTimeout(3000); // Give time for any redirects/updates
              logger.info('JavaScript form submission completed successfully');
            } else {
              logger.warn('Form not found, throwing error to trigger fallback');
              throw new Error('Form not found');
            }
          } catch (e) {
            logger.warn('JavaScript form submission failed, trying button click', { error: e.message });
            // Fallback to button click if JavaScript submission fails
            const currentSubmitButton = await this.page.$(foundSubmitSelector);
            if (currentSubmitButton) {
              await currentSubmitButton.click();
              await this.page.waitForLoadState('networkidle');
              await this.page.waitForTimeout(2000);
            }
          }
        } else {
          logger.warn('Submit button not found, trying to submit form directly');
          // Try to submit the form directly
          await this.page.evaluate(() => {
            const form = document.querySelector('form.js-email-sniffing-auth-form');
            if (form) form.submit();
          });
          await this.page.waitForLoadState('networkidle');
        }
      }

      // Check for OTP gate
      const otpInput = await this.page.$('input[type="text"][maxlength="6"], input[type="text"][maxlength="4"], input[name*="code"], input[name*="otp"]');
      if (otpInput) {
        logger.info('OTP gate detected, retrieving code from email');
        const otp = await this.emailService.getOTP();
        if (otp) {
          await otpInput.fill(otp);
          
          const submitButton = await this.page.$('button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("Submit")');
          if (submitButton) {
            await submitButton.click();
            await this.page.waitForLoadState('networkidle');
          }
        } else {
          throw new Error('Failed to retrieve OTP from email');
        }
      }

      // Check for terms/consent
      const acceptButton = await this.page.$('button:has-text("Accept"), button:has-text("Agree"), button:has-text("Continue")');
      if (acceptButton) {
        logger.info('Terms/consent detected, accepting');
        try {
          // Try JavaScript click first
          await this.page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
              const text = btn.textContent?.toLowerCase() || '';
              if (text.includes('accept') || text.includes('agree') || text.includes('continue')) {
                btn.click();
                return;
              }
            }
          });
          logger.info('Terms accepted via JavaScript');
          await this.page.waitForLoadState('domcontentloaded');
          await this.page.waitForTimeout(2000);
        } catch (e) {
          logger.warn('JavaScript terms acceptance failed, trying direct click');
          await acceptButton.click();
          await this.page.waitForLoadState('domcontentloaded');
        }
      }

    } catch (error) {
      logger.error('Authentication handling failed', { error: error.message });
      throw error;
    }
  }

  // Wait for the DocSend viewer to be ready
  async waitForViewerReady() {
    try {
      // Wait for viewer elements to appear
      await this.page.waitForSelector('.viewer, .document-viewer, [data-testid="viewer"], .slides-container', { timeout: 30000 });
      
      // Wait for content to load with more lenient approach
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(3000); // Additional wait for viewer to initialize
      
      logger.info('DocSend viewer is ready');
    } catch (error) {
      logger.error('Failed to wait for viewer ready', { error: error.message });
      throw error;
    }
  }

  // Get total number of pages/slides
  async getPageCount() {
    try {
      // Try multiple selectors for page count
      const pageCountSelectors = [
        '.page-counter span:last-child',
        '.slide-counter span:last-child',
        '[data-testid="page-counter"]',
        '.pagination .total',
        '.slides-nav .total'
      ];

      for (const selector of pageCountSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const text = await element.textContent();
            const count = parseInt(text.match(/\d+/)?.[0]);
            if (count && count > 0 && count <= config.rateLimiting.maxPages) {
              logger.info('Page count detected', { count, selector });
              return count;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Fallback: count by navigation with a reasonable limit
      const pageCount = await this.countPagesByNavigation();
      if (pageCount > 50) {
        logger.warn('Page count seems unusually high, limiting to 50 pages', { pageCount });
        return 50;
      }
      return pageCount;
    } catch (error) {
      logger.error('Failed to get page count', { error: error.message });
      throw error;
    }
  }

  // Count pages by navigating through slides
  async countPagesByNavigation() {
    try {
      let pageCount = 1;
      const maxAttempts = config.rateLimiting.maxPages;
      
      // Navigate through slides to count them using DocSend-specific selectors
      for (let i = 0; i < maxAttempts; i++) {
        // Try multiple selectors for the next button
        const nextButton = await this.page.$('#nextPageIcon, button[aria-label*="next"], button[aria-label*="Next"], .next-button, .arrow-right, [data-react-class*="ChevronRight"]');
        if (!nextButton) {
          logger.info('No next button found, reached end of document');
          break;
        }
        
        // Check if button is visible and enabled
        const isVisible = await nextButton.isVisible();
        const isDisabled = await nextButton.getAttribute('disabled');
        
        if (!isVisible || isDisabled) {
          logger.info('Next button not visible or disabled, reached end of document');
          break;
        }
        
        logger.info(`Navigating to page ${pageCount + 1}`);
        
        await nextButton.click();
        await this.page.waitForTimeout(2000); // Give more time for page transition
        await this.page.waitForLoadState('domcontentloaded');
        
        // Check if the next button is still available after navigation
        const nextButtonAfterNav = await this.page.$('#nextPageIcon, button[aria-label*="next"], button[aria-label*="Next"], .next-button, .arrow-right, [data-react-class*="ChevronRight"]');
        const isNextButtonVisible = nextButtonAfterNav ? await nextButtonAfterNav.isVisible() : false;
        
        logger.info(`Next button after navigation: ${nextButtonAfterNav ? 'found' : 'not found'}, visible: ${isNextButtonVisible}`);
        
        if (!nextButtonAfterNav || !isNextButtonVisible) {
          logger.info('Next button no longer available after navigation, reached end of document');
          pageCount++;
          break;
        }
        
        pageCount++;
        
        // Safety check to avoid infinite loops
        if (pageCount > maxAttempts) {
          logger.warn('Reached maximum page count limit', { maxAttempts });
          break;
        }
        
        // Additional safety: if we've gone way beyond expected pages, stop
        if (pageCount > 25) {
          logger.warn('Reached reasonable page limit, stopping navigation', { pageCount });
          break;
        }
      }
      
      logger.info(`Total pages counted: ${pageCount}`);
      
      // Go back to first page
      if (pageCount > 1) {
        logger.info('Returning to first page');
        for (let i = 0; i < pageCount - 1; i++) {
          const prevButton = await this.page.$('#prevPageIcon, button[aria-label*="previous"], button[aria-label*="Previous"], .prev-button, .arrow-left, [data-react-class*="ChevronLeft"]');
          if (prevButton && await prevButton.isVisible()) {
            await prevButton.click();
            await this.page.waitForTimeout(1000);
            await this.page.waitForLoadState('domcontentloaded');
          }
        }
      }
      
      logger.info('Page count determined by navigation', { count: pageCount });
      return pageCount;
    } catch (error) {
      logger.error('Failed to count pages by navigation', { error: error.message });
      throw error;
    }
  }

  // Capture screenshot of current page
  async capturePage(pageNumber) {
    try {
      // Wait for page to render
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(2000); // Give more time for content to render
      
      // Try to hide UI elements that might overlap content
      await this.page.evaluate(() => {
        const selectors = [
          '.toolbar', '.navigation', '.header', '.footer',
          '.floating-controls', '.ui-overlay', '.chrome'
        ];
        
        selectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            if (el.style) el.style.display = 'none';
          });
        });
      });
      
      // Capture full page screenshot
      const screenshot = await this.page.screenshot({
        fullPage: true,
        type: 'png'
      });
      
      logger.info('Page captured successfully', { pageNumber });
      return screenshot;
    } catch (error) {
      logger.error('Failed to capture page', { pageNumber, error: error.message });
      throw error;
    }
  }

  // Navigate to specific page
  async navigateToPage(pageNumber) {
    try {
      if (pageNumber === 1) {
        // Already on first page
        return;
      }
      
      // Simple approach: always go back to first page, then navigate forward
      // This ensures we're always starting from a known position
      const prevButton = await this.page.$('#prevPageIcon, button[aria-label*="previous"], button[aria-label*="Previous"], .prev-button, .arrow-left, [data-react-class*="ChevronLeft"]');
      if (prevButton && await prevButton.isVisible()) {
        logger.info('Going back to first page before navigation');
        // Go back to first page
        while (await prevButton.isVisible()) {
          await prevButton.click();
          await this.page.waitForTimeout(1000);
          await this.page.waitForLoadState('domcontentloaded');
        }
      }
      
      // Navigate from page 1 to target page
      for (let i = 1; i < pageNumber; i++) {
        const nextButton = await this.page.$('#nextPageIcon, button[aria-label*="next"], button[aria-label*="Next"], .next-button, .arrow-right, [data-react-class*="ChevronRight"]');
        if (nextButton && await nextButton.isVisible()) {
          logger.info(`Navigating from page ${i} to page ${i + 1}`);
          await nextButton.click();
          await this.page.waitForTimeout(1500); // Give more time for page transition
          await this.page.waitForLoadState('domcontentloaded');
        } else {
          throw new Error(`Cannot navigate to page ${pageNumber} - next button not found or not visible`);
        }
      }
      
      logger.info('Navigated to page', { pageNumber });
    } catch (error) {
      logger.error('Failed to navigate to page', { pageNumber, error: error.message });
      throw error;
    }
  }

  // Capture specific pages or all pages
  async captureAllPages(pageNumbers = null) {
    try {
      logger.info('Starting page capture', { pageNumbers });
      
      const screenshots = [];
      
      if (pageNumbers && pageNumbers.length > 0) {
        // Capture specific pages
        logger.info(`Capturing specific pages: ${pageNumbers.join(', ')}`);
        
        for (const pageNum of pageNumbers) {
          logger.info('Capturing specific page', { pageNum });
          
          // Navigate to the specific page
          await this.navigateToPage(pageNum);
          
          // Take screenshot of current page
          const screenshot = await this.capturePage(pageNum);
          screenshots.push({
            pageNumber: pageNum,
            data: screenshot
          });
          
          // Save screenshot locally for testing (optional)
          if (config.debug?.saveScreenshots) {
            const fs = require('fs');
            const path = require('path');
            const screenshotsDir = path.join(process.cwd(), 'screenshots');
            if (!fs.existsSync(screenshotsDir)) {
              fs.mkdirSync(screenshotsDir, { recursive: true });
            }
            const filename = `page-${pageNum.toString().padStart(2, '0')}.png`;
            fs.writeFileSync(path.join(screenshotsDir, filename), screenshot);
            logger.info(`Screenshot saved locally: ${filename}`);
          }
        }
        
        logger.info('Specific pages captured successfully', { 
          totalPages: screenshots.length, 
          requestedPages: pageNumbers 
        });
        
      } else {
        // Capture all pages dynamically
        logger.info('Capturing all pages dynamically');
        
        let pageNum = 1;
        const configMaxPages = config.rateLimiting.maxPages;
        
        // Start from page 1 and navigate forward, capturing each page
        while (pageNum <= configMaxPages) {
          logger.info('Capturing page', { pageNum, maxAllowed: configMaxPages });
          
          // Take screenshot of current page
          const screenshot = await this.capturePage(pageNum);
          screenshots.push({
            pageNumber: pageNum,
            data: screenshot
          });
          
          // Save screenshot locally for testing (optional)
          if (config.debug?.saveScreenshots) {
            const fs = require('fs');
            const path = require('path');
            const screenshotsDir = path.join(process.cwd(), 'screenshots');
            if (!fs.existsSync(screenshotsDir)) {
              fs.mkdirSync(screenshotsDir, { recursive: true });
            }
            const filename = `page-${pageNum.toString().padStart(2, '0')}.png`;
            fs.writeFileSync(path.join(screenshotsDir, filename), screenshot);
            logger.info(`Screenshot saved locally: ${filename}`);
          }
          
          // Check if there's a next page
          const nextButton = await this.page.$('#nextPageIcon, button[aria-label*="next"], button[aria-label*="Next"], .next-button, .arrow-right, [data-react-class*="ChevronRight"]');
          if (!nextButton || !(await nextButton.isVisible())) {
            logger.info('No next button found, reached end of document');
            break;
          }
          
          // Navigate to next page
          logger.info(`Navigating from page ${pageNum} to page ${pageNum + 1}`);
          await nextButton.click();
          await this.page.waitForTimeout(1500); // Give time for page transition
          await this.page.waitForLoadState('domcontentloaded');
          
          pageNum++;
          
          // Progress update
          if (pageNum % 5 === 0) {
            logger.info('Capture progress', { completed: pageNum - 1 });
          }
        }
        
        logger.info('All pages captured successfully', { 
          totalPages: screenshots.length, 
          maxAllowed: configMaxPages 
        });
      }
      
      return screenshots;
    } catch (error) {
      logger.error('Failed to capture pages', { error: error.message });
      throw error;
    }
  }

  // Clean up resources
  async cleanup() {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      logger.info('Browser resources cleaned up');
    } catch (error) {
      logger.error('Failed to cleanup browser resources', { error: error.message });
    }
  }

  // Redact URL for logging
  redactUrl(url) {
    return url.replace(/(https?:\/\/docsend\.com\/view\/[a-zA-Z0-9]+)(\?[^\s]*)?/, '[DOCSEND_URL]');
  }
}

module.exports = DocSendService; 