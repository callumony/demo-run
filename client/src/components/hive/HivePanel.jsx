import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Hexagon, RefreshCw, AlertCircle, CheckCircle, Settings, User,
  ChevronDown, ChevronRight, ExternalLink, Clock, Flag, Folder,
  Plus, MessageSquare, Calendar, Users, Briefcase, Circle, X,
  Send, ArrowLeft, Tag, Link2, Edit3, Save, Loader, ListTree, Bell,
  Check, Timer
} from 'lucide-react';
import {
  getHiveConnection,
  fetchWorkspaces,
  fetchProjects,
  fetchMyTasks,
  fetchProjectActions,
  fetchActionDetails,
  fetchActionComments,
  fetchChats,
  fetchChatMessages,
  sendChatMessage,
  createChat,
  fetchWorkspaceMembers,
  fetchMentions,
  updateAction,
  fetchLabels,
  fetchSubActions,
  postActionComment,
  getCachedHiveData,
  cacheHiveData,
  formatRelativeTime,
  getStatusColor,
  getPriorityColor
} from '../../services/hiveService';
import './HivePanel.css';

// Strip HTML/CSS from text and extract links
function sanitizeAndExtractLinks(html) {
  if (!html) return { html: '', links: [] };

  // Extract href links before sanitizing
  const linkRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    if (match[1] && !match[1].startsWith('mailto:')) {
      links.push({ url: match[1], text: match[2] || match[1] });
    }
  }
  // Also find plain URLs in text
  const plainUrlRegex = /https?:\/\/[^\s<>"']+/g;
  const strippedForUrls = html.replace(/<[^>]*>/g, ' ');
  let urlMatch;
  while ((urlMatch = plainUrlRegex.exec(strippedForUrls)) !== null) {
    if (!links.some(l => l.url === urlMatch[0])) {
      links.push({ url: urlMatch[0], text: urlMatch[0] });
    }
  }

  let clean = html;

  // ── Strip dangerous code: JavaScript, PHP, SQL ──
  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<\?php[\s\S]*?\?>/gi, '');
  clean = clean.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  clean = clean.replace(/javascript\s*:/gi, '');
  // Strip SQL injection patterns
  clean = clean.replace(/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|UNION|TRUNCATE)\b\s+(INTO|FROM|TABLE|DATABASE|ALL|SET)\b[\s\S]*?[;])/gi, '');

  // ── Strip style/link tags and their content ──
  clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<link[^>]*>/gi, '');

  // ── Strip HTML comments ──
  clean = clean.replace(/<!--[\s\S]*?-->/g, '');

  // ── Strip class, id, style, data-* attributes (keep basic tags clean) ──
  clean = clean.replace(/\s+(class|id|style|data-[\w-]+|align|bgcolor|cellpadding|cellspacing|width|height|border|valign|face|size|color)\s*=\s*["'][^"']*["']/gi, '');

  // ── Strip email signatures / fine print ──
  // Common signature delimiters
  clean = clean.replace(/--\s*<br[^>]*>[\s\S]*$/gi, '');
  clean = clean.replace(/<div[^>]*class=["'].*?signature.*?["'][^>]*>[\s\S]*?<\/div>/gi, '');
  clean = clean.replace(/<div[^>]*id=["'].*?signature.*?["'][^>]*>[\s\S]*?<\/div>/gi, '');
  // Gmail signature marker
  clean = clean.replace(/<div[^>]*class=["']gmail_signature["'][^>]*>[\s\S]*?<\/div>/gi, '');
  // Outlook signature markers
  clean = clean.replace(/<div[^>]*id=["']Signature["'][^>]*>[\s\S]*?<\/div>/gi, '');
  clean = clean.replace(/<div[^>]*id=["']divtagdefaultwrapper["'][^>]*>[\s\S]*?<\/div>/gi, '');
  // "Sent from" lines
  clean = clean.replace(/<(p|div|span)[^>]*>\s*Sent from (my )?(iPhone|iPad|Galaxy|Android|Samsung|Outlook|Mail).*?<\/(p|div|span)>/gi, '');
  clean = clean.replace(/Sent from (my )?(iPhone|iPad|Galaxy|Android|Samsung|Outlook|Mail)[^\n]*/gi, '');
  // Fine print / legal / unsubscribe blocks
  clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(This (email|message) (is|was) (intended|confidential|sent)[\s\S]*?)<\/(p|div|span|td)>/gi, '');
  clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(If you (are not|received this in error)[\s\S]*?)<\/(p|div|span|td)>/gi, '');
  clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(To unsubscribe|Unsubscribe|Click here to unsubscribe)[\s\S]*?<\/(p|div|span|td)>/gi, '');
  clean = clean.replace(/<(p|div|span|td)[^>]*>\s*(CONFIDENTIALITY|DISCLAIMER|LEGAL NOTICE)[\s\S]*?<\/(p|div|span|td)>/gi, '');

  // ── Strip non-basic HTML tags (keep only safe formatting tags) ──
  const allowedTags = 'b|i|u|em|strong|p|br|ul|ol|li|h1|h2|h3|h4|h5|h6|a|blockquote|pre|code|hr|sub|sup|s|del|ins|mark|small|table|thead|tbody|tr|td|th';
  const tagStripRegex = new RegExp(`<(?!\\/?(${allowedTags})\\b)[^>]+>`, 'gi');
  clean = clean.replace(tagStripRegex, '');

  // ── Decode HTML entities ──
  clean = clean.replace(/&nbsp;/g, ' ');

  // ── Clean up excessive whitespace / blank lines ──
  clean = clean.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
  clean = clean.replace(/\n{3,}/g, '\n\n');
  clean = clean.trim();

  return { html: clean, links };
}


// ═══ Local Time Estimates (stored in localStorage, never sent to Hive) ═══
const TIME_ESTIMATES_KEY = 'omnipotent_hive_time_estimates';

function getTimeEstimates() {
  try {
    const stored = localStorage.getItem(TIME_ESTIMATES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
}

function setTimeEstimate(actionId, estimate) {
  const estimates = getTimeEstimates();
  if (estimate) {
    estimates[actionId] = estimate;
  } else {
    delete estimates[actionId];
  }
  localStorage.setItem(TIME_ESTIMATES_KEY, JSON.stringify(estimates));
}

// Inline time estimate editor
function TimeEstimateEditor({ actionId, compact = false }) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(() => getTimeEstimates()[actionId] || '');

  const handleSave = () => {
    setTimeEstimate(actionId, value.trim());
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <span className="time-estimate-editor" onClick={e => e.stopPropagation()}>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setIsEditing(false); }}
          placeholder="e.g. 2h, 30m"
          className="time-estimate-input"
          autoFocus
        />
        <button className="time-estimate-save" onClick={handleSave}><Check size={10} /></button>
      </span>
    );
  }

  return (
    <span
      className={`time-estimate-display ${compact ? 'compact' : ''} ${value ? '' : 'empty'}`}
      onClick={e => { e.stopPropagation(); setIsEditing(true); }}
      title="Set local time estimate"
    >
      <Timer size={compact ? 10 : 12} />
      {value || (compact ? '' : 'Est.')}
    </span>
  );
}

// Member Selector Component
function MemberSelector({ members, selectedMemberId, onSelect, isLoading }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selected = members.find(m => (m.id || m._id) === selectedMemberId);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const getMemberDisplayName = (member) => {
    return member.name || member.full_name || member.fullName || member.username || member.email || 'Unknown';
  };

  const getMemberId = (member) => {
    return member.id || member._id || member.userId || member.user_id;
  };

  return (
    <div className="member-selector" ref={dropdownRef}>
      <button
        className="member-selector-btn"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading || members.length === 0}
      >
        <Users size={14} />
        <span>
          {isLoading ? 'Loading members...' : selected ? getMemberDisplayName(selected) : 'All Members'}
        </span>
        <ChevronDown size={14} className={isOpen ? 'rotated' : ''} />
      </button>

      {isOpen && (
        <div className="member-dropdown">
          <div
            className={`member-option ${!selectedMemberId ? 'active' : ''}`}
            onClick={() => {
              onSelect(null);
              setIsOpen(false);
            }}
          >
            <Users size={14} />
            <div className="member-option-info">
              <span className="member-option-name">All Members</span>
              <span className="member-option-id">Show all actions</span>
            </div>
            {!selectedMemberId && <CheckCircle size={14} />}
          </div>
          {members.map(member => {
            const memberId = getMemberId(member);
            return (
              <div
                key={memberId}
                className={`member-option ${memberId === selectedMemberId ? 'active' : ''}`}
                onClick={() => {
                  onSelect(memberId);
                  setIsOpen(false);
                }}
              >
                <div className="member-option-avatar">
                  {getMemberDisplayName(member).charAt(0).toUpperCase()}
                </div>
                <div className="member-option-info">
                  <span className="member-option-name">{getMemberDisplayName(member)}</span>
                  <span className="member-option-id">ID: {memberId}</span>
                </div>
                {memberId === selectedMemberId && <CheckCircle size={14} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Action Card Component for My Tasks
function ActionCard({ action, onSelect, workspaceId, connection, labels, onComplete }) {
  const statusColor = getStatusColor(action.status);
  const priorityColor = getPriorityColor(action.priority);
  const commentsCount = action.comments_count || action.commentsCount || action.comments?.length || 0;
  const subactionsCount = action._isSubAction ? 0 : (action.subactions?.length || action.children?.length || action.sub_actions_count || 0);

  const [isExpanded, setIsExpanded] = useState(false);
  const [subActions, setSubActions] = useState([]);
  const [isLoadingSubActions, setIsLoadingSubActions] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const handleComplete = async (e) => {
    e.stopPropagation();
    if (isCompleting) return;
    setIsCompleting(true);
    try {
      await updateAction(connection.apiKey, connection.userId, workspaceId, action.id, {
        status: 'Completed'
      });
      onComplete?.(action.id);
    } catch (err) {
      console.error('Error completing action:', err);
    } finally {
      setIsCompleting(false);
    }
  };

  // Get assignee name
  const getAssigneeName = () => {
    const assignees = action.assignees || action.assigned_members || [];
    if (assignees.length > 0) {
      return assignees[0].name || assignees[0].full_name || 'Unassigned';
    }
    const singleAssignee = action.assignee || action.assigned_to || action.owner;
    if (singleAssignee) {
      return singleAssignee.name || singleAssignee.full_name || 'Unassigned';
    }
    return 'Unassigned';
  };

  // Get assignee name from a sub-action
  const getSubActionAssigneeName = (sub) => {
    const assignees = sub.assignees || sub.assigned_members || [];
    if (assignees.length > 0) {
      return assignees[0].name || assignees[0].full_name || 'Unassigned';
    }
    const singleAssignee = sub.assignee || sub.assigned_to || sub.owner;
    if (singleAssignee) {
      return singleAssignee.name || singleAssignee.full_name || 'Unassigned';
    }
    return 'Unassigned';
  };

  const handleToggleSubActions = async (e) => {
    e.stopPropagation();
    if (subactionsCount === 0) return;

    const willExpand = !isExpanded;
    setIsExpanded(willExpand);

    // Lazy fetch on first expand
    if (willExpand && subActions.length === 0 && connection && workspaceId) {
      setIsLoadingSubActions(true);
      try {
        const subs = await fetchSubActions(connection.apiKey, connection.userId, workspaceId, action.id);
        setSubActions(subs || []);
      } catch (err) {
        console.error('Error fetching sub-actions:', err);
      } finally {
        setIsLoadingSubActions(false);
      }
    }
  };

  return (
    <div className="hive-action-card" onClick={() => onSelect?.(action)}>
      <div className="action-card-header">
        <button
          className={`action-complete-btn ${isCompleting ? 'completing' : ''}`}
          onClick={handleComplete}
          title="Mark as Completed"
        >
          {isCompleting ? <Loader size={12} className="spinning" /> : <Check size={12} />}
        </button>
        <div className="action-status-indicator" style={{ backgroundColor: statusColor }} />
        <span className="action-title">
          {action._isSubAction && <span className="subaction-badge">SUB</span>}
          {action.title || action.name}
        </span>
        {action.priority && (
          <span className="action-priority" style={{ color: priorityColor }}>
            <Flag size={12} />
          </span>
        )}
      </div>

      <div className="action-card-meta">
        <span className="action-assignee">
          <User size={12} />
          {getAssigneeName()}
        </span>
        {action.project?.name && (
          <span className="action-project">
            <Folder size={12} />
            {action.project.name}
          </span>
        )}
        <TimeEstimateEditor actionId={action.id} compact />
      </div>

      <div className="action-card-footer">
        <div className="action-indicators">
          {subactionsCount > 0 && (
            <span
              className="action-subactions-count action-subactions-toggle"
              onClick={handleToggleSubActions}
              title={isExpanded ? 'Collapse sub-actions' : 'Expand sub-actions'}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <ListTree size={12} />
              {subactionsCount}
            </span>
          )}
          {commentsCount > 0 && (
            <span className="action-comments-count">
              <MessageSquare size={12} />
              {commentsCount}
            </span>
          )}
          {action.labels?.length > 0 && (
            <span className="action-labels-count">
              <Tag size={12} />
              {action.labels.length}
            </span>
          )}
        </div>
        <a
          href={`https://app.hive.com/workspace/${workspaceId}/action/${action.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="action-link"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Sub-actions accordion */}
      {isExpanded && subactionsCount > 0 && (
        <div className="action-subactions-panel" onClick={(e) => e.stopPropagation()}>
          {isLoadingSubActions ? (
            <div className="subactions-loading">
              <RefreshCw size={14} className="spinning" />
              <span>Loading sub-actions...</span>
            </div>
          ) : subActions.length === 0 ? (
            <div className="subactions-empty">
              <span>No sub-actions found</span>
            </div>
          ) : (
            subActions.map(sub => (
              <div key={sub.id} className="subaction-row">
                <div
                  className="subaction-status-dot"
                  style={{ backgroundColor: getStatusColor(sub.status) }}
                />
                <span className="subaction-title">{sub.title || sub.name}</span>
                <span className="subaction-assignee">{getSubActionAssigneeName(sub)}</span>
                <span className="subaction-status" style={{ color: getStatusColor(sub.status) }}>
                  {sub.status || 'No Status'}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Project Action Row Component (for project detail view)
function ProjectActionRow({ action, workspaceId, connection, labels }) {
  const statusColor = getStatusColor(action.status);
  const subactionsCount = action.subactions?.length || action.children?.length || action.sub_actions_count || 0;

  // Get assignee name
  const getAssigneeName = () => {
    const assignees = action.assignees || action.assigned_members || [];
    if (assignees.length > 0) {
      return assignees[0].name || assignees[0].full_name || 'Unassigned';
    }
    const singleAssignee = action.assignee || action.assigned_to || action.owner;
    if (singleAssignee) {
      return singleAssignee.name || singleAssignee.full_name || 'Unassigned';
    }
    return 'Unassigned';
  };

  return (
    <div className="project-action-row">
      <div className="action-row-left">
        <div className="action-status-dot" style={{ backgroundColor: statusColor }} />
        <span className="action-row-title">{action.title || action.name}</span>
      </div>

      <div className="action-row-meta">
        <span className="action-row-assignee">{getAssigneeName()}</span>
        <span className="action-row-status" style={{ color: statusColor }}>
          {action.status || 'No Status'}
        </span>
        {subactionsCount > 0 && (
          <span className="action-row-subactions">
            <ListTree size={12} />
            {subactionsCount}
          </span>
        )}
        {action.labels?.length > 0 && (
          <div className="action-row-labels">
            {action.labels.slice(0, 2).map((label, i) => (
              <span
                key={i}
                className="action-row-label"
                style={{ backgroundColor: label.color || '#6366f1' }}
              >
                {label.name || label}
              </span>
            ))}
            {action.labels.length > 2 && (
              <span className="action-row-label-more">+{action.labels.length - 2}</span>
            )}
          </div>
        )}
      </div>

      <a
        href={`https://app.hive.com/workspace/${workspaceId}/action/${action.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="action-row-link"
      >
        <ExternalLink size={14} />
        View
      </a>
    </div>
  );
}

// Task Detail View Component
function TaskDetailView({ task, connection, selectedWorkspace, onClose, onUpdate, members, projects, labels: workspaceLabels }) {
  const [details, setDetails] = useState(null);
  const [comments, setComments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Inline field editing
  const [editingField, setEditingField] = useState(null); // 'status', 'due', 'assignee', 'labels', 'project'
  const [fieldValue, setFieldValue] = useState('');
  const [isFieldSaving, setIsFieldSaving] = useState(false);
  // Comment input
  const [newComment, setNewComment] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  const statusOptions = ['Unstarted', 'In Progress', 'In Review', 'On Hold', 'Blocked', 'Completed'];

  useEffect(() => {
    loadDetails();
  }, [task.id]);

  const loadDetails = async () => {
    setIsLoading(true);
    try {
      const [actionDetails, actionComments] = await Promise.all([
        fetchActionDetails(connection.apiKey, connection.userId, task.id),
        fetchActionComments(connection.apiKey, connection.userId, task.id)
      ]);

      setDetails(actionDetails || task);
      setComments(actionComments || []);
      setEditedTitle(actionDetails?.title || actionDetails?.name || task.title || task.name || '');
      setEditedDescription(actionDetails?.description || task.description || '');
    } catch (e) {
      console.error('Error loading task details:', e);
      setDetails(task);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await updateAction(connection.apiKey, connection.userId, selectedWorkspace, task.id, {
        title: editedTitle,
        description: editedDescription
      });

      if (result) {
        setDetails(prev => ({ ...prev, title: editedTitle, description: editedDescription }));
        setIsEditing(false);
        onUpdate?.();
      }
    } catch (e) {
      console.error('Error saving task:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFieldSave = async (field, value) => {
    setIsFieldSaving(true);
    try {
      const updates = {};
      if (field === 'status') updates.status = value;
      else if (field === 'due') updates.deadline = value || null;
      else if (field === 'assignee') updates.assignees = value ? [value] : [];
      else if (field === 'labels') updates.labels = value;
      else if (field === 'project') updates.project_id = value || null;

      const result = await updateAction(connection.apiKey, connection.userId, selectedWorkspace, task.id, updates);
      if (result) {
        setDetails(prev => {
          const updated = { ...prev };
          if (field === 'status') updated.status = value;
          else if (field === 'due') updated.deadline = value;
          else if (field === 'assignee') updated.assignees = value ? [value] : [];
          else if (field === 'labels') updated.labels = value;
          else if (field === 'project') {
            const proj = (projects || []).find(p => p.id === value);
            updated.project = proj ? { id: proj.id, name: proj.name } : null;
          }
          return updated;
        });
        setEditingField(null);
        onUpdate?.();
      }
    } catch (e) {
      console.error('Error updating field:', e);
    } finally {
      setIsFieldSaving(false);
    }
  };

  const handlePostComment = async () => {
    if (!newComment.trim() || isPostingComment) return;
    setIsPostingComment(true);
    try {
      const result = await postActionComment(connection.apiKey, connection.userId, task.id, newComment.trim());
      if (result) {
        setComments(prev => [...prev, result]);
        setNewComment('');
      }
    } catch (e) {
      console.error('Error posting comment:', e);
    } finally {
      setIsPostingComment(false);
    }
  };

  const handleMarkCompleted = async () => {
    await handleFieldSave('status', 'Completed');
  };

  const displayTask = details || task;
  const parentAction = displayTask.parent || displayTask.parentAction || displayTask._parentAction;
  const createdBy = displayTask.created_by || displayTask.createdBy || displayTask.creator;

  const getMemberName = (memberId) => {
    if (!memberId || !members) return 'Unknown';
    const m = members.find(mem => (mem.id || mem._id) === memberId);
    return m?.name || m?.full_name || m?.username || m?.email || 'Unknown';
  };

  return (
    <div className="task-detail-view">
      <div className="task-detail-header">
        <button className="back-btn" onClick={onClose}>
          <ArrowLeft size={18} />
          Back to Tasks
        </button>
        <div className="task-detail-actions">
          <button className="complete-action-btn" onClick={handleMarkCompleted} title="Mark as Completed">
            <Check size={14} />
          </button>
          {!isEditing ? (
            <button className="edit-btn" onClick={() => setIsEditing(true)}>
              <Edit3 size={14} />
              Edit
            </button>
          ) : (
            <>
              <button className="cancel-btn" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
              <button className="save-btn" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader size={14} className="spinning" /> : <Save size={14} />}
                Save
              </button>
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="task-detail-loading">
          <RefreshCw size={24} className="spinning" />
          <span>Loading action details...</span>
        </div>
      ) : (
        <div className="task-detail-content">
          {/* Title */}
          <div className="task-detail-section">
            <label>Title</label>
            {isEditing ? (
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="task-edit-input"
              />
            ) : (
              <h2 className="task-detail-title">
                <div className="task-status-indicator" style={{ backgroundColor: getStatusColor(displayTask.status) }} />
                {displayTask.title || displayTask.name}
              </h2>
            )}
          </div>

          {/* Local Time Estimate */}
          <div className="task-detail-section">
            <label><Timer size={14} /> Time Estimate (local only)</label>
            <TimeEstimateEditor actionId={task.id} />
          </div>

          {/* Description */}
          <div className="task-detail-section">
            <label>Description</label>
            {isEditing ? (
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                className="task-edit-textarea"
                rows={4}
              />
            ) : (() => {
              const { html: sanitizedHtml, links } = sanitizeAndExtractLinks(displayTask.description);
              return (
                <div className="task-detail-description">
                  {sanitizedHtml ? (
                    <div className="task-desc-html" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
                  ) : (
                    <p style={{ whiteSpace: 'pre-wrap' }}>No description provided</p>
                  )}
                  {links.length > 0 && (
                    <div className="task-description-links">
                      <span className="task-desc-links-label">
                        <Link2 size={10} />
                        Links
                      </span>
                      {links.map((link, i) => (
                        <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="task-desc-link">
                          <ExternalLink size={10} />
                          {link.text.length > 60 ? link.text.substring(0, 60) + '...' : link.text}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Meta Info Cards - now clickable to edit */}
          <div className="task-meta-cards">
            {/* Status Card - clickable */}
            <div
              className="task-meta-card task-meta-card--status task-meta-card--editable"
              onClick={() => { setEditingField('status'); setFieldValue(displayTask.status || ''); }}
            >
              <div className="task-meta-card-icon" style={{ backgroundColor: `${getStatusColor(displayTask.status)}20`, color: getStatusColor(displayTask.status) }}>
                <Circle size={16} />
              </div>
              <div className="task-meta-card-body">
                <span className="task-meta-card-label">Status <Edit3 size={9} /></span>
                {editingField === 'status' ? (
                  <select
                    className="task-meta-inline-select"
                    value={fieldValue}
                    onChange={(e) => { handleFieldSave('status', e.target.value); }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                    onBlur={() => setEditingField(null)}
                  >
                    {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <span className="task-meta-card-value" style={{ color: getStatusColor(displayTask.status) }}>
                    {displayTask.status || 'Unknown'}
                  </span>
                )}
              </div>
            </div>

            {/* Created By Card */}
            <div className="task-meta-card task-meta-card--creator">
              <div className="task-meta-card-icon" style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                <User size={16} />
              </div>
              <div className="task-meta-card-body">
                <span className="task-meta-card-label">Created By</span>
                <span className="task-meta-card-value">
                  {createdBy ? (createdBy.name || createdBy.full_name || createdBy.email || 'Unknown') : 'Unknown'}
                </span>
              </div>
            </div>

            {/* Due Date Card - clickable */}
            <div
              className="task-meta-card task-meta-card--due task-meta-card--editable"
              onClick={() => { setEditingField('due'); setFieldValue(displayTask.deadline ? new Date(displayTask.deadline).toISOString().split('T')[0] : ''); }}
            >
              <div className="task-meta-card-icon" style={{ backgroundColor: displayTask.deadline ? 'rgba(245, 158, 11, 0.15)' : 'rgba(100, 116, 139, 0.15)', color: displayTask.deadline ? '#f59e0b' : '#64748b' }}>
                <Calendar size={16} />
              </div>
              <div className="task-meta-card-body">
                <span className="task-meta-card-label">Due Date <Edit3 size={9} /></span>
                {editingField === 'due' ? (
                  <input
                    type="date"
                    className="task-meta-inline-input"
                    value={fieldValue}
                    onChange={(e) => { handleFieldSave('due', e.target.value); }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                    onBlur={() => setEditingField(null)}
                  />
                ) : (
                  <span className="task-meta-card-value">
                    {displayTask.deadline ? new Date(displayTask.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date'}
                  </span>
                )}
              </div>
            </div>

            {/* Assignee Card - clickable */}
            <div
              className="task-meta-card task-meta-card--assignee task-meta-card--editable"
              onClick={() => {
                const assignees = displayTask.assignees || displayTask.assigned_members || [];
                const currentAssignee = assignees[0];
                const currentId = typeof currentAssignee === 'string' ? currentAssignee : (currentAssignee?.id || currentAssignee?._id || '');
                setEditingField('assignee');
                setFieldValue(currentId);
              }}
            >
              <div className="task-meta-card-icon" style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                <User size={16} />
              </div>
              <div className="task-meta-card-body">
                <span className="task-meta-card-label">Assignee <Edit3 size={9} /></span>
                {editingField === 'assignee' ? (
                  <select
                    className="task-meta-inline-select"
                    value={fieldValue}
                    onChange={(e) => { handleFieldSave('assignee', e.target.value); }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                    onBlur={() => setEditingField(null)}
                  >
                    <option value="">Unassigned</option>
                    {(members || []).map(m => {
                      const mId = m.id || m._id;
                      return <option key={mId} value={mId}>{m.name || m.full_name || m.email || mId}</option>;
                    })}
                  </select>
                ) : (
                  <span className="task-meta-card-value">
                    {(() => {
                      const assignees = displayTask.assignees || displayTask.assigned_members || [];
                      if (assignees.length === 0) return 'Unassigned';
                      const first = assignees[0];
                      if (typeof first === 'string') return getMemberName(first);
                      return first.name || first.full_name || 'Assigned';
                    })()}
                  </span>
                )}
              </div>
            </div>

            {/* Comments Card */}
            <div className="task-meta-card task-meta-card--comments">
              <div className="task-meta-card-icon" style={{ backgroundColor: comments.length > 0 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(100, 116, 139, 0.15)', color: comments.length > 0 ? '#22c55e' : '#64748b' }}>
                <MessageSquare size={16} />
              </div>
              <div className="task-meta-card-body">
                <span className="task-meta-card-label">Comments</span>
                <span className="task-meta-card-value">
                  {comments.length} comment{comments.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            {/* Project Card - clickable */}
            <div
              className="task-meta-card task-meta-card--project task-meta-card--editable"
              onClick={() => { setEditingField('project'); setFieldValue(displayTask.project?.id || ''); }}
            >
              <div className="task-meta-card-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                <Folder size={16} />
              </div>
              <div className="task-meta-card-body">
                <span className="task-meta-card-label">Project <Edit3 size={9} /></span>
                {editingField === 'project' ? (
                  <select
                    className="task-meta-inline-select"
                    value={fieldValue}
                    onChange={(e) => { handleFieldSave('project', e.target.value); }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                    onBlur={() => setEditingField(null)}
                  >
                    <option value="">No project</option>
                    {(projects || []).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <span className="task-meta-card-value">{displayTask.project?.name || 'No project'}</span>
                )}
              </div>
            </div>

            {/* Priority Card (if applicable) */}
            {displayTask.priority && (
              <div className="task-meta-card task-meta-card--priority">
                <div className="task-meta-card-icon" style={{ backgroundColor: `${getPriorityColor(displayTask.priority)}20`, color: getPriorityColor(displayTask.priority) }}>
                  <Flag size={16} />
                </div>
                <div className="task-meta-card-body">
                  <span className="task-meta-card-label">Priority</span>
                  <span className="task-meta-card-value" style={{ color: getPriorityColor(displayTask.priority) }}>
                    {typeof displayTask.priority === 'number' ? `Level ${displayTask.priority}` : displayTask.priority}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Labels - clickable to edit */}
          <div className="task-detail-section">
            <label
              style={{ cursor: 'pointer' }}
              onClick={() => { setEditingField('labels'); }}
            >
              <Tag size={14} /> Labels <Edit3 size={9} style={{ marginLeft: 4, opacity: 0.5 }} />
            </label>
            {editingField === 'labels' ? (
              <div className="task-labels-editor">
                {(workspaceLabels || []).map((label, i) => {
                  const labelId = label.id || label._id || label.name;
                  const currentLabels = displayTask.labels || [];
                  const isSelected = currentLabels.some(l => (l.id || l._id || l.name || l) === labelId || (l.name || l) === (label.name || label));
                  return (
                    <span
                      key={i}
                      className={`task-label task-label--selectable ${isSelected ? 'selected' : ''}`}
                      style={{ backgroundColor: isSelected ? (label.color || '#6366f1') : 'rgba(100,116,139,0.2)', cursor: 'pointer' }}
                      onClick={() => {
                        const newLabels = isSelected
                          ? currentLabels.filter(l => (l.id || l._id || l.name || l) !== labelId && (l.name || l) !== (label.name || label))
                          : [...currentLabels, label];
                        handleFieldSave('labels', newLabels);
                      }}
                    >
                      {label.name || label}
                    </span>
                  );
                })}
                <button className="labels-done-btn" onClick={() => setEditingField(null)}>Done</button>
              </div>
            ) : (
              <div className="task-labels">
                {displayTask.labels?.length > 0 ? displayTask.labels.map((label, i) => (
                  <span
                    key={i}
                    className="task-label"
                    style={{ backgroundColor: label.color || '#6366f1' }}
                  >
                    {label.name || label}
                  </span>
                )) : (
                  <span style={{ fontSize: 12, color: '#64748b' }}>No labels</span>
                )}
              </div>
            )}
          </div>

          {/* Comments Section */}
          <div className="task-detail-section">
            <label><MessageSquare size={14} /> Comments</label>
            <div className="task-comments-list">
              {comments.length === 0 ? (
                <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0' }}>No comments yet</p>
              ) : (
                comments.map((comment, i) => {
                  const sender = comment.user || comment.created_by || comment.author || {};
                  const senderName = sender.name || sender.full_name || sender.username || 'Unknown';
                  const body = comment.body || comment.content || comment.message || comment.text || '';
                  const time = comment.created_at || comment.createdAt || comment.timestamp;
                  return (
                    <div key={comment.id || i} className="task-comment-item">
                      <div className="task-comment-header">
                        <span className="task-comment-sender">{senderName}</span>
                        <span className="task-comment-time">{formatRelativeTime(time)}</span>
                      </div>
                      <div className="task-comment-body">{body}</div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="task-comment-input-area">
              <input
                type="text"
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePostComment()}
                placeholder="Add a comment..."
                className="task-comment-input"
                disabled={isPostingComment}
              />
              <button
                className="task-comment-send-btn"
                onClick={handlePostComment}
                disabled={!newComment.trim() || isPostingComment}
              >
                {isPostingComment ? <Loader size={14} className="spinning" /> : <Send size={14} />}
              </button>
            </div>
          </div>

          {/* Action Buttons Row */}
          <div className="task-detail-buttons-row">
            {parentAction && (
              <a
                href={`https://app.hive.com/workspace/${selectedWorkspace}/action/${parentAction.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="view-parent-action-btn"
              >
                <Link2 size={14} />
                View Parent Action
              </a>
            )}
            <a
              href={`https://app.hive.com/workspace/${selectedWorkspace}/action/${displayTask.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="go-to-action-hive-btn"
            >
              <ExternalLink size={14} />
              Go to Action in Hive
            </a>
          </div>

        </div>
      )}
    </div>
  );
}

// Project Detail View Component
function ProjectDetailView({ project, connection, selectedWorkspace, onBack, labels }) {
  const [actions, setActions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadProjectActions();
  }, [project.id]);

  const loadProjectActions = async () => {
    setIsLoading(true);
    try {
      const projectActions = await fetchProjectActions(
        connection.apiKey,
        connection.userId,
        selectedWorkspace,
        project.id
      );
      setActions(projectActions);
    } catch (e) {
      console.error('Error loading project actions:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="project-detail-view">
      <div className="project-detail-header">
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={18} />
          Back to Projects
        </button>
        <div className="project-detail-title">
          <div className="project-icon" style={{ backgroundColor: project.color || '#6366f1' }}>
            <Folder size={16} />
          </div>
          <div className="project-detail-title-text">
            <h3>{project.name}</h3>
            <span className="project-detail-id">ID: {project.id}</span>
          </div>
        </div>
      </div>

      <div className="project-detail-content">
        {isLoading ? (
          <div className="hive-loading">
            <RefreshCw size={24} className="spinning" />
            <span>Loading actions...</span>
          </div>
        ) : actions.length === 0 ? (
          <div className="hive-empty">
            <CheckCircle size={32} />
            <p>No active actions in this project</p>
            <span className="hive-empty-hint">Completed and archived actions are hidden</span>
          </div>
        ) : (
          <>
            <div className="project-actions-header">
              <span>{actions.length} active action{actions.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="project-actions-list">
              {actions.map(action => (
                <ProjectActionRow
                  key={action.id}
                  action={action}
                  workspaceId={selectedWorkspace}
                  connection={connection}
                  labels={labels}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Chat List Item Component
function ChatItem({ chat, onSelect, isActive }) {
  const lastMessage = chat.lastMessage || chat.last_message;

  return (
    <div
      className={`chat-item ${isActive ? 'active' : ''}`}
      onClick={() => onSelect(chat)}
    >
      <div className="chat-avatar">
        {chat.name?.charAt(0).toUpperCase() || chat.participants?.[0]?.name?.charAt(0).toUpperCase() || '?'}
      </div>
      <div className="chat-item-content">
        <span className="chat-name">
          {chat.name || chat.participants?.map(p => p.name).join(', ') || 'Chat'}
        </span>
        {lastMessage && (
          <span className="chat-preview">
            {lastMessage.body?.substring(0, 50) || lastMessage.content?.substring(0, 50) || ''}
          </span>
        )}
      </div>
      {chat.unread_count > 0 && (
        <span className="chat-unread">{chat.unread_count}</span>
      )}
    </div>
  );
}

// Chat View Component
function ChatView({ chat, connection, onBack }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadMessages();
  }, [chat.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMessages = async () => {
    setIsLoading(true);
    try {
      const msgs = await fetchChatMessages(connection.apiKey, connection.userId, chat.id);
      setMessages(msgs);
    } catch (e) {
      console.error('Error loading messages:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    try {
      const result = await sendChatMessage(connection.apiKey, connection.userId, chat.id, newMessage);
      if (result) {
        setMessages(prev => [...prev, result]);
        setNewMessage('');
      }
    } catch (e) {
      console.error('Error sending message:', e);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="chat-view">
      <div className="chat-view-header">
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="chat-view-info">
          <span className="chat-view-name">
            {chat.name || chat.participants?.map(p => p.name).join(', ') || 'Chat'}
          </span>
        </div>
      </div>

      <div className="chat-messages">
        {isLoading ? (
          <div className="chat-loading">
            <RefreshCw size={20} className="spinning" />
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <MessageSquare size={32} />
            <p>No messages yet</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={msg.id || i}
              className={`chat-message ${msg.sender?.id === connection.userId ? 'own' : ''}`}
            >
              <div className="message-sender">{msg.sender?.name || 'Unknown'}</div>
              <div className="message-content">{msg.body || msg.content}</div>
              <div className="message-time">{formatRelativeTime(msg.created_at || msg.createdAt)}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type a message..."
          disabled={isSending}
        />
        <button onClick={handleSend} disabled={!newMessage.trim() || isSending}>
          {isSending ? <Loader size={18} className="spinning" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}

// Mention Item Component
function MentionItem({ mention, onSelect }) {
  const content = mention.body || mention.content || mention.message || mention.text || '';
  const actionTitle = mention.action?.title || mention.action?.name || mention.actionTitle || 'Unknown Action';
  const createdAt = mention.created_at || mention.createdAt || mention.timestamp;
  const sender = mention.sender || mention.from || mention.user || mention.created_by;
  const senderName = sender?.name || sender?.full_name || sender?.username || 'Someone';

  return (
    <div className="mention-item" onClick={() => onSelect(mention)}>
      <div className="mention-avatar">
        {senderName.charAt(0).toUpperCase()}
      </div>
      <div className="mention-content">
        <div className="mention-header">
          <span className="mention-sender">{senderName}</span>
          <span className="mention-time">{formatRelativeTime(createdAt)}</span>
        </div>
        <div className="mention-body">
          {content.length > 100 ? content.substring(0, 100) + '...' : content}
        </div>
        <div className="mention-action-ref">
          <Briefcase size={12} />
          <span>{actionTitle}</span>
        </div>
      </div>
    </div>
  );
}

// Mention Modal Component
function MentionModal({ mention, workspaceId, onClose }) {
  const content = mention.body || mention.content || mention.message || mention.text || '';
  const actionTitle = mention.action?.title || mention.action?.name || mention.actionTitle || 'Unknown Action';
  const actionId = mention.action?.id || mention.actionId || mention.action_id;
  const createdAt = mention.created_at || mention.createdAt || mention.timestamp;
  const sender = mention.sender || mention.from || mention.user || mention.created_by;
  const senderName = sender?.name || sender?.full_name || sender?.username || 'Unknown';

  return (
    <div className="mention-modal-overlay" onClick={onClose}>
      <div className="mention-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mention-modal-header">
          <h3>Mention</h3>
          <button className="mention-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="mention-modal-content">
          <div className="mention-modal-meta">
            <div className="mention-modal-sender">
              <div className="mention-modal-avatar">
                {senderName.charAt(0).toUpperCase()}
              </div>
              <div className="mention-modal-sender-info">
                <span className="mention-modal-sender-name">{senderName}</span>
                <span className="mention-modal-time">{formatRelativeTime(createdAt)}</span>
              </div>
            </div>
          </div>

          <div className="mention-modal-body">
            <p>{content}</p>
          </div>

          <div className="mention-modal-action">
            <label>
              <Briefcase size={14} />
              Related Action
            </label>
            <div className="mention-modal-action-card">
              <span>{actionTitle}</span>
              {actionId && (
                <a
                  href={`https://app.hive.com/workspace/${workspaceId}/action/${actionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="go-to-action-btn"
                >
                  <ExternalLink size={14} />
                  Go to Action
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Notes/Mentions List Component
function NotesList({ mentions, isLoading, onSelectMention }) {
  return (
    <div className="notes-list-view">
      {isLoading ? (
        <div className="hive-loading">
          <RefreshCw size={24} className="spinning" />
          <span>Loading mentions...</span>
        </div>
      ) : mentions.length === 0 ? (
        <div className="hive-empty">
          <MessageSquare size={32} />
          <p>No mentions found</p>
          <span className="hive-empty-hint">You'll see notifications when someone @mentions you</span>
        </div>
      ) : (
        <div className="mentions-list">
          {mentions.map((mention, index) => (
            <MentionItem
              key={mention.id || index}
              mention={mention}
              onSelect={onSelectMention}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Projects List Component
function ProjectsList({ projects, isLoading, onSelectProject }) {
  return (
    <div className="projects-list-view">
      {isLoading ? (
        <div className="hive-loading">
          <RefreshCw size={24} className="spinning" />
          <span>Loading projects...</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="hive-empty">
          <Folder size={32} />
          <p>No projects found</p>
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map(project => (
            <div
              key={project.id}
              className="project-card clickable"
              onClick={() => onSelectProject(project)}
            >
              <span className="project-color-dot" style={{ backgroundColor: project.color || '#6366f1' }} />
              <div className="project-card-info">
                <span className="project-card-name">{project.name}</span>
                {project.description && (
                  <span className="project-card-desc">{project.description.substring(0, 60)}...</span>
                )}
              </div>
              <ChevronRight size={14} className="project-card-arrow" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Workspace Selector Component
function WorkspaceSelector({ workspaces, selectedWorkspace, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = workspaces.find(w => w.id === selectedWorkspace);

  return (
    <div className="workspace-selector">
      <button className="workspace-selector-btn" onClick={() => setIsOpen(!isOpen)}>
        <Briefcase size={14} />
        <span>{selected?.name || 'Select Workspace'}</span>
        <ChevronDown size={14} className={isOpen ? 'rotated' : ''} />
      </button>

      {isOpen && (
        <div className="workspace-dropdown">
          {workspaces.map(workspace => (
            <div
              key={workspace.id}
              className={`workspace-option ${workspace.id === selectedWorkspace ? 'active' : ''}`}
              onClick={() => {
                onSelect(workspace.id);
                setIsOpen(false);
              }}
            >
              <Briefcase size={14} />
              <span>{workspace.name}</span>
              {workspace.id === selectedWorkspace && <CheckCircle size={14} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Main Hive Panel Component
export default function HivePanel() {
  const [connection, setConnection] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [chats, setChats] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeTab, setActiveTab] = useState('tasks'); // 'tasks', 'chat', 'projects', 'notes'
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedChat, setSelectedChat] = useState(null);
  const [mentions, setMentions] = useState([]);
  const [selectedMention, setSelectedMention] = useState(null);
  const [members, setMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [isMembersLoading, setIsMembersLoading] = useState(false);
  const [allActions, setAllActions] = useState([]);
  const [labels, setLabels] = useState([]);

  // Check for Hive connection on mount
  useEffect(() => {
    const conn = getHiveConnection();
    setConnection(conn);

    // Load cached data
    const cached = getCachedHiveData();
    if (cached) {
      if (cached.workspaces) setWorkspaces(cached.workspaces);
      if (cached.selectedWorkspace) setSelectedWorkspace(cached.selectedWorkspace);
      if (cached.projects) setProjects(cached.projects);
      if (cached.tasks) setTasks(cached.tasks);
    }
  }, []);

  // Fetch workspaces when connected
  const loadWorkspaces = useCallback(async () => {
    if (!connection?.apiKey || !connection?.userId) return;

    try {
      const ws = await fetchWorkspaces(connection.apiKey, connection.userId);
      setWorkspaces(ws);

      // Auto-select first workspace if none selected
      if (ws.length > 0 && !selectedWorkspace) {
        setSelectedWorkspace(ws[0].id);
      }
    } catch (e) {
      console.error('Error loading workspaces:', e);
    }
  }, [connection, selectedWorkspace]);

  // Fetch projects, tasks, members and chats for selected workspace
  const loadWorkspaceData = useCallback(async () => {
    if (!connection?.apiKey || !connection?.userId || !selectedWorkspace) return;

    setIsLoading(true);
    setIsMembersLoading(true);
    setError(null);

    try {
      const [projectsData, tasksData, membersData, labelsData] = await Promise.all([
        fetchProjects(connection.apiKey, connection.userId, selectedWorkspace),
        fetchMyTasks(connection.apiKey, connection.userId, selectedWorkspace),
        fetchWorkspaceMembers(connection.apiKey, connection.userId, selectedWorkspace),
        fetchLabels(connection.apiKey, connection.userId, selectedWorkspace)
      ]);

      setProjects(projectsData);
      setMembers(membersData);
      setLabels(labelsData || []);
      setChats([]);

      // Auto-select connected user on first load
      if (!selectedMemberId && membersData.length > 0) {
        const uid = connection.userId;
        let me = membersData.find(m =>
          (m.id && m.id === uid) ||
          (m._id && m._id === uid) ||
          (m.userId && m.userId === uid) ||
          (m.user_id && m.user_id === uid)
        );
        if (!me && uid.includes('@')) {
          me = membersData.find(m =>
            (m.email && m.email.toLowerCase() === uid.toLowerCase()) ||
            (m.emails && m.emails.some(e => e.toLowerCase() === uid.toLowerCase()))
          );
        }
        if (me) {
          const meId = me.id || me._id;
          if (meId) setSelectedMemberId(meId);
        }
      }

      // Fetch mentions for the selected/current user by scanning comments
      try {
        const targetMemberId = selectedMemberId || connection.userId;
        const targetMember = membersData.find(m => (m.id || m._id) === targetMemberId);
        const userName = targetMember?.name || targetMember?.full_name || null;
        const mentionsData = await fetchMentions(connection.apiKey, connection.userId, selectedWorkspace, userName);
        setMentions(mentionsData);
      } catch (mentionErr) {
        console.warn('Could not fetch mentions:', mentionErr.message);
        setMentions([]);
      }

      // Build a label lookup map so we can enrich actions with full label objects
      const labelMap = {};
      (labelsData || []).forEach(l => { labelMap[l.id || l._id] = l; });

      // Enrich actions: convert label IDs to full label objects if needed
      const enrichedTasks = tasksData.map(action => {
        // If action.labels contains strings (IDs), resolve them to full objects
        if (action.labels && action.labels.length > 0 && typeof action.labels[0] === 'string') {
          return {
            ...action,
            labels: action.labels.map(lid => labelMap[lid] || { id: lid, name: lid }).filter(Boolean)
          };
        }
        return action;
      });

      setAllActions(enrichedTasks);

      // Apply member filter if one is selected, otherwise show all
      if (selectedMemberId) {
        const filtered = enrichedTasks.filter(action => {
          const assignees = action.assignees || action.assigned_members || [];
          // Direct string match (Hive often returns assignee IDs as strings)
          if (assignees.includes(selectedMemberId)) return true;
          // Object match — check various ID fields
          return assignees.some(a => {
            if (typeof a === 'string') return a === selectedMemberId;
            return (a.id || a._id || a.userId || a.user_id) === selectedMemberId;
          });
        });
        console.log(`Hive UI: Member filter ${selectedMemberId} matched ${filtered.length}/${enrichedTasks.length} tasks`);
        // Log a sample for debugging if few results
        if (filtered.length <= 3 && enrichedTasks.length > 10) {
          const sample = enrichedTasks[0];
          console.log(`Hive UI: Sample action assignees format:`, JSON.stringify(sample?.assignees || sample?.assigned_members || []).substring(0, 300));
          console.log(`Hive UI: Looking for memberId:`, selectedMemberId);
        }
        setTasks(filtered);
      } else {
        setTasks(enrichedTasks);
      }

      // Cache the data
      cacheHiveData({
        workspaces,
        selectedWorkspace,
        projects: projectsData,
        tasks: tasksData
      });

      setLastRefresh(new Date());
    } catch (e) {
      console.error('Error loading workspace data:', e);
      setError('Failed to load Hive data. Please check your credentials.');
    } finally {
      setIsLoading(false);
      setIsMembersLoading(false);
    }
  }, [connection, selectedWorkspace, workspaces, selectedMemberId]);

  // Load data when connection or workspace changes
  useEffect(() => {
    if (connection?.apiKey) {
      loadWorkspaces();
    }
  }, [connection, loadWorkspaces]);

  useEffect(() => {
    if (connection?.apiKey && selectedWorkspace) {
      loadWorkspaceData();
    }
  }, [connection, selectedWorkspace, loadWorkspaceData]);

  // Handle member selection for filtering
  const handleSelectMember = useCallback((memberId) => {
    setSelectedMemberId(memberId);
    if (!memberId) {
      // Show all actions
      setTasks(allActions);
    } else {
      // Filter actions (including subactions) by the selected member's ID
      const filtered = allActions.filter(action => {
        const assignees = action.assignees || action.assigned_members || [];
        // Direct string match
        if (assignees.includes(memberId)) return true;
        // Object match
        return assignees.some(a => {
          if (typeof a === 'string') return a === memberId;
          return (a.id || a._id || a.userId || a.user_id) === memberId;
        });
      });
      setTasks(filtered);
    }
  }, [allActions]);

  // Handle completing an action (remove from list)
  const handleCompleteAction = useCallback((actionId) => {
    setAllActions(prev => prev.filter(a => a.id !== actionId));
    setTasks(prev => prev.filter(a => a.id !== actionId));
  }, []);

  // Handle task selection (open detail view)
  const handleSelectTask = (task) => {
    setSelectedTask(task);
  };

  // Handle project selection
  const handleSelectProject = (project) => {
    setSelectedProject(project);
  };

  // Handle chat selection
  const handleSelectChat = (chat) => {
    setSelectedChat(chat);
  };

  // Refresh data
  const handleRefresh = () => {
    loadWorkspaceData();
  };

  // Not connected state
  if (!connection || !connection.apiKey || !connection.userId) {
    return (
      <div className="hive-panel">
        <div className="hive-not-connected">
          <Hexagon size={48} />
          <h3>Connect to Hive</h3>
          <p>Connect your Hive account in Settings to view your actions and projects here.</p>
          <div className="hive-connect-hint">
            <Settings size={14} />
            <span>Go to Settings → Integrations → Hive</span>
          </div>
          <div className="hive-api-info">
            <p>You'll need:</p>
            <ul>
              <li>Your Hive API Key</li>
              <li>Your User ID</li>
            </ul>
            <a href="https://app.hive.com" target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} />
              Hive → My Profile → API Info
            </a>
          </div>

          <div className="hive-troubleshooting" style={{ marginTop: '16px', padding: '12px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px', fontSize: '12px' }}>
            <h4 style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={14} />
              Troubleshooting
            </h4>
            <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-secondary, #94a3b8)', lineHeight: 1.7 }}>
              <li><strong style={{ color: 'var(--text-primary, #e2e8f0)' }}>Tasks not listing:</strong> Verify your User ID matches your Hive profile exactly. The API key must have read access to the workspace. Go to Hive → My Profile → copy User ID.</li>
              <li><strong style={{ color: 'var(--text-primary, #e2e8f0)' }}>Clicking goes to dashboard:</strong> Open <a href="https://app.hive.com" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>app.hive.com</a> in your browser first (active session required). Verify the correct workspace is selected from the dropdown.</li>
              <li><strong style={{ color: 'var(--text-primary, #e2e8f0)' }}>Connection failed:</strong> API keys expire if regenerated. Go to Hive → My Profile → API Info → generate a new key if needed.</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Task detail view
  if (selectedTask) {
    return (
      <div className="hive-panel">
        <TaskDetailView
          task={selectedTask}
          connection={connection}
          selectedWorkspace={selectedWorkspace}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleRefresh}
          members={members}
          projects={projects}
          labels={labels}
        />
      </div>
    );
  }

  // Project detail view
  if (selectedProject) {
    return (
      <div className="hive-panel">
        <ProjectDetailView
          project={selectedProject}
          connection={connection}
          selectedWorkspace={selectedWorkspace}
          onBack={() => setSelectedProject(null)}
          labels={labels}
        />
      </div>
    );
  }

  // Chat view
  if (selectedChat) {
    return (
      <div className="hive-panel">
        <ChatView
          chat={selectedChat}
          connection={connection}
          onBack={() => setSelectedChat(null)}
        />
      </div>
    );
  }

  return (
    <div className="hive-panel">
      {/* Header */}
      <div className="hive-panel-header">
        <div className="hive-header-left">
          <Hexagon size={18} />
          <h3>Hive</h3>
        </div>
        <div className="hive-header-right">
          {lastRefresh && (
            <span className="hive-last-refresh">
              {formatRelativeTime(lastRefresh)}
            </span>
          )}
          <button
            className="hive-refresh-btn"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh"
          >
            <RefreshCw size={16} className={isLoading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* Workspace selector */}
      {workspaces.length > 0 && (
        <div className="hive-workspace-bar">
          <WorkspaceSelector
            workspaces={workspaces}
            selectedWorkspace={selectedWorkspace}
            onSelect={setSelectedWorkspace}
          />
        </div>
      )}

      {/* View tabs */}
      <div className="hive-view-tabs">
        <button
          className={`hive-view-tab ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          <User size={14} />
          Tasks
          {tasks.length > 0 && <span className="tab-badge tab-badge-tasks">{tasks.length}</span>}
        </button>
        <button
          className={`hive-view-tab ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          <MessageSquare size={14} />
          Chat
        </button>
        <button
          className={`hive-view-tab ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          <Folder size={14} />
          Projects
        </button>
        <button
          className={`hive-view-tab ${activeTab === 'notes' ? 'active' : ''}`}
          onClick={() => setActiveTab('notes')}
        >
          <Bell size={14} />
          Notif
          {mentions.filter(m => !m.read && !m.is_read).length > 0 && <span className="tab-badge">{mentions.filter(m => !m.read && !m.is_read).length}</span>}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="hive-error">
          <AlertCircle size={16} />
          <span>{error}</span>
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted, #64748b)', lineHeight: 1.6 }}>
            <strong>Quick fix:</strong> Verify User ID matches your Hive profile. Open <a href="https://app.hive.com" target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa' }}>app.hive.com</a> first for an active session. Re-enter your API key if it was recently regenerated.
          </div>
        </div>
      )}

      {/* Mention Modal */}
      {selectedMention && (
        <MentionModal
          mention={selectedMention}
          workspaceId={selectedWorkspace}
          onClose={() => setSelectedMention(null)}
        />
      )}

      {/* Content */}
      <div className="hive-content">
        {/* Notes Tab */}
        {activeTab === 'notes' && (
          <NotesList
            mentions={mentions}
            isLoading={isLoading && mentions.length === 0}
            onSelectMention={setSelectedMention}
          />
        )}

        {/* Tasks Tab */}
        {activeTab === 'tasks' && (
          <div className="hive-tasks-view">
            {/* Member selector dropdown */}
            <div className="hive-member-filter-bar">
              <MemberSelector
                members={members}
                selectedMemberId={selectedMemberId}
                onSelect={handleSelectMember}
                isLoading={isMembersLoading}
              />
            </div>

            {isLoading && tasks.length === 0 ? (
              <div className="hive-loading">
                <RefreshCw size={24} className="spinning" />
                <span>Loading actions...</span>
              </div>
            ) : tasks.length === 0 ? (
              <div className="hive-empty">
                <CheckCircle size={32} />
                <p>No active actions{selectedMemberId ? ' assigned to this member' : ''}</p>
                <span className="hive-empty-hint">Completed and archived actions are hidden</span>
              </div>
            ) : (
              <>
                <div className="tasks-count">
                  Showing {tasks.length} action{tasks.length !== 1 ? 's' : ''}
                  {selectedMemberId
                    ? ` assigned to ${members.find(m => (m.id || m._id) === selectedMemberId)?.name || members.find(m => (m.id || m._id) === selectedMemberId)?.full_name || 'selected member'}`
                    : ' (all members)'}
                </div>
                <div className="hive-tasks-list">
                  {tasks.map(task => (
                    <ActionCard
                      key={task.id}
                      action={task}
                      onSelect={handleSelectTask}
                      workspaceId={selectedWorkspace}
                      connection={connection}
                      labels={labels}
                      onComplete={handleCompleteAction}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div className="hive-chat-view">
            {isLoading && chats.length === 0 ? (
              <div className="hive-loading">
                <RefreshCw size={24} className="spinning" />
                <span>Loading chats...</span>
              </div>
            ) : chats.length === 0 ? (
              <div className="hive-empty">
                <MessageSquare size={32} />
                <p>No chats found</p>
                <span className="hive-empty-hint">Start a conversation in Hive to see it here</span>
              </div>
            ) : (
              <div className="chat-list">
                {chats.map(chat => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    onSelect={handleSelectChat}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Projects Tab */}
        {activeTab === 'projects' && (
          <ProjectsList
            projects={projects}
            isLoading={isLoading && projects.length === 0}
            onSelectProject={handleSelectProject}
          />
        )}
      </div>
    </div>
  );
}
