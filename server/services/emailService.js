// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL SERVICE
// Gmail / Google Workspace OAuth 2.0 integration with token management
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SETTINGS_PATH = path.join(__dirname, '../../data/email-settings.json');

const DEFAULT_SETTINGS = {
  connected: false,
  gmailEmail: null,
  gmailAccessToken: null,
  gmailRefreshToken: null,
  gmailTokenExpiresAt: null,
  authExpiresAt: null
};

class EmailService {
  constructor() {
    this.emailSettings = { ...DEFAULT_SETTINGS };
    this.refreshPromise = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION & SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════════

  async initialize() {
    await fs.mkdir(path.join(__dirname, '../../data'), { recursive: true });
    await this.loadSettings();
    console.log('✓ Email service initialized');
  }

  async loadSettings() {
    try {
      const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
      this.emailSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    } catch {
      // Settings file doesn't exist yet, use defaults
    }
  }

  async saveSettings(settings) {
    this.emailSettings = { ...this.emailSettings, ...settings };
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(this.emailSettings, null, 2));
    return this.emailSettings;
  }

  getSettings() {
    return {
      connected: this.emailSettings.connected,
      gmailEmail: this.emailSettings.gmailEmail,
      gmailAccessToken: this.emailSettings.gmailAccessToken ? '***configured***' : null,
      gmailRefreshToken: this.emailSettings.gmailRefreshToken ? '***configured***' : null
    };
  }

  isConnected() {
    if (!this.emailSettings.connected || !this.emailSettings.gmailRefreshToken) return false;
    // Check auth expiration if set
    if (this.emailSettings.authExpiresAt && Date.now() > this.emailSettings.authExpiresAt) {
      console.log('Gmail auth session expired. Re-login required.');
      return false;
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TOKEN MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  async getValidAccessToken() {
    // Check if current token is still valid (60s buffer)
    if (
      this.emailSettings.gmailAccessToken &&
      this.emailSettings.gmailTokenExpiresAt &&
      this.emailSettings.gmailTokenExpiresAt > Date.now() + 60000
    ) {
      return this.emailSettings.gmailAccessToken;
    }

    if (!this.emailSettings.gmailRefreshToken) {
      throw new Error('No refresh token available. Please reconnect Gmail.');
    }

    return await this.refreshAccessToken();
  }

  async refreshAccessToken() {
    // Prevent concurrent refresh calls
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this._doRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async _doRefresh() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    }

    if (!this.emailSettings.gmailRefreshToken) {
      await this.disconnect();
      throw new Error('No refresh token. Please reconnect your Google account.');
    }

    let response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: this.emailSettings.gmailRefreshToken,
          grant_type: 'refresh_token'
        })
      });
    } catch (fetchErr) {
      throw new Error(`Failed to reach Google OAuth server: ${fetchErr.message}`);
    }

    // Ensure the response is JSON before parsing
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text().catch(() => '');
      console.error('Token refresh returned non-JSON:', text.substring(0, 200));
      await this.disconnect();
      throw new Error('Google session expired. Please reconnect your Google account.');
    }

    const data = await response.json();

    if (data.error) {
      if (data.error === 'invalid_grant') {
        await this.disconnect();
        throw new Error('Gmail session expired. Please reconnect your Google account.');
      }
      throw new Error(data.error_description || data.error);
    }

    if (!data.access_token) {
      await this.disconnect();
      throw new Error('No access token received from Google. Please reconnect.');
    }

    this.emailSettings.gmailAccessToken = data.access_token;
    this.emailSettings.gmailTokenExpiresAt = Date.now() + (data.expires_in * 1000);

    // Google may return a new refresh token
    if (data.refresh_token) {
      this.emailSettings.gmailRefreshToken = data.refresh_token;
    }

    await this.saveSettings(this.emailSettings);
    return data.access_token;
  }

  async disconnect() {
    // Try to revoke the token
    if (this.emailSettings.gmailAccessToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${this.emailSettings.gmailAccessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
      } catch {
        // Token might already be invalid
      }
    }

    this.emailSettings = { ...DEFAULT_SETTINGS };
    await this.saveSettings(this.emailSettings);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GMAIL API METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  async _gmailRequest(endpoint, options = {}) {
    const token = await this.getValidAccessToken();
    const url = `https://www.googleapis.com/gmail/v1/users/me${endpoint}`;

    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...options.headers
      }
    });

    // Handle redirects (Google sends 302 to login page when token is invalid)
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Google session expired. Please reconnect your Google account in Settings.');
    }

    // Verify content type is JSON before parsing
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json') && response.status !== 204) {
      const text = await response.text().catch(() => '');
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        throw new Error('Google session expired. Please reconnect your Google account in Settings.');
      }
      throw new Error(`Unexpected response from Gmail API: ${response.status}`);
    }

    if (response.status === 204) {
      return { success: true };
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error('Google session expired. Please reconnect your Google account in Settings.');
      }
      throw new Error(error.error?.message || `Gmail API error: ${response.status}`);
    }

    return await response.json();
  }

  async getProfile() {
    return await this._gmailRequest('/profile');
  }

  // Extract plain text body from Gmail message payload
  /**
   * Sanitize HTML content — keeps basic formatting tags, strips dangerous code
   * (JS, PHP, SQL), email signatures, fine print, and excessive styling.
   */
  _sanitizeHtml(html) {
    let clean = html;

    // Strip dangerous code: JavaScript, PHP, SQL
    clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    clean = clean.replace(/<\?php[\s\S]*?\?>/gi, '');
    clean = clean.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    clean = clean.replace(/javascript\s*:/gi, '');
    clean = clean.replace(/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|UNION|TRUNCATE)\b\s+(INTO|FROM|TABLE|DATABASE|ALL|SET)\b[\s\S]*?[;])/gi, '');

    // Strip style/link tags and their content
    clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    clean = clean.replace(/<link[^>]*>/gi, '');

    // Strip HTML comments
    clean = clean.replace(/<!--[\s\S]*?-->/g, '');

    // Strip class, id, style, data-* and presentation attributes
    clean = clean.replace(/\s+(class|id|style|data-[\w-]+|align|bgcolor|cellpadding|cellspacing|width|height|border|valign|face|size|color)\s*=\s*["'][^"']*["']/gi, '');

    // Strip email signatures
    // Double-dash separator: only strip if it appears in the last 50% of the email
    // to avoid wiping content when "--" appears in code or regular text
    const dashSigHtml = clean.match(/--\s*<br[^>]*>/i);
    if (dashSigHtml && dashSigHtml.index > clean.length * 0.5) {
      clean = clean.substring(0, dashSigHtml.index);
    }
    clean = clean.replace(/<div[^>]*class=["'][^"']*signature[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
    clean = clean.replace(/<div[^>]*id=["'][^"']*signature[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
    clean = clean.replace(/<div[^>]*class=["'][^"']*gmail_signature[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
    clean = clean.replace(/<div[^>]*id=["']Signature["'][^>]*>[\s\S]*?<\/div>/gi, '');
    clean = clean.replace(/<div[^>]*id=["']divtagdefaultwrapper["'][^>]*>[\s\S]*?<\/div>/gi, '');

    // Strip "Sent from my ..." lines
    clean = clean.replace(/<(p|div|span)[^>]*>\s*Sent from (my )?(iPhone|iPad|Galaxy|Android|Samsung|Outlook|Mail).*?<\/(p|div|span)>/gi, '');
    clean = clean.replace(/Sent from (my )?(iPhone|iPad|Galaxy|Android|Samsung|Outlook|Mail)[^\n]*/gi, '');

    // Strip fine print / legal / unsubscribe
    clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(This (email|message) (is|was) (intended|confidential|sent)[\s\S]*?)<\/(p|div|span|td)>/gi, '');
    clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(If you (are not|received this in error)[\s\S]*?)<\/(p|div|span|td)>/gi, '');
    clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(To unsubscribe|Unsubscribe|Click here to unsubscribe)[\s\S]*?<\/(p|div|span|td)>/gi, '');
    clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(CONFIDENTIALITY|DISCLAIMER|LEGAL NOTICE)[\s\S]*?<\/(p|div|span|td)>/gi, '');

    // Strip non-basic HTML tags (keep safe formatting only)
    const allowedTags = 'b|i|u|em|strong|p|br|ul|ol|li|h1|h2|h3|h4|h5|h6|a|blockquote|pre|code|hr|sub|sup|s|del|ins|mark|small|table|thead|tbody|tr|td|th';
    const tagStripRegex = new RegExp(`<(?!\\/?(${allowedTags})\\b)[^>]+>`, 'gi');
    clean = clean.replace(tagStripRegex, '');

    // Decode common entities
    clean = clean.replace(/&nbsp;/g, ' ');

    // Clean up excessive whitespace
    clean = clean.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
    clean = clean.replace(/\n{3,}/g, '\n\n');

    return clean.trim();
  }

  _extractBody(payload) {
    if (!payload) return '';

    // Direct body on the payload
    if (payload.body?.data) {
      const mimeType = payload.mimeType || '';
      if (mimeType === 'text/plain') {
        return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      }
      if (mimeType === 'text/html') {
        return this._sanitizeHtml(Buffer.from(payload.body.data, 'base64url').toString('utf-8'));
      }
    }

    // Check parts recursively
    if (payload.parts && payload.parts.length > 0) {
      // First try to find text/plain
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64url').toString('utf-8');
        }
      }
      // Recurse into multipart parts
      for (const part of payload.parts) {
        if (part.parts) {
          const result = this._extractBody(part);
          if (result) return result;
        }
      }
      // Fallback to text/html — sanitize and keep basic formatting
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
          return this._sanitizeHtml(html);
        }
      }
    }
    return '';
  }

  // Extract attachment metadata from Gmail message payload
  // Filters out inline/embedded images (logos, signatures, social icons)
  _extractAttachments(payload) {
    const attachments = [];
    if (!payload) return attachments;

    // Common embedded image filenames to exclude (email signatures, logos, social icons)
    const embeddedImagePatterns = [
      /^image\d*\./i,                    // image001.png, image002.jpg etc.
      /^(logo|banner|header|footer)/i,   // logo.png, banner.jpg
      /^(facebook|twitter|linkedin|instagram|youtube|tiktok|x-icon|social)/i,
      /^(icon|spacer|pixel|tracking|separator|divider|line)/i,
      /^unnamed/i,                        // unnamed inline images
    ];

    const walk = (parts) => {
      if (!parts) return;
      for (const part of parts) {
        if (part.filename && part.body?.attachmentId) {
          // Check Content-Disposition header — skip inline images
          const headers = part.headers || [];
          const dispositionHeader = headers.find(h => h.name?.toLowerCase() === 'content-disposition');
          const contentIdHeader = headers.find(h => h.name?.toLowerCase() === 'content-id');
          const disposition = dispositionHeader?.value?.toLowerCase() || '';
          const isInline = disposition.startsWith('inline');
          const hasCid = !!contentIdHeader;

          // If it's an inline image with a Content-ID, it's embedded in the email body
          const isImage = (part.mimeType || '').startsWith('image/');
          const matchesEmbeddedPattern = embeddedImagePatterns.some(p => p.test(part.filename));

          // Skip if: (inline disposition AND image) OR (has CID AND image AND matches embedded pattern)
          // OR (image AND very small size likely a tracking pixel/icon AND has CID)
          if (isImage && (isInline || (hasCid && matchesEmbeddedPattern) || (hasCid && part.body.size < 15000))) {
            continue;
          }

          attachments.push({
            partId: part.partId || '',
            filename: part.filename,
            mimeType: part.mimeType || 'application/octet-stream',
            size: part.body.size || 0,
            attachmentId: part.body.attachmentId
          });
        }
        if (part.parts) {
          walk(part.parts);
        }
      }
    };

    walk(payload.parts);
    return attachments;
  }

  async fetchMessages(query = 'is:inbox', maxResults = 30) {
    const listData = await this._gmailRequest(
      `/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`
    );

    if (!listData.messages || listData.messages.length === 0) {
      return [];
    }

    const messages = await Promise.all(
      listData.messages.map(async (msg) => {
        try {
          const msgData = await this._gmailRequest(
            `/messages/${msg.id}?format=full`
          );

          const headers = {};
          msgData.payload?.headers?.forEach(h => {
            headers[h.name.toLowerCase()] = h.value;
          });

          // Extract full body text with line breaks preserved
          const bodyText = this._extractBody(msgData.payload);
          const preview = bodyText
            ? bodyText.substring(0, 500)
            : (msgData.snippet || '').substring(0, 150);

          // Extract attachment metadata
          const attachments = this._extractAttachments(msgData.payload);

          return {
            id: msgData.id,
            threadId: msgData.threadId,
            from: headers.from || '',
            to: headers.to || '',
            cc: headers.cc || '',
            subject: headers.subject || '(No Subject)',
            date: headers.date || new Date(parseInt(msgData.internalDate)).toISOString(),
            preview: preview,
            isUnread: msgData.labelIds?.includes('UNREAD'),
            labels: msgData.labelIds || [],
            snippet: msgData.snippet,
            attachments
          };
        } catch {
          return null;
        }
      })
    );

    return messages.filter(m => m !== null);
  }

  async getMessage(messageId, format = 'metadata') {
    return await this._gmailRequest(`/messages/${messageId}?format=${format}`);
  }

  async getAttachment(messageId, attachmentId) {
    return await this._gmailRequest(`/messages/${messageId}/attachments/${attachmentId}`);
  }

  async fetchThread(threadId) {
    const thread = await this._gmailRequest(`/threads/${threadId}?format=full`);

    if (!thread.messages || thread.messages.length === 0) {
      return { id: threadId, messages: [] };
    }

    const messages = thread.messages.map(msgData => {
      const headers = {};
      msgData.payload?.headers?.forEach(h => {
        headers[h.name.toLowerCase()] = h.value;
      });

      const bodyText = this._extractBody(msgData.payload);
      const preview = bodyText
        ? bodyText.substring(0, 500)
        : (msgData.snippet || '').substring(0, 150);

      const attachments = this._extractAttachments(msgData.payload);

      return {
        id: msgData.id,
        threadId: msgData.threadId,
        from: headers.from || '',
        to: headers.to || '',
        cc: headers.cc || '',
        subject: headers.subject || '(No Subject)',
        date: headers.date || new Date(parseInt(msgData.internalDate)).toISOString(),
        preview: preview,
        isUnread: msgData.labelIds?.includes('UNREAD'),
        labels: msgData.labelIds || [],
        snippet: msgData.snippet,
        attachments
      };
    });

    return { id: threadId, messages };
  }

  async sendMessage(raw) {
    return await this._gmailRequest('/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw })
    });
  }

  async modifyMessage(messageId, addLabelIds = [], removeLabelIds = []) {
    return await this._gmailRequest(`/messages/${messageId}/modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addLabelIds, removeLabelIds })
    });
  }

  async trashMessage(messageId) {
    return await this._gmailRequest(`/messages/${messageId}/trash`, {
      method: 'POST'
    });
  }

  async deleteMessage(messageId) {
    const token = await this.getValidAccessToken();
    const url = `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Gmail API error: ${response.status}`);
    }

    return { success: true };
  }

  async listLabels() {
    const data = await this._gmailRequest('/labels');
    return data.labels || [];
  }

  async createLabel(name, options = {}) {
    return await this._gmailRequest('/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...options })
    });
  }

  async deleteLabel(labelId) {
    const token = await this.getValidAccessToken();
    const url = `https://www.googleapis.com/gmail/v1/users/me/labels/${labelId}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Gmail API error: ${response.status}`);
    }

    return { success: true };
  }
}

const emailService = new EmailService();
export default emailService;
