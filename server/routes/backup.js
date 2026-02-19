// ═══════════════════════════════════════════════════════════════════════════════
// BACKUP ROUTES
// API endpoints for backup management with OAuth integration
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import backupService from '../services/backupService.js';
import emailService from '../services/emailService.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────────
// OAuth Configuration
// ─────────────────────────────────────────────────────────────────────────────────

// Read env vars lazily (at request time) because ES module imports
// execute before dotenv config() is called in index.js
const getEnv = () => ({
  APP_URL: process.env.APP_URL || 'http://localhost:5174'
});

// Store OAuth state tokens temporarily (in production, use Redis or similar)
const oauthStates = new Map();

// ─────────────────────────────────────────────────────────────────────────────────
// GET /api/backup/status
// Get backup service status and settings
// ─────────────────────────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const status = backupService.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting backup status:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// GET /api/backup/list
// List all available backups
// ─────────────────────────────────────────────────────────────────────────────────
router.get('/list', async (req, res) => {
  try {
    const backups = await backupService.listBackups();
    res.json({ backups });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// POST /api/backup/create
// Create a new backup (on-demand)
// Options:
//   - uploadToCloud: also upload to configured cloud provider
//   - downloadOnly: create backup for immediate download (not stored locally)
// ─────────────────────────────────────────────────────────────────────────────────
router.post('/create', async (req, res) => {
  try {
    const { clientData, uploadToCloud = false, downloadOnly = false, cloudProvider } = req.body;

    // If a specific cloudProvider was requested, temporarily set it for this backup
    if (cloudProvider && uploadToCloud) {
      await backupService.saveSettings({ cloudProvider });
    }

    let result;
    if (downloadOnly) {
      // Create backup for immediate download (not stored)
      result = await backupService.createDownloadBackup(clientData);
    } else if (uploadToCloud) {
      result = await backupService.createFullBackup(clientData);
    } else {
      result = await backupService.createLocalBackup(clientData, true);
    }

    // Send email notification (non-blocking)
    backupService.sendBackupNotification(result).catch(() => {});

    res.json(result);
  } catch (error) {
    console.error('Error creating backup:', error);
    // Send error notification (non-blocking)
    backupService.sendBackupNotification(null, error).catch(() => {});
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// GET /api/backup/download-temp/:name
// Download and delete a temporary backup file (for download-only backups)
// ─────────────────────────────────────────────────────────────────────────────────
router.get('/download-temp/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const backupPath = path.join(__dirname, '../../data/temp', name);

    // Security check - prevent directory traversal
    const resolvedPath = path.resolve(backupPath);
    const tempDir = path.resolve(__dirname, '../../data/temp');
    if (!resolvedPath.startsWith(tempDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    try {
      await fs.access(backupPath);
    } catch {
      return res.status(404).json({ error: 'Backup not found' });
    }

    // Get file stats
    const stats = await fs.stat(backupPath);

    // Set headers for download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const readStream = createReadStream(backupPath);

    // Delete the temp file after streaming completes
    readStream.on('end', async () => {
      try {
        await fs.unlink(backupPath);
        console.log(`Cleaned up temp backup: ${name}`);
      } catch (e) {
        console.error('Error cleaning up temp backup:', e);
      }
    });

    readStream.pipe(res);
  } catch (error) {
    console.error('Error downloading temp backup:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// POST /api/backup/upload-cloud
// Upload an existing backup to cloud storage
// ─────────────────────────────────────────────────────────────────────────────────
router.post('/upload-cloud', async (req, res) => {
  try {
    const { backupName, provider } = req.body;

    if (!backupName) {
      return res.status(400).json({ error: 'backupName is required' });
    }

    const backupPath = path.join(backupService.getBackupDir(), backupName);

    let result;
    if (provider === 'google') {
      result = await backupService.uploadToGoogleDrive(backupPath, backupName);
    } else {
      return res.status(400).json({ error: 'Invalid provider. Use "google".' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error uploading to cloud:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// GET /api/backup/download/:name
// Download a backup file
// ─────────────────────────────────────────────────────────────────────────────────
router.get('/download/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const backupPath = path.join(backupService.getBackupDir(), name);

    // Security check - prevent directory traversal
    const resolvedPath = path.resolve(backupPath);
    const backupDir = path.resolve(backupService.getBackupDir());
    if (!resolvedPath.startsWith(backupDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    try {
      await fs.access(backupPath);
    } catch {
      return res.status(404).json({ error: 'Backup not found' });
    }

    // Get file stats
    const stats = await fs.stat(backupPath);

    // Set headers for download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const readStream = createReadStream(backupPath);
    readStream.pipe(res);
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// DELETE /api/backup/:name
// Delete a specific backup
// ─────────────────────────────────────────────────────────────────────────────────
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const backupPath = path.join(backupService.getBackupDir(), name);

    // Security check - prevent directory traversal
    const resolvedPath = path.resolve(backupPath);
    const backupDir = path.resolve(backupService.getBackupDir());
    if (!resolvedPath.startsWith(backupDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.unlink(backupPath);
    res.json({ success: true, message: `Deleted backup: ${name}` });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Backup not found' });
    }
    console.error('Error deleting backup:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// POST /api/backup/restore/:name
// Get restore instructions for a backup
// ─────────────────────────────────────────────────────────────────────────────────
router.post('/restore/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const result = await backupService.restoreBackup(name);
    res.json(result);
  } catch (error) {
    console.error('Error restoring backup:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// GET /api/backup/settings
// Get backup settings
// ─────────────────────────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const settings = backupService.getSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error getting backup settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// PUT /api/backup/settings
// Update backup settings
// ─────────────────────────────────────────────────────────────────────────────────
router.put('/settings', async (req, res) => {
  try {
    const settings = req.body;
    const updated = await backupService.saveSettings(settings);
    res.json({
      success: true,
      settings: updated
    });
  } catch (error) {
    console.error('Error updating backup settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// OAUTH ROUTES - Google Drive (reuses Gmail/Google OAuth from emailService)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/backup/oauth/google
// Initiate Google OAuth flow (reuses email OAuth endpoint)
router.get('/oauth/google', (req, res) => {
  const env = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    APP_URL: process.env.APP_URL || 'http://localhost:5174'
  };

  if (!env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({
      error: 'Google OAuth not configured',
      message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'
    });
  }

  // If already connected via Gmail, just set the cloud provider and return
  if (emailService.isConnected()) {
    backupService.saveSettings({ cloudProvider: 'google' }).catch(() => {});
    const emailSettings = emailService.getSettings();
    return res.json({
      alreadyConnected: true,
      email: emailSettings.gmailEmail
    });
  }

  // Otherwise, generate the same OAuth URL as the email route
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { provider: 'google-backup', timestamp: Date.now() });

  // Clean up old states
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of oauthStates) {
    if (value.timestamp < tenMinutesAgo) {
      oauthStates.delete(key);
    }
  }

  // Redirect to the email OAuth flow which handles Google login
  const redirectUri = `${env.APP_URL}/api/email/oauth/callback`;
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ].join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  res.json({ authUrl: authUrl.toString() });
});

// POST /api/backup/oauth/google/disconnect
// Disconnect Google Drive from backup (does NOT disconnect Gmail)
router.post('/oauth/google/disconnect', async (req, res) => {
  try {
    await backupService.saveSettings({
      cloudProvider: backupService.backupSettings.cloudProvider === 'google' ? null : backupService.backupSettings.cloudProvider
    });
    res.json({ success: true, message: 'Google Drive backup disconnected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTION STATUS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/backup/connections
// Get connected cloud accounts
router.get('/connections', async (req, res) => {
  try {
    const settings = backupService.backupSettings;

    // Get Google connection status from emailService (shared OAuth)
    const emailSettings = emailService.getSettings();

    const connections = {
      google: {
        connected: emailService.isConnected(),
        email: emailSettings.gmailEmail || null
      }
    };

    res.json(connections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
