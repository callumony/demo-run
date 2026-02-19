// ═══════════════════════════════════════════════════════════════════════════════
// BACKUP SERVICE
// Comprehensive backup system with local storage and cloud integration
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { createWriteStream, createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import emailService from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────────

const BACKUP_DIR = path.join(os.homedir(), 'Documents', 'OmniBAK');
const LEGACY_BACKUP_DIR = path.join(__dirname, '../../data/backups');
const MAX_BACKUPS = 3;
const BACKUP_PREFIX = 'credm-ai-backup';
const GDRIVE_BACKUP_FOLDER = 'OmniBAK';

// Items to backup — ALL site data
const BACKUP_SOURCES = {
  // ── Vector database (learned embeddings) ──────────────────────
  lancedb: path.join(__dirname, '../../data/lancedb'),

  // ── SQLite databases ──────────────────────────────────────────
  'training.db': path.join(__dirname, '../../data/training.db'),
  'sessions.db': path.join(__dirname, '../../data/sessions.db'),
  'chat_sessions.db': path.join(__dirname, '../../data/chat_sessions.db'),
  'watched_files.db': path.join(__dirname, '../../data/watched_files.db'),

  // ── Chat logs ─────────────────────────────────────────────────
  chat_logs: path.join(__dirname, '../../data/chat_logs'),

  // ── Manual training files ─────────────────────────────────────
  manual: path.join(__dirname, '../../data/manual'),

  // ── Unprocessed data ──────────────────────────────────────────
  unprocessed: path.join(__dirname, '../../data/unprocessed'),

  // ── Library backup snapshots ──────────────────────────────────
  library_backup: path.join(__dirname, '../../data/library_backup'),

  // ── Settings files ────────────────────────────────────────────
  'backup-settings.json': path.join(__dirname, '../../data/backup-settings.json'),
  'email-settings.json': path.join(__dirname, '../../data/email-settings.json'),

  // ── Configuration (.env) ──────────────────────────────────────
  envFile: path.join(__dirname, '../../.env'),

  // ── Server logs ───────────────────────────────────────────────
  logs: path.join(__dirname, '../../logs'),

  // ── User data exports (IndexedDB, client data) ────────────────
  exports: path.join(__dirname, '../../data/exports')
};

// ─────────────────────────────────────────────────────────────────────────────────
// BACKUP SERVICE CLASS
// ─────────────────────────────────────────────────────────────────────────────────

class BackupService {
  constructor() {
    this.isBackingUp = false;
    this.lastBackupTime = null;
    this.scheduledBackup = null;
    this.backupSettings = {
      enabled: false,
      schedule: 'daily', // daily, weekly, manual
      time: '03:00', // Time for scheduled backups
      cloudProvider: null, // 'google' | null
      notifyOnBackup: false,
      notifyEmail: ''
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════════

  async initialize() {
    // Ensure backup directory exists
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    await fs.mkdir(path.join(__dirname, '../../data/exports'), { recursive: true });

    // Load settings from file if exists
    await this.loadSettings();

    // Start scheduler if enabled
    if (this.backupSettings.enabled && this.backupSettings.schedule !== 'manual') {
      this.startScheduler();
    }

    console.log('✓ Backup service initialized');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SETTINGS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  async loadSettings() {
    try {
      const settingsPath = path.join(__dirname, '../../data/backup-settings.json');
      const data = await fs.readFile(settingsPath, 'utf-8');
      this.backupSettings = { ...this.backupSettings, ...JSON.parse(data) };
    } catch (error) {
      // Settings file doesn't exist yet, use defaults
    }
  }

  async saveSettings(settings) {
    this.backupSettings = { ...this.backupSettings, ...settings };
    const settingsPath = path.join(__dirname, '../../data/backup-settings.json');

    await fs.writeFile(settingsPath, JSON.stringify(this.backupSettings, null, 2));

    // Restart scheduler with new settings
    this.stopScheduler();
    if (this.backupSettings.enabled && this.backupSettings.schedule !== 'manual') {
      this.startScheduler();
    }

    return this.backupSettings;
  }

  getSettings() {
    return { ...this.backupSettings };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LOCAL BACKUP
  // ═══════════════════════════════════════════════════════════════════════════════

  async createLocalBackup(clientData = null, storeLocally = true) {
    if (this.isBackingUp) {
      throw new Error('Backup already in progress');
    }

    this.isBackingUp = true;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${BACKUP_PREFIX}-${timestamp}`;

    // Use temp directory for download-only backups, otherwise use backup dir
    const targetDir = storeLocally ? BACKUP_DIR : path.join(__dirname, '../../data/temp');
    await fs.mkdir(targetDir, { recursive: true });
    const backupPath = path.join(targetDir, `${backupName}.zip`);

    try {
      console.log(`Starting backup: ${backupName} (store: ${storeLocally})`);

      // Create exports directory for client data
      const exportsDir = path.join(__dirname, '../../data/exports');
      await fs.mkdir(exportsDir, { recursive: true });

      // Save client-side data if provided (IndexedDB exports)
      if (clientData) {
        await fs.writeFile(
          path.join(exportsDir, 'client-data.json'),
          JSON.stringify(clientData, null, 2)
        );
      }

      // Create metadata file
      const metadata = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        appName: 'C:REDM-AI',
        backupName,
        contents: []
      };

      // Create zip archive
      const output = createWriteStream(backupPath);
      const archive = archiver('zip', { zlib: { level: 5 } });

      // Setup archive events
      const archivePromise = new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
      });

      archive.pipe(output);

      // Add each backup source
      for (const [name, sourcePath] of Object.entries(BACKUP_SOURCES)) {
        try {
          const stats = await fs.stat(sourcePath);

          if (stats.isDirectory()) {
            archive.directory(sourcePath, name);
            metadata.contents.push({ name, type: 'directory', path: sourcePath });
          } else if (stats.isFile()) {
            archive.file(sourcePath, { name: path.basename(sourcePath) });
            metadata.contents.push({ name, type: 'file', path: sourcePath });
          }
        } catch (error) {
          // Source doesn't exist, skip it
          console.log(`Skipping ${name}: ${error.message}`);
        }
      }

      // Generate credentials backup file with all sensitive env vars
      try {
        const credentialKeys = [
          'OPENAI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
          'HIVE_API_KEY', 'HIVE_USER_ID',
          'APP_URL', 'CLIENT_URL', 'PORT', 'NODE_ENV',
          'PRIMARY_COLOR', 'ACCENT_COLOR', 'BOT_NAME', 'BOT_AVATAR_URL',
          'CHATBOT_LOGO_URL', 'COMPANY_NAME', 'COMPANY_TAGLINE', 'COMPANY_DESCRIPTION',
          'TEMPERATURE', 'MAX_TOKENS', 'SYSTEM_PROMPT_ADDITION',
          'LANCEDB_PATH', 'COLLECTION_NAME', 'EMBEDDING_MODEL',
          'CONTACT_SHEET_ID', 'SSH_HOST', 'SSH_USER', 'SSH_KEY_PATH', 'SSH_PORT'
        ];
        let credContent = '# ════════════════════════════════════════════════════\n';
        credContent += '# OMNIPOTENT CREDENTIALS & CONFIGURATION BACKUP\n';
        credContent += `# Generated: ${new Date().toISOString()}\n`;
        credContent += '# ════════════════════════════════════════════════════\n\n';
        for (const key of credentialKeys) {
          const val = process.env[key];
          if (val) {
            credContent += `${key}=${val}\n`;
          }
        }
        // Also capture any other env vars that look like keys/secrets
        for (const [key, val] of Object.entries(process.env)) {
          if (!credentialKeys.includes(key) && val && (
            key.includes('KEY') || key.includes('SECRET') || key.includes('TOKEN') ||
            key.includes('PASSWORD') || key.includes('SSH') || key.includes('OAUTH') ||
            key.includes('API_') || key.includes('_ID')
          )) {
            credContent += `${key}=${val}\n`;
          }
        }
        archive.append(credContent, { name: 'credentials-backup.txt' });
        metadata.contents.push({ name: 'credentials-backup.txt', type: 'generated' });
      } catch (credErr) {
        console.warn('Could not generate credentials backup:', credErr.message);
      }

      // Add metadata
      archive.append(JSON.stringify(metadata, null, 2), { name: 'backup-metadata.json' });

      await archive.finalize();
      await archivePromise;

      // Get backup file size
      const backupStats = await fs.stat(backupPath);
      const backupSize = backupStats.size;

      // Only rotate if storing locally
      if (storeLocally) {
        await this.rotateBackups();
        this.lastBackupTime = new Date();
      }

      console.log(`Backup completed: ${backupName} (${this.formatSize(backupSize)})`);

      return {
        success: true,
        backupName: `${backupName}.zip`,
        backupPath,
        size: backupSize,
        sizeFormatted: this.formatSize(backupSize),
        timestamp: new Date().toISOString(),
        stored: storeLocally
      };

    } catch (error) {
      console.error('Backup failed:', error);
      // Clean up partial backup
      try {
        await fs.unlink(backupPath);
      } catch (e) { /* ignore */ }
      throw error;
    } finally {
      this.isBackingUp = false;
    }
  }

  // Create backup for immediate download (not stored locally)
  async createDownloadBackup(clientData = null) {
    return this.createLocalBackup(clientData, false);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // BACKUP ROTATION
  // ═══════════════════════════════════════════════════════════════════════════════

  async rotateBackups() {
    try {
      const files = await fs.readdir(BACKUP_DIR);
      const backups = files
        .filter(f => f.startsWith(BACKUP_PREFIX) && f.endsWith('.zip'))
        .map(f => ({
          name: f,
          path: path.join(BACKUP_DIR, f)
        }));

      // Sort by name (which includes timestamp) - newest first
      backups.sort((a, b) => b.name.localeCompare(a.name));

      // Delete old backups beyond MAX_BACKUPS
      if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(MAX_BACKUPS);
        for (const backup of toDelete) {
          console.log(`Rotating out old backup: ${backup.name}`);
          await fs.unlink(backup.path);
        }
      }
    } catch (error) {
      console.error('Backup rotation error:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIST BACKUPS
  // ═══════════════════════════════════════════════════════════════════════════════

  async listBackups() {
    try {
      const files = await fs.readdir(BACKUP_DIR);
      const backups = [];

      for (const file of files) {
        if (file.startsWith(BACKUP_PREFIX) && file.endsWith('.zip')) {
          const filePath = path.join(BACKUP_DIR, file);
          const stats = await fs.stat(filePath);

          // Extract timestamp from filename
          const timestampMatch = file.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
          const timestamp = timestampMatch
            ? timestampMatch[1].replace(/-/g, (m, i) => i > 9 ? ':' : '-')
            : null;

          backups.push({
            name: file,
            path: filePath,
            size: stats.size,
            sizeFormatted: this.formatSize(stats.size),
            createdAt: stats.birthtime,
            timestamp
          });
        }
      }

      // Sort by creation date - newest first
      backups.sort((a, b) => b.createdAt - a.createdAt);

      return backups;
    } catch (error) {
      console.error('Error listing backups:', error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RESTORE BACKUP
  // ═══════════════════════════════════════════════════════════════════════════════

  async restoreBackup(backupName) {
    const backupPath = path.join(BACKUP_DIR, backupName);

    try {
      await fs.access(backupPath);
    } catch {
      throw new Error(`Backup not found: ${backupName}`);
    }

    // Note: Full restore implementation would require:
    // 1. Extracting the zip
    // 2. Stopping services
    // 3. Replacing data files
    // 4. Restarting services

    // For safety, we return instructions rather than auto-restoring
    return {
      success: true,
      message: 'Backup found. Manual restore recommended for safety.',
      backupPath,
      instructions: [
        '1. Stop the application',
        '2. Extract the backup zip to a temporary location',
        '3. Replace the data/ folder contents with the backup',
        '4. Restart the application'
      ]
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CLOUD BACKUP - GOOGLE DRIVE
  // ═══════════════════════════════════════════════════════════════════════════════

  async uploadToGoogleDrive(backupPath, backupName) {
    if (!emailService.isConnected()) {
      throw new Error('Google account not connected. Please connect via Settings → Integrations.');
    }

    let token;
    try {
      token = await emailService.getValidAccessToken();
    } catch (err) {
      throw new Error(`Google auth failed: ${err.message}`);
    }

    try {
      // Read backup file
      const fileContent = await fs.readFile(backupPath);

      // Check for existing backup folder
      let folderId = null;
      const folderSearchResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name='OmniBAK' and mimeType='application/vnd.google-apps.folder' and trashed=false")}&fields=files(id,name)`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (folderSearchResponse.ok) {
        const folderData = await folderSearchResponse.json();
        if (folderData.files && folderData.files.length > 0) {
          folderId = folderData.files[0].id;
        }
      }

      // Create folder if it doesn't exist
      if (!folderId) {
        const createFolderResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: 'OmniBAK',
            mimeType: 'application/vnd.google-apps.folder'
          })
        });

        if (!createFolderResponse.ok) {
          const err = await createFolderResponse.json().catch(() => ({}));
          throw new Error(err.error?.message || 'Failed to create backup folder in Google Drive');
        }

        const folderResult = await createFolderResponse.json();
        folderId = folderResult.id;
      }

      // Upload file using multipart upload
      const boundary = '-------314159265358979323846';
      const metadata = JSON.stringify({
        name: backupName,
        parents: [folderId],
        mimeType: 'application/zip'
      });

      const multipartBody = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`),
        fileContent,
        Buffer.from(`\r\n--${boundary}--`)
      ]);

      const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(multipartBody.length)
        },
        body: multipartBody
      });

      if (!uploadResponse.ok) {
        const err = await uploadResponse.json().catch(() => ({}));
        throw new Error(err.error?.message || `Google Drive upload failed: ${uploadResponse.status}`);
      }

      // Rotate old backups
      await this.rotateGoogleDriveBackups(token, folderId);

      return { success: true, provider: 'google', backupName };
    } catch (error) {
      console.error('Google Drive upload error:', error);
      throw error;
    }
  }

  async rotateGoogleDriveBackups(token, folderId) {
    try {
      // List files in backup folder
      const listResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(id,name,createdTime)&orderBy=createdTime desc`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (!listResponse.ok) return;

      const data = await listResponse.json();
      const backups = (data.files || [])
        .filter(f => f.name.startsWith(BACKUP_PREFIX));

      // Delete old backups beyond MAX_BACKUPS
      if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(MAX_BACKUPS);
        for (const file of toDelete) {
          await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
        }
      }
    } catch (error) {
      console.error('Google Drive backup rotation error:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FULL BACKUP (LOCAL + CLOUD)
  // ═══════════════════════════════════════════════════════════════════════════════

  async createFullBackup(clientData = null) {
    // Create local backup first
    const localResult = await this.createLocalBackup(clientData);

    // Upload to cloud if configured
    const cloudResults = [];

    if (this.backupSettings.cloudProvider === 'google' && emailService.isConnected()) {
      try {
        const googleResult = await this.uploadToGoogleDrive(localResult.backupPath, `${localResult.backupName}.zip`);
        cloudResults.push(googleResult);
      } catch (error) {
        cloudResults.push({ success: false, provider: 'google', error: error.message });
      }
    }

    return {
      ...localResult,
      cloud: cloudResults
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SCHEDULER
  // ═══════════════════════════════════════════════════════════════════════════════

  startScheduler() {
    this.stopScheduler();

    const scheduleMs = this.getScheduleInterval();
    if (scheduleMs > 0) {
      console.log(`Backup scheduler started: ${this.backupSettings.schedule}`);
      this.scheduledBackup = setInterval(async () => {
        console.log('Running scheduled backup...');
        try {
          const result = await this.createFullBackup();
          await this.sendBackupNotification(result);
        } catch (error) {
          console.error('Scheduled backup failed:', error);
          await this.sendBackupNotification(null, error);
        }
      }, scheduleMs);
    }
  }

  stopScheduler() {
    if (this.scheduledBackup) {
      clearInterval(this.scheduledBackup);
      this.scheduledBackup = null;
      console.log('Backup scheduler stopped');
    }
  }

  getScheduleInterval() {
    switch (this.backupSettings.schedule) {
      case 'daily':
        return 24 * 60 * 60 * 1000; // 24 hours
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000; // 7 days
      default:
        return 0; // Manual only
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // EMAIL NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  async sendBackupNotification(result, error = null) {
    if (!this.backupSettings.notifyOnBackup || !this.backupSettings.notifyEmail) return;
    if (!emailService.isConnected()) {
      console.warn('Cannot send backup notification — Gmail not connected');
      return;
    }

    try {
      const to = this.backupSettings.notifyEmail;
      const emailSettings = emailService.getSettings();
      const from = emailSettings.gmailEmail;
      const timestamp = new Date().toLocaleString();

      let subject, body;

      if (error) {
        subject = `⚠️ OmniBAK Backup Failed — ${timestamp}`;
        body = [
          `Backup failed at ${timestamp}.`,
          '',
          `Error: ${error.message || error}`,
          '',
          'Please check your backup settings and try again.',
          '',
          '— Omni-AI Backup Service'
        ].join('\r\n');
      } else {
        const dest = result.cloud?.length > 0
          ? result.cloud.map(c => c.provider).join(', ')
          : 'Local Drive';
        subject = `✅ OmniBAK Backup Completed — ${timestamp}`;
        body = [
          `Backup completed successfully at ${timestamp}.`,
          '',
          `File: ${result.backupName}`,
          `Size: ${result.sizeFormatted}`,
          `Destination: ${dest}`,
          '',
          '— Omni-AI Backup Service'
        ].join('\r\n');
      }

      // Build RFC 2822 raw email
      const rawEmail = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        body
      ].join('\r\n');

      const encoded = Buffer.from(rawEmail).toString('base64url');
      await emailService.sendMessage(encoded);
      console.log(`Backup notification sent to ${to}`);
    } catch (err) {
      console.error('Failed to send backup notification:', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════════

  formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  getBackupDir() {
    return BACKUP_DIR;
  }

  getStatus() {
    return {
      isBackingUp: this.isBackingUp,
      lastBackupTime: this.lastBackupTime?.toISOString() || null,
      schedulerActive: this.scheduledBackup !== null,
      settings: this.getSettings()
    };
  }
}

// Export singleton instance
const backupService = new BackupService();
export default backupService;
