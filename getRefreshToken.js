const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000'; // Or your local redirect URI

const oauth2Client = new OAuth2Client(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Replace with the scope your application needs
const scopes = ['https://www.googleapis.com/auth/youtube.readonly'];

async function getNewRefreshToken() {
  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // This is crucial for getting a refresh token
    scope: scopes,
    prompt: 'consent', // Ensures user is prompted for consent, even if already granted
  });

  console.log('Authorize this app by visiting this URL:');
  console.log(authorizeUrl);
  console.log('\nAfter authorization, paste the code from the redirect URL here:');

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (input) => {
    const code = input.trim();
    if (code) {
      try {
        const { tokens } = await oauth2Client.getToken(code);
        console.log('\n--- Your new REFRESH TOKEN ---');
        console.log(tokens.refresh_token);
        console.log('-----------------------------');
        console.log('Update YOUTUBE_REFRESH_TOKEN in your .env file and Vercel environment variables with this token.');
        process.exit();
      } catch (error) {
        console.error('Error getting tokens:', error.message);
        process.exit(1);
      }
    }
  });
}

getNewRefreshToken().catch(console.error);