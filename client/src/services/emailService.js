// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL SERVICE - Gmail / Google Workspace Integration
// Server-side OAuth 2.0 with backend API proxy
// ═══════════════════════════════════════════════════════════════════════════════

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3001';
const EMAIL_CACHE_KEY = 'omnipotent_email_cache';

// Email tag types for categorization
export const EMAIL_TAGS = {
  TODO_ITEMS: { id: 'todo_items', label: 'To-Do Items', color: '#ef4444', icon: 'alert' },
  QUESTIONS: { id: 'questions', label: 'Questions', color: '#f59e0b', icon: 'help' },
  REQUESTS_CHANGES: { id: 'requests_changes', label: 'Requests & Changes', color: '#8b5cf6', icon: 'code' },
  MEETINGS: { id: 'meetings', label: 'Meetings & Discussions', color: '#3b82f6', icon: 'briefcase' },
  FEEDBACK: { id: 'feedback', label: 'Feedback', color: '#10b981', icon: 'message' },
  INTERNAL: { id: 'internal', label: 'Internal Mail', color: '#6366f1', icon: 'bell' },
  GENERAL: { id: 'general', label: 'General', color: '#94a3b8', icon: 'file' }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTION & OAUTH (Server-Side)
// ═══════════════════════════════════════════════════════════════════════════════

// Check if Gmail is connected (server-side)
export async function getGmailConnectionStatus() {
  try {
    const response = await fetch(`${API_URL}/api/email/connection`);
    if (!response.ok) throw new Error('Failed to check Gmail connection');
    return await response.json();
  } catch (e) {
    console.error('Error checking Gmail connection:', e);
    return { connected: false, email: null };
  }
}

// Initiate Gmail OAuth flow (server-side authorization code flow)
export async function loginWithGmail() {
  const response = await fetch(`${API_URL}/api/email/oauth/google`);
  const data = await response.json();
  if (data.error) throw new Error(data.message || data.error);

  // Open OAuth popup
  const width = 600;
  const height = 700;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const popup = window.open(
    data.authUrl,
    'Gmail Login',
    `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,resizable=yes,scrollbars=yes`
  );

  return new Promise((resolve, reject) => {
    const checkPopup = setInterval(async () => {
      try {
        if (!popup || popup.closed) {
          clearInterval(checkPopup);

          // Check URL params for OAuth result
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('oauth_success') === 'gmail') {
            const user = urlParams.get('user');
            window.history.replaceState({}, document.title, window.location.pathname);
            resolve({ success: true, user });
            return;
          }
          if (urlParams.get('oauth_error')) {
            const error = urlParams.get('oauth_error');
            window.history.replaceState({}, document.title, window.location.pathname);
            reject(new Error(error));
            return;
          }

          // Popup closed without URL params — check server connection status
          const status = await getGmailConnectionStatus();
          if (status.connected) {
            resolve({ success: true, user: status.email });
          } else {
            reject(new Error('Login cancelled'));
          }
        }
      } catch {
        // Cross-origin access errors are expected during OAuth redirect
      }
    }, 500);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(checkPopup);
      reject(new Error('Login timeout'));
    }, 5 * 60 * 1000);
  });
}

// Disconnect Gmail (server-side)
export async function disconnectGmail() {
  const response = await fetch(`${API_URL}/api/email/oauth/disconnect`, { method: 'POST' });
  if (!response.ok) throw new Error('Failed to disconnect Gmail');
  // Clear local cache
  localStorage.removeItem(EMAIL_CACHE_KEY);
  return await response.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// GMAIL API (via Backend Proxy)
// ═══════════════════════════════════════════════════════════════════════════════

// Fetch emails through backend proxy
export async function fetchEmails(maxResults = 30, query = 'is:inbox') {
  const response = await fetch(
    `${API_URL}/api/email/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error('Gmail not connected');
    throw new Error('Failed to fetch emails');
  }
  const messages = await response.json();

  // Parse the from field into name/email objects
  return messages.map(msg => ({
    ...msg,
    from: parseEmailAddress(msg.from || ''),
    date: msg.date ? new Date(msg.date) : new Date()
  }));
}

// Fetch single message
export async function fetchMessage(messageId, format = 'metadata') {
  const response = await fetch(`${API_URL}/api/email/messages/${messageId}?format=${format}`);
  if (!response.ok) throw new Error('Failed to fetch message');
  return await response.json();
}

// Send email (raw base64url-encoded RFC 2822 message)
export async function sendEmail(rawMessage) {
  const response = await fetch(`${API_URL}/api/email/messages/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: rawMessage })
  });
  if (!response.ok) throw new Error('Failed to send email');
  return await response.json();
}

// Modify message labels (e.g., mark as read/unread)
export async function modifyMessage(messageId, addLabelIds = [], removeLabelIds = []) {
  const response = await fetch(`${API_URL}/api/email/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds, removeLabelIds })
  });
  if (!response.ok) throw new Error('Failed to modify message');
  return await response.json();
}

// Delete/trash message
export async function deleteMessage(messageId, permanent = false) {
  const response = await fetch(
    `${API_URL}/api/email/messages/${messageId}?permanent=${permanent}`,
    { method: 'DELETE' }
  );
  if (!response.ok) throw new Error('Failed to delete message');
  return await response.json();
}

// List labels
export async function fetchLabels() {
  const response = await fetch(`${API_URL}/api/email/labels`);
  if (!response.ok) throw new Error('Failed to fetch labels');
  return await response.json();
}

// Fetch email thread
export async function fetchThread(threadId) {
  const response = await fetch(`${API_URL}/api/email/threads/${threadId}`);
  if (!response.ok) throw new Error('Failed to fetch thread');
  const thread = await response.json();
  // Parse from fields
  return {
    ...thread,
    messages: (thread.messages || []).map(msg => ({
      ...msg,
      from: parseEmailAddress(msg.from || ''),
      date: msg.date ? new Date(msg.date) : new Date()
    }))
  };
}

// Upload email attachment to a Hive action (proxy through server)
export async function uploadAttachmentToHive({ messageId, attachmentId, filename, mimeType, hiveActionId, hiveApiKey, hiveUserId }) {
  const response = await fetch(`${API_URL}/api/email/attachments/upload-to-hive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, attachmentId, filename, mimeType, hiveActionId, hiveApiKey, hiveUserId })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to upload attachment to Hive');
  }
  return await response.json();
}

// Fetch Gmail profile
export async function fetchGmailProfile() {
  const response = await fetch(`${API_URL}/api/email/profile`);
  if (!response.ok) throw new Error('Failed to fetch profile');
  return await response.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOCAL UTILITIES (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

// Parse email address from "Name <email@domain.com>" format
function parseEmailAddress(fromString) {
  const match = fromString.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
  if (match) {
    return {
      name: match[1]?.trim() || match[2].split('@')[0],
      email: match[2].trim()
    };
  }
  return {
    name: fromString.split('@')[0],
    email: fromString
  };
}

// Analyze email content and determine tag
export function analyzeEmailContent(email) {
  const subject = (email.subject || '').toLowerCase();
  const preview = (email.preview || '').toLowerCase();
  const content = subject + ' ' + preview;

  // Check for local relabels first
  const relabels = JSON.parse(localStorage.getItem('omnipotent_email_relabels') || '{}');
  if (relabels[email.id]) {
    const tag = Object.values(EMAIL_TAGS).find(t => t.id === relabels[email.id]);
    if (tag) return tag;
  }

  // Check for internal mail (addressed to @om.agency)
  const toField = (email.to || email.from?.email || '').toLowerCase();
  const fromField = (typeof email.from === 'string' ? email.from : email.from?.email || '').toLowerCase();
  if (toField.includes('@om.agency') && fromField.includes('@om.agency')) {
    return EMAIL_TAGS.INTERNAL;
  }

  const patterns = {
    todo_items: [
      'action required', 'urgent', 'asap', 'deadline', 'due date',
      'please complete', 'needs your', 'awaiting your', 'review needed',
      'approval needed', 'sign off', 'immediate attention', 'todo',
      'to-do', 'task', 'reminder', 'follow up', 'follow-up'
    ],
    questions: [
      'question', 'wondering', 'could you', 'can you', 'would you',
      'what do you think', 'your opinion', 'your thoughts', 'how do',
      'is it possible', 'clarification', 'what is', 'when will',
      'where is', 'who is', 'why does'
    ],
    requests_changes: [
      'request', 'change', 'update the', 'modify', 'edit', 'revision',
      'redesign', 'new page', 'add to site', 'remove from', 'content update',
      'image update', 'text change', 'please add', 'please remove',
      'please update', 'please change', 'can we add', 'want to change',
      'website', 'site change'
    ],
    meetings: [
      'meeting', 'call', 'discuss', 'schedule', 'calendar', 'zoom',
      'teams', 'agenda', 'conference', 'sync up', 'catch up',
      'availability', 'invite', 'proposal', 'partnership'
    ],
    feedback: [
      'feedback', 'input', 'review', 'thoughts on', 'opinion',
      'suggestions', 'comments', 'let me know', 'looks good',
      'great work', 'nice job', 'approved', 'love it'
    ]
  };

  const scores = {};
  for (const [category, keywords] of Object.entries(patterns)) {
    scores[category] = keywords.filter(kw => content.includes(kw)).length;
  }

  // Question mark booster
  if (content.includes('?')) {
    scores.questions = (scores.questions || 0) + 1;
  }

  let maxScore = 0;
  let bestCategory = 'general';
  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }

  return EMAIL_TAGS[bestCategory.toUpperCase()] || EMAIL_TAGS.GENERAL;
}

// Get cached emails with tags
export function getCachedEmails() {
  try {
    const cached = localStorage.getItem(EMAIL_CACHE_KEY);
    if (cached) {
      const emails = JSON.parse(cached);
      return emails.map(e => ({
        ...e,
        date: new Date(e.date)
      }));
    }
  } catch (e) {
    console.error('Error getting cached emails:', e);
  }
  return [];
}

// Cache emails
export function cacheEmails(emails) {
  try {
    localStorage.setItem(EMAIL_CACHE_KEY, JSON.stringify(emails));
  } catch (e) {
    console.error('Error caching emails:', e);
  }
}

// Get Gmail message URL
export function getGmailMessageUrl(messageId, email = '') {
  if (email) {
    return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#inbox/${messageId}`;
  }
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

// Group emails by tag
export function groupEmailsByTag(emails) {
  const groups = {};

  Object.values(EMAIL_TAGS).forEach(tag => {
    groups[tag.id] = { tag, emails: [] };
  });

  emails.forEach(email => {
    const tag = email.tag || analyzeEmailContent(email);
    email.tag = tag;
    groups[tag.id].emails.push(email);
  });

  const priority = ['todo_items', 'questions', 'requests_changes', 'internal', 'meetings', 'feedback', 'general'];

  return priority
    .map(id => groups[id])
    .filter(group => group.emails.length > 0);
}

// Fetch contact directory from Google Sheets (with 15-minute cache)
const CONTACT_CACHE_KEY = 'omnipotent_contacts_cache';
const CONTACT_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export async function fetchContactDirectory(sheetId) {
  if (!sheetId) return [];

  // Check cache first
  try {
    const cached = localStorage.getItem(CONTACT_CACHE_KEY);
    if (cached) {
      const { sheetId: cachedSheet, contacts, timestamp } = JSON.parse(cached);
      if (cachedSheet === sheetId && Date.now() - timestamp < CONTACT_CACHE_TTL && contacts?.length > 0) {
        return contacts;
      }
    }
  } catch {
    // Cache read failed, proceed to fetch
  }

  try {
    const response = await fetch(`${API_URL}/api/drive/sheets/${sheetId}/values?range=A1:Z500`);
    if (!response.ok) throw new Error('Failed to fetch contact directory');
    const data = await response.json();

    if (!data.values || data.values.length < 2) return [];

    const headers = data.values[0].map(h => (h || '').toLowerCase().trim());
    const nameIdx = headers.findIndex(h => h.includes('name'));
    const emailIdx = headers.findIndex(h => h.includes('email'));
    const companyIdx = headers.findIndex(h => h.includes('company') || h.includes('client'));
    const ccIdx = headers.findIndex(h => h === 'cc');
    const bccIdx = headers.findIndex(h => h === 'bcc');
    const phoneIdx = headers.findIndex(h => h.includes('phone'));

    const contacts = data.values.slice(1).map(row => ({
      name: nameIdx >= 0 ? (row[nameIdx] || '') : '',
      email: emailIdx >= 0 ? (row[emailIdx] || '') : '',
      company: companyIdx >= 0 ? (row[companyIdx] || '') : '',
      cc: ccIdx >= 0 ? (row[ccIdx] || '') : '',
      bcc: bccIdx >= 0 ? (row[bccIdx] || '') : '',
      phone: phoneIdx >= 0 ? (row[phoneIdx] || '') : ''
    })).filter(c => c.email);

    // Cache the result
    try {
      localStorage.setItem(CONTACT_CACHE_KEY, JSON.stringify({
        sheetId,
        contacts,
        timestamp: Date.now()
      }));
    } catch {
      // localStorage full or unavailable — not critical
    }

    return contacts;
  } catch (e) {
    console.error('Error fetching contact directory:', e);
    return [];
  }
}

// Format relative time
export function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL BODY CLEANING (Remove quoted text, signatures, HTML)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clean email body by removing ALL quoted/replied text, signatures,
 * styles, and HTML — returns plain text only.
 *
 * Threaded conversations are handled by fetching individual messages,
 * so quoted text is always redundant and should be stripped completely.
 *
 * @param {string} body - Raw email body (HTML or plain text)
 * @returns {string} - Cleaned plain text
 */
export function cleanEmailBody(body) {
  if (!body) return '';

  let clean = body;

  // ── 1. Remove script, style, link, and meta tags first ──
  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<link[^>]*>/gi, '');
  clean = clean.replace(/<meta[^>]*>/gi, '');

  // ── 2. Remove HTML comments ──
  clean = clean.replace(/<!--[\s\S]*?-->/g, '');

  // ── 3. Remove ALL quoted / replied text (comprehensive) ──

  // Gmail: <div class="gmail_quote ..."> ... </div>  (class may contain extra tokens)
  clean = clean.replace(/<div[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*$/gi, '');
  // Gmail: <blockquote class="gmail_quote ..."> ... </blockquote>
  clean = clean.replace(/<blockquote[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*$/gi, '');
  // Gmail extra wrapper
  clean = clean.replace(/<div[^>]*class=["'][^"']*gmail_extra[^"']*["'][^>]*>[\s\S]*$/gi, '');

  // Outlook: <div id="divRplyFwdMsg"> or class="OutlookMessageHeader"
  clean = clean.replace(/<div[^>]*id=["']divRplyFwdMsg["'][^>]*>[\s\S]*$/gi, '');
  clean = clean.replace(/<div[^>]*class=["'][^"']*OutlookMessageHeader[^"']*["'][^>]*>[\s\S]*$/gi, '');
  // Outlook: <div id="appendonsend"> ... </div> (Outlook on the web)
  clean = clean.replace(/<div[^>]*id=["']appendonsend["'][^>]*>[\s\S]*$/gi, '');
  // Outlook: <hr> followed by "From:" header block
  clean = clean.replace(/<hr[^>]*>\s*(<(p|div|span|b|font)[^>]*>\s*)*(From|De|Von|Da|Van)\s*:/gi, (match, ...args) => {
    // Wipe from this point to end
    return '';
  });
  // Remove everything after Outlook hr+From pattern
  clean = clean.replace(/<hr[^>]*>[\s\S]*$/gi, function (match) {
    // Only strip if it looks like a quoted header (contains From/Date/Subject)
    if (/from\s*:/i.test(match) && /subject\s*:/i.test(match)) return '';
    return match;
  });

  // Apple Mail: <blockquote type="cite"> ... </blockquote>
  clean = clean.replace(/<blockquote[^>]*type=["']cite["'][^>]*>[\s\S]*?<\/blockquote>/gi, '');

  // Yahoo Mail: <div class="yahoo_quoted"> ... </div>
  clean = clean.replace(/<div[^>]*class=["'][^"']*yahoo_quoted[^"']*["'][^>]*>[\s\S]*$/gi, '');

  // Thunderbird / generic: <blockquote ...> with cite attribute
  clean = clean.replace(/<blockquote[^>]*cite=["'][^"']*["'][^>]*>[\s\S]*?<\/blockquote>/gi, '');

  // Forwarded message markers (Gmail, Outlook, etc.)
  clean = clean.replace(/-{5,}\s*Forwarded message\s*-{5,}[\s\S]*$/gi, '');
  clean = clean.replace(/-{5,}\s*Original Message\s*-{5,}[\s\S]*$/gi, '');
  clean = clean.replace(/<(p|div|span)[^>]*>\s*-{3,}\s*(Forwarded|Original)\s+(message|Message)\s*-{3,}[\s\S]*$/gi, '');

  // Generic "On <date> <person> wrote:" pattern — strip from that line to end
  // Handles: "On Mon, Jan 1, 2026 at 10:00 AM John <john@x.com> wrote:"
  clean = clean.replace(/\n?\s*On\s+.{10,80}\s+wrote:\s*[\s\S]*$/gi, '');
  // HTML variant: <div>On ... wrote:</div>
  clean = clean.replace(/<(div|p|span)[^>]*>\s*On\s+.{10,80}\s+wrote:\s*<\/(div|p|span)>[\s\S]*$/gi, '');

  // Quoted lines: lines starting with > or &gt;
  clean = clean.replace(/^(&gt;|>)\s?.*$/gm, '');

  // ── 4. Remove email signatures ──

  // Gmail signature: <div class="gmail_signature ...">
  clean = clean.replace(/<div[^>]*class=["'][^"']*gmail_signature[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
  // Outlook signature: <div id="Signature"> or <div id="divtagdefaultwrapper">
  clean = clean.replace(/<div[^>]*id=["']Signature["'][^>]*>[\s\S]*?<\/div>/gi, '');
  clean = clean.replace(/<div[^>]*id=["']divtagdefaultwrapper["'][^>]*>[\s\S]*?<\/div>/gi, '');
  // Generic signature class
  clean = clean.replace(/<div[^>]*class=["'][^"']*signature[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

  // "Sent from" lines (mobile / Outlook)
  clean = clean.replace(/<(p|div|span)[^>]*>\s*Sent from.*?<\/(p|div|span)>/gi, '');
  clean = clean.replace(/Sent from (my )?(iPhone|iPad|Galaxy|Android|Samsung|Outlook|Mail|Proton Mail|Yahoo)[^\n]*/gi, '');
  // "Get Outlook for ..." lines
  clean = clean.replace(/<(p|div|span)[^>]*>\s*Get Outlook for.*?<\/(p|div|span)>/gi, '');
  clean = clean.replace(/Get Outlook for (iOS|Android|Mac|Windows)[^\n]*/gi, '');

  // Double-dash signature separator: "-- " followed by content
  // Only strip if it's near the end (within last 30% of remaining content)
  const dashSigMatch = clean.match(/\n--\s*\n/);
  if (dashSigMatch && dashSigMatch.index > clean.length * 0.5) {
    clean = clean.substring(0, dashSigMatch.index);
  }
  // HTML variant: "-- <br>" near end
  const dashSigHtmlMatch = clean.match(/--\s*<br[^>]*>/i);
  if (dashSigHtmlMatch && dashSigHtmlMatch.index > clean.length * 0.5) {
    clean = clean.substring(0, dashSigHtmlMatch.index);
  }

  // Legal disclaimers and fine print
  clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(This (email|message) (is|was) (intended|confidential|sent)[\s\S]{0,500}?)<\/(p|div|span|td)>/gi, '');
  clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(If you (are not|received this)[\s\S]{0,500}?)<\/(p|div|span|td)>/gi, '');
  clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(To unsubscribe|Unsubscribe|Click here)[\s\S]{0,300}?<\/(p|div|span|td)>/gi, '');
  clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(CONFIDENTIALITY|DISCLAIMER|LEGAL NOTICE)[\s\S]{0,500}?<\/(p|div|span|td)>/gi, '');

  // ── 5. Strip dangerous attributes ──
  clean = clean.replace(/\s+(on\w+|eval|alert|import|javascript|vbscript|expression)\s*=\s*["'][^"']*["']/gi, '');
  clean = clean.replace(/\s+(class|id|style|data-[^\s=]*|align|bgcolor|cellpadding|cellspacing|width|height|border|valign|face|size|color)\s*=\s*["'][^"']*["']/gi, '');

  // ── 6. Convert HTML to plain text ──

  // Line breaks
  clean = clean.replace(/<br\s*\/?>/gi, '\n');
  clean = clean.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
  clean = clean.replace(/<\/td>/gi, '\t');

  // Strip ALL remaining HTML tags
  clean = clean.replace(/<[^>]+>/g, '');

  // ── 7. Decode HTML entities ──
  clean = clean.replace(/&nbsp;/g, ' ');
  clean = clean.replace(/&lt;/g, '<');
  clean = clean.replace(/&gt;/g, '>');
  clean = clean.replace(/&amp;/g, '&');
  clean = clean.replace(/&quot;/g, '"');
  clean = clean.replace(/&#39;/g, "'");
  clean = clean.replace(/&rsquo;/g, "'");
  clean = clean.replace(/&lsquo;/g, "'");
  clean = clean.replace(/&rdquo;/g, '"');
  clean = clean.replace(/&ldquo;/g, '"');
  clean = clean.replace(/&mdash;/g, '—');
  clean = clean.replace(/&ndash;/g, '–');
  clean = clean.replace(/&hellip;/g, '…');

  // ── 8. Final whitespace cleanup ──
  clean = clean.replace(/\t+/g, '  ');
  clean = clean.replace(/ {3,}/g, '  ');
  clean = clean.replace(/\n{3,}/g, '\n\n');
  clean = clean.trim();

  return clean;
}

/**
 * Convert HTML email body to plain text
 * @param {string} html - HTML content
 * @returns {string} - Plain text
 */
export function htmlToPlainText(html) {
  if (!html) return '';
  
  let text = html;
  
  // Line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  
  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  text = textarea.value;
  
  // Clean up multiple newlines
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text.trim();
}
