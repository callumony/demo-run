import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Megaphone, RefreshCw, AtSign, ExternalLink, Briefcase, Clock,
  X, CheckCircle, AlertCircle, User, ChevronDown, Filter, CheckCheck
} from 'lucide-react';
import {
  getHiveConnection,
  fetchWorkspaces,
  fetchWorkspaceMembers,
  fetchMentions,
  formatRelativeTime
} from '../../services/hiveService';
import './NotificationsPanel.css';

const READ_MENTIONS_KEY = 'omnipotent_read_mentions';

// Get set of read mention IDs from localStorage
function getReadMentionIds() {
  try {
    const stored = localStorage.getItem(READ_MENTIONS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return new Set(Array.isArray(parsed) ? parsed : []);
    }
  } catch { /* ignore */ }
  return new Set();
}

// Save read mention IDs to localStorage
function saveReadMentionIds(ids) {
  try {
    localStorage.setItem(READ_MENTIONS_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

// Single mention item in the list
function NotificationItem({ mention, onSelect }) {
  const content = mention.body || mention.content || mention.message || mention.text || '';
  const actionTitle = mention.action?.title || mention.action?.name || mention.actionTitle || 'Unknown Action';
  const createdAt = mention.created_at || mention.createdAt || mention.timestamp;
  const sender = mention.sender || mention.from || mention.user || mention.created_by;
  const senderName = typeof sender === 'string' ? sender : (sender?.name || sender?.full_name || sender?.username || 'Someone');

  // Strip HTML from content
  const cleanContent = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

  return (
    <div className="notif-item" onClick={() => onSelect(mention)}>
      <div className="notif-avatar">
        <AtSign size={14} />
      </div>
      <div className="notif-item-content">
        <div className="notif-header">
          <span className="notif-sender">{senderName}</span>
          <span className="notif-time">{formatRelativeTime(createdAt)}</span>
        </div>
        <div className="notif-body">
          {cleanContent.length > 120 ? cleanContent.substring(0, 120) + '...' : cleanContent}
        </div>
        <div className="notif-action-ref">
          <Briefcase size={11} />
          <span>{actionTitle}</span>
        </div>
      </div>
    </div>
  );
}

// Detail modal for a mention
function NotificationModal({ mention, workspaceId, onClose }) {
  const content = mention.body || mention.content || mention.message || mention.text || '';
  const actionTitle = mention.action?.title || mention.action?.name || mention.actionTitle || 'Unknown Action';
  const actionId = mention.action?.id || mention.actionId || mention.action_id;
  const createdAt = mention.created_at || mention.createdAt || mention.timestamp;
  const sender = mention.sender || mention.from || mention.user || mention.created_by;
  const senderName = typeof sender === 'string' ? sender : (sender?.name || sender?.full_name || sender?.username || 'Unknown');

  const cleanContent = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

  return (
    <div className="notif-modal-overlay" onClick={onClose}>
      <div className="notif-modal" onClick={(e) => e.stopPropagation()}>
        <div className="notif-modal-header">
          <div className="notif-modal-title">
            <AtSign size={18} />
            <h3>Mention</h3>
          </div>
          <button className="notif-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="notif-modal-content">
          <div className="notif-modal-sender-row">
            <div className="notif-modal-sender-avatar">
              {senderName.charAt(0).toUpperCase()}
            </div>
            <div className="notif-modal-sender-info">
              <span className="notif-modal-sender-name">{senderName}</span>
              <span className="notif-modal-sender-time">
                <Clock size={11} />
                {formatRelativeTime(createdAt)}
              </span>
            </div>
          </div>

          <div className="notif-modal-body">
            <p>{cleanContent}</p>
          </div>

          {actionId && (
            <div className="notif-modal-action-section">
              <label>
                <Briefcase size={13} />
                Related Action
              </label>
              <div className="notif-modal-action-card">
                <span className="notif-modal-action-title">{actionTitle}</span>
                <a
                  href={`https://app.hive.com/workspace/${workspaceId}/action/${actionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="notif-go-to-action-btn"
                >
                  <ExternalLink size={13} />
                  View in Hive
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main Notifications Panel
export default function NotificationsPanel() {
  const [connection, setConnection] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [mentions, setMentions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedMention, setSelectedMention] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [readIds, setReadIds] = useState(() => getReadMentionIds());
  const refreshTimerRef = useRef(null);

  // Check connection on mount
  useEffect(() => {
    const conn = getHiveConnection();
    setConnection(conn);
  }, []);

  // Load workspaces
  useEffect(() => {
    if (!connection?.apiKey) return;
    (async () => {
      try {
        const ws = await fetchWorkspaces(connection.apiKey, connection.userId);
        setWorkspaces(ws);
        if (ws.length > 0) {
          setSelectedWorkspace(ws[0].id);
        }
      } catch (e) {
        console.error('NotificationsPanel: Error loading workspaces:', e);
      }
    })();
  }, [connection]);

  // Load mentions when workspace is selected
  const loadMentions = useCallback(async () => {
    if (!connection?.apiKey || !connection?.userId || !selectedWorkspace) return;

    setIsLoading(true);
    setError(null);

    try {
      // Get members to find current user's name
      const membersData = await fetchWorkspaceMembers(connection.apiKey, connection.userId, selectedWorkspace);
      setMembers(membersData);

      // Try multiple ID field variations (Hive API returns different shapes)
      const uid = connection.userId;
      let me = null;

      // Strategy 1: Match by user ID fields
      me = membersData.find(m =>
        (m.id && m.id === uid) ||
        (m._id && m._id === uid) ||
        (m.userId && m.userId === uid) ||
        (m.user_id && m.user_id === uid)
      );

      // Strategy 2: If userId looks like an email, match by email
      if (!me && uid.includes('@')) {
        me = membersData.find(m =>
          (m.email && m.email.toLowerCase() === uid.toLowerCase()) ||
          (m.emails && m.emails.some(e => e.toLowerCase() === uid.toLowerCase()))
        );
      }

      // Strategy 3: If only one member, use them
      if (!me && membersData.length === 1) {
        me = membersData[0];
      }

      // Strategy 4: Partial ID match
      if (!me && membersData.length > 0) {
        me = membersData.find(m => {
          const mId = (m.id || m._id || '').toString();
          return mId && (uid.includes(mId) || mId.includes(uid));
        });
      }

      setCurrentUser(me);

      // Resolve the user's display name from multiple sources
      let userName = me?.name || me?.full_name || me?.fullName || me?.username || me?.display_name || null;

      if (!userName && connection.userName) {
        userName = connection.userName;
      }

      // Check settings for stored name
      if (!userName) {
        try {
          const settingsStr = localStorage.getItem('callumony_settings');
          if (settingsStr) {
            const s = JSON.parse(settingsStr);
            if (s.hiveUserName) userName = s.hiveUserName;
          }
        } catch { /* ignore */ }
      }

      // Use email as fallback
      if (!userName && me?.email) {
        userName = me.email.split('@')[0];
      }

      // Set resolved user for display
      if (!me && userName) {
        setCurrentUser({ name: userName, id: uid });
      }

      if (!userName) {
        if (membersData.length > 0) {
          console.log('[Notif] Members available but no name match for userId:', uid);
        }
        setError(`Could not determine your name for mention matching. Please reconnect Hive in Settings.`);
        setMentions([]);
        setIsLoading(false);
        return;
      }

      console.log(`[Notif] Searching for @mentions for: "${userName}" (userId: ${uid})`);

      const mentionsData = await fetchMentions(
        connection.apiKey,
        connection.userId,
        selectedWorkspace,
        userName
      );

      // Filter out mentions that have been locally marked as read
      const currentReadIds = getReadMentionIds();
      const unreadMentions = mentionsData.filter(m => {
        const mentionId = m.id || m._id;
        // Skip if already marked read locally OR flagged read from API
        if (m.read || m.is_read) return false;
        if (mentionId && currentReadIds.has(mentionId)) return false;
        return true;
      });

      console.log(`[Notif] Total mentions: ${mentionsData.length}, Unread: ${unreadMentions.length}`);
      setMentions(unreadMentions);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('NotificationsPanel: Error loading mentions:', e);
      setError('Failed to load mentions. ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }, [connection, selectedWorkspace]);

  useEffect(() => {
    loadMentions();
  }, [loadMentions]);

  // Mark all mentions as read
  const handleMarkAllRead = useCallback(() => {
    const newReadIds = new Set(readIds);
    for (const mention of mentions) {
      const id = mention.id || mention._id;
      if (id) newReadIds.add(id);
    }
    setReadIds(newReadIds);
    saveReadMentionIds(newReadIds);
    setMentions([]);
  }, [mentions, readIds]);

  // Not connected state
  if (!connection) {
    return (
      <div className="notif-panel">
        <div className="notif-panel-header">
          <div className="notif-header-left">
            <Megaphone size={18} />
            <h3>Notifications</h3>
          </div>
        </div>
        <div className="notif-not-connected">
          <AtSign size={40} />
          <h3>Connect to Hive</h3>
          <p>Open the HIVE tab and connect your account to see @mentions here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="notif-panel">
      {/* Header */}
      <div className="notif-panel-header">
        <div className="notif-header-left">
          <Megaphone size={18} />
          <h3>My Mentions</h3>
          {mentions.length > 0 && (
            <span className="notif-count-badge">{mentions.length}</span>
          )}
        </div>
        <div className="notif-header-right">
          {mentions.length > 0 && (
            <button
              className="notif-mark-all-btn"
              onClick={handleMarkAllRead}
              title="Mark all as read"
            >
              <CheckCheck size={14} />
            </button>
          )}
          {lastRefresh && (
            <span className="notif-last-refresh">
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            className="notif-refresh-btn"
            onClick={loadMentions}
            disabled={isLoading}
            title="Refresh mentions"
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* User info */}
      {currentUser && (
        <div className="notif-user-bar">
          <User size={12} />
          <span>Showing @mentions for <strong>{currentUser.name || currentUser.full_name || currentUser.fullName || currentUser.username || currentUser.display_name || currentUser.email || 'you'}</strong></span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="notif-error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Mention Modal */}
      {selectedMention && (
        <NotificationModal
          mention={selectedMention}
          workspaceId={selectedWorkspace}
          onClose={() => setSelectedMention(null)}
        />
      )}

      {/* Content */}
      <div className="notif-content">
        {isLoading && mentions.length === 0 ? (
          <div className="notif-loading">
            <RefreshCw size={24} className="spinning" />
            <span>Scanning comments for @mentions...</span>
            <span className="notif-loading-hint">This may take a moment</span>
          </div>
        ) : mentions.length === 0 && !error ? (
          <div className="notif-empty">
            <CheckCircle size={32} />
            <p>No unread @mentions</p>
            <span className="notif-empty-hint">
              You'll see notifications here when someone @mentions you in a comment
            </span>
          </div>
        ) : (
          <div className="notif-list">
            {mentions.map((mention, index) => (
              <NotificationItem
                key={mention.id || index}
                mention={mention}
                onSelect={setSelectedMention}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
