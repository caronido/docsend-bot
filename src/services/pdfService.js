const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const { config } = require('../config');
const { logger } = require('../utils/logger');

class PDFService {
  constructor() {
    this.pageSize = config.pdf.pageSize;
    this.dpi = config.pdf.dpi;
    this.compressionQuality = config.pdf.compressionQuality;
  }

  // Convert screenshots to PDF
  async createPDF(screenshots) {
    try {
      logger.info('Starting PDF creation', { 
        pageCount: screenshots.length, 
        pageSize: this.pageSize,
        dpi: this.dpi 
      });

      const pdfDoc = await PDFDocument.create();
      
      for (let i = 0; i < screenshots.length; i++) {
        const screenshot = screenshots[i];
        logger.info('Processing page for PDF', { 
          pageNumber: screenshot.pageNumber, 
          totalPages: screenshots.length 
        });

        // Process image with Sharp
        const processedImage = await this.processImage(screenshot.data);
        
        // Add page to PDF
        const page = await this.addPageToPDF(pdfDoc, processedImage, screenshot.pageNumber);
        
        logger.info('Page added to PDF', { pageNumber: screenshot.pageNumber });
      }

      // Generate final PDF
      const pdfBytes = await pdfDoc.save();
      
      // Convert Uint8Array to Buffer for Slack compatibility
      const pdfBuffer = Buffer.from(pdfBytes);
      
      logger.info('PDF created successfully', { 
        size: pdfBytes.length, 
        pageCount: screenshots.length,
        bufferSize: pdfBuffer.length,
        isBuffer: Buffer.isBuffer(pdfBuffer)
      });

      return pdfBuffer;
    } catch (error) {
      logger.error('Failed to create PDF', { error: error.message });
      throw error;
    }
  }

  // Process image with Sharp for optimization
  async processImage(imageBuffer) {
    try {
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      
      logger.info('Image metadata', { 
        width: metadata.width, 
        height: metadata.height, 
        format: metadata.format 
      });

      // Calculate target dimensions based on page size and DPI
      const targetDimensions = this.calculateTargetDimensions(metadata.width, metadata.height);
      
      // Resize and optimize image
      const processedImage = await image
        .resize(targetDimensions.width, targetDimensions.height, {
          fit: 'inside',
          withoutEnlargement: true,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png({ 
          quality: this.compressionQuality,
          compressionLevel: 9
        })
        .toBuffer();

      logger.info('Image processed successfully', { 
        originalSize: imageBuffer.length,
        processedSize: processedImage.length,
        targetDimensions
      });

      return processedImage;
    } catch (error) {
      logger.error('Failed to process image', { error: error.message });
      throw error;
    }
  }

  // Calculate target dimensions for PDF page
  calculateTargetDimensions(originalWidth, originalHeight) {
    const pageDimensions = this.getPageDimensions();
    const aspectRatio = originalWidth / originalHeight;
    
    let targetWidth, targetHeight;
    
    if (aspectRatio > pageDimensions.aspectRatio) {
      // Image is wider than page
      targetWidth = pageDimensions.width;
      targetHeight = targetWidth / aspectRatio;
    } else {
      // Image is taller than page
      targetHeight = pageDimensions.height;
      targetWidth = targetHeight * aspectRatio;
    }
    
    // Ensure dimensions are within reasonable bounds
    const maxDimension = Math.max(pageDimensions.width, pageDimensions.height);
    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      const scale = maxDimension / Math.max(targetWidth, targetHeight);
      targetWidth *= scale;
      targetHeight *= scale;
    }
    
    return {
      width: Math.round(targetWidth),
      height: Math.round(targetHeight)
    };
  }

  // Get page dimensions based on configured page size (LANDSCAPE ORIENTATION)
  getPageDimensions() {
    const dpi = this.dpi;
    
    switch (this.pageSize.toLowerCase()) {
      case 'a4':
        return {
          width: Math.round(11.69 * dpi), // A4 height becomes width (landscape)
          height: Math.round(8.27 * dpi), // A4 width becomes height (landscape)
          aspectRatio: 11.69 / 8.27
        };
      case 'letter':
        return {
          width: Math.round(11 * dpi), // Letter height becomes width (landscape)
          height: Math.round(8.5 * dpi), // Letter width becomes height (landscape)
          aspectRatio: 11 / 8.5
        };
      case 'legal':
        return {
          width: Math.round(14 * dpi), // Legal height becomes width (landscape)
          height: Math.round(8.5 * dpi), // Legal width becomes height (landscape)
          aspectRatio: 14 / 8.5
        };
      default:
        // Default to A4 landscape
        return {
          width: Math.round(11.69 * dpi),
          height: Math.round(8.27 * dpi),
          aspectRatio: 11.69 / 8.27
        };
    }
  }

  // Add a page to the PDF document
  async addPageToPDF(pdfDoc, imageBuffer, pageNumber) {
    try {
      // Create page with calculated dimensions
      const pageDimensions = this.getPageDimensions();
      const page = pdfDoc.addPage([pageDimensions.width, pageDimensions.height]);
      
      // Convert image to PDF format
      const image = await pdfDoc.embedPng(imageBuffer);
      
      // Calculate image positioning (center on page)
      const imageDimensions = this.calculateTargetDimensions(image.width, image.height);
      const x = (pageDimensions.width - imageDimensions.width) / 2;
      const y = (pageDimensions.height - imageDimensions.height) / 2;
      
      // Draw image on page
      page.drawImage(image, {
        x,
        y,
        width: imageDimensions.width,
        height: imageDimensions.height
      });
      
      // Add page number (optional)
      if (config.pdf.showPageNumbers) {
        this.addPageNumber(page, pageNumber, pageDimensions);
      }
      
      logger.info('Page added to PDF successfully', { 
        pageNumber, 
        imageDimensions, 
        pageDimensions 
      });
      
      return page;
    } catch (error) {
      logger.error('Failed to add page to PDF', { pageNumber, error: error.message });
      throw error;
    }
  }

  // Add page number to PDF page
  addPageNumber(page, pageNumber, pageDimensions) {
    try {
      const fontSize = Math.round(this.dpi * 0.1); // Scale font size with DPI
      const text = `Page ${pageNumber}`;
      
      page.drawText(text, {
        x: pageDimensions.width - 100,
        y: 20,
        size: fontSize,
        color: { r: 0.5, g: 0.5, b: 0.5, alpha: 0.7 }
      });
    } catch (error) {
      logger.warn('Failed to add page number', { pageNumber, error: error.message });
      // Don't fail the entire process for page numbers
    }
  }

  // Get PDF file size in MB
  getFileSizeMB(pdfBytes) {
    return (pdfBytes.length / (1024 * 1024)).toFixed(2);
  }

  // Check if PDF is within Slack upload limits
  isWithinSlackLimit(pdfBytes) {
    const maxSizeBytes = 50 * 1024 * 1024; // 50MB Slack limit
    return pdfBytes.length <= maxSizeBytes;
  }

  // Get compression statistics
  getCompressionStats(originalSize, finalSize) {
    const compressionRatio = ((originalSize - finalSize) / originalSize * 100).toFixed(2);
    return {
      originalSizeMB: (originalSize / (1024 * 1024)).toFixed(2),
      finalSizeMB: (finalSize / (1024 * 1024)).toFixed(2),
      compressionRatio: `${compressionRatio}%`
    };
  }
}

module.exports = PDFService; 