// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE SERVICE - Google Drive / Docs / Sheets Integration (read-only)
// Client-side fetch wrappers for backend API proxy
// ═══════════════════════════════════════════════════════════════════════════════

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3001';

// ═══════════════════════════════════════════════════════════════════════════════
// SAFE JSON PARSER - prevents "Unexpected token '<'" errors
// ═══════════════════════════════════════════════════════════════════════════════

async function safeJsonParse(response, context = '') {
  const contentType = response.headers.get('content-type') || '';

  // If content type isn't JSON, read as text and provide a clear error
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      throw new Error('Google account not connected. Please connect via Settings → Integrations.');
    }
    throw new Error(`${context}: unexpected response (${response.status})`);
  }

  return await response.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE FILE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * List/search files from Google Drive
 */
export async function listDriveFiles(query = '', pageSize = 50, pageToken = '', folderId = '') {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (pageSize) params.set('pageSize', String(pageSize));
  if (pageToken) params.set('pageToken', pageToken);
  if (folderId) params.set('folderId', folderId);

  const url = `${API_URL}/api/drive/files?${params.toString()}`;
  console.log('[DriveService] Fetching:', url);

  let response;
  try {
    response = await fetch(url);
  } catch (fetchErr) {
    console.error('[DriveService] Fetch error:', fetchErr);
    throw new Error('Cannot reach server. Please check that the backend is running.');
  }

  console.log('[DriveService] Response status:', response.status, 'Content-Type:', response.headers.get('content-type'));

  if (!response.ok) {
    const err = await safeJsonParse(response, 'List files').catch(() => ({}));
    throw new Error(err.error || `Failed to list files: ${response.status}`);
  }
  const data = await safeJsonParse(response, 'List files');
  console.log('[DriveService] Parsed data - files:', data?.files?.length ?? 'undefined', 'keys:', Object.keys(data || {}));
  return data;
}

/**
 * Get file metadata
 */
export async function getDriveFile(fileId) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/drive/files/${fileId}`);
  } catch (fetchErr) {
    throw new Error('Cannot reach server. Please check that the backend is running.');
  }

  if (!response.ok) {
    const err = await safeJsonParse(response, 'Get file').catch(() => ({}));
    throw new Error(err.error || `Failed to get file: ${response.status}`);
  }
  return await safeJsonParse(response, 'Get file');
}

/**
 * Get file content (auto-detects Doc vs Sheet vs other)
 */
export async function getFileContent(fileId) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/drive/files/${fileId}/content`);
  } catch (fetchErr) {
    throw new Error('Cannot reach server. Please check that the backend is running.');
  }

  if (!response.ok) {
    const err = await safeJsonParse(response, 'Get content').catch(() => ({}));
    throw new Error(err.error || `Failed to get file content: ${response.status}`);
  }
  return await safeJsonParse(response, 'Get content');
}

/**
 * List folder contents
 */
export async function listFolder(folderId) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/drive/folders/${folderId}`);
  } catch (fetchErr) {
    throw new Error('Cannot reach server. Please check that the backend is running.');
  }

  if (!response.ok) {
    const err = await safeJsonParse(response, 'List folder').catch(() => ({}));
    throw new Error(err.error || `Failed to list folder: ${response.status}`);
  }
  return await safeJsonParse(response, 'List folder');
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCS / SHEETS OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get Google Doc content (plain text)
 */
export async function getDocument(docId) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/drive/docs/${docId}`);
  } catch (fetchErr) {
    throw new Error('Cannot reach server. Please check that the backend is running.');
  }

  if (!response.ok) {
    const err = await safeJsonParse(response, 'Get document').catch(() => ({}));
    throw new Error(err.error || `Failed to get document: ${response.status}`);
  }
  return await safeJsonParse(response, 'Get document');
}

/**
 * Get spreadsheet metadata
 */
export async function getSpreadsheet(sheetId) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/drive/sheets/${sheetId}`);
  } catch (fetchErr) {
    throw new Error('Cannot reach server. Please check that the backend is running.');
  }

  if (!response.ok) {
    const err = await safeJsonParse(response, 'Get spreadsheet').catch(() => ({}));
    throw new Error(err.error || `Failed to get spreadsheet: ${response.status}`);
  }
  return await safeJsonParse(response, 'Get spreadsheet');
}

/**
 * Get sheet cell values
 */
export async function getSheetValues(sheetId, range = '') {
  const params = range ? `?range=${encodeURIComponent(range)}` : '';

  let response;
  try {
    response = await fetch(`${API_URL}/api/drive/sheets/${sheetId}/values${params}`);
  } catch (fetchErr) {
    throw new Error('Cannot reach server. Please check that the backend is running.');
  }

  if (!response.ok) {
    const err = await safeJsonParse(response, 'Get sheet values').catch(() => ({}));
    throw new Error(err.error || `Failed to get sheet values: ${response.status}`);
  }
  return await safeJsonParse(response, 'Get sheet values');
}

/**
 * Get processed file content for in-app viewing (text extraction for all file types)
 */
export async function getProcessedFileContent(fileId) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/drive/files/${fileId}/processed`);
  } catch (fetchErr) {
    console.error('[DriveService] Fetch error:', fetchErr);
    throw new Error('Cannot reach server. Please check that the backend is running.');
  }

  if (!response.ok) {
    const err = await safeJsonParse(response, 'Process file').catch(() => ({}));
    throw new Error(err.error || `Failed to process file: ${response.status}`);
  }
  return await safeJsonParse(response, 'Process file');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get icon name based on Google Drive MIME type
 */
export function getFileIcon(mimeType) {
  const iconMap = {
    'application/vnd.google-apps.folder': 'folder',
    'application/vnd.google-apps.document': 'doc',
    'application/vnd.google-apps.spreadsheet': 'sheet',
    'application/vnd.google-apps.presentation': 'slides',
    'application/vnd.google-apps.form': 'form',
    'application/vnd.google-apps.drawing': 'drawing',
    'application/pdf': 'pdf',
    'image/png': 'image',
    'image/jpeg': 'image',
    'image/gif': 'image',
    'image/svg+xml': 'image',
    'video/mp4': 'video',
    'audio/mpeg': 'audio',
    'text/plain': 'text',
    'text/html': 'html',
    'text/csv': 'csv',
    'application/zip': 'archive',
    'application/json': 'code',
    'application/javascript': 'code'
  };

  return iconMap[mimeType] || 'file';
}

/**
 * Check if a file is a Google Workspace file (can be previewed inline)
 */
export function isPreviewable(mimeType) {
  return [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet'
  ].includes(mimeType);
}

/**
 * Check if a file can be opened and viewed within the app
 * Returns true for all types except folders and unsupported Google Apps types
 */
export function isViewableInApp(mimeType) {
  if (!mimeType) return false;
  if (mimeType === 'application/vnd.google-apps.folder') return false;
  // Unsupported Google Workspace types
  const unsupported = [
    'application/vnd.google-apps.form',
    'application/vnd.google-apps.site',
    'application/vnd.google-apps.map',
    'application/vnd.google-apps.fusiontable',
    'application/vnd.google-apps.shortcut'
  ];
  return !unsupported.includes(mimeType);
}

/**
 * Check if file is a folder
 */
export function isFolder(mimeType) {
  return mimeType === 'application/vnd.google-apps.folder';
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === '0') return '';
  const num = parseInt(bytes);
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format date to relative time string
 */
export function formatModifiedTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  if (days < 30) return `${Math.floor(days / 7)}w ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
