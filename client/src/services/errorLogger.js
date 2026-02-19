// ═══════════════════════════════════════════════════════════════════════════════
// ERROR LOGGER SERVICE
// Captures and stores application errors for display in Settings > Utilities
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_LOGS = 100;
const STORAGE_KEY = 'credm_error_logs';
const MAX_AGE_DAYS = 30; // Auto-purge logs older than 30 days

/**
 * Remove error logs older than MAX_AGE_DAYS
 * @param {Array} logs - Array of log objects
 * @returns {Array} Filtered array with old logs removed
 */
function purgeOldLogs(logs) {
  const cutoff = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  return logs.filter(log => {
    if (!log.timestamp) return true; // keep logs without timestamps
    return new Date(log.timestamp).getTime() >= cutoff;
  });
}

/**
 * Log an error to the error log
 * @param {Object} error - Error object or string
 * @param {string} severity - 'error' | 'warning' | 'info'
 * @param {string} file - Optional file path where error occurred
 */
export function logError(error, severity = 'error', file = null) {
  try {
    let logs = getErrorLogs();

    // Auto-purge logs older than 30 days
    logs = purgeOldLogs(logs);

    const newLog = {
      id: crypto.randomUUID(),
      message: typeof error === 'string' ? error : error.message || 'Unknown error',
      stack: error?.stack || null,
      severity,
      file,
      timestamp: new Date().toISOString()
    };

    // Add to beginning of array
    logs.unshift(newLog);

    // Keep only the last MAX_LOGS entries
    if (logs.length > MAX_LOGS) {
      logs.length = MAX_LOGS;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));

    return newLog;
  } catch (e) {
    console.error('Failed to log error:', e);
    return null;
  }
}

/**
 * Get all error logs (auto-purges entries older than 30 days)
 * @returns {Array} Array of error log objects
 */
export function getErrorLogs() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      let logs = JSON.parse(stored);
      const before = logs.length;
      logs = purgeOldLogs(logs);
      // Persist the purge if any were removed
      if (logs.length < before) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
      }
      return logs;
    }
  } catch (e) {
    console.error('Failed to get error logs:', e);
  }
  return [];
}

/**
 * Clear all error logs
 */
export function clearErrorLogs() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear error logs:', e);
  }
}

/**
 * Get error count by severity
 * @returns {Object} Object with counts by severity
 */
export function getErrorCounts() {
  const logs = getErrorLogs();
  return {
    total: logs.length,
    error: logs.filter(l => l.severity === 'error').length,
    warning: logs.filter(l => l.severity === 'warning').length,
    info: logs.filter(l => l.severity === 'info').length
  };
}

/**
 * Set up global error handlers to automatically capture errors
 */
export function setupGlobalErrorHandlers() {
  // Capture unhandled errors
  window.addEventListener('error', (event) => {
    logError({
      message: event.message,
      stack: event.error?.stack
    }, 'error', event.filename);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    logError({
      message: event.reason?.message || 'Unhandled promise rejection',
      stack: event.reason?.stack
    }, 'error');
  });

  // Override console.error to capture logged errors
  const originalConsoleError = console.error;
  console.error = (...args) => {
    // Call original console.error
    originalConsoleError.apply(console, args);

    // Log the error
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');

    // Only log if it looks like an actual error
    if (message.toLowerCase().includes('error') ||
        message.toLowerCase().includes('failed') ||
        message.toLowerCase().includes('exception')) {
      logError(message, 'error');
    }
  };

  // Override console.warn to capture warnings
  const originalConsoleWarn = console.warn;
  console.warn = (...args) => {
    originalConsoleWarn.apply(console, args);

    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');

    logError(message, 'warning');
  };
}

export default {
  logError,
  getErrorLogs,
  clearErrorLogs,
  getErrorCounts,
  setupGlobalErrorHandlers
};
