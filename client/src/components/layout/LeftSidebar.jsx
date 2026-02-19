import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FolderTree,
  History,
  Activity,
  ChevronDown,
  ChevronRight,
  Folder,
  FileCode,
  FileJson,
  FileText,
  File,
  Brain,
  X,
  MessageCircle,
  Archive,
  Trash2,
  Edit2,
  Check,
  PlayCircle,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  AlertCircle,
  HardDrive,
  ExternalLink,
  Image,
  Film,
  Music,
  FileSpreadsheet,
  Presentation,
  FolderOpen,
  Bug
} from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useSettings } from '../../contexts/SettingsContext';
import {
  getContextFolders,
  addContextFolder,
  removeContextFolder,
  isContextFolder
} from '../../services/localDatabase';
import { ErrorAnalyzer } from '../helper/HelperPanel';
import { listDriveFiles, getProcessedFileContent, getFileIcon as getDriveMimeIcon, formatFileSize, formatModifiedTime, isFolder, isViewableInApp } from '../../services/driveService';
import './LeftSidebar.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// File icon mapping
const getFileIcon = (fileName) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'lua':
      return <FileCode size={16} className="file-icon lua" />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return <FileCode size={16} className="file-icon js" />;
    case 'json':
      return <FileJson size={16} className="file-icon json" />;
    case 'md':
    case 'txt':
      return <FileText size={16} className="file-icon text" />;
    default:
      return <File size={16} className="file-icon default" />;
  }
};

// File tree item component
function FileTreeItem({ item, depth = 0, contextFolders, onContextFolderToggle }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(item.name);
  const { openFile, selectedFile, setSelectedFile, refreshFileTree, workspacePath } = useWorkspace();
  const menuRef = useRef(null);

  const isContextFolderPath = contextFolders.some(cf => cf.path === item.path);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowContextMenu(false);
      }
    };

    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showContextMenu]);

  const handleClick = () => {
    if (item.type === 'directory') {
      setIsExpanded(!isExpanded);
    } else {
      setSelectedFile(item.path);
      openFile(item.path, item.name);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  const handleToggleContext = async () => {
    setShowContextMenu(false);
    if (onContextFolderToggle) {
      await onContextFolderToggle(item.path, isContextFolderPath);
    }
  };

  const handleOpen = () => {
    setShowContextMenu(false);
    if (item.type === 'directory') {
      setIsExpanded(!isExpanded);
    } else {
      setSelectedFile(item.path);
      openFile(item.path, item.name);
    }
  };

  const handleDelete = async () => {
    setShowContextMenu(false);
    if (!window.confirm(`Are you sure you want to delete "${item.name}"?`)) return;
    try {
      const response = await fetch(`${API_URL}/api/files/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path })
      });
      if (response.ok) refreshFileTree();
    } catch (err) {
      console.error('Error deleting:', err);
    }
  };

  const handleRename = () => {
    setShowContextMenu(false);
    setRenameValue(item.name);
    setIsRenaming(true);
  };

  const handleRenameSubmit = async () => {
    if (!renameValue || renameValue === item.name) {
      setIsRenaming(false);
      return;
    }
    try {
      const sep = item.path.includes('/') ? '/' : '\\';
      const parts = item.path.split(sep);
      parts[parts.length - 1] = renameValue;
      const newPath = parts.join(sep);
      const response = await fetch(`${API_URL}/api/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: item.path, newPath })
      });
      if (response.ok) refreshFileTree();
    } catch (err) {
      console.error('Error renaming:', err);
    }
    setIsRenaming(false);
  };

  const handleArchive = async () => {
    setShowContextMenu(false);
    if (!window.confirm(`Archive "${item.name}"?`)) return;
    try {
      const sep = item.path.includes('/') ? '/' : '\\';
      const archivePath = workspacePath + sep + '.archive' + sep + item.name;
      // Create .archive directory first
      await fetch(`${API_URL}/api/files/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workspacePath + sep + '.archive', type: 'directory' })
      });
      // Move the file/folder
      const response = await fetch(`${API_URL}/api/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: item.path, newPath: archivePath })
      });
      if (response.ok) refreshFileTree();
    } catch (err) {
      console.error('Error archiving:', err);
    }
  };

  const isSelected = selectedFile === item.path;

  return (
    <div className="file-tree-item-wrapper">
      <div
        className={`file-tree-item ${isSelected ? 'selected' : ''} ${isContextFolderPath ? 'context-folder' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {item.type === 'directory' ? (
          <>
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={16} className={`folder-icon ${isExpanded ? 'open' : ''} ${isContextFolderPath ? 'context' : ''}`} />
            {isContextFolderPath && <Brain size={12} className="context-badge" />}
          </>
        ) : (
          <>
            <span style={{ width: 14 }} />
            {getFileIcon(item.name)}
          </>
        )}
        {isRenaming ? (
          <input
            className="file-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="file-name">{item.name}</span>
        )}
      </div>

      {showContextMenu && (
        <div
          ref={menuRef}
          className="file-context-menu"
          style={{
            position: 'fixed',
            left: menuPosition.x,
            top: menuPosition.y,
            zIndex: 1000
          }}
        >
          <button onClick={handleOpen}>
            {item.type === 'directory' ? <FolderOpen size={14} /> : <FileCode size={14} />}
            Open
          </button>
          <button onClick={handleRename}>
            <Edit2 size={14} />
            Rename
          </button>
          {item.type === 'directory' && (
            <button onClick={handleToggleContext}>
              <Brain size={14} />
              {isContextFolderPath ? 'Remove from Context' : 'Use as Context'}
            </button>
          )}
          <button onClick={handleArchive}>
            <Archive size={14} />
            Archive
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-danger" onClick={handleDelete}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}

      {item.type === 'directory' && isExpanded && item.children && (
        <div className="file-tree-children">
          {item.children.map((child, index) => (
            <FileTreeItem
              key={child.path || index}
              item={child}
              depth={depth + 1}
              contextFolders={contextFolders}
              onContextFolderToggle={onContextFolderToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Main tab component for Explorer/History
function MainTab({ id, label, icon: Icon, isActive, onClick }) {
  return (
    <button
      className={`main-sidebar-tab ${isActive ? 'active' : ''}`}
      onClick={() => onClick(id)}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
}

// Sub-tab panel for bottom section
function SidebarTab({ id, label, icon: Icon, isActive, onClick }) {
  return (
    <button
      className={`sidebar-tab ${isActive ? 'active' : ''}`}
      onClick={() => onClick(id)}
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

// Chat session item component
function ChatSessionItem({ session, isActive, onSelect, onRename, onArchive, onDelete, onToggleContext }) {
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const menuRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRename = () => {
    if (editName.trim() && editName !== session.name) {
      onRename(session.id, editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleRename();
    } else if (e.key === 'Escape') {
      setEditName(session.name);
      setIsEditing(false);
    }
  };

  const handleDelete = () => {
    if (deleteConfirmText === 'DELETE') {
      onDelete(session.id);
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={`chat-session-item ${isActive ? 'active' : ''} ${session.status}`}>
      <div className="session-main" onClick={() => onSelect(session)}>
        <div className="session-icon">
          {session.status === 'archived' ? (
            <Archive size={16} />
          ) : (
            <MessageCircle size={16} />
          )}
        </div>
        <div className="session-info">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={handleKeyDown}
              className="session-name-input"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="session-name">{session.smart_title || session.name}</span>
              {session.smart_description && (
                <span className="session-description">{session.smart_description}</span>
              )}
              <span className="session-meta">
                {session.message_count} messages • {formatDate(session.updated_at)}
              </span>
              {session.learned_points && (() => {
                try {
                  const points = typeof session.learned_points === 'string'
                    ? JSON.parse(session.learned_points)
                    : session.learned_points;
                  if (Array.isArray(points) && points.length > 0) {
                    return (
                      <div className="session-learned-points">
                        {points.map((point, i) => (
                          <span key={i} className="session-learned-point">
                            <Brain size={9} />
                            {point}
                          </span>
                        ))}
                      </div>
                    );
                  }
                } catch { /* ignore */ }
                return null;
              })()}
            </>
          )}
        </div>
        {session.use_as_context === 1 && (
          <Brain size={14} className="context-indicator" title="Used as context" />
        )}
      </div>

      <div className="session-actions">
        <button
          className="session-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
        >
          <MoreVertical size={14} />
        </button>

        {showMenu && (
          <div ref={menuRef} className="session-menu">
            <button onClick={() => { onSelect(session); setShowMenu(false); }}>
              <PlayCircle size={14} />
              Continue
            </button>
            <button onClick={() => { setIsEditing(true); setShowMenu(false); }}>
              <Edit2 size={14} />
              Rename
            </button>
            <button onClick={() => { onToggleContext(session.id, !session.use_as_context); setShowMenu(false); }}>
              <Brain size={14} />
              {session.use_as_context ? 'Remove from Context' : 'Use as Context'}
            </button>
            <button onClick={() => { onArchive(session.id); setShowMenu(false); }}>
              <Archive size={14} />
              {session.status === 'archived' ? 'Unarchive' : 'Archive'}
            </button>
            <button className="danger" onClick={() => { setShowDeleteConfirm(true); setShowMenu(false); }}>
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="delete-confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <AlertCircle size={32} className="warning-icon" />
            <h4>Delete Chat Session?</h4>
            <p>This will permanently delete "{session.name}" and remove it from the AI's memory.</p>
            <p className="delete-instruction">Type <strong>DELETE</strong> to confirm:</p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="delete-confirm-input"
              autoFocus
            />
            <div className="delete-confirm-actions">
              <button className="btn-secondary" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={handleDelete}
                disabled={deleteConfirmText !== 'DELETE'}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeftSidebar({ onSessionSelect, currentSessionId }) {
  const { settings } = useSettings();
  const [mainTab, setMainTab] = useState('explorer');
  const [activeTab, setActiveTab] = useState('gdrive');
  const [historyTab, setHistoryTab] = useState('active');
  const [contextFolders, setContextFolders] = useState([]);
  const [chatSessions, setChatSessions] = useState([]);
  const [archivedSessions, setArchivedSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [driveFiles, setDriveFiles] = useState([]);
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState(null);
  const [driveSearchQuery, setDriveSearchQuery] = useState('');
  const [driveOpeningFileId, setDriveOpeningFileId] = useState(null);
  const [tabbedHeight, setTabbedHeight] = useState(280);
  const isDragging = useRef(false);
  const sidebarRef = useRef(null);
  const { fileTree, isLoading, workspacePath, activeFile, openFiles, updateFileContent, openDriveFile } = useWorkspace();

  // Get current file content for ErrorAnalyzer
  const currentFileContent = useMemo(() => {
    if (!activeFile || !openFiles) return '';
    const file = openFiles.find(f => f.path === activeFile);
    return file?.content || '';
  }, [activeFile, openFiles]);

  const handleFixApplied = useCallback((fixedCode) => {
    if (activeFile && updateFileContent) {
      updateFileContent(activeFile, fixedCode);
    }
  }, [activeFile, updateFileContent]);

  // Resize drag handler for sidebar sections
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent) => {
      if (!isDragging.current || !sidebarRef.current) return;
      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const bottomOffset = sidebarRect.bottom - moveEvent.clientY;
      const clamped = Math.max(120, Math.min(bottomOffset, sidebarRect.height - 120));
      setTabbedHeight(clamped);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Load context folders on mount
  useEffect(() => {
    loadContextFolders();
  }, []);

  // Load chat sessions when History tab is active
  useEffect(() => {
    if (mainTab === 'history') {
      loadChatSessions();
    }
  }, [mainTab, historyTab]);

  // Load Google Drive files when GDRV tab is active (uses designated folder if set)
  const driveFolderId = settings.googleDriveFolderId || '';
  const loadDriveFiles = useCallback(async (query = '') => {
    console.log('[G-DRV] loadDriveFiles called, query:', JSON.stringify(query), 'folderId:', JSON.stringify(driveFolderId));
    setIsDriveLoading(true);
    setDriveError(null);
    try {
      const result = await listDriveFiles(query, 100, '', driveFolderId);
      console.log('[G-DRV] API result:', { fileCount: result?.files?.length ?? 0, keys: Object.keys(result || {}), isArray: Array.isArray(result) });
      setDriveFiles(result.files || result || []);
    } catch (e) {
      console.error('[G-DRV] Error loading Drive files:', e);
      setDriveError(e.message || 'Failed to load Google Drive files');
      setDriveFiles([]);
    } finally {
      setIsDriveLoading(false);
    }
  }, [driveFolderId]);

  useEffect(() => {
    if (activeTab === 'gdrive') {
      loadDriveFiles(driveSearchQuery);
    }
  }, [activeTab, loadDriveFiles, driveFolderId]);

  const loadContextFolders = async () => {
    try {
      const folders = await getContextFolders();
      setContextFolders(folders);
    } catch (error) {
      console.error('Failed to load context folders:', error);
    }
  };

  const loadChatSessions = async () => {
    setIsLoadingSessions(true);
    try {
      const activeResponse = await fetch(`${API_URL}/api/chat-sessions/sessions/active`);
      const archivedResponse = await fetch(`${API_URL}/api/chat-sessions/sessions/archived`);

      if (activeResponse.ok) {
        const activeData = await activeResponse.json();
        setChatSessions(activeData.sessions || []);
      }

      if (archivedResponse.ok) {
        const archivedData = await archivedResponse.json();
        setArchivedSessions(archivedData.sessions || []);
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const handleContextFolderToggle = async (folderPath, isCurrentlyContext) => {
    try {
      if (isCurrentlyContext) {
        await removeContextFolder(folderPath);
      } else {
        await addContextFolder(folderPath);
      }
      await loadContextFolders();
    } catch (error) {
      console.error('Failed to toggle context folder:', error);
    }
  };

  const handleSessionSelect = (session) => {
    if (onSessionSelect) {
      onSessionSelect(session);
    }
  };

  const handleRenameSession = async (sessionId, newName) => {
    try {
      const response = await fetch(`${API_URL}/api/chat-sessions/sessions/${sessionId}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      if (response.ok) {
        loadChatSessions();
      }
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  };

  const handleArchiveSession = async (sessionId) => {
    try {
      const session = chatSessions.find(s => s.id === sessionId) || archivedSessions.find(s => s.id === sessionId);
      const isArchiving = session?.status !== 'archived';
      const endpoint = isArchiving ? 'archive' : 'unarchive';

      const response = await fetch(`${API_URL}/api/chat-sessions/sessions/${sessionId}/${endpoint}`, {
        method: 'PUT'
      });
      if (response.ok) {
        // If archiving, generate an intelligent summary in the background
        if (isArchiving) {
          fetch(`${API_URL}/api/chat-sessions/sessions/${sessionId}/generate-summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }).then(() => {
            // Refresh sessions to show the new smart title/description
            loadChatSessions();
          }).catch(err => {
            console.warn('Summary generation failed (non-critical):', err.message);
          });
        }
        loadChatSessions();
      }
    } catch (error) {
      console.error('Failed to archive/unarchive session:', error);
    }
  };

  const handleDeleteSession = async (sessionId) => {
    try {
      const response = await fetch(`${API_URL}/api/chat-sessions/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' })
      });
      if (response.ok) {
        loadChatSessions();
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleToggleContext = async (sessionId, useAsContext) => {
    try {
      const response = await fetch(`${API_URL}/api/chat-sessions/sessions/${sessionId}/context`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useAsContext })
      });
      if (response.ok) {
        loadChatSessions();
      }
    } catch (error) {
      console.error('Failed to toggle context:', error);
    }
  };

  const handleCreateNewSession = async () => {
    try {
      const response = await fetch(`${API_URL}/api/chat-sessions/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `New Chat ${new Date().toLocaleString()}` })
      });
      if (response.ok) {
        const data = await response.json();
        loadChatSessions();
        if (onSessionSelect) {
          onSessionSelect(data.session);
        }
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  // Filter sessions based on search
  const filteredActiveSessions = chatSessions.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredArchivedSessions = archivedSessions.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const explorerTabs = [
    { id: 'gdrive', label: 'G-DRV', icon: HardDrive },
    { id: 'performance', label: 'Perf', icon: Activity },
    { id: 'errors', label: 'ERR', icon: Bug }
  ];

  return (
    <div className="left-sidebar" ref={sidebarRef}>
      {/* Main Tab Selector (Explorer / History) */}
      <div className="main-sidebar-tabs">
        <MainTab
          id="explorer"
          label="Explorer"
          icon={FolderTree}
          isActive={mainTab === 'explorer'}
          onClick={setMainTab}
        />
        <MainTab
          id="context"
          label="Context"
          icon={Brain}
          isActive={mainTab === 'context'}
          onClick={setMainTab}
        />
        <MainTab
          id="history"
          label="History"
          icon={History}
          isActive={mainTab === 'history'}
          onClick={setMainTab}
        />
      </div>

      {mainTab === 'explorer' && (
        <>
          {/* File Tree Section */}
          <div className="sidebar-section file-tree-section">
            <div className="file-tree-container">
              {isLoading ? (
                <div className="file-tree-loading">Loading...</div>
              ) : fileTree.length === 0 ? (
                <div className="file-tree-empty">
                  {workspacePath ? 'No files found' : 'Open a workspace folder'}
                </div>
              ) : (
                <div className="file-tree">
                  {fileTree.map((item, index) => (
                    <FileTreeItem
                      key={item.path || index}
                      item={item}
                      contextFolders={contextFolders}
                      onContextFolderToggle={handleContextFolderToggle}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Resize Handle */}
          <div
            className="sidebar-resize-handle"
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          />

          {/* Tabbed Bottom Section */}
          <div className="sidebar-section tabbed-section" style={{ height: `${tabbedHeight}px` }}>
            <div className="sidebar-tabs">
              {explorerTabs.map(tab => (
                <SidebarTab
                  key={tab.id}
                  id={tab.id}
                  label={tab.label}
                  icon={tab.icon}
                  isActive={activeTab === tab.id}
                  onClick={setActiveTab}
                />
              ))}
            </div>

            <div className="sidebar-tab-content">
              {activeTab === 'performance' && (
                <div className="tab-panel performance-panel">
                  <div className="perf-stat">
                    <span className="perf-label">CPU Usage</span>
                    <span className="perf-value">--</span>
                  </div>
                  <div className="perf-stat">
                    <span className="perf-label">Memory</span>
                    <span className="perf-value">--</span>
                  </div>
                  <div className="perf-stat">
                    <span className="perf-label">Script Time</span>
                    <span className="perf-value">--</span>
                  </div>
                  <p className="perf-note">Open a file to see performance metrics</p>
                </div>
              )}

              {activeTab === 'gdrive' && (
                <div className="tab-panel gdrive-panel">
                  {/* Search bar */}
                  <div className="gdrive-search">
                    <Search size={13} />
                    <input
                      type="text"
                      placeholder="Search Drive files..."
                      value={driveSearchQuery}
                      onChange={(e) => setDriveSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') loadDriveFiles(driveSearchQuery);
                      }}
                    />
                    <button
                      className="gdrive-refresh-btn"
                      onClick={() => loadDriveFiles(driveSearchQuery)}
                      disabled={isDriveLoading}
                      title="Refresh"
                    >
                      <RefreshCw size={12} className={isDriveLoading ? 'spinning' : ''} />
                    </button>
                  </div>

                  {/* Error state */}
                  {driveError && (
                    <div className="gdrive-error">
                      <AlertCircle size={13} />
                      <span>{driveError}</span>
                    </div>
                  )}

                  {/* File list */}
                  {isDriveLoading && driveFiles.length === 0 ? (
                    <div className="gdrive-loading">
                      <RefreshCw size={18} className="spinning" />
                      <span>Loading files...</span>
                    </div>
                  ) : driveFiles.length === 0 && !driveError ? (
                    <div className="gdrive-empty">
                      <HardDrive size={24} />
                      <p>No files found</p>
                      <span>Connect Google Drive in Settings or try a search</span>
                    </div>
                  ) : (
                    <div className="gdrive-file-list">
                      {driveFiles.map(file => {
                        const iconType = getDriveMimeIcon(file.mimeType);
                        const fileIsFolder = isFolder(file.mimeType);
                        const canViewInApp = isViewableInApp(file.mimeType);
                        const isOpening = driveOpeningFileId === file.id;
                        return (
                          <div
                            key={file.id}
                            className={`gdrive-file-item ${canViewInApp ? 'clickable' : ''} ${isOpening ? 'opening' : ''}`}
                            onClick={async () => {
                              if (fileIsFolder) return;
                              if (!canViewInApp) {
                                window.open(file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, '_blank');
                                return;
                              }
                              try {
                                setDriveOpeningFileId(file.id);
                                setDriveError(null);
                                const processed = await getProcessedFileContent(file.id);
                                if (processed.type === 'unsupported') {
                                  window.open(file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, '_blank');
                                  return;
                                }
                                openDriveFile(file.id, file.name, processed.content || processed.text || '', {
                                  fileId: file.id,
                                  fileName: file.name,
                                  mimeType: file.mimeType,
                                  type: processed.type,
                                  webViewLink: file.webViewLink,
                                  title: processed.title,
                                  html: processed.html || '',
                                  sheets: processed.sheets,
                                  sheetData: processed.sheetData,
                                  values: processed.values,
                                  description: processed.description,
                                  fileType: processed.fileType,
                                  metadata: processed.metadata
                                });
                              } catch (e) {
                                console.error('[G-DRV] Error opening file:', e);
                                setDriveError(`Failed to open ${file.name}: ${e.message}`);
                              } finally {
                                setDriveOpeningFileId(null);
                              }
                            }}
                            title={file.name}
                          >
                            <span className={`gdrive-file-icon gdrive-icon-${iconType}`}>
                              {isOpening ? <RefreshCw size={14} className="spinning" /> :
                               fileIsFolder ? <FolderOpen size={14} /> :
                               iconType === 'doc' ? <FileText size={14} /> :
                               iconType === 'sheet' ? <FileSpreadsheet size={14} /> :
                               iconType === 'slides' ? <Presentation size={14} /> :
                               iconType === 'image' ? <Image size={14} /> :
                               iconType === 'video' ? <Film size={14} /> :
                               iconType === 'audio' ? <Music size={14} /> :
                               iconType === 'pdf' ? <FileText size={14} /> :
                               iconType === 'code' ? <FileCode size={14} /> :
                               <File size={14} />
                              }
                            </span>
                            <div className="gdrive-file-info">
                              <span className="gdrive-file-name">{file.name}</span>
                              <span className="gdrive-file-meta">
                                {formatFileSize(file.size)}
                                {file.modifiedTime && ` • ${formatModifiedTime(file.modifiedTime)}`}
                              </span>
                            </div>
                            <a
                              href={file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="gdrive-file-external-link"
                              onClick={(e) => e.stopPropagation()}
                              title="Open in Google Drive"
                            >
                              <ExternalLink size={11} className="gdrive-file-link-icon" />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'errors' && (
                <div className="tab-panel errors-panel">
                  <ErrorAnalyzer
                    activeFile={activeFile}
                    fileContent={currentFileContent}
                    onFixApplied={handleFixApplied}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {mainTab === 'context' && (
        <div className="sidebar-section" style={{ flex: 1, overflow: 'auto' }}>
          <div className="tab-panel context-panel">
            {contextFolders.length === 0 ? (
              <div className="context-empty">
                <Brain size={24} />
                <p>No context folders set</p>
                <span>Right-click on a folder in the file tree to add it as AI context</span>
              </div>
            ) : (
              <>
                <div className="context-header">
                  <span>{contextFolders.length} folder(s) in AI context</span>
                </div>
                <div className="context-folders-list">
                  {contextFolders.map((folder, index) => {
                    const folderName = folder.path.split(/[/\\]/).pop();
                    return (
                      <div key={index} className="context-folder-item">
                        <Folder size={14} className="context-folder-icon" />
                        <span className="context-folder-name" title={folder.path}>
                          {folderName}
                        </span>
                        <button
                          className="context-folder-remove"
                          onClick={() => handleContextFolderToggle(folder.path, true)}
                          title="Remove from context"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="context-info">
                  <p>Files from these folders are automatically included in AI conversations for better context understanding.</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {mainTab === 'history' && (
        <div className="history-section">
          {/* History header with actions */}
          <div className="history-header">
            <div className="history-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="new-session-btn" onClick={handleCreateNewSession} title="New Session">
              <Plus size={16} />
            </button>
            <button className="refresh-btn" onClick={loadChatSessions} title="Refresh">
              <RefreshCw size={14} className={isLoadingSessions ? 'spinning' : ''} />
            </button>
          </div>

          {/* History sub-tabs */}
          <div className="history-tabs">
            <button
              className={`history-tab ${historyTab === 'active' ? 'active' : ''}`}
              onClick={() => setHistoryTab('active')}
            >
              <MessageCircle size={14} />
              Active ({chatSessions.length})
            </button>
            <button
              className={`history-tab ${historyTab === 'archived' ? 'active' : ''}`}
              onClick={() => setHistoryTab('archived')}
            >
              <Archive size={14} />
              Archived ({archivedSessions.length})
            </button>
          </div>

          {/* Sessions list */}
          <div className="sessions-list">
            {isLoadingSessions ? (
              <div className="sessions-loading">
                <RefreshCw size={20} className="spinning" />
                <span>Loading sessions...</span>
              </div>
            ) : historyTab === 'active' ? (
              filteredActiveSessions.length === 0 ? (
                <div className="sessions-empty">
                  <MessageCircle size={32} />
                  <p>No active sessions</p>
                  <span>Start a new chat to create a session</span>
                </div>
              ) : (
                filteredActiveSessions.map(session => (
                  <ChatSessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === currentSessionId}
                    onSelect={handleSessionSelect}
                    onRename={handleRenameSession}
                    onArchive={handleArchiveSession}
                    onDelete={handleDeleteSession}
                    onToggleContext={handleToggleContext}
                  />
                ))
              )
            ) : (
              filteredArchivedSessions.length === 0 ? (
                <div className="sessions-empty">
                  <Archive size={32} />
                  <p>No archived sessions</p>
                  <span>Archived sessions will appear here</span>
                </div>
              ) : (
                filteredArchivedSessions.map(session => (
                  <ChatSessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === currentSessionId}
                    onSelect={handleSessionSelect}
                    onRename={handleRenameSession}
                    onArchive={handleArchiveSession}
                    onDelete={handleDeleteSession}
                    onToggleContext={handleToggleContext}
                  />
                ))
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
