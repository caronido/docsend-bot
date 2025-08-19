const { config, validateConfig } = require('./src/config');

console.log('🧪 Testing Configuration...\n');

try {
  // Test configuration validation
  validateConfig();
  console.log('✅ Configuration validation: SUCCESS');
  
  // Show current config (with sensitive data redacted)
  console.log('\n📋 Current Configuration:');
  console.log('├── Slack Bot Token:', config.slack.botToken ? '✅ Set' : '❌ Missing');
  console.log('├── Slack Signing Secret:', config.slack.signingSecret ? '✅ Set' : '❌ Missing');
  console.log('├── Slack App Token:', config.slack.appToken ? '✅ Set' : '❌ Missing');
  console.log('├── DocSend Viewer Email:', config.docsend.viewerEmail ? '✅ Set' : '❌ Missing');
  console.log('├── Email Provider:', config.docsend.emailProvider || '❌ Not set');
  console.log('└── Email Credentials:', config.docsend.emailCredentials ? '✅ Set' : '❌ Missing');
  
  // Check what's missing
  const missing = [];
  if (!config.slack.appToken) missing.push('SLACK_APP_TOKEN');
  
  if (missing.length > 0) {
    console.log(`\n⚠️  Still missing: ${missing.join(', ')}`);
    console.log('   Get the App Token from Slack app settings → Basic Information → App-Level Tokens');
  } else {
    console.log('\n🎉 All required configuration is set!');
    console.log('   You can now start the bot with: npm start');
  }
  
} catch (error) {
  console.error('❌ Configuration validation failed:', error.message);
} 