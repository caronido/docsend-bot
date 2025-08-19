const Imap = require('imap');
const { simpleParser } = require('mailparser');

// Test IMAP connection
async function testIMAP() {
  console.log('🧪 Testing IMAP connection...');
  
  // You'll need to replace these with your actual values
  const config = {
    user: 'renata@nido.ventures',
    password: 'vjct icbc ohsg ppzf', // Your Gmail app password
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  };

  return new Promise((resolve, reject) => {
    const imap = new Imap(config);

    imap.once('ready', () => {
      console.log('✅ IMAP connection successful!');
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('❌ Error opening inbox:', err.message);
          imap.end();
          resolve(false);
          return;
        }
        
        console.log('✅ Inbox opened successfully');
        console.log('📧 Total messages:', box.messages.total);
        imap.end();
        resolve(true);
      });
    });

    imap.once('error', (err) => {
      console.error('❌ IMAP connection error:', err.message);
      resolve(false);
    });

    imap.once('end', () => {
      console.log('🔌 IMAP connection ended');
    });

    console.log('🔌 Connecting to IMAP...');
    imap.connect();
  });
}

// Run the test
testIMAP().then(success => {
  if (success) {
    console.log('\n🎉 IMAP test completed successfully!');
    console.log('📝 Now you can update your .env file with the correct password.');
  } else {
    console.log('\n❌ IMAP test failed. Check your credentials.');
  }
}).catch(error => {
  console.error('💥 Test error:', error.message);
}); 