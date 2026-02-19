// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL ROUTES
// Gmail / Google Workspace OAuth 2.0 and API proxy endpoints
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import crypto from 'crypto';
import emailService from '../services/emailService.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────────
// OAuth Configuration
// ─────────────────────────────────────────────────────────────────────────────────

// Read env vars lazily (at request time) because ES module imports
// execute before dotenv config() is called in index.js
const getEnv = () => ({
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  APP_URL: process.env.APP_URL || 'http://localhost:5174',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5174'
});

// Google scopes - Gmail full access + Drive read/write + Docs/Sheets readonly
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly'
].join(' ');

// Store OAuth state tokens temporarily
const oauthStates = new Map();

// Periodic cleanup of stale OAuth state tokens (every 5 minutes)
const OAUTH_STATE_TTL = 10 * 60 * 1000; // 10 minutes
setInterval(() => {
  const cutoff = Date.now() - OAUTH_STATE_TTL;
  for (const [key, value] of oauthStates) {
    if (value.timestamp < cutoff) {
      oauthStates.delete(key);
    }
  }
}, 5 * 60 * 1000).unref(); // .unref() so it doesn't prevent process exit

// ═══════════════════════════════════════════════════════════════════════════════
// OAUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/email/oauth/google
// Initiate Google OAuth flow
router.get('/oauth/google', (req, res) => {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({
      error: 'Google OAuth not configured',
      message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'
    });
  }

  // Generate state token for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { provider: 'gmail', timestamp: Date.now() });

  // Clean up old states (older than 10 minutes)
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of oauthStates) {
    if (value.timestamp < tenMinutesAgo) {
      oauthStates.delete(key);
    }
  }

  const redirectUri = `${env.APP_URL}/api/email/oauth/callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GOOGLE_SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  res.json({ authUrl: authUrl.toString() });
});

// GET /api/email/oauth/callback
// Handle Google OAuth callback
router.get('/oauth/callback', async (req, res) => {
  const env = getEnv();
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${env.CLIENT_URL}/?oauth_error=${encodeURIComponent(error)}`);
  }

  // Verify state token
  if (!state || !oauthStates.has(state)) {
    return res.redirect(`${env.CLIENT_URL}/?oauth_error=invalid_state`);
  }
  oauthStates.delete(state);

  if (!code) {
    return res.redirect(`${env.CLIENT_URL}/?oauth_error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${env.APP_URL}/api/email/oauth/callback`,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return res.redirect(`${env.CLIENT_URL}/?oauth_error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
    }

    const { access_token, refresh_token, expires_in } = tokenData;

    // Fetch user profile
    const profileResponse = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const profile = await profileResponse.json();

    // Save to email service (default 30 days auth persistence)
    await emailService.saveSettings({
      connected: true,
      gmailEmail: profile.emailAddress,
      gmailAccessToken: access_token,
      gmailRefreshToken: refresh_token,
      gmailTokenExpiresAt: Date.now() + (expires_in * 1000),
      authExpiresAt: Date.now() + (30 * 86400000)
    });

    // Redirect back to app with success
    res.redirect(`${env.CLIENT_URL}/?oauth_success=gmail&user=${encodeURIComponent(profile.emailAddress)}`);
  } catch (error) {
    console.error('Gmail OAuth error:', error);
    res.redirect(`${env.CLIENT_URL}/?oauth_error=${encodeURIComponent(error.message)}`);
  }
});

// POST /api/email/oauth/disconnect
// Disconnect Gmail account
router.post('/oauth/disconnect', async (req, res) => {
  try {
    await emailService.disconnect();
    res.json({ success: true, message: 'Gmail disconnected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/email/connection
// Get Gmail connection status
router.get('/connection', (req, res) => {
  res.json({
    connected: emailService.isConnected(),
    email: emailService.emailSettings.gmailEmail || null
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GMAIL API PROXY ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Middleware to check connection
function requireConnection(req, res, next) {
  if (!emailService.isConnected()) {
    return res.status(401).json({ error: 'Gmail not connected' });
  }
  next();
}

// GET /api/email/profile
router.get('/profile', requireConnection, async (req, res) => {
  try {
    const profile = await emailService.getProfile();
    res.json(profile);
  } catch (error) {
    console.error('Error fetching Gmail profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/email/messages
router.get('/messages', requireConnection, async (req, res) => {
  try {
    const { q = 'is:inbox', maxResults = 30 } = req.query;
    const messages = await emailService.fetchMessages(q, parseInt(maxResults));
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/email/messages/:id
router.get('/messages/:id', requireConnection, async (req, res) => {
  try {
    const { format = 'metadata' } = req.query;
    const message = await emailService.getMessage(req.params.id, format);
    res.json(message);
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/email/threads/:threadId
router.get('/threads/:threadId', requireConnection, async (req, res) => {
  try {
    const thread = await emailService.fetchThread(req.params.threadId);
    res.json(thread);
  } catch (error) {
    console.error('Error fetching thread:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/email/messages/:messageId/attachments/:attachmentId
// Download attachment data from Gmail
router.get('/messages/:messageId/attachments/:attachmentId', requireConnection, async (req, res) => {
  try {
    const { messageId, attachmentId } = req.params;
    const attachment = await emailService.getAttachment(messageId, attachmentId);
    res.json(attachment);
  } catch (error) {
    console.error('Error fetching attachment:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/email/attachments/upload-to-hive
// Download from Gmail, then upload to Hive action as attachment
router.post('/attachments/upload-to-hive', requireConnection, async (req, res) => {
  try {
    const { messageId, attachmentId, filename, mimeType, hiveActionId, hiveApiKey, hiveUserId } = req.body;

    if (!messageId || !attachmentId || !hiveActionId || !hiveApiKey || !hiveUserId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Download attachment data from Gmail
    const gmailAttachment = await emailService.getAttachment(messageId, attachmentId);

    // 2. Convert base64url to Buffer
    const fileBuffer = Buffer.from(gmailAttachment.data, 'base64url');

    // 3. Build multipart form data for Hive API
    const boundary = '----FormBoundary' + Date.now().toString(16);
    const safeName = filename || 'attachment';
    const safeMime = mimeType || 'application/octet-stream';

    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
      `Content-Type: ${safeMime}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);

    // 4. Upload to Hive
    const hiveResponse = await fetch(
      `https://app.hive.com/api/v1/actions/${hiveActionId}/attachments?user_id=${encodeURIComponent(hiveUserId)}`,
      {
        method: 'POST',
        headers: {
          'api_key': hiveApiKey,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length.toString()
        },
        body: body
      }
    );

    if (!hiveResponse.ok) {
      const errorText = await hiveResponse.text();
      throw new Error(`Hive upload failed (${hiveResponse.status}): ${errorText}`);
    }

    const result = await hiveResponse.json().catch(() => ({ success: true }));
    res.json({ success: true, hiveResult: result, filename: safeName });
  } catch (error) {
    console.error('Error uploading attachment to Hive:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/email/messages/send
router.post('/messages/send', requireConnection, async (req, res) => {
  try {
    const { raw } = req.body;
    if (!raw) {
      return res.status(400).json({ error: 'raw message is required' });
    }
    const result = await emailService.sendMessage(raw);
    res.json(result);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/email/messages/:id/modify
router.post('/messages/:id/modify', requireConnection, async (req, res) => {
  try {
    const { addLabelIds = [], removeLabelIds = [] } = req.body;
    const result = await emailService.modifyMessage(req.params.id, addLabelIds, removeLabelIds);
    res.json(result);
  } catch (error) {
    console.error('Error modifying message:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/email/messages/:id
router.delete('/messages/:id', requireConnection, async (req, res) => {
  try {
    const { permanent } = req.query;
    let result;
    if (permanent === 'true') {
      result = await emailService.deleteMessage(req.params.id);
    } else {
      result = await emailService.trashMessage(req.params.id);
    }
    res.json(result);
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/email/labels
router.get('/labels', requireConnection, async (req, res) => {
  try {
    const labels = await emailService.listLabels();
    res.json(labels);
  } catch (error) {
    console.error('Error fetching labels:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/email/labels
router.post('/labels', requireConnection, async (req, res) => {
  try {
    const { name, ...options } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Label name is required' });
    }
    const result = await emailService.createLabel(name, options);
    res.json(result);
  } catch (error) {
    console.error('Error creating label:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/email/labels/:id
router.delete('/labels/:id', requireConnection, async (req, res) => {
  try {
    const result = await emailService.deleteLabel(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error deleting label:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
