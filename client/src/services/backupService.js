// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT BACKUP SERVICE
// Handles backup operations and OAuth cloud sync from the frontend
// ═══════════════════════════════════════════════════════════════════════════════

import { exportDatabase } from './localDatabase';

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3001';

// ─────────────────────────────────────────────────────────────────────────────────
// API CALLS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get backup service status
 */
export async function getBackupStatus() {
  try {
    const response = await fetch(`${API_URL}/api/backup/status`);
    if (!response.ok) throw new Error('Failed to get backup status');
    return await response.json();
  } catch (error) {
    console.error('Error getting backup status:', error);
    throw error;
  }
}

/**
 * List all available backups
 */
export async function listBackups() {
  try {
    const response = await fetch(`${API_URL}/api/backup/list`);
    if (!response.ok) throw new Error('Failed to list backups');
    return await response.json();
  } catch (error) {
    console.error('Error listing backups:', error);
    throw error;
  }
}

/**
 * Create a new backup
 * @param {Object} options - Backup options
 * @param {boolean} options.uploadToCloud - Whether to also upload to configured cloud provider
 * @param {boolean} options.downloadOnly - Create backup for immediate download (not stored)
 */
export async function createBackup(options = {}) {
  // Support legacy boolean parameter for uploadToCloud
  const opts = typeof options === 'boolean'
    ? { uploadToCloud: options, downloadOnly: false }
    : { uploadToCloud: false, downloadOnly: false, ...options };

  try {
    // Export client-side data (IndexedDB)
    const clientData = await exportDatabase();

    const response = await fetch(`${API_URL}/api/backup/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientData,
        uploadToCloud: opts.uploadToCloud,
        downloadOnly: opts.downloadOnly
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create backup');
    }

    const result = await response.json();

    // If download-only, trigger immediate download
    if (opts.downloadOnly && result.backupName) {
      await downloadTempBackup(result.backupName);
    }

    return result;
  } catch (error) {
    console.error('Error creating backup:', error);
    throw error;
  }
}

/**
 * Download a temporary backup file (for download-only backups)
 * The file is deleted from server after download
 * @param {string} backupName - Name of the backup file
 */
export async function downloadTempBackup(backupName) {
  try {
    const response = await fetch(`${API_URL}/api/backup/download-temp/${backupName}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to download backup');
    }

    // Create blob and trigger download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    return { success: true };
  } catch (error) {
    console.error('Error downloading temp backup:', error);
    throw error;
  }
}

/**
 * Upload existing backup to cloud
 * @param {string} backupName - Name of the backup file
 * @param {string} provider - 'google'
 */
export async function uploadToCloud(backupName, provider) {
  try {
    const response = await fetch(`${API_URL}/api/backup/upload-cloud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupName, provider })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload to cloud');
    }

    return await response.json();
  } catch (error) {
    console.error('Error uploading to cloud:', error);
    throw error;
  }
}

/**
 * Download a backup file
 * @param {string} backupName - Name of the backup file
 */
export async function downloadBackup(backupName) {
  try {
    const response = await fetch(`${API_URL}/api/backup/download/${backupName}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to download backup');
    }

    // Create blob and trigger download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    return { success: true };
  } catch (error) {
    console.error('Error downloading backup:', error);
    throw error;
  }
}

/**
 * Delete a backup
 * @param {string} backupName - Name of the backup file
 */
export async function deleteBackup(backupName) {
  try {
    const response = await fetch(`${API_URL}/api/backup/${backupName}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete backup');
    }

    return await response.json();
  } catch (error) {
    console.error('Error deleting backup:', error);
    throw error;
  }
}

/**
 * Get restore instructions for a backup
 * @param {string} backupName - Name of the backup file
 */
export async function restoreBackup(backupName) {
  try {
    const response = await fetch(`${API_URL}/api/backup/restore/${backupName}`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get restore instructions');
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting restore instructions:', error);
    throw error;
  }
}

/**
 * Get backup settings
 */
export async function getBackupSettings() {
  try {
    const response = await fetch(`${API_URL}/api/backup/settings`);
    if (!response.ok) throw new Error('Failed to get backup settings');
    return await response.json();
  } catch (error) {
    console.error('Error getting backup settings:', error);
    throw error;
  }
}

/**
 * Update backup settings
 * @param {Object} settings - New settings to apply
 */
export async function updateBackupSettings(settings) {
  try {
    const response = await fetch(`${API_URL}/api/backup/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update backup settings');
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating backup settings:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// OAUTH FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Get connected cloud accounts
 */
export async function getCloudConnections() {
  try {
    const response = await fetch(`${API_URL}/api/backup/connections`);
    if (!response.ok) throw new Error('Failed to get connections');
    return await response.json();
  } catch (error) {
    console.error('Error getting cloud connections:', error);
    throw error;
  }
}

/**
 * Start Google Drive OAuth login flow
 * Opens Google login in a popup window
 */
export async function loginWithGoogleDrive() {
  try {
    const response = await fetch(`${API_URL}/api/backup/oauth/google`);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.message || data.error);
    }

    // If already connected via Gmail, no need to open popup
    if (data.alreadyConnected) {
      return { success: true, user: data.email };
    }

    // Open OAuth popup
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      data.authUrl,
      'Google Drive Login',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
    );

    // Return a promise that resolves when OAuth completes
    return new Promise((resolve, reject) => {
      const checkPopup = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(checkPopup);
            // Check URL params for OAuth result
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('oauth_success') === 'google') {
              resolve({ success: true, user: urlParams.get('user') });
              // Clean up URL
              window.history.replaceState({}, document.title, window.location.pathname);
            } else if (urlParams.get('oauth_error')) {
              reject(new Error(urlParams.get('oauth_error')));
              window.history.replaceState({}, document.title, window.location.pathname);
            } else {
              // Popup closed without redirect, check connections
              getCloudConnections().then(connections => {
                if (connections.google?.connected) {
                  resolve({ success: true, user: connections.google.email });
                } else {
                  reject(new Error('Login cancelled'));
                }
              });
            }
          }
        } catch (e) {
          // Cross-origin error, popup still open on OAuth page
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(checkPopup);
        reject(new Error('Login timeout'));
      }, 5 * 60 * 1000);
    });
  } catch (error) {
    console.error('Google Drive login error:', error);
    throw error;
  }
}

/**
 * Disconnect Google Drive account
 */
export async function disconnectGoogleDrive() {
  try {
    const response = await fetch(`${API_URL}/api/backup/oauth/google/disconnect`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to disconnect Google Drive');
    }

    return await response.json();
  } catch (error) {
    console.error('Error disconnecting Google Drive:', error);
    throw error;
  }
}

/**
 * Create a local backup and download it as a zip file
 * This creates an immediate download without storing on server
 */
export async function createLocalBackup() {
  try {
    // Export client-side data (IndexedDB)
    const clientData = await exportDatabase();

    const response = await fetch(`${API_URL}/api/backup/create-local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientData })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create local backup');
    }

    // Get the backup as a blob and download it
    const blob = await response.blob();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `credm-ai-backup-${timestamp}.zip`;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    return { success: true, filename, size: blob.size, sizeFormatted: formatSize(blob.size) };
  } catch (error) {
    console.error('Error creating local backup:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Format file size for display
 * @param {number} bytes - Size in bytes
 */
export function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Format date for display
 * @param {string|Date} date - Date to format
 */
export function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleString();
}

/**
 * Check URL for OAuth callback params and handle them
 */
export function handleOAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const result = {
    success: null,
    provider: null,
    user: null,
    error: null
  };

  if (urlParams.get('oauth_success')) {
    result.success = true;
    result.provider = urlParams.get('oauth_success');
    result.user = urlParams.get('user');
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get('oauth_error')) {
    result.success = false;
    result.error = urlParams.get('oauth_error');
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  return result;
}

export default {
  getBackupStatus,
  listBackups,
  createBackup,
  uploadToCloud,
  downloadBackup,
  downloadTempBackup,
  deleteBackup,
  restoreBackup,
  getBackupSettings,
  updateBackupSettings,
  getCloudConnections,
  loginWithGoogleDrive,
  disconnectGoogleDrive,
  createLocalBackup,
  formatSize,
  formatDate,
  handleOAuthCallback
};
