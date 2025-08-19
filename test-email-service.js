const EmailService = require('./src/services/emailService');

async function testEmailService() {
  try {
    console.log('🧪 Testing Email Service...');
    
    const emailService = new EmailService();
    
    // Test connection
    console.log('🔌 Testing IMAP connection...');
    const connectionTest = await emailService.testConnection();
    console.log('✅ Connection test:', connectionTest ? 'SUCCESS' : 'FAILED');
    
    if (connectionTest) {
      console.log('🔍 Testing OTP retrieval...');
      console.log('📧 This will search for recent DocSend emails...');
      
      try {
        const otp = await emailService.getOTP();
        if (otp) {
          console.log('✅ OTP found:', otp);
        } else {
          console.log('ℹ️  No recent OTP found (this is normal if no recent DocSend emails)');
        }
      } catch (otpError) {
        console.log('ℹ️  OTP retrieval test:', otpError.message);
        console.log('   (This is normal if no recent DocSend verification emails)');
      }
    }
    
  } catch (error) {
    console.error('❌ Email service test failed:', error.message);
  }
}

testEmailService(); 