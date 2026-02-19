// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS MANAGER
// Handles graceful shutdown and process cleanup
// ═══════════════════════════════════════════════════════════════════════════════

import winston from 'winston';
import readline from 'readline';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class ProcessManager {
  constructor() {
    this.processes = new Map();
    this.server = null;
    this.wss = null;
    this.db = null;
    this.isShuttingDown = false;
    this.ptyProcesses = new Set();
    this.initialized = false;
    this.cleanupCallbacks = [];
  }

  // Initialize shutdown handlers (call after construction)
  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    // Handle various termination signals
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));

    // SIGHUP is not available on Windows
    if (process.platform !== 'win32') {
      process.on('SIGHUP', () => this.gracefulShutdown('SIGHUP'));
    }

    // Handle Windows-specific close events
    if (process.platform === 'win32') {
      // Only attach readline if stdin is a TTY (interactive terminal).
      // When run under concurrently/npm, stdin is piped and the 'close'
      // event fires spuriously, killing the server on browser refresh.
      if (process.stdin.isTTY) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        rl.on('close', () => {
          if (!this.isShuttingDown) {
            this.gracefulShutdown('STDIN_CLOSE');
          }
        });
      }
    }

    // Handle uncaught errors gracefully
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      // Don't shutdown on uncaught exceptions - let the server continue
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't shutdown on unhandled rejections - let the server continue
    });

    // Handle 'exit' event to ensure cleanup
    process.on('exit', (code) => {
      if (!this.isShuttingDown) {
        this.cleanupSync();
      }
      logger.info(`Process exiting with code ${code}`);
    });

    logger.info('Process manager initialized with shutdown handlers');
  }

  // Register the HTTP server
  registerServer(server) {
    this.server = server;
  }

  // Register the WebSocket server
  registerWebSocketServer(wss) {
    this.wss = wss;
  }

  // Register database connection
  registerDatabase(db) {
    this.db = db;
  }

  // Register a PTY process
  registerPtyProcess(pty, ws) {
    const entry = { pty, ws, createdAt: Date.now() };
    this.ptyProcesses.add(entry);
    return entry;
  }

  // Unregister a PTY process
  unregisterPtyProcess(entry) {
    this.ptyProcesses.delete(entry);
  }

  // Register a generic child process
  registerProcess(name, childProcess) {
    this.processes.set(name, {
      process: childProcess,
      createdAt: Date.now()
    });
  }

  // Unregister a process
  unregisterProcess(name) {
    this.processes.delete(name);
  }

  // Register a cleanup callback
  registerCleanupCallback(name, callback) {
    this.cleanupCallbacks.push({ name, callback });
  }

  // Synchronous cleanup for exit event
  cleanupSync() {
    logger.info('Running synchronous cleanup...');

    // Kill all PTY processes
    for (const entry of this.ptyProcesses) {
      try {
        if (entry.pty) {
          entry.pty.kill();
        }
      } catch (e) {
        // Ignore errors during sync cleanup
      }
    }

    // Kill all child processes
    for (const [name, entry] of this.processes) {
      try {
        if (entry.process && !entry.process.killed) {
          entry.process.kill('SIGTERM');
        }
      } catch (e) {
        // Ignore errors during sync cleanup
      }
    }
  }

  // Graceful shutdown handler
  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      logger.info('Shutdown already in progress...');
      return;
    }

    this.isShuttingDown = true;
    logger.info(`\n${'═'.repeat(60)}`);
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    logger.info('═'.repeat(60));

    const shutdownTimeout = setTimeout(() => {
      logger.error('Shutdown timeout exceeded. Forcing exit...');
      process.exit(1);
    }, 10000); // 10 second timeout

    try {
      // 1. Kill all PTY processes (terminals)
      logger.info(`Terminating ${this.ptyProcesses.size} terminal session(s)...`);
      for (const entry of this.ptyProcesses) {
        try {
          if (entry.pty) {
            entry.pty.kill();
          }
          if (entry.ws && entry.ws.readyState === 1) {
            entry.ws.close();
          }
        } catch (e) {
          logger.warn('Error closing PTY:', e.message);
        }
      }
      this.ptyProcesses.clear();

      // 2. Kill all registered child processes
      logger.info(`Terminating ${this.processes.size} child process(es)...`);
      for (const [name, entry] of this.processes) {
        try {
          if (entry.process && !entry.process.killed) {
            entry.process.kill('SIGTERM');
            logger.info(`  → Killed process: ${name}`);
          }
        } catch (e) {
          logger.warn(`Error killing process ${name}:`, e.message);
        }
      }
      this.processes.clear();

      // 3. Close WebSocket server
      if (this.wss) {
        logger.info('Closing WebSocket server...');
        try {
          // Close all WebSocket connections
          this.wss.clients.forEach(client => {
            try {
              client.close();
            } catch (e) {}
          });
          this.wss.close();
        } catch (e) {
          logger.warn('Error closing WebSocket server:', e.message);
        }
      }

      // 4. Close HTTP server
      if (this.server) {
        logger.info('Closing HTTP server...');
        await new Promise((resolve) => {
          this.server.close((err) => {
            if (err) {
              logger.warn('Error closing server:', err.message);
            }
            resolve();
          });
        });
      }

      // 5. Close database connections
      if (this.db) {
        logger.info('Closing database connections...');
        try {
          this.db = null;
        } catch (e) {
          logger.warn('Error closing database:', e.message);
        }
      }

      // 6. Run custom cleanup callbacks
      if (this.cleanupCallbacks.length > 0) {
        logger.info(`Running ${this.cleanupCallbacks.length} cleanup callback(s)...`);
        for (const { name, callback } of this.cleanupCallbacks) {
          try {
            await callback();
            logger.info(`  → Cleanup complete: ${name}`);
          } catch (e) {
            logger.warn(`Error in cleanup callback ${name}:`, e.message);
          }
        }
      }

      clearTimeout(shutdownTimeout);
      logger.info('═'.repeat(60));
      logger.info('Graceful shutdown complete. Goodbye!');
      logger.info('═'.repeat(60));

      process.exit(0);
    } catch (error) {
      clearTimeout(shutdownTimeout);
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  // Get status of all processes
  getStatus() {
    return {
      isShuttingDown: this.isShuttingDown,
      ptyProcessCount: this.ptyProcesses.size,
      childProcessCount: this.processes.size,
      serverRunning: !!this.server,
      wssRunning: !!this.wss
    };
  }
}

// Singleton instance
const processManager = new ProcessManager();

export default processManager;
