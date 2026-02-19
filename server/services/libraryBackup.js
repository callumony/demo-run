// ═══════════════════════════════════════════════════════════════════════════════
// LIBRARY BACKUP SERVICE
// Automatic backup of training data, learnings, and manual files
// Creates recoverable snapshots whenever library data changes
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class LibraryBackup {
  constructor() {
    this.backupDir = path.join(__dirname, '..', '..', 'data', 'library_backup');
    this.maxBackups = 10; // Keep last 10 backups of each type
    this.debounceTimer = null;
    this.debounceDelay = 5000; // 5 second debounce to batch multiple changes
    this.ensureBackupDir();
  }

  ensureBackupDir() {
    const dirs = [
      this.backupDir,
      path.join(this.backupDir, 'training_db'),
      path.join(this.backupDir, 'lancedb'),
      path.join(this.backupDir, 'manual_files'),
      path.join(this.backupDir, 'chat_logs')
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // BACKUP TRAINING DATABASE
  // ═══════════════════════════════════════════════════════════════════════════════

  async backupTrainingDb() {
    try {
      const sourceDb = path.join(__dirname, '..', '..', 'data', 'training.db');

      if (!existsSync(sourceDb)) {
        console.log('Training database not found, skipping backup');
        return null;
      }

      const timestamp = this.getTimestamp();
      const backupPath = path.join(this.backupDir, 'training_db', `training-${timestamp}.db`);

      // Copy the database file
      copyFileSync(sourceDb, backupPath);

      // Rotate old backups
      await this.rotateBackups(path.join(this.backupDir, 'training_db'), 'training-', '.db');

      console.log(`✓ Training database backed up: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('Failed to backup training database:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // BACKUP LANCEDB (VECTOR DATABASE)
  // ═══════════════════════════════════════════════════════════════════════════════

  async backupLanceDb() {
    try {
      const sourceLanceDb = path.join(__dirname, '..', '..', 'data', 'lancedb');

      if (!existsSync(sourceLanceDb)) {
        console.log('LanceDB not found, skipping backup');
        return null;
      }

      const timestamp = this.getTimestamp();
      const backupPath = path.join(this.backupDir, 'lancedb', `lancedb-${timestamp}`);

      // Copy the entire lancedb folder
      await this.copyDirectory(sourceLanceDb, backupPath);

      // Rotate old backups
      await this.rotateFolderBackups(path.join(this.backupDir, 'lancedb'), 'lancedb-');

      console.log(`✓ LanceDB backed up: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('Failed to backup LanceDB:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // BACKUP MANUAL TRAINING FILES
  // ═══════════════════════════════════════════════════════════════════════════════

  async backupManualFiles() {
    try {
      const sourceManual = path.join(__dirname, '..', '..', 'data', 'training');

      if (!existsSync(sourceManual)) {
        console.log('Manual training folder not found, skipping backup');
        return null;
      }

      const timestamp = this.getTimestamp();
      const backupPath = path.join(this.backupDir, 'manual_files', `manual-${timestamp}`);

      // Copy the entire manual training folder
      await this.copyDirectory(sourceManual, backupPath);

      // Rotate old backups
      await this.rotateFolderBackups(path.join(this.backupDir, 'manual_files'), 'manual-');

      console.log(`✓ Manual training files backed up: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('Failed to backup manual files:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FULL LIBRARY BACKUP (ALL COMPONENTS)
  // ═══════════════════════════════════════════════════════════════════════════════

  async createFullBackup() {
    console.log('Starting full library backup...');

    const results = {
      timestamp: new Date().toISOString(),
      trainingDb: await this.backupTrainingDb(),
      lanceDb: await this.backupLanceDb(),
      manualFiles: await this.backupManualFiles()
    };

    console.log('Full library backup complete');
    return results;
  }

  // Debounced backup - waits for activity to settle before backing up
  triggerDebouncedBackup() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      console.log('Triggered debounced library backup');
      await this.backupTrainingDb();
    }, this.debounceDelay);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  async copyDirectory(source, destination) {
    await fs.mkdir(destination, { recursive: true });

    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(source, entry.name);
      const destPath = path.join(destination, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async rotateBackups(dir, prefix, extension) {
    try {
      const files = await fs.readdir(dir);
      const backups = files
        .filter(f => f.startsWith(prefix) && f.endsWith(extension))
        .sort()
        .reverse();

      // Delete old backups
      if (backups.length > this.maxBackups) {
        const toDelete = backups.slice(this.maxBackups);
        for (const file of toDelete) {
          await fs.unlink(path.join(dir, file));
          console.log(`Rotated out old backup: ${file}`);
        }
      }
    } catch (error) {
      console.error('Backup rotation error:', error);
    }
  }

  async rotateFolderBackups(dir, prefix) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const backups = entries
        .filter(e => e.isDirectory() && e.name.startsWith(prefix))
        .map(e => e.name)
        .sort()
        .reverse();

      // Delete old backups
      if (backups.length > this.maxBackups) {
        const toDelete = backups.slice(this.maxBackups);
        for (const folder of toDelete) {
          await fs.rm(path.join(dir, folder), { recursive: true, force: true });
          console.log(`Rotated out old backup folder: ${folder}`);
        }
      }
    } catch (error) {
      console.error('Folder backup rotation error:', error);
    }
  }

  // List all available backups
  async listBackups() {
    const backups = {
      trainingDb: [],
      lanceDb: [],
      manualFiles: []
    };

    try {
      // Training DB backups
      const trainingDir = path.join(this.backupDir, 'training_db');
      if (existsSync(trainingDir)) {
        const files = await fs.readdir(trainingDir);
        backups.trainingDb = files.filter(f => f.startsWith('training-')).sort().reverse();
      }

      // LanceDB backups
      const lanceDir = path.join(this.backupDir, 'lancedb');
      if (existsSync(lanceDir)) {
        const entries = await fs.readdir(lanceDir, { withFileTypes: true });
        backups.lanceDb = entries
          .filter(e => e.isDirectory() && e.name.startsWith('lancedb-'))
          .map(e => e.name)
          .sort()
          .reverse();
      }

      // Manual files backups
      const manualDir = path.join(this.backupDir, 'manual_files');
      if (existsSync(manualDir)) {
        const entries = await fs.readdir(manualDir, { withFileTypes: true });
        backups.manualFiles = entries
          .filter(e => e.isDirectory() && e.name.startsWith('manual-'))
          .map(e => e.name)
          .sort()
          .reverse();
      }
    } catch (error) {
      console.error('Error listing backups:', error);
    }

    return backups;
  }

  // Restore from backup
  async restoreTrainingDb(backupName) {
    try {
      const backupPath = path.join(this.backupDir, 'training_db', backupName);
      const targetPath = path.join(__dirname, '..', '..', 'data', 'training.db');

      if (!existsSync(backupPath)) {
        throw new Error(`Backup not found: ${backupName}`);
      }

      // Create a backup of current state before restore
      await this.backupTrainingDb();

      // Copy backup to main location
      copyFileSync(backupPath, targetPath);

      console.log(`✓ Training database restored from: ${backupName}`);
      return { success: true, restored: backupName };
    } catch (error) {
      console.error('Failed to restore training database:', error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AUTO-RESTORE ON STARTUP
  // Checks if data is missing/empty and restores from backup automatically
  // ═══════════════════════════════════════════════════════════════════════════════

  async checkAndRestoreOnStartup() {
    console.log('Checking library data integrity...');

    const trainingDbPath = path.join(__dirname, '..', '..', 'data', 'training.db');
    const lanceDbPath = path.join(__dirname, '..', '..', 'data', 'lancedb');

    let restoredItems = [];

    // Check if training.db exists and has data
    let trainingDbMissing = false;
    if (!existsSync(trainingDbPath)) {
      console.log('⚠ Training database is missing!');
      trainingDbMissing = true;
    } else {
      // Check if it has any learnings
      try {
        const stats = await fs.stat(trainingDbPath);
        if (stats.size < 1000) { // Very small file, likely empty
          console.log('⚠ Training database appears to be empty!');
          trainingDbMissing = true;
        }
      } catch (e) {
        trainingDbMissing = true;
      }
    }

    if (trainingDbMissing) {
      // Try to restore from backup
      const backups = await this.listBackups();

      if (backups.trainingDb.length > 0) {
        const latestBackup = backups.trainingDb[0];
        console.log(`🔄 Auto-restoring training database from: ${latestBackup}`);

        try {
          const backupPath = path.join(this.backupDir, 'training_db', latestBackup);
          const targetPath = path.join(__dirname, '..', '..', 'data', 'training.db');

          // Ensure data directory exists
          await fs.mkdir(path.dirname(targetPath), { recursive: true });

          // Copy backup to main location
          copyFileSync(backupPath, targetPath);

          console.log(`✓ Training database restored from backup: ${latestBackup}`);
          restoredItems.push({ type: 'training_db', backup: latestBackup });
        } catch (error) {
          console.error('Failed to auto-restore training database:', error);
        }
      } else {
        console.log('⚠ No backup available to restore training database');
      }
    }

    // Check LanceDB
    let lanceDbMissing = false;
    if (!existsSync(lanceDbPath)) {
      console.log('⚠ LanceDB (vector database) is missing!');
      lanceDbMissing = true;
    } else {
      // Check if it has any tables
      try {
        const files = await fs.readdir(lanceDbPath);
        if (files.length === 0) {
          console.log('⚠ LanceDB appears to be empty!');
          lanceDbMissing = true;
        }
      } catch (e) {
        lanceDbMissing = true;
      }
    }

    if (lanceDbMissing) {
      const backups = await this.listBackups();
      if (backups.lanceDb.length > 0) {
        const latestBackup = backups.lanceDb[0];
        console.log(`🔄 Auto-restoring LanceDB from: ${latestBackup}`);

        try {
          const backupPath = path.join(this.backupDir, 'lancedb', latestBackup);
          await this.copyDirectory(backupPath, lanceDbPath);

          console.log(`✓ LanceDB restored from backup: ${latestBackup}`);
          restoredItems.push({ type: 'lancedb', backup: latestBackup });
        } catch (error) {
          console.error('Failed to auto-restore LanceDB:', error);
        }
      } else {
        console.log('⚠ No backup available to restore LanceDB');
      }
    }

    if (restoredItems.length > 0) {
      console.log(`\n════════════════════════════════════════════════════════════════`);
      console.log(`✓ AUTO-RESTORE COMPLETE - Restored ${restoredItems.length} item(s)`);
      restoredItems.forEach(item => {
        console.log(`  • ${item.type}: ${item.backup}`);
      });
      console.log(`════════════════════════════════════════════════════════════════\n`);
    } else if (!trainingDbMissing && !lanceDbMissing) {
      console.log('✓ Library data integrity check passed');
    }

    return restoredItems;
  }
}

// Export singleton instance
const libraryBackup = new LibraryBackup();
export default libraryBackup;
