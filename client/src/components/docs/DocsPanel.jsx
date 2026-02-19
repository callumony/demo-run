import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, FileText, Table, File, Search, RefreshCw,
  ChevronRight, ArrowLeft, ExternalLink, Settings, Loader,
  AlertCircle, Image, Film, Music, Code, Archive, X,
  HardDrive
} from 'lucide-react';
import {
  listDriveFiles,
  getFileContent,
  getFileIcon,
  isPreviewable,
  isFolder,
  formatFileSize,
  formatModifiedTime
} from '../../services/driveService';
import { getGmailConnectionStatus } from '../../services/emailService';
import './DocsPanel.css';

// ═══════════════════════════════════════════════════════════════════════════════
// FILE ICON COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function FileIcon({ mimeType, size = 16 }) {
  const iconType = getFileIcon(mimeType);
  const iconMap = {
    folder: <FolderOpen size={size} className="drive-icon-folder" />,
    doc: <FileText size={size} className="drive-icon-doc" />,
    sheet: <Table size={size} className="drive-icon-sheet" />,
    slides: <File size={size} className="drive-icon-slides" />,
    form: <FileText size={size} className="drive-icon-form" />,
    drawing: <Image size={size} className="drive-icon-drawing" />,
    pdf: <FileText size={size} className="drive-icon-pdf" />,
    image: <Image size={size} className="drive-icon-image" />,
    video: <Film size={size} className="drive-icon-video" />,
    audio: <Music size={size} className="drive-icon-audio" />,
    text: <FileText size={size} className="drive-icon-text" />,
    html: <Code size={size} className="drive-icon-code" />,
    csv: <Table size={size} className="drive-icon-csv" />,
    archive: <Archive size={size} className="drive-icon-archive" />,
    code: <Code size={size} className="drive-icon-code" />,
    file: <File size={size} className="drive-icon-file" />
  };
  return iconMap[iconType] || iconMap.file;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BREADCRUMB COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function Breadcrumb({ path, onNavigate }) {
  return (
    <div className="drive-breadcrumb">
      <button
        className={`drive-breadcrumb-item ${path.length === 0 ? 'active' : ''}`}
        onClick={() => onNavigate([])}
      >
        <HardDrive size={12} />
        <span>My Drive</span>
      </button>
      {path.map((item, index) => (
        <span key={item.id} className="drive-breadcrumb-segment">
          <ChevronRight size={12} className="drive-breadcrumb-sep" />
          <button
            className={`drive-breadcrumb-item ${index === path.length - 1 ? 'active' : ''}`}
            onClick={() => onNavigate(path.slice(0, index + 1))}
          >
            <span>{item.name}</span>
          </button>
        </span>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT PREVIEW COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function DocumentPreview({ content, onClose }) {
  if (!content) return null;

  return (
    <div className="drive-preview">
      <div className="drive-preview-header">
        <button className="drive-preview-back" onClick={onClose}>
          <ArrowLeft size={14} />
          <span>Back to files</span>
        </button>
        <span className="drive-preview-title">{content.title || content.name}</span>
        {content.webViewLink && (
          <a
            href={content.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="drive-preview-external"
            title="Open in Google"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      <div className="drive-preview-content">
        {content.type === 'document' && (
          <div className="drive-doc-content">
            {content.text ? (
              content.text.split('\n').map((line, i) => (
                <p key={i} className={line.trim() === '' ? 'drive-doc-empty-line' : ''}>
                  {line || '\u00A0'}
                </p>
              ))
            ) : (
              <p className="drive-doc-empty">This document is empty.</p>
            )}
          </div>
        )}

        {content.type === 'spreadsheet' && (
          <div className="drive-sheet-content">
            {content.sheets && content.sheets.length > 0 && (
              <div className="drive-sheet-tabs">
                {content.sheets.map(sheet => (
                  <span key={sheet.id} className="drive-sheet-tab">
                    {sheet.title}
                  </span>
                ))}
              </div>
            )}
            {content.values && content.values.length > 0 ? (
              <div className="drive-sheet-table-wrapper">
                <table className="drive-sheet-table">
                  <thead>
                    <tr>
                      {content.values[0].map((cell, i) => (
                        <th key={i}>{cell}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {content.values.slice(1).map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        {row.map((cell, cellIdx) => (
                          <td key={cellIdx}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="drive-sheet-empty">This spreadsheet is empty.</p>
            )}
          </div>
        )}

        {content.type === 'other' && (
          <div className="drive-other-content">
            <File size={48} />
            <p>This file type cannot be previewed inline.</p>
            {content.webViewLink && (
              <a
                href={content.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="drive-open-link"
              >
                <ExternalLink size={14} />
                <span>Open in Google Drive</span>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DOCS PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function DocsPanel() {
  const [connection, setConnection] = useState(null);
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderPath, setFolderPath] = useState([]); // [{ id, name }, ...]
  const [preview, setPreview] = useState(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [nextPageToken, setNextPageToken] = useState(null);

  // Check Google connection on mount
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
  }, []);

  // Current folder ID (last in path, or empty for root)
  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : '';

  // Fetch files when connection/folder changes
  const loadFiles = useCallback(async (folderId = '', search = '') => {
    if (!connection?.connected) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await listDriveFiles(search, 50, '', folderId);
      setFiles(result.files || []);
      setNextPageToken(result.nextPageToken || null);
    } catch (e) {
      console.error('Error loading Drive files:', e);
      setError(e.message || 'Failed to load files');
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [connection]);

  // Load files when connection is ready or folder changes
  useEffect(() => {
    if (connection?.connected) {
      loadFiles(currentFolderId, searchQuery);
    }
  }, [connection, currentFolderId, loadFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle search
  const handleSearch = useCallback((e) => {
    if (e.key === 'Enter') {
      setFolderPath([]); // Reset to root for search
      loadFiles('', searchQuery);
    }
  }, [searchQuery, loadFiles]);

  // Handle folder navigation
  const navigateToFolder = useCallback((file) => {
    setSearchQuery('');
    setPreview(null);
    setFolderPath(prev => [...prev, { id: file.id, name: file.name }]);
  }, []);

  // Handle breadcrumb navigation
  const navigateToBreadcrumb = useCallback((newPath) => {
    setSearchQuery('');
    setPreview(null);
    setFolderPath(newPath);
  }, []);

  // Handle file click
  const handleFileClick = useCallback(async (file) => {
    if (isFolder(file.mimeType)) {
      navigateToFolder(file);
      return;
    }

    if (isPreviewable(file.mimeType)) {
      setIsLoadingPreview(true);
      try {
        const content = await getFileContent(file.id);
        content.webViewLink = file.webViewLink;
        setPreview(content);
      } catch (e) {
        console.error('Error loading file content:', e);
        setError(`Failed to load preview: ${e.message}`);
      } finally {
        setIsLoadingPreview(false);
      }
      return;
    }

    // For other files, open in Google Drive
    if (file.webViewLink) {
      window.open(file.webViewLink, '_blank');
    }
  }, [navigateToFolder]);

  // Refresh current view
  const handleRefresh = useCallback(() => {
    loadFiles(currentFolderId, searchQuery);
  }, [currentFolderId, searchQuery, loadFiles]);

  // Load more files (pagination)
  const loadMore = useCallback(async () => {
    if (!nextPageToken || isLoading) return;

    setIsLoading(true);
    try {
      const result = await listDriveFiles(searchQuery, 50, nextPageToken, currentFolderId);
      setFiles(prev => [...prev, ...(result.files || [])]);
      setNextPageToken(result.nextPageToken || null);
    } catch (e) {
      console.error('Error loading more files:', e);
    } finally {
      setIsLoading(false);
    }
  }, [nextPageToken, isLoading, searchQuery, currentFolderId]);

  // ─── Not Connected State ───
  if (!connection || !connection.connected) {
    return (
      <div className="drive-panel">
        <div className="drive-not-connected">
          <HardDrive size={48} />
          <h3>Connect Google Drive</h3>
          <p>Connect your Google account in Settings to browse your Drive files here.</p>
          <div className="drive-connect-hint">
            <Settings size={14} />
            <span>Go to Settings → Integrations → Gmail</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Preview Mode ───
  if (preview) {
    return (
      <div className="drive-panel">
        <DocumentPreview content={preview} onClose={() => setPreview(null)} />
      </div>
    );
  }

  // ─── File Browser ───
  return (
    <div className="drive-panel">
      {/* Header */}
      <div className="drive-header">
        <div className="drive-header-left">
          <HardDrive size={16} />
          <h3>Google Drive</h3>
        </div>
        <div className="drive-header-right">
          <button
            className={`drive-refresh-btn ${isLoading ? 'spinning' : ''}`}
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="drive-search">
        <Search size={14} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearch}
          placeholder="Search files... (Enter to search)"
        />
        {searchQuery && (
          <button
            className="drive-search-clear"
            onClick={() => {
              setSearchQuery('');
              loadFiles(currentFolderId, '');
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Breadcrumb */}
      <Breadcrumb path={folderPath} onNavigate={navigateToBreadcrumb} />

      {/* Error */}
      {error && (
        <div className="drive-error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      {/* Loading Preview Overlay */}
      {isLoadingPreview && (
        <div className="drive-loading-overlay">
          <Loader size={20} className="spinning" />
          <span>Loading preview...</span>
        </div>
      )}

      {/* File List */}
      <div className="drive-file-list">
        {isLoading && files.length === 0 ? (
          <div className="drive-loading">
            <Loader size={24} className="spinning" />
            <span>Loading files...</span>
          </div>
        ) : files.length === 0 ? (
          <div className="drive-empty">
            <FolderOpen size={32} />
            <p>{searchQuery ? 'No files found' : 'This folder is empty'}</p>
            {searchQuery && <span>Try a different search term</span>}
          </div>
        ) : (
          <>
            {files.map(file => (
              <div
                key={file.id}
                className={`drive-file-item ${isFolder(file.mimeType) ? 'is-folder' : ''} ${isPreviewable(file.mimeType) ? 'is-previewable' : ''}`}
                onClick={() => handleFileClick(file)}
              >
                <FileIcon mimeType={file.mimeType} size={16} />
                <div className="drive-file-info">
                  <span className="drive-file-name">{file.name}</span>
                  <span className="drive-file-meta">
                    {formatModifiedTime(file.modifiedTime)}
                    {file.size ? ` · ${formatFileSize(file.size)}` : ''}
                  </span>
                </div>
                <div className="drive-file-actions">
                  {isFolder(file.mimeType) ? (
                    <ChevronRight size={14} className="drive-file-arrow" />
                  ) : file.webViewLink ? (
                    <a
                      href={file.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="drive-file-external"
                      onClick={(e) => e.stopPropagation()}
                      title="Open in Google Drive"
                    >
                      <ExternalLink size={12} />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}

            {nextPageToken && (
              <button
                className="drive-load-more"
                onClick={loadMore}
                disabled={isLoading}
              >
                {isLoading ? <Loader size={14} className="spinning" /> : 'Load more files'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
