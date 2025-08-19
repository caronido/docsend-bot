# DocSend Parser - Slack Bot

A Slack bot that converts DocSend links to PDFs using headless browser automation. The bot captures screenshots of each page and assembles them into a multi-page PDF, handling various authentication gates and restrictions.

## Features

- **Slash Command**: `/docsend-bot <docsend_url>` for easy access
- **App Mentions**: Mention the bot with a DocSend URL
- **Authentication Support**: Handles email gates, OTP verification, and consent forms
- **High-Quality PDFs**: Full-resolution screenshots with configurable DPI and page sizes
- **Rate Limiting**: Configurable limits for concurrent jobs and user cooldowns
- **Error Handling**: Comprehensive error messages with user-friendly guidance
- **Security**: Permission controls, PII redaction, and encrypted credentials
- **Scalability**: AWS Lambda deployment with S3 storage for large files

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐
│   Slack     │───▶│  Slack App   │───▶│ DocSend     │───▶│   PDF       │
│   Command   │    │  (Bolt)      │    │ Service     │    │  Service    │
└─────────────┘    └──────────────┘    └─────────────┘    └─────────────┘
                           │                    │                    │
                           ▼                    ▼                    ▼
                    ┌──────────────┐    ┌──────────────┐    ┌─────────────┐
                    │   Rate       │    │   Email      │    │   Storage   │
                    │  Limiter     │    │  Service     │    │  (S3/Slack) │
                    └──────────────┘    └──────────────┘    └─────────────┘
```

## Prerequisites

- Node.js 18+ 
- Slack App with appropriate permissions
- Email provider credentials (Gmail API or IMAP)
- AWS account (for Lambda deployment)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd docsend-parser
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Install Playwright browsers**
   ```bash
   npx playwright install chromium
   ```

4. **Set up environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

5. **Run locally**
   ```bash
   npm run dev
   ```

## Configuration

### Required Environment Variables

```bash
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token

# DocSend Configuration
DOCSEND_VIEWER_EMAIL=viewer@example.com
DOCSEND_EMAIL_PROVIDER=gmail
EMAIL_INBOX_CREDENTIALS={"type":"gmail","client_id":"","client_secret":"","refresh_token":""}
```

### Optional Configuration

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
KMS_KEY_ID=your-kms-key-id
S3_BUCKET=your-s3-bucket

# Rate Limiting
MAX_CONCURRENT_JOBS=3
USER_COOLDOWN_SECONDS=60
MAX_PAGES=300
TIMEOUT_SECONDS=600

# PDF Configuration
PDF_PAGE_SIZE=A4
PDF_DPI=150
PDF_COMPRESSION_QUALITY=90
```

## Slack App Setup

1. **Create a Slack App** at [api.slack.com/apps](https://api.slack.com/apps)
2. **Add Bot Token Scopes**:
   - `commands` - For slash commands
   - `files:write` - For uploading PDFs
   - `chat:write` - For sending messages
   - `links:read` - For reading URLs

3. **Create Slash Command**:
   - Command: `/docsend-bot`
   - Request URL: Your endpoint URL
   - Short Description: Convert DocSend to PDF

4. **Subscribe to Events**:
   - `app_mention` - For @mentions
   - `message.channels` - For channel messages

## Email Provider Setup

### Gmail API

1. **Create Google Cloud Project**
2. **Enable Gmail API**
3. **Create OAuth 2.0 credentials**
4. **Generate refresh token**

```json
{
  "type": "gmail",
  "client_id": "your-client-id",
  "client_secret": "your-client-secret",
  "refresh_token": "your-refresh-token"
}
```

### IMAP

```json
{
  "type": "imap",
  "username": "your-email@example.com",
  "password": "your-password",
  "host": "imap.gmail.com",
  "port": 993
}
```

## Usage

### Slash Command

```
/docsend-bot https://docsend.com/view/abc123
```

### App Mention

```
@docsend-bot can you convert this? https://docsend.com/view/abc123
```

## Deployment

### Local Development

```bash
npm run dev
```

### AWS Lambda

1. **Install Serverless Framework**
   ```bash
   npm install -g serverless
   ```

2. **Deploy**
   ```bash
   serverless deploy
   ```

3. **Update Slack App URLs** with the deployed endpoints

## API Endpoints

- `POST /slack/events` - Slack event subscriptions
- `POST /slack/commands` - Slack slash commands
- `GET /health` - Health check and status

## Error Handling

The bot provides user-friendly error messages for common issues:

- **Invalid URL**: Format validation and examples
- **Authentication**: Email mismatch and OTP timeout guidance
- **Access Denied**: Permission and restriction explanations
- **Rate Limits**: Cooldown information and retry guidance

## Security Features

- **PII Redaction**: Automatically redacts sensitive information in logs
- **Permission Controls**: Configurable user and channel allowlists
- **Encrypted Credentials**: KMS encryption for sensitive data
- **Rate Limiting**: Prevents abuse and ensures fair usage

## Monitoring

- **Structured Logging**: JSON-formatted logs with context
- **Job Tracking**: Real-time status updates and progress monitoring
- **Health Checks**: Endpoint monitoring and status reporting
- **Metrics**: Success rates, processing times, and error tracking

## Troubleshooting

### Common Issues

1. **Browser Launch Failures**
   - Ensure Playwright is properly installed
   - Check system dependencies for headless Chrome

2. **Authentication Errors**
   - Verify email credentials
   - Check OTP retrieval configuration

3. **Slack Integration Issues**
   - Validate bot token and signing secret
   - Ensure proper scopes are configured

4. **PDF Generation Failures**
   - Check available memory and disk space
   - Verify image processing dependencies

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm run dev
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review logs for error details
3. Open a GitHub issue with details
4. Contact the development team

## Changelog

### v1.0.0
- Initial release
- Slack slash command support
- DocSend automation with Playwright
- PDF generation with configurable options
- Email authentication handling
- Rate limiting and security features 