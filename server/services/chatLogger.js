// ═══════════════════════════════════════════════════════════════════════════════
// CHAT LOGGER SERVICE
// Logs all chat conversations to text files in real-time
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ChatLogger {
  constructor() {
    this.logsDir = path.join(__dirname, '..', '..', 'data', 'chat_logs');
    this.currentLogFile = null;
    this.currentDate = null;
    this.ensureLogsDir();
  }

  ensureLogsDir() {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  getLogFilePath() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Create new file if date changed
    if (this.currentDate !== today) {
      this.currentDate = today;
      this.currentLogFile = path.join(this.logsDir, `chat-${today}.txt`);

      // Add header if new file
      if (!existsSync(this.currentLogFile)) {
        const header = `════════════════════════════════════════════════════════════════════════════════
CHAT LOG - ${today}
OMNIPOTENT Agent Conversations
════════════════════════════════════════════════════════════════════════════════

`;
        appendFileSync(this.currentLogFile, header, 'utf-8');
      }
    }

    return this.currentLogFile;
  }

  formatTimestamp() {
    return new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }

  // Log user message in real-time
  logUserMessage(message, files = []) {
    try {
      const logFile = this.getLogFilePath();
      const timestamp = this.formatTimestamp();

      let logEntry = `\n[${timestamp}] USER:\n${message}\n`;

      if (files && files.length > 0) {
        const fileNames = files.map(f => f.name || 'unnamed').join(', ');
        logEntry += `  [Attachments: ${fileNames}]\n`;
      }

      appendFileSync(logFile, logEntry, 'utf-8');
    } catch (error) {
      console.error('Failed to log user message:', error);
    }
  }

  // Log assistant response in real-time
  logAssistantMessage(message, processingTime = null) {
    try {
      const logFile = this.getLogFilePath();
      const timestamp = this.formatTimestamp();

      let logEntry = `\n[${timestamp}] ASSISTANT`;
      if (processingTime) {
        logEntry += ` (${processingTime}ms)`;
      }
      logEntry += `:\n${message}\n`;
      logEntry += '\n────────────────────────────────────────────────────────────────────────────────\n';

      appendFileSync(logFile, logEntry, 'utf-8');
    } catch (error) {
      console.error('Failed to log assistant message:', error);
    }
  }

  // Log errors
  logError(error, context = '') {
    try {
      const logFile = this.getLogFilePath();
      const timestamp = this.formatTimestamp();

      let logEntry = `\n[${timestamp}] ERROR`;
      if (context) {
        logEntry += ` (${context})`;
      }
      logEntry += `:\n${error.message || error}\n`;
      logEntry += '\n────────────────────────────────────────────────────────────────────────────────\n';

      appendFileSync(logFile, logEntry, 'utf-8');
    } catch (err) {
      console.error('Failed to log error:', err);
    }
  }

  // Log session start
  logSessionStart(sessionId = null) {
    try {
      const logFile = this.getLogFilePath();
      const timestamp = this.formatTimestamp();

      let logEntry = `\n\n╔══════════════════════════════════════════════════════════════════════════════╗
║  NEW SESSION STARTED - ${timestamp}${sessionId ? ` - ID: ${sessionId}` : ''}
╚══════════════════════════════════════════════════════════════════════════════╝\n`;

      appendFileSync(logFile, logEntry, 'utf-8');
    } catch (error) {
      console.error('Failed to log session start:', error);
    }
  }

  // Get all log files
  async getLogFiles() {
    try {
      const files = await fs.readdir(this.logsDir);
      return files
        .filter(f => f.startsWith('chat-') && f.endsWith('.txt'))
        .sort()
        .reverse();
    } catch (error) {
      console.error('Failed to get log files:', error);
      return [];
    }
  }

  // Read a specific log file
  async readLogFile(filename) {
    try {
      const filePath = path.join(this.logsDir, filename);
      if (!existsSync(filePath)) {
        return null;
      }
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      console.error('Failed to read log file:', error);
      return null;
    }
  }
}

// Export singleton instance
const chatLogger = new ChatLogger();
export default chatLogger;
