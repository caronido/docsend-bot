# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Install system dependencies required for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set environment variables for Playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and run postinstall script
RUN npm ci --only=production && npm run postinstall

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start:prod"] 