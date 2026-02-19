import { useState, useEffect, useCallback, useRef, Component } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import {
  Mail, RefreshCw, AlertCircle, HelpCircle, Code,
  Briefcase, MessageSquare, Bell, FileText, ChevronDown, ChevronRight,
  ExternalLink, Inbox, Settings, User, Plus, Reply, ReplyAll,
  Tag, Archive, X, Send, Loader, Users,
  GripVertical, CheckCheck,
  Paperclip
} from 'lucide-react';
import {
  getGmailConnectionStatus,
  fetchEmails,
  fetchThread,
  analyzeEmailContent,
  groupEmailsByTag,
  getGmailMessageUrl,
  formatRelativeTime,
  getCachedEmails,
  cacheEmails,
  sendEmail,
  modifyMessage,
  EMAIL_TAGS,
  fetchContactDirectory,
  cleanEmailBody,
  htmlToPlainText
} from '../../services/emailService';
import { useSettings } from '../../contexts/SettingsContext';
import { estimateTaskTime, getTimeColor, formatFileSize } from '../../utils/todoHelpers';
import './EmailPanel.css';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const TAG_ICONS = {
  alert: AlertCircle,
  help: HelpCircle,
  code: Code,
  briefcase: Briefcase,
  message: MessageSquare,
  mail: Mail,
  bell: Bell,
  file: FileText
};

const READ_EMAILS_KEY = 'omnipotent_read_emails';
const KNOWN_EMAILS_KEY = 'omnipotent_known_emails';
const RELABELS_KEY = 'omnipotent_email_relabels';
const GROUP_ORDER_KEY = 'omnipotent_email_group_order';

function getReadEmails() {
  try { return JSON.parse(localStorage.getItem(READ_EMAILS_KEY) || '[]'); } catch { return []; }
}
function setReadEmails(ids) {
  localStorage.setItem(READ_EMAILS_KEY, JSON.stringify(ids));
}
function getKnownEmails() {
  try { return JSON.parse(localStorage.getItem(KNOWN_EMAILS_KEY) || '[]'); } catch { return []; }
}
function setKnownEmails(ids) {
  localStorage.setItem(KNOWN_EMAILS_KEY, JSON.stringify(ids));
}
function getGroupOrder() {
  try { return JSON.parse(localStorage.getItem(GROUP_ORDER_KEY) || '[]'); } catch { return []; }
}
function setGroupOrder(order) {
  localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(order));
}

function applyGroupOrder(groups) {
  const saved = getGroupOrder();
  if (saved.length === 0) return groups;
  const map = new Map(groups.map(g => [g.tag.id, g]));
  const ordered = [];
  for (const id of saved) {
    if (map.has(id)) {
      ordered.push(map.get(id));
      map.delete(id);
    }
  }
  // Append any new groups not in saved order
  for (const g of map.values()) {
    ordered.push(g);
  }
  return ordered;
}

// Create base64url-encoded RFC 2822 message
function createRawEmail(to, subject, body, inReplyTo = '', references = '', cc = '', from = '') {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `MIME-Version: 1.0`
  ];
  if (from) headers.unshift(`From: ${from}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  const raw = headers.join('\r\n') + '\r\n\r\n' + body;
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSE EMAIL COMPONENT (Centered Modal with Contact Picker)
// ═══════════════════════════════════════════════════════════════════════════════

function ComposeOverlay({ onClose, replyTo, replyAll, connectedEmail, contacts }) {
  const [to, setTo] = useState(replyTo ? replyTo.from.email : '');
  const [cc, setCc] = useState(replyAll && replyTo?.cc ? replyTo.cc : '');
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject.replace(/^Re:\s*/i, '')}` : '');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showContactDropdown, setShowContactDropdown] = useState(false);

  const filteredContacts = (contacts || []).filter(c => {
    if (!to) return true;
    const search = to.toLowerCase();
    return (
      (c.name && c.name.toLowerCase().includes(search)) ||
      (c.email && c.email.toLowerCase().includes(search))
    );
  });

  const handleSend = async () => {
    if (!to || !subject) return;
    setIsSending(true);
    setSendError('');
    try {
      const raw = createRawEmail(to, subject, body, replyTo?.id || '', replyTo?.id || '', cc, connectedEmail || '');
      await sendEmail(raw);
      onClose();
    } catch (e) {
      setSendError(e.message || 'Failed to send');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="compose-modal-overlay" onClick={onClose}>
      <div className="compose-modal" onClick={e => e.stopPropagation()}>
        <div className="compose-header">
          <h4>{replyTo ? (replyAll ? 'Reply All' : 'Reply') : 'New Message'}</h4>
          <button className="compose-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="compose-fields">
          <div className="compose-field">
            <label>To:</label>
            <div className="compose-to-wrapper">
              <input
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder="recipient@email.com"
                onFocus={() => { if (contacts && contacts.length > 0) setShowContactDropdown(true); }}
              />
              {contacts && contacts.length > 0 && (
                <button
                  className="compose-contacts-btn"
                  onClick={() => setShowContactDropdown(!showContactDropdown)}
                  title="Browse contacts"
                  type="button"
                >
                  <Users size={14} />
                </button>
              )}
            </div>
            {showContactDropdown && filteredContacts.length > 0 && (
              <div className="compose-contact-dropdown">
                {filteredContacts.slice(0, 10).map((c, idx) => (
                  <button
                    key={idx}
                    className="compose-contact-option"
                    onClick={() => {
                      setTo(c.email);
                      setShowContactDropdown(false);
                    }}
                    type="button"
                  >
                    <User size={12} />
                    <span className="compose-contact-name">{c.name || c.email}</span>
                    <span className="compose-contact-email">{c.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="compose-field">
            <label>CC:</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="cc@email.com" />
          </div>
          <div className="compose-field">
            <label>Subject:</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
          </div>
          <textarea
            className="compose-body"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={8}
          />
        </div>
        {sendError && (
          <div className="compose-error">
            <AlertCircle size={12} />
            <span>{sendError}</span>
          </div>
        )}
        <div className="compose-actions">
          <button className="compose-send-btn" onClick={handleSend} disabled={isSending || !to || !subject}>
            {isSending ? <Loader size={14} className="spinning" /> : <Send size={14} />}
            {isSending ? 'Sending...' : 'Send'}
          </button>
          <button className="compose-cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// THREAD VIEW COMPONENT (sorted newest-to-oldest)
// ═══════════════════════════════════════════════════════════════════════════════

function ThreadView({ messages }) {
  const [expandedMsg, setExpandedMsg] = useState(null);

  const sorted = [...messages].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="thread-messages">
      <div className="thread-header">
        <MessageSquare size={12} />
        <span>{messages.length} messages in thread</span>
      </div>
      {sorted.map((msg, idx) => (
        <div key={msg.id} className={`thread-message-item ${expandedMsg === idx ? 'expanded' : ''}`}>
          <div className="thread-message-header" onClick={() => setExpandedMsg(expandedMsg === idx ? null : idx)}>
            <span className="thread-msg-from">{msg.from?.name || msg.from}</span>
            <span className="thread-msg-date">{formatRelativeTime(msg.date)}</span>
            <ChevronDown size={12} className={`thread-chevron ${expandedMsg === idx ? 'open' : ''}`} />
          </div>
          {expandedMsg === idx && (
            <div className="thread-message-body" style={{ whiteSpace: 'pre-wrap' }}>
              {cleanEmailBody(msg.preview || msg.snippet || '')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL ACCORDION COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function EmailAccordion({ email, isExpanded, onToggle, onMarkRead, onArchive, onReply, onReplyAll, onRelabel, connectedEmail, threadMessages, readEmailIds = [] }) {
  const tag = email.tag || EMAIL_TAGS.GENERAL;
  const TagIcon = TAG_ICONS[tag.icon] || Mail;
  const [showRelabel, setShowRelabel] = useState(false);
  const isRead = readEmailIds.includes(email.id);

  const handleOpenInGmail = (e) => {
    e.stopPropagation();
    window.open(getGmailMessageUrl(email.id, connectedEmail), '_blank');
  };

  const handleToggle = () => {
    onToggle();
    if (!isExpanded) {
      onMarkRead(email.id);
    }
  };

  return (
    <div className={`email-accordion ${isExpanded ? 'expanded' : ''} ${email.isUnread && !isRead ? 'unread' : ''}`}>
      <div className="email-accordion-header" onClick={handleToggle}>
        <div className="email-accordion-left">
          <button className="email-expand-btn">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <div className="email-sender-avatar">
            {email.from.name.charAt(0).toUpperCase()}
          </div>
          <div className="email-header-info">
            <div className="email-sender-row">
              <span className="email-sender-name">{email.from.name}</span>
              <span className="email-date">{formatRelativeTime(email.date)}</span>
            </div>
            <div className="email-subject">{email.subject}</div>
          </div>
        </div>
        <div className="email-header-right-meta">
          {email.attachments && email.attachments.length > 0 && (
            <span className="email-attachment-indicator">
              <Paperclip size={10} />
              {email.attachments.length}
            </span>
          )}
          {threadMessages && threadMessages.length > 1 && (
            <span className="email-thread-count">
              <MessageSquare size={10} />
              {threadMessages.length}
            </span>
          )}
          <div className="email-tag-pill" style={{ backgroundColor: tag.color }}>
            <TagIcon size={12} />
            <span>{tag.label}</span>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="email-accordion-body">
          {/* Action Bar */}
          <div className="email-actions-bar">
            <button className="email-action-btn" onClick={() => onReply(email)} title="Reply">
              <Reply size={14} />
            </button>
            <button className="email-action-btn" onClick={() => onReplyAll(email)} title="Reply All">
              <ReplyAll size={14} />
            </button>
            <button className="email-action-btn" onClick={() => setShowRelabel(!showRelabel)} title="Relabel">
              <Tag size={14} />
            </button>
            <button className="email-action-btn" onClick={() => onArchive(email)} title="Archive">
              <Archive size={14} />
            </button>
            <button className="email-action-btn" onClick={handleOpenInGmail} title="Open in Gmail">
              <ExternalLink size={14} />
            </button>
          </div>

          {/* Relabel Dropdown */}
          {showRelabel && (
            <div className="relabel-dropdown">
              {Object.values(EMAIL_TAGS).map(t => (
                <button
                  key={t.id}
                  className={`relabel-option ${tag.id === t.id ? 'active' : ''}`}
                  onClick={() => {
                    onRelabel(email.id, t.id);
                    setShowRelabel(false);
                  }}
                >
                  <span className="relabel-dot" style={{ backgroundColor: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div className="email-details">
            <div className="email-detail-row">
              <span className="email-detail-label">From:</span>
              <span className="email-detail-value">{email.from.name}</span>
            </div>
            <div className="email-detail-row">
              <span className="email-detail-label">Email:</span>
              <span className="email-detail-value email-address">{email.from.email}</span>
            </div>
            <div className="email-detail-row">
              <span className="email-detail-label">Subject:</span>
              <span className="email-detail-value">{email.subject}</span>
            </div>
            <div className="email-detail-row">
              <span className="email-detail-label">Date:</span>
              <span className="email-detail-value">
                {email.date.toLocaleDateString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                })} at {email.date.toLocaleTimeString('en-US', {
                  hour: '2-digit', minute: '2-digit'
                })}
              </span>
            </div>
          </div>

          <div className="email-preview-text" style={{ whiteSpace: 'pre-wrap' }}>
            {cleanEmailBody(email.preview || '')}
          </div>

          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="email-detail-attachments">
              <div className="email-attachments-header">
                <Paperclip size={12} />
                <span>{email.attachments.length} Attachment{email.attachments.length > 1 ? 's' : ''}</span>
              </div>
              <div className="email-attachments-list">
                {email.attachments.map((att, idx) => (
                  <div key={idx} className="email-attachment-item">
                    <FileText size={12} />
                    <span className="email-attachment-name">{att.filename}</span>
                    <span className="email-attachment-size">{formatFileSize(att.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Thread Messages */}
          {threadMessages && threadMessages.length > 1 && (
            <ThreadView messages={threadMessages} />
          )}

          <button className="email-open-btn" onClick={handleOpenInGmail}>
            <ExternalLink size={14} />
            Open in Gmail
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL GROUP COMPONENT (with new-message badges)
// ═══════════════════════════════════════════════════════════════════════════════

function EmailGroup({ group, isCollapsed, onToggleGroup, expandedEmails, onToggleEmail, onMarkRead, onArchive, onReply, onReplyAll, onRelabel, connectedEmail, threadCache, readEmailIds }) {
  const dragControls = useDragControls();
  const TagIcon = TAG_ICONS[group.tag.icon] || Mail;

  const newCount = group.emails.filter(e => !readEmailIds.includes(e.id)).length;

  return (
    <Reorder.Item
      value={group}
      dragListener={false}
      dragControls={dragControls}
      className="email-group"
      whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 10 }}
      transition={{ duration: 0.15 }}
    >
      <div
        className="email-group-header"
        onClick={onToggleGroup}
        style={{ borderLeftColor: group.tag.color }}
      >
        <div
          className="email-group-drag-handle"
          onPointerDown={(e) => { e.stopPropagation(); dragControls.start(e); }}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </div>
        <div className="email-group-left">
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <TagIcon size={16} style={{ color: group.tag.color }} />
          <span className="email-group-label">{group.tag.label}</span>
          {newCount > 0 && <span className="email-group-new-badge">{newCount} new</span>}
        </div>
        <span className="email-group-count">{group.emails.length}</span>
      </div>

      {!isCollapsed && (
        <div className="email-group-content">
          {group.emails.map(email => (
            <EmailAccordion
              key={email.id}
              email={email}
              isExpanded={expandedEmails.has(email.id)}
              onToggle={() => onToggleEmail(email.id)}
              onMarkRead={onMarkRead}
              onArchive={onArchive}
              onReply={onReply}
              onReplyAll={onReplyAll}
              onRelabel={onRelabel}
              connectedEmail={connectedEmail}
              threadMessages={threadCache[email.threadId]}
              readEmailIds={readEmailIds}
            />
          ))}
        </div>
      )}
    </Reorder.Item>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EMAIL PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function EmailPanel({ onBadgeCount, onTodoData }) {
  const { settings } = useSettings();
  const [connection, setConnection] = useState(null);
  const [emails, setEmails] = useState([]);
  const [groupedEmails, setGroupedEmails] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedEmails, setExpandedEmails] = useState(new Set());
  const [lastRefresh, setLastRefresh] = useState(null);
  const [composeState, setComposeState] = useState(null);
  const [threadCache, setThreadCache] = useState({});
  const [contacts, setContacts] = useState([]);
  const [showContacts, setShowContacts] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState(null);
  const refreshIntervalRef = useRef(null);
  const isRefreshingRef = useRef(false);
  const [readEmailIdsState, setReadEmailIdsState] = useState(() => getReadEmails());

  // Check for Gmail connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const status = await getGmailConnectionStatus();
        setConnection(status);
      } catch {
        setConnection({ connected: false, email: null });
      }
    };
    checkConnection();

    // Load cached emails
    const cached = getCachedEmails();
    if (cached.length > 0) {
      const analyzed = cached.map(email => ({
        ...email,
        tag: analyzeEmailContent(email)
      }));
      setEmails(analyzed);
      setGroupedEmails(applyGroupOrder(groupEmailsByTag(analyzed)));
    }
  }, []);

  // Load contacts on mount if contactSheetId is available
  useEffect(() => {
    const loadContacts = async () => {
      if (settings.contactSheetId) {
        try {
          const contactList = await fetchContactDirectory(settings.contactSheetId);
          setContacts(contactList || []);
        } catch (err) {
          console.error('Error loading contacts:', err);
        }
      }
    };
    loadContacts();
  }, [settings.contactSheetId]);

  // Deduplicate emails by threadId (keep latest per thread)
  const deduplicateByThread = useCallback((emailList) => {
    const threadMap = new Map();
    for (const email of emailList) {
      const existing = threadMap.get(email.threadId);
      if (!existing || new Date(email.date) > new Date(existing.date)) {
        threadMap.set(email.threadId, email);
      }
    }
    return Array.from(threadMap.values());
  }, []);

  // Fetch emails from Gmail (guarded against concurrent calls)
  const refreshEmails = useCallback(async () => {
    if (!connection?.connected) return;
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;

    setIsLoading(true);
    setError(null);

    try {
      const fetchedEmails = await fetchEmails(30);
      const deduped = deduplicateByThread(fetchedEmails);

      const analyzedEmails = deduped.map(email => ({
        ...email,
        tag: analyzeEmailContent(email)
      }));

      setEmails(analyzedEmails);
      setGroupedEmails(applyGroupOrder(groupEmailsByTag(analyzedEmails)));
      cacheEmails(analyzedEmails);
      setLastRefresh(new Date());

      // Update known emails for badge tracking
      const currentIds = analyzedEmails.map(e => e.id);
      const knownIds = getKnownEmails();
      const readIds = getReadEmails();

      const unreadBadge = currentIds.filter(id => !readIds.includes(id) && !knownIds.includes(id));

      // Update known set
      setKnownEmails(currentIds);

      // Report badge count
      if (onBadgeCount) {
        onBadgeCount(unreadBadge.length);
      }
    } catch (e) {
      console.error('Error fetching emails:', e);
      setError('Failed to fetch emails. Please try again.');
    } finally {
      setIsLoading(false);
      isRefreshingRef.current = false;
    }
  }, [connection, deduplicateByThread, onBadgeCount]);

  // Fetch emails when connection is available
  useEffect(() => {
    if (connection?.connected) {
      refreshEmails();
    }
  }, [connection, refreshEmails]);

  // Auto-refresh interval
  useEffect(() => {
    if (!connection?.connected) return;

    const intervalMs = (settings.emailRefreshInterval || 5) * 60000;
    refreshIntervalRef.current = setInterval(() => {
      refreshEmails();
    }, intervalMs);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [connection, settings.emailRefreshInterval, refreshEmails]);

  // Toggle email expansion + load thread
  const toggleEmailExpanded = useCallback(async (emailId) => {
    setExpandedEmails(prev => {
      const newSet = new Set(prev);
      if (newSet.has(emailId)) {
        newSet.delete(emailId);
      } else {
        newSet.add(emailId);
      }
      return newSet;
    });

    // Load thread if not cached
    const email = emails.find(e => e.id === emailId);
    if (email && email.threadId && !threadCache[email.threadId]) {
      try {
        const thread = await fetchThread(email.threadId);
        if (thread.messages && thread.messages.length > 1) {
          setThreadCache(prev => ({ ...prev, [email.threadId]: thread.messages }));
        }
      } catch (e) {
        console.error('Error loading thread:', e);
      }
    }
  }, [emails, threadCache]);

  // Mark email as read (for badge + UI)
  const handleMarkRead = useCallback((emailId) => {
    const readIds = getReadEmails();
    if (!readIds.includes(emailId)) {
      const updated = [...readIds, emailId];
      setReadEmails(updated);
      setReadEmailIdsState(updated);

      // Recalculate badge
      const knownIds = getKnownEmails();
      const currentIds = emails.map(e => e.id);
      const unread = currentIds.filter(id => !updated.includes(id) && !knownIds.includes(id));
      if (onBadgeCount) onBadgeCount(unread.length);
    }
  }, [emails, onBadgeCount]);

  // Mark ALL emails as read — marks every email ID as read and clears badge to 0
  const handleMarkAllRead = useCallback(() => {
    const currentIds = emails.map(e => e.id);
    if (currentIds.length === 0) return;

    const readIds = getReadEmails();
    // Merge all current IDs into read list (deduplicated)
    const merged = [...new Set([...readIds, ...currentIds])];
    setReadEmails(merged);
    setReadEmailIdsState(merged);

    // Also add them to known emails so they lose the "new" badge
    const knownIds = getKnownEmails();
    const mergedKnown = [...new Set([...knownIds, ...currentIds])];
    setKnownEmails(mergedKnown);

    // Badge count is now 0
    if (onBadgeCount) onBadgeCount(0);
  }, [emails, onBadgeCount]);

  // Archive email (remove INBOX label)
  const handleArchive = useCallback(async (email) => {
    try {
      await modifyMessage(email.id, [], ['INBOX']);
      setEmails(prev => {
        const updated = prev.filter(e => e.id !== email.id);
        setGroupedEmails(applyGroupOrder(groupEmailsByTag(updated)));
        return updated;
      });
    } catch (e) {
      console.error('Error archiving email:', e);
      setError('Failed to archive email');
    }
  }, []);

  // Relabel email (local only)
  const handleRelabel = useCallback((emailId, newTagId) => {
    const relabels = JSON.parse(localStorage.getItem(RELABELS_KEY) || '{}');
    relabels[emailId] = newTagId;
    localStorage.setItem(RELABELS_KEY, JSON.stringify(relabels));

    setEmails(prev => {
      const updated = prev.map(e => ({
        ...e,
        tag: e.id === emailId ? (Object.values(EMAIL_TAGS).find(t => t.id === newTagId) || e.tag) : e.tag
      }));
      setGroupedEmails(applyGroupOrder(groupEmailsByTag(updated)));
      return updated;
    });
  }, []);

  const handleReply = useCallback((email) => {
    setComposeState({ replyTo: email, replyAll: false });
  }, []);

  const handleReplyAll = useCallback((email) => {
    setComposeState({ replyTo: email, replyAll: true });
  }, []);

  // Get requests/changes emails for TODO list
  const requestsEmails = emails.filter(e => e.tag?.id === 'requests_changes');

  // Pass todo data up to parent for TodoPanel
  useEffect(() => {
    if (onTodoData) {
      onTodoData({
        todoEmails: requestsEmails,
        threadCache,
        connectedEmail: connection?.email || null
      });
    }
  }, [requestsEmails.length, threadCache, connection?.email, onTodoData]);

  // Read email IDs for badge tracking (use reactive state)
  const readEmailIds = readEmailIdsState;

  // ─── Not Connected State ───
  if (!connection || !connection.connected) {
    return (
      <div className="email-panel">
        <div className="email-not-connected">
          <Mail size={48} />
          <h3>Connect Gmail</h3>
          <p>Connect your Gmail account in Settings to view your emails here.</p>
          <div className="email-connect-hint">
            <Settings size={14} />
            <span>Go to Settings → Integrations → Gmail</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="email-panel">
      {/* Compose Modal */}
      {composeState && (
        <ComposeOverlay
          onClose={() => setComposeState(null)}
          replyTo={composeState.replyTo}
          replyAll={composeState.replyAll}
          connectedEmail={connection?.email}
          contacts={contacts}
        />
      )}

      {/* Header */}
      <div className="email-panel-header">
        <div className="email-header-left">
          <Inbox size={18} />
          <h3>Inbox</h3>
          {emails.length > 0 && (
            <span className="email-total-count">{emails.length}</span>
          )}
          {emails.length > 0 && emails.some(e => !readEmailIds.includes(e.id)) && (
            <button
              className="mark-all-read-btn"
              onClick={handleMarkAllRead}
              title="Mark all as read"
            >
              <CheckCheck size={14} />
              <span>Mark all read</span>
            </button>
          )}
        </div>
        <div className="email-header-right">
          <button
            className="email-action-btn compose-btn"
            onClick={() => setComposeState({})}
            title="New Message"
          >
            <Plus size={16} />
          </button>
          {lastRefresh && (
            <span className="email-last-refresh">
              {formatRelativeTime(lastRefresh)}
            </span>
          )}
          <button
            className="email-refresh-btn"
            onClick={refreshEmails}
            disabled={isLoading}
            title="Refresh emails"
          >
            <RefreshCw size={16} className={isLoading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* Connected user info */}
      {connection?.email && (
        <div className="email-user-info">
          <User size={14} />
          <span>{connection.email}</span>
        </div>
      )}

      {/* Contacts section (collapsible) */}
      {contacts.length > 0 && (
        <div className="email-contacts-section">
          <div className="email-contacts-header" onClick={() => setShowContacts(!showContacts)}>
            {showContacts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Users size={14} />
            <span>Contacts ({contacts.length})</span>
          </div>
          {showContacts && (
            <div className="email-contacts-list">
              {contacts.map((c, idx) => (
                <div key={idx} className="email-contact-item">
                  <User size={12} />
                  <span className="email-contact-name">{c.name || 'No Name'}</span>
                  <span className="email-contact-email">{c.email}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="email-error">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button className="email-error-dismiss" onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && emails.length === 0 && (
        <div className="email-loading">
          <RefreshCw size={24} className="spinning" />
          <span>Loading emails...</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && emails.length === 0 && !error && (
        <div className="email-empty">
          <Inbox size={32} />
          <p>No emails found</p>
        </div>
      )}

      {/* Email groups */}
      {groupedEmails.length > 0 && (
        <Reorder.Group
          axis="y"
          values={groupedEmails}
          onReorder={(newOrder) => {
            setGroupedEmails(newOrder);
            setGroupOrder(newOrder.map(g => g.tag.id));
          }}
          className="email-groups"
          as="div"
        >
          {groupedEmails.map(group => (
            <EmailGroup
              key={group.tag.id}
              group={group}
              isCollapsed={expandedGroupId !== group.tag.id}
              onToggleGroup={() => setExpandedGroupId(expandedGroupId === group.tag.id ? null : group.tag.id)}
              expandedEmails={expandedEmails}
              onToggleEmail={toggleEmailExpanded}
              onMarkRead={handleMarkRead}
              onArchive={handleArchive}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onRelabel={handleRelabel}
              connectedEmail={connection?.email}
              threadCache={threadCache}
              readEmailIds={readEmailIds}
            />
          ))}
        </Reorder.Group>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY — prevents email rendering errors from crashing the whole app
// ═══════════════════════════════════════════════════════════════════════════════

class EmailPanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('EmailPanel error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="email-panel">
          <div className="email-error" style={{ margin: '24px 16px', flexDirection: 'column', gap: '12px', alignItems: 'center', textAlign: 'center' }}>
            <AlertCircle size={32} />
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>Something went wrong</h4>
              <p style={{ margin: 0, fontSize: '12px', opacity: 0.7 }}>
                {this.state.error?.message || 'An error occurred loading emails.'}
              </p>
            </div>
            <button
              className="email-refresh-btn"
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{ marginTop: '8px', padding: '6px 16px', cursor: 'pointer' }}
            >
              <RefreshCw size={14} />
              <span style={{ marginLeft: '6px' }}>Try Again</span>
            </button>
          </div>
        </div>
      );
    }

    return <EmailPanel {...this.props} />;
  }
}

export default EmailPanelErrorBoundary;
