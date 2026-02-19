import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CheckSquare, RefreshCw, AlertCircle, CheckCircle, ChevronDown, ChevronRight,
  ExternalLink, Clock, X, Send, Loader, User, BookOpen, Trash2,
  Archive, Hexagon, Folder, FileText, Paperclip, MessageSquare, Mail,
  Bell, AtSign, Briefcase, Plus, Edit2, Save, Link2
} from 'lucide-react';
import {
  getTodoArchive, setTodoArchive, estimateTaskTime, estimateMentionTime,
  getTimeColor, formatFileSize, isActionableMention
} from '../../utils/todoHelpers';
import {
  getGmailMessageUrl,
  formatRelativeTime
} from '../../services/emailService';
import {
  getHiveConnection,
  fetchProjects as fetchHiveProjects,
  fetchWorkspaceMembers as fetchHiveMembers,
  fetchWorkspaces as fetchHiveWorkspaces,
  createAction as createHiveAction,
  fetchMentions,
  fetchWorkspaceMembers,
  uploadAttachmentToHiveAction
} from '../../services/hiveService';
import { useSettings } from '../../contexts/SettingsContext';
import './TodoPanel.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY: Strip HTML while preserving line breaks and extracting links
// ═══════════════════════════════════════════════════════════════════════════════

function sanitizeContent(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return { text: '', links: [] };

  // Extract links before stripping
  const links = [];
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(rawHtml)) !== null) {
    const url = linkMatch[1];
    const label = linkMatch[2].replace(/<[^>]*>/g, '').trim();
    if (url && !url.startsWith('mailto:') && !url.startsWith('#')) {
      links.push({ url, label: label || url });
    }
  }

  // Also extract standalone URLs from text
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  let urlMatch;
  const existingUrls = new Set(links.map(l => l.url));
  // Work on a copy without anchor tags to avoid double-counting
  const withoutAnchors = rawHtml.replace(/<a\s+[^>]*>[\s\S]*?<\/a>/gi, '');
  while ((urlMatch = urlRegex.exec(withoutAnchors)) !== null) {
    const url = urlMatch[0].replace(/[.,;:!?)]+$/, ''); // trim trailing punctuation
    if (!existingUrls.has(url)) {
      links.push({ url, label: url });
      existingUrls.add(url);
    }
  }

  let text = rawHtml;

  // Remove images entirely
  text = text.replace(/<img[^>]*>/gi, '');

  // Convert block-level tags to line breaks BEFORE stripping
  text = text.replace(/<\/?(p|div|br|hr|tr|li|h[1-6]|blockquote|pre|section|article|header|footer)[^>]*\/?>/gi, (match) => {
    if (/^<br\s*\/?>/i.test(match)) return '\n';
    if (/^<hr\s*\/?>/i.test(match)) return '\n---\n';
    if (/^<\/(p|div|tr|li|h[1-6]|blockquote|pre|section|article|header|footer)/i.test(match)) return '\n';
    if (/^<li/i.test(match)) return '\n• ';
    return '\n';
  });

  // Strip remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…');

  // Remove standalone URLs from the body text (they'll appear in the links section)
  if (links.length > 0) {
    links.forEach(link => {
      text = text.replace(new RegExp(link.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
    });
  }

  // Clean up excessive whitespace but preserve line breaks
  text = text.replace(/[ \t]+/g, ' '); // collapse horizontal whitespace
  text = text.replace(/\n[ \t]+/g, '\n'); // trim leading whitespace on lines
  text = text.replace(/[ \t]+\n/g, '\n'); // trim trailing whitespace on lines
  text = text.replace(/\n{3,}/g, '\n\n'); // max 2 consecutive newlines
  text = text.trim();

  return { text, links };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM TODO STORAGE (for manually added todos)
// ═══════════════════════════════════════════════════════════════════════════════

const CUSTOM_TODO_KEY = 'omnipotent_custom_todos';

function getCustomTodos() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_TODO_KEY) || '[]'); } catch { return []; }
}

function setCustomTodos(items) {
  localStorage.setItem(CUSTOM_TODO_KEY, JSON.stringify(items));
}

function addCustomTodo(todo) {
  const todos = getCustomTodos();
  const newTodo = {
    id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    subject: todo.subject || 'Untitled Task',
    preview: todo.preview || '',
    from: { name: 'Me', email: '' },
    date: new Date().toISOString(),
    source: 'custom',
    priority: todo.priority || 'medium',
    estimatedMinutes: todo.estimatedMinutes || null,
    ...todo
  };
  todos.push(newTodo);
  setCustomTodos(todos);
  return newTodo;
}

function updateCustomTodo(id, updates) {
  const todos = getCustomTodos();
  const idx = todos.findIndex(t => t.id === id);
  if (idx >= 0) {
    todos[idx] = { ...todos[idx], ...updates, updatedAt: new Date().toISOString() };
    setCustomTodos(todos);
    return todos[idx];
  }
  return null;
}

function deleteCustomTodo(id) {
  const todos = getCustomTodos().filter(t => t.id !== id);
  setCustomTodos(todos);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD / EDIT TODO MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function AddEditTodoModal({ onClose, onSave, editItem }) {
  const [subject, setSubject] = useState(editItem?.subject || '');
  const [preview, setPreview] = useState(editItem?.preview || '');
  const [priority, setPriority] = useState(editItem?.priority || 'medium');
  const [estimatedMinutes, setEstimatedMinutes] = useState(editItem?.estimatedMinutes || '');

  const handleSave = () => {
    if (!subject.trim()) return;
    onSave({
      subject: subject.trim(),
      preview: preview.trim(),
      priority,
      estimatedMinutes: estimatedMinutes ? parseInt(estimatedMinutes, 10) : null
    });
  };

  return (
    <div className="compose-modal-overlay" onClick={onClose}>
      <div className="compose-modal todo-add-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="compose-header">
          <h4>
            {editItem ? <Edit2 size={16} /> : <Plus size={16} />}
            {editItem ? ' Edit To-Do' : ' Add To-Do'}
          </h4>
          <button className="compose-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="todo-add-edit-body">
          <div className="todo-form-group">
            <label>Title *</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              autoComplete="off"
            />
          </div>

          <div className="todo-form-group">
            <label>Description</label>
            <textarea
              value={preview}
              onChange={e => setPreview(e.target.value)}
              placeholder="Add details, notes, or context..."
              rows={5}
              autoComplete="off"
            />
          </div>

          <div className="todo-form-row">
            <div className="todo-form-group todo-form-half">
              <label>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div className="todo-form-group todo-form-half">
              <label>Time Estimate (min)</label>
              <input
                type="number"
                value={estimatedMinutes}
                onChange={e => setEstimatedMinutes(e.target.value)}
                placeholder="e.g. 30"
                min="1"
                max="999"
              />
            </div>
          </div>
        </div>

        <div className="todo-add-edit-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={!subject.trim()}>
            <Save size={14} />
            {editItem ? 'Save Changes' : 'Add To-Do'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HIVE ACTION DROPDOWN (Send To-Do to Hive as an Action)
// ═══════════════════════════════════════════════════════════════════════════════

function HiveActionDropdown({ email, hiveProjects, hiveMembers, onCreateAction, isOpen, onToggle }) {
  const dropdownRef = useRef(null);
  const { settings } = useSettings();
  const [selectedProjectId, setSelectedProjectId] = useState(() => settings.hiveDefaultProjectId || '');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendPhase, setSendPhase] = useState(''); // 'creating' | 'uploading' | ''
  const [attachmentProgress, setAttachmentProgress] = useState({ current: 0, total: 0 });
  const [sent, setSent] = useState(false);
  const [attachmentErrors, setAttachmentErrors] = useState([]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onToggle(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onToggle]);

  const handleSend = async (e) => {
    e.stopPropagation();
    if (!selectedProjectId || isSending) return;
    setIsSending(true);
    setSendPhase('creating');
    setAttachmentErrors([]);
    try {
      // Build comprehensive description with all email information
      const from = email.from || {};
      const emailDate = email.date ? new Date(email.date).toLocaleString() : 'Unknown';
      const attachmentInfo = email.attachments?.length ? `\n\n**Attachments:** ${email.attachments.length} file(s)` : '';
      const threadInfo = email.threadId ? `\n**Gmail Thread:** [View Thread](https://mail.google.com/mail/u/0/#inbox/${email.id})` : '';
      
      const description = `**From:** ${from.name || 'Unknown'} <${from.email || 'unknown@email.com'}>\n**Date:** ${emailDate}${attachmentInfo}${threadInfo}\n\n---\n\n${email.preview || 'No preview available'}`;

      const result = await onCreateAction({
        title: email.subject || 'Untitled Email',
        description,
        projectId: selectedProjectId,
        assignees: selectedAssigneeId ? [selectedAssigneeId] : [],
        email,
        onProgress: (phase, progress) => {
          setSendPhase(phase);
          if (progress) setAttachmentProgress(progress);
        },
        onAttachmentError: (filename) => {
          setAttachmentErrors(prev => [...prev, filename]);
        }
      });
      setSent(true);
      const hasErrors = result?.attachmentErrors?.length > 0;
      setTimeout(() => { onToggle(false); setSent(false); setAttachmentErrors([]); }, hasErrors ? 3000 : 1500);
    } catch (err) {
      console.error('Error creating Hive action:', err);
    } finally {
      setIsSending(false);
      setSendPhase('');
    }
  };

  if (!isOpen) return null;

  const hasAttachments = email?.attachments?.length > 0;

  const getSendingLabel = () => {
    if (sendPhase === 'creating') return 'Creating action...';
    if (sendPhase === 'uploading') {
      return `Uploading ${attachmentProgress.current}/${attachmentProgress.total} files...`;
    }
    return 'Sending...';
  };

  return (
    <div className="hive-action-dropdown" ref={dropdownRef} onClick={e => e.stopPropagation()}>
      {sent ? (
        <div className="hive-action-sent">
          <CheckCircle size={16} />
          <span>
            {attachmentErrors.length > 0
              ? `Action created! ${attachmentErrors.length} attachment(s) failed.`
              : 'Sent to Hive!'}
          </span>
        </div>
      ) : (
        <>
          <div className="hive-action-dropdown-header">
            <Hexagon size={14} />
            <span>Send to Hive</span>
          </div>
          <div className="hive-action-field">
            <label><Folder size={11} /> Project</label>
            <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}>
              <option value="">Select project...</option>
              {hiveProjects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="hive-action-field">
            <label><User size={11} /> Assignee</label>
            <select value={selectedAssigneeId} onChange={e => setSelectedAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {hiveMembers.map(m => (
                <option key={m.id || m._id} value={m.id || m._id}>
                  {m.name || m.full_name || m.email || 'Unknown'}
                </option>
              ))}
            </select>
          </div>
          {hasAttachments && !isSending && (
            <div className="hive-action-attachment-notice">
              <Paperclip size={11} />
              <span>{email.attachments.length} attachment{email.attachments.length > 1 ? 's' : ''} will be uploaded</span>
            </div>
          )}
          <button
            className="hive-action-send-btn"
            onClick={handleSend}
            disabled={!selectedProjectId || isSending}
          >
            {isSending ? <Loader size={12} className="spinning" /> : <Send size={12} />}
            {isSending ? getSendingLabel() : 'Create Action'}
          </button>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TODO LIST COMPONENT (Accordion with Checkboxes + Archive)
// ═══════════════════════════════════════════════════════════════════════════════

function TodoList({ items, onArchiveItems, onShowArchiveModal, onShowDetailModal, onDeleteItem, hiveProjects, hiveMembers, onCreateHiveAction, onRefreshHive, isHiveConnected, defaultCollapsed }) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed === true);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [openHiveDropdownId, setOpenHiveDropdownId] = useState(null);

  if (!items || items.length === 0) return null;

  const sorted = [...items].sort((a, b) => {
    const timeA = a.source === 'mention' ? estimateMentionTime(a.mentionData) : (a.estimatedMinutes || estimateTaskTime(a));
    const timeB = b.source === 'mention' ? estimateMentionTime(b.mentionData) : (b.estimatedMinutes || estimateTaskTime(b));
    return timeA - timeB;
  });

  const toggleChecked = (id, e) => {
    e.stopPropagation();
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleArchive = (e) => {
    e.stopPropagation();
    if (checkedIds.size === 0) return;
    const toArchive = items.filter(em => checkedIds.has(em.id));
    if (onArchiveItems) onArchiveItems(toArchive);
    setCheckedIds(new Set());
  };

  return (
    <div className="requests-todo-list">
      <div className="requests-todo-header" onClick={() => setIsCollapsed(!isCollapsed)}>
        <div className="requests-todo-header-left">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <CheckSquare size={14} />
          <span>TO DO LIST</span>
          <span className="requests-todo-count">{items.length}</span>
        </div>
        <div className="requests-todo-header-right">
          {isHiveConnected && onRefreshHive && (
            <button
              className="todo-hive-refresh-btn"
              onClick={(e) => { e.stopPropagation(); onRefreshHive(); }}
              title="Refresh Hive projects & members"
            >
              <RefreshCw size={11} />
            </button>
          )}
          {checkedIds.size > 0 && (
            <button className="todo-archive-btn" onClick={handleArchive} title="Archive checked items">
              <Archive size={12} />
              Archive ({checkedIds.size})
            </button>
          )}
          <button
            className="todo-view-archive-btn"
            onClick={(e) => { e.stopPropagation(); if (onShowArchiveModal) onShowArchiveModal(); }}
            title="View Archive"
          >
            <BookOpen size={12} />
            View Archive
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <div className="requests-todo-items">
          {sorted.map(item => {
            const minutes = item.source === 'mention'
              ? estimateMentionTime(item.mentionData)
              : (item.estimatedMinutes || estimateTaskTime(item));
            const color = getTimeColor(minutes);
            const isChecked = checkedIds.has(item.id);
            const sourceBadge = item.source === 'mention' ? 'HIVE' : item.source === 'custom' ? 'MANUAL' : 'EMAIL';
            return (
              <div
                key={item.id}
                className={`todo-item ${isChecked ? 'checked' : ''} ${item.source === 'mention' ? 'mention-source' : ''} ${item.source === 'custom' ? 'custom-source' : ''}`}
                onClick={() => { if (onShowDetailModal) onShowDetailModal(item); }}
              >
                <input
                  type="checkbox"
                  className="todo-checkbox"
                  checked={isChecked}
                  onChange={(e) => toggleChecked(item.id, e)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="todo-time-indicator" style={{ backgroundColor: color }}>
                  <span className="todo-time-number">{minutes}</span>
                  <span className="todo-time-unit">MINS</span>
                </div>
                <div className="todo-item-info">
                  <div className="todo-item-top-row">
                    <span className="todo-item-subject">{item.subject}</span>
                  </div>
                  <span className="todo-item-from">
                    {item.source === 'mention'
                      ? (item.mentionData?.sender?.name || item.mentionData?.sender?.full_name || 'Someone')
                      : item.source === 'custom'
                        ? 'Personal task'
                        : (item.from?.name || 'Unknown')}
                  </span>
                  {item.attachments && item.attachments.length > 0 && (
                    <span className="todo-item-attachment-count">
                      <Paperclip size={10} />
                      {item.attachments.length} file{item.attachments.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {/* Source badge + action buttons column */}
                <div className="todo-item-actions-col">
                  <span className={`todo-item-source-badge ${item.source}`}>
                    {sourceBadge}
                  </span>
                  {/* Delete button for custom todos */}
                  {item.source === 'custom' && onDeleteItem && (
                    <button
                      className="todo-item-delete-btn"
                      onClick={(e) => { e.stopPropagation(); onDeleteItem(item.id); }}
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  {isHiveConnected && item.source === 'email' && (
                    <div className="todo-item-hive-wrapper">
                      <button
                        className={`todo-hive-btn ${openHiveDropdownId === item.id ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenHiveDropdownId(openHiveDropdownId === item.id ? null : item.id);
                        }}
                        title="Send to Hive"
                      >
                        <Hexagon size={13} />
                      </button>
                      <HiveActionDropdown
                        email={item}
                        hiveProjects={hiveProjects || []}
                        hiveMembers={hiveMembers || []}
                        onCreateAction={onCreateHiveAction}
                        isOpen={openHiveDropdownId === item.id}
                        onToggle={(open) => setOpenHiveDropdownId(open ? item.id : null)}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TODO ARCHIVE MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function TodoArchiveModal({ onClose, onRestore }) {
  const [archivedItems, setArchivedItems] = useState(() => getTodoArchive());
  const [selectedIds, setSelectedIds] = useState(new Set());

  const allSelected = archivedItems.length > 0 && selectedIds.size === archivedItems.length;

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(archivedItems.map(item => item.id)));
  };

  const handleRestore = () => {
    const toRestore = archivedItems.filter(item => selectedIds.has(item.id));
    const remaining = archivedItems.filter(item => !selectedIds.has(item.id));
    setTodoArchive(remaining);
    setArchivedItems(remaining);
    setSelectedIds(new Set());
    if (onRestore) onRestore(toRestore);
  };

  const handleDelete = () => {
    const remaining = archivedItems.filter(item => !selectedIds.has(item.id));
    setTodoArchive(remaining);
    setArchivedItems(remaining);
    setSelectedIds(new Set());
  };

  const handleAddTrainingData = async () => {
    const selected = archivedItems.filter(item => selectedIds.has(item.id));
    if (selected.length === 0) return;
    try {
      for (const item of selected) {
        const payload = {
          title: `Email Request: ${item.subject || 'No Subject'}`,
          description: `From ${item.from?.name || 'Unknown'} (${item.from?.email || 'unknown'})`,
          content: `Subject: ${item.subject || ''}\nFrom: ${item.from?.name || ''} <${item.from?.email || ''}>\nDate: ${item.date ? new Date(item.date).toLocaleString() : 'Unknown'}\nContent:\n${item.preview || ''}`
        };
        await fetch(`${API_URL}/api/training/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
    } catch (err) {
      console.error('Error adding training data:', err);
    }
  };

  return (
    <div className="compose-modal-overlay" onClick={onClose}>
      <div className="compose-modal todo-archive-modal" onClick={e => e.stopPropagation()}>
        <div className="compose-header">
          <h4><BookOpen size={16} /> Archived To-Do Items</h4>
          <button className="compose-close" onClick={onClose}><X size={16} /></button>
        </div>

        {archivedItems.length === 0 ? (
          <div className="todo-archive-empty">
            <Archive size={24} />
            <p>No archived items</p>
          </div>
        ) : (
          <>
            <div className="todo-archive-controls">
              <label className="todo-archive-select-all">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                Select All ({archivedItems.length})
              </label>
              {selectedIds.size > 0 && (
                <div className="todo-archive-actions">
                  <button className="todo-archive-action-btn restore-btn" onClick={handleRestore}>
                    <RefreshCw size={12} /> Restore ({selectedIds.size})
                  </button>
                  <button className="todo-archive-action-btn delete-btn" onClick={handleDelete}>
                    <Trash2 size={12} /> Delete ({selectedIds.size})
                  </button>
                  <button className="todo-archive-action-btn training-btn" onClick={handleAddTrainingData}>
                    <BookOpen size={12} /> Add as Training Data ({selectedIds.size})
                  </button>
                </div>
              )}
            </div>
            <div className="todo-archive-list">
              {archivedItems.map(item => {
                const minutes = estimateTaskTime(item);
                const color = getTimeColor(minutes);
                return (
                  <div key={item.id} className={`todo-archive-item ${selectedIds.has(item.id) ? 'selected' : ''}`}>
                    <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} />
                    <div className="todo-time-indicator" style={{ backgroundColor: color }}>
                      <span className="todo-time-number">{minutes}</span>
                      <span className="todo-time-unit">MINS</span>
                    </div>
                    <div className="todo-archive-item-info">
                      <span className="todo-item-subject">{item.subject}</span>
                      <span className="todo-item-from">{item.from?.name || 'Unknown'} - {item.from?.email || ''}</span>
                    </div>
                    <span className="todo-archive-date">{item.date ? formatRelativeTime(new Date(item.date)) : ''}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TODO DETAIL MODAL (supports both email and mention sources)
// ═══════════════════════════════════════════════════════════════════════════════

function TodoDetailModal({ item, onClose, onEdit, onDelete, threadMessages, connectedEmail, hiveProjects, hiveMembers, onCreateHiveAction, isHiveConnected, workspaceId }) {
  const { settings } = useSettings();
  const [selectedProjectId, setSelectedProjectId] = useState(() => settings.hiveDefaultProjectId || '');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [isSendingHive, setIsSendingHive] = useState(false);
  const [hiveSendPhase, setHiveSendPhase] = useState('');
  const [hiveAttachmentProgress, setHiveAttachmentProgress] = useState({ current: 0, total: 0 });
  const [hiveSent, setHiveSent] = useState(false);
  const [hiveAttachmentErrors, setHiveAttachmentErrors] = useState([]);

  if (!item) return null;

  const isMention = item.source === 'mention';
  const isCustom = item.source === 'custom';
  const mention = item.mentionData;

  const minutes = isMention
    ? estimateMentionTime(mention)
    : (item.estimatedMinutes || estimateTaskTime(item));
  const color = getTimeColor(minutes);

  // Use sanitizeContent to strip HTML while preserving line breaks and extracting links
  const rawContent = isMention
    ? (mention?.body || mention?.content || '')
    : (item.preview || '');
  const { text: contentText, links: extractedLinks } = sanitizeContent(rawContent);
  const contentLines = contentText.split('\n').filter(line => line.trim().length > 0);

  const handleSendToHive = async () => {
    if (!selectedProjectId || isSendingHive) return;
    setIsSendingHive(true);
    setHiveSendPhase('creating');
    setHiveAttachmentErrors([]);
    try {
      let title, description;

      if (isMention) {
        title = mention?.action?.title || 'Hive Mention Task';
        const senderName = mention?.sender?.name || mention?.sender?.full_name || 'Someone';
        const mentionDate = mention?.created_at 
          ? new Date(mention.created_at).toLocaleString()
          : 'Unknown';
        description = `**Mentioned by:** ${senderName}\n**Date:** ${mentionDate}\n\n---\n\n${contentText}`;
      } else {
        title = item.subject || 'Email Task';
        const from = item.from || {};
        const emailDate = item.date ? new Date(item.date).toLocaleString() : 'Unknown';
        const attachmentInfo = item.attachments?.length ? `\n\n**Attachments:** ${item.attachments.length} file(s)` : '';
        const threadInfo = item.id ? `\n**Gmail Thread:** [View Email](https://mail.google.com/mail/u/0/#inbox/${item.id})` : '';
        
        description = `**From:** ${from.name || 'Unknown'} <${from.email || 'unknown@email.com'}>\n**Date:** ${emailDate}${attachmentInfo}${threadInfo}\n\n---\n\n${item.preview || 'No preview available'}`;
      }

      const result = await onCreateHiveAction({
        title,
        description,
        projectId: selectedProjectId,
        assignees: selectedAssigneeId ? [selectedAssigneeId] : [],
        email: isMention ? null : item,
        onProgress: (phase, progress) => {
          setHiveSendPhase(phase);
          if (progress) setHiveAttachmentProgress(progress);
        },
        onAttachmentError: (filename) => {
          setHiveAttachmentErrors(prev => [...prev, filename]);
        }
      });
      setHiveSent(true);
      setTimeout(() => { setHiveSent(false); setHiveAttachmentErrors([]); }, 3000);
    } catch (err) {
      console.error('Error creating Hive action from detail modal:', err);
    } finally {
      setIsSendingHive(false);
      setHiveSendPhase('');
    }
  };

  const getHiveSendingLabel = () => {
    if (hiveSendPhase === 'creating') return 'Creating action...';
    if (hiveSendPhase === 'uploading') {
      return `Uploading ${hiveAttachmentProgress.current}/${hiveAttachmentProgress.total} files...`;
    }
    return 'Sending...';
  };

  return (
    <div className="compose-modal-overlay" onClick={onClose}>
      <div className="compose-modal todo-archive-modal todo-detail-modal-full" onClick={e => e.stopPropagation()}>
        <div className="compose-header">
          <h4>
            {isMention ? <AtSign size={16} /> : isCustom ? <CheckSquare size={16} /> : <FileText size={16} />}
            {isMention ? ' Mention Detail' : isCustom ? ' Task Detail' : ' To-Do Detail'}
          </h4>
          <div className="compose-header-actions">
            {isCustom && onEdit && (
              <button className="todo-detail-edit-btn" onClick={() => onEdit(item)} title="Edit">
                <Edit2 size={14} />
              </button>
            )}
            {isCustom && onDelete && (
              <button className="todo-detail-delete-btn" onClick={() => onDelete(item.id)} title="Delete">
                <Trash2 size={14} />
              </button>
            )}
            <button className="compose-close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="todo-detail-content">
          {/* Meta info section */}
          <div className="todo-detail-meta">
            {isMention ? (
              <>
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><User size={12} /> From:</span>
                  <span className="todo-detail-value">{mention?.sender?.name || mention?.sender?.full_name || 'Unknown'}</span>
                </div>
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><Briefcase size={12} /> Action:</span>
                  <span className="todo-detail-value todo-detail-subject">{mention?.action?.title || 'Unknown Action'}</span>
                </div>
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><Clock size={12} /> Date:</span>
                  <span className="todo-detail-value">
                    {mention?.created_at
                      ? new Date(mention.created_at).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                        }) + ' at ' + new Date(mention.created_at).toLocaleTimeString('en-US', {
                          hour: '2-digit', minute: '2-digit'
                        })
                      : 'Unknown'}
                  </span>
                </div>
              </>
            ) : isCustom ? (
              <>
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><CheckSquare size={12} /> Task:</span>
                  <span className="todo-detail-value todo-detail-subject">{item.subject}</span>
                </div>
                {item.priority && (
                  <div className="todo-detail-row">
                    <span className="todo-detail-label"><AlertCircle size={12} /> Priority:</span>
                    <span className={`todo-detail-value todo-priority-badge ${item.priority}`}>
                      {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
                    </span>
                  </div>
                )}
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><Clock size={12} /> Created:</span>
                  <span className="todo-detail-value">
                    {item.date
                      ? new Date(item.date).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                        }) + ' at ' + new Date(item.date).toLocaleTimeString('en-US', {
                          hour: '2-digit', minute: '2-digit'
                        })
                      : 'Unknown'}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><User size={12} /> From:</span>
                  <span className="todo-detail-value">{item.from?.name || 'Unknown'}</span>
                </div>
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><Mail size={12} /> Email:</span>
                  <span className="todo-detail-value">{item.from?.email || ''}</span>
                </div>
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><FileText size={12} /> Subject:</span>
                  <span className="todo-detail-value todo-detail-subject">{item.subject}</span>
                </div>
                <div className="todo-detail-row">
                  <span className="todo-detail-label"><Clock size={12} /> Date:</span>
                  <span className="todo-detail-value">
                    {item.date
                      ? new Date(item.date).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                        }) + ' at ' + new Date(item.date).toLocaleTimeString('en-US', {
                          hour: '2-digit', minute: '2-digit'
                        })
                      : 'Unknown'}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="todo-detail-time-badge" style={{ backgroundColor: color }}>
            <Clock size={12} />
            Estimated: {minutes} MINS
          </div>

          {/* Content */}
          <div className="todo-detail-body">
            <h5>Content</h5>
            {contentLines.length > 0 ? (
              <div className="todo-detail-content-text">
                {contentLines.map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
              </div>
            ) : (
              <p className="todo-detail-empty">No preview content available.</p>
            )}
          </div>

          {/* Extracted Links */}
          {extractedLinks.length > 0 && (
            <div className="todo-detail-links">
              <h5><Link2 size={14} /> Links ({extractedLinks.length})</h5>
              <div className="todo-detail-links-list">
                {extractedLinks.map((link, idx) => (
                  <a
                    key={idx}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="todo-detail-link-item"
                  >
                    <ExternalLink size={11} />
                    <span className="todo-detail-link-label">{link.label}</span>
                    {link.label !== link.url && (
                      <span className="todo-detail-link-url">{link.url}</span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Attachments (email only) */}
          {!isMention && item.attachments && item.attachments.length > 0 && (
            <div className="todo-detail-attachments">
              <h5><Paperclip size={14} /> Attachments ({item.attachments.length})</h5>
              <div className="todo-detail-attachments-list">
                {item.attachments.map((att, idx) => (
                  <div key={idx} className="todo-detail-attachment-item">
                    <FileText size={14} />
                    <span className="todo-detail-attachment-name">{att.filename}</span>
                    <span className="todo-detail-attachment-size">{formatFileSize(att.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Thread Messages (email only) */}
          {!isMention && threadMessages && threadMessages.length > 0 && (
            <div className="todo-detail-thread">
              <h5><MessageSquare size={14} /> Thread Messages ({threadMessages.length})</h5>
              {[...threadMessages].sort((a, b) => new Date(b.date) - new Date(a.date)).map((msg, idx) => (
                <div key={msg.id || idx} className="todo-detail-thread-msg">
                  <span className="todo-detail-thread-from">{msg.from?.name || msg.from || 'Unknown'}</span>
                  <span className="todo-detail-thread-date">{msg.date ? formatRelativeTime(new Date(msg.date)) : ''}</span>
                  <p className="todo-detail-thread-snippet">{msg.preview || msg.snippet || ''}</p>
                </div>
              ))}
            </div>
          )}

          {/* Hive Integration Section */}
          {isHiveConnected && (
            <div className="todo-detail-hive-section">
              <h5><Hexagon size={14} /> Send to Hive</h5>
              {hiveSent ? (
                <div className="hive-action-sent">
                  <CheckCircle size={16} />
                  <span>
                    {hiveAttachmentErrors.length > 0
                      ? `Action created! ${hiveAttachmentErrors.length} attachment(s) failed to upload.`
                      : 'Action created in Hive!'}
                  </span>
                </div>
              ) : (
                <div className="todo-detail-hive-form">
                  <div className="todo-detail-hive-field">
                    <label><Folder size={12} /> Project</label>
                    <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}>
                      <option value="">Select project...</option>
                      {(hiveProjects || []).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="todo-detail-hive-field">
                    <label><User size={12} /> Assignee</label>
                    <select value={selectedAssigneeId} onChange={e => setSelectedAssigneeId(e.target.value)}>
                      <option value="">Unassigned</option>
                      {(hiveMembers || []).map(m => (
                        <option key={m.id || m._id} value={m.id || m._id}>
                          {m.name || m.full_name || m.email || 'Unknown'}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!isMention && item.attachments && item.attachments.length > 0 && !isSendingHive && (
                    <div className="hive-action-attachment-notice">
                      <Paperclip size={11} />
                      <span>{item.attachments.length} attachment{item.attachments.length > 1 ? 's' : ''} will be uploaded to the action</span>
                    </div>
                  )}
                  <button
                    className="hive-action-send-btn"
                    onClick={handleSendToHive}
                    disabled={!selectedProjectId || isSendingHive}
                  >
                    {isSendingHive ? <Loader size={12} className="spinning" /> : <Send size={12} />}
                    {isSendingHive ? getHiveSendingLabel() : 'Create Hive Action'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Action link */}
          {isMention && mention?.action?.id && workspaceId ? (
            <a
              className="email-open-btn"
              href={`https://app.hive.com/workspace/${workspaceId}/action/${mention.action.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />
              View in Hive
            </a>
          ) : !isMention && !isCustom ? (
            <a
              className="email-open-btn"
              href={getGmailMessageUrl(item.id, connectedEmail || '')}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />
              Open in Gmail
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARCHIVE GROUP COMPONENT (bottom of todo panel)
// ═══════════════════════════════════════════════════════════════════════════════

function ArchiveGroup() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [archivedItems, setArchivedItems] = useState(() => getTodoArchive());
  const [selectedIds, setSelectedIds] = useState(new Set());

  const handleToggle = () => {
    if (isCollapsed) setArchivedItems(getTodoArchive());
    setIsCollapsed(!isCollapsed);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    const remaining = archivedItems.filter(item => !selectedIds.has(item.id));
    setTodoArchive(remaining);
    setArchivedItems(remaining);
    setSelectedIds(new Set());
  };

  const handleDeleteSingle = (id) => {
    const remaining = archivedItems.filter(item => item.id !== id);
    setTodoArchive(remaining);
    setArchivedItems(remaining);
    selectedIds.delete(id);
    setSelectedIds(new Set(selectedIds));
  };

  if (archivedItems.length === 0) return null;

  return (
    <div className="todo-archive-group">
      <div className="todo-archive-group-header" onClick={handleToggle} style={{ borderLeftColor: '#6b7280' }}>
        <div className="todo-archive-group-left">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <Archive size={14} style={{ color: '#6b7280' }} />
          <span>Archived Items</span>
        </div>
        <span className="todo-archive-group-count">{archivedItems.length}</span>
      </div>

      {!isCollapsed && (
        <div className="todo-archive-group-content">
          {selectedIds.size > 0 && (
            <div className="archive-group-bulk-actions">
              <button className="todo-archive-action-btn delete-btn" onClick={handleBulkDelete}>
                <Trash2 size={12} /> Delete Selected ({selectedIds.size})
              </button>
            </div>
          )}
          {archivedItems.map(item => (
            <div key={item.id} className="archive-group-item">
              <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} />
              <div className="archive-group-item-info">
                <span className="archive-group-item-subject">{item.subject || 'No Subject'}</span>
                <span className="archive-group-item-from">{item.from?.name || 'Unknown'} - {item.from?.email || ''}</span>
              </div>
              <span className="archive-group-item-date">{item.date ? formatRelativeTime(new Date(item.date)) : ''}</span>
              <button className="archive-group-delete-btn" onClick={() => handleDeleteSingle(item.id)} title="Delete">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN TODO PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function TodoPanel({ todoEmails, threadCache, connectedEmail, onArchiveTodoItems, onRestoreFromArchive }) {
  const { settings } = useSettings();

  // Hive integration state (loaded independently)
  const [hiveProjects, setHiveProjects] = useState([]);
  const [hiveMembers, setHiveMembers] = useState([]);
  const [hiveWorkspaceId, setHiveWorkspaceId] = useState(null);
  const [hiveConnection, setHiveConnection] = useState(null);

  // Mention todos from Hive
  const [mentionTodos, setMentionTodos] = useState([]);
  const [isMentionsLoading, setIsMentionsLoading] = useState(false);
  const [mentionsError, setMentionsError] = useState(null);

  // Custom todos
  const [customTodos, setCustomTodos] = useState(() => getCustomTodos());

  // Modals
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(null);
  const [showAddEditModal, setShowAddEditModal] = useState(null); // null | {} for new | item for edit

  // Load Hive data on mount
  const loadHiveData = useCallback(async () => {
    const conn = getHiveConnection();
    if (!conn || !conn.apiKey || !conn.userId) {
      setHiveConnection(null);
      return;
    }
    setHiveConnection(conn);
    try {
      const workspaces = await fetchHiveWorkspaces(conn.apiKey, conn.userId);
      if (workspaces && workspaces.length > 0) {
        const wsId = workspaces[0].id || workspaces[0]._id;
        setHiveWorkspaceId(wsId);

        const [projects, members] = await Promise.all([
          fetchHiveProjects(conn.apiKey, conn.userId, wsId),
          fetchHiveMembers(conn.apiKey, conn.userId, wsId)
        ]);

        setHiveProjects(Array.isArray(projects) ? projects : []);
        setHiveMembers(Array.isArray(members) ? members : []);

        // Also load mentions
        await loadMentions(conn, wsId, members);
      }
    } catch (err) {
      console.error('TodoPanel: Error loading Hive data:', err);
    }
  }, []);

  // Load actionable Hive mentions
  const loadMentions = useCallback(async (conn, wsId, membersData) => {
    if (!conn?.apiKey || !conn?.userId || !wsId) return;

    setIsMentionsLoading(true);
    setMentionsError(null);

    try {
      // Find current user from members
      const uid = conn.userId;
      let me = (membersData || []).find(m =>
        (m.id && m.id === uid) ||
        (m._id && m._id === uid) ||
        (m.userId && m.userId === uid) ||
        (m.user_id && m.user_id === uid)
      );

      if (!me && uid.includes('@')) {
        me = (membersData || []).find(m =>
          (m.email && m.email.toLowerCase() === uid.toLowerCase()) ||
          (m.emails && m.emails.some(e => e.toLowerCase() === uid.toLowerCase()))
        );
      }

      if (!me && (membersData || []).length === 1) {
        me = membersData[0];
      }

      const userName = me?.name || me?.full_name || me?.fullName || me?.username || me?.display_name || null;

      if (!userName) {
        console.log('TodoPanel: Could not determine user name for mention scanning');
        setIsMentionsLoading(false);
        return;
      }

      const mentions = await fetchMentions(conn.apiKey, conn.userId, wsId, userName);

      // Filter to actionable mentions only
      const actionable = mentions.filter(m => isActionableMention(m));

      // Convert to unified todo item format
      const mentionItems = actionable.map(mention => ({
        id: `mention-${mention.id}`,
        subject: mention.action?.title || 'Hive Mention',
        preview: (mention.body || mention.content || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(),
        from: {
          name: mention.sender?.name || mention.sender?.full_name || 'Someone',
          email: ''
        },
        date: mention.created_at || mention.createdAt,
        source: 'mention',
        mentionData: mention,
        tag: { id: 'mention', label: 'Hive Mention', color: '#f59e0b', icon: 'bell' }
      }));

      setMentionTodos(mentionItems);
    } catch (err) {
      console.error('TodoPanel: Error loading mentions:', err);
      setMentionsError('Failed to load Hive mentions');
    } finally {
      setIsMentionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHiveData();
  }, [loadHiveData]);

  const handleRefreshHive = useCallback(() => {
    loadHiveData();
  }, [loadHiveData]);

  const handleCreateHiveAction = useCallback(async ({ title, description, projectId, assignees, email: sourceEmail, onProgress, onAttachmentError }) => {
    if (!hiveConnection || !hiveWorkspaceId) return;

    // Phase 1: Create the Hive action
    if (onProgress) onProgress('creating', null);

    const actionData = {
      title,
      description: description || '',
      project_id: projectId,
      assignees: assignees || []
    };
    const result = await createHiveAction(hiveConnection.apiKey, hiveConnection.userId, hiveWorkspaceId, actionData);
    if (!result) throw new Error('Failed to create Hive action');

    // Phase 2: Upload email attachments to the created Hive action
    const actionId = result.id || result._id;
    const attachmentErrors = [];

    if (actionId && sourceEmail?.attachments?.length > 0) {
      const attachments = sourceEmail.attachments;
      const total = attachments.length;

      if (onProgress) onProgress('uploading', { current: 0, total });

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        try {
          await uploadAttachmentToHiveAction({
            messageId: sourceEmail.id,
            attachmentId: att.attachmentId,
            filename: att.filename,
            mimeType: att.mimeType,
            hiveActionId: actionId,
            hiveApiKey: hiveConnection.apiKey,
            hiveUserId: hiveConnection.userId
          });
          if (onProgress) onProgress('uploading', { current: i + 1, total });
        } catch (err) {
          console.error(`Failed to upload attachment ${att.filename}:`, err);
          attachmentErrors.push(att.filename);
          if (onAttachmentError) onAttachmentError(att.filename);
          // Continue uploading remaining attachments even if one fails
          if (onProgress) onProgress('uploading', { current: i + 1, total });
        }
      }

      if (attachmentErrors.length > 0) {
        console.warn(`Hive action created but ${attachmentErrors.length}/${total} attachments failed to upload`);
      } else {
        console.log(`All ${total} attachments uploaded successfully to Hive action ${actionId}`);
      }
    }

    result.attachmentErrors = attachmentErrors;
    return result;
  }, [hiveConnection, hiveWorkspaceId]);

  // Handle adding a custom todo
  const handleAddTodo = useCallback((todoData) => {
    const newTodo = addCustomTodo(todoData);
    setCustomTodos(getCustomTodos());
    setShowAddEditModal(null);
  }, []);

  // Handle editing a custom todo
  const handleEditTodo = useCallback((todoData) => {
    if (!showAddEditModal?.id) return;
    updateCustomTodo(showAddEditModal.id, todoData);
    setCustomTodos(getCustomTodos());
    setShowAddEditModal(null);
    setShowDetailModal(null);
  }, [showAddEditModal]);

  // Handle deleting a custom todo
  const handleDeleteTodo = useCallback((id) => {
    deleteCustomTodo(id);
    setCustomTodos(getCustomTodos());
    setShowDetailModal(null);
  }, []);

  // Handle archiving todo items
  const handleArchiveItems = useCallback(async (itemsToArchive) => {
    // Separate email items from mention items
    const emailItems = itemsToArchive.filter(i => i.source !== 'mention');
    const mentionItems = itemsToArchive.filter(i => i.source === 'mention');

    // Archive email items via parent callback
    if (emailItems.length > 0 && onArchiveTodoItems) {
      await onArchiveTodoItems(emailItems);
    }

    // Remove mention items from local state (just hide them)
    if (mentionItems.length > 0) {
      const mentionIds = new Set(mentionItems.map(i => i.id));
      setMentionTodos(prev => prev.filter(m => !mentionIds.has(m.id)));
    }
  }, [onArchiveTodoItems]);

  // Combine email todos + mention todos + custom todos
  const allTodoItems = useMemo(() => {
    const emailItems = (todoEmails || []).map(e => ({ ...e, source: 'email' }));
    return [...emailItems, ...mentionTodos, ...customTodos];
  }, [todoEmails, mentionTodos, customTodos]);

  return (
    <div className="todo-panel">
      {/* Header */}
      <div className="todo-panel-header">
        <div className="todo-header-left-section">
          <CheckSquare size={18} />
          <h3>To Do</h3>
          {allTodoItems.length > 0 && (
            <span className="todo-total-count">{allTodoItems.length}</span>
          )}
        </div>
        <div className="todo-header-right-section">
          {isMentionsLoading && <Loader size={14} className="spinning" />}
          <button
            className="todo-add-btn"
            onClick={() => setShowAddEditModal({})}
            title="Add new to-do"
          >
            <Plus size={14} />
          </button>
          <button
            className="todo-refresh-btn"
            onClick={handleRefreshHive}
            title="Refresh Hive mentions & projects"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Error */}
      {mentionsError && (
        <div className="todo-error">
          <AlertCircle size={14} />
          <span>{mentionsError}</span>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddEditModal && (
        <AddEditTodoModal
          onClose={() => setShowAddEditModal(null)}
          onSave={showAddEditModal.id ? handleEditTodo : handleAddTodo}
          editItem={showAddEditModal.id ? showAddEditModal : null}
        />
      )}

      {/* Archive Modal */}
      {showArchiveModal && (
        <TodoArchiveModal
          onClose={() => setShowArchiveModal(false)}
          onRestore={onRestoreFromArchive}
        />
      )}

      {/* Detail Modal */}
      {showDetailModal && (
        <TodoDetailModal
          item={showDetailModal}
          onClose={() => setShowDetailModal(null)}
          onEdit={(item) => {
            setShowDetailModal(null);
            setShowAddEditModal(item);
          }}
          onDelete={(id) => {
            handleDeleteTodo(id);
            setShowDetailModal(null);
          }}
          threadMessages={showDetailModal.threadId ? (threadCache || {})[showDetailModal.threadId] : null}
          connectedEmail={connectedEmail}
          hiveProjects={hiveProjects}
          hiveMembers={hiveMembers}
          onCreateHiveAction={handleCreateHiveAction}
          isHiveConnected={!!hiveConnection}
          workspaceId={hiveWorkspaceId}
        />
      )}

      {/* Content */}
      <div className="todo-panel-content">
        {allTodoItems.length === 0 && !isMentionsLoading ? (
          <div className="todo-empty">
            <CheckCircle size={32} />
            <p>No to-do items</p>
            <span className="todo-empty-hint">
              Add tasks manually, or emails tagged as requests and Hive @mentions will appear here
            </span>
            <button
              className="todo-empty-add-btn"
              onClick={() => setShowAddEditModal({})}
            >
              <Plus size={14} />
              Add a To-Do
            </button>
          </div>
        ) : (
          <>
            <TodoList
              items={allTodoItems}
              onArchiveItems={handleArchiveItems}
              onShowArchiveModal={() => setShowArchiveModal(true)}
              onShowDetailModal={(item) => setShowDetailModal(item)}
              onDeleteItem={handleDeleteTodo}
              hiveProjects={hiveProjects}
              hiveMembers={hiveMembers}
              onCreateHiveAction={handleCreateHiveAction}
              onRefreshHive={handleRefreshHive}
              isHiveConnected={!!hiveConnection}
              defaultCollapsed={settings.todoListCollapsed === true}
            />
            <ArchiveGroup />
          </>
        )}
      </div>
    </div>
  );
}
