import { WebSocketServer } from 'ws';
import os from 'os';
import processManager from '../services/processManager.js';

// node-pty is optional — may not be available in cloud/container environments
let pty = null;
try {
  pty = await import('node-pty');
} catch (e) {
  console.warn('[terminal] node-pty not available — terminal feature disabled:', e.message);
}

// Get shell based on platform
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
const shellArgs = os.platform() === 'win32' ? ['-NoLogo'] : [];

export function setupTerminalWebSocket(server) {
  if (!pty) {
    console.warn('[terminal] Skipping terminal WebSocket setup — node-pty unavailable');
    return null;
  }

  let wss;
  try {
    wss = new WebSocketServer({ server, path: '/terminal' });
  } catch (error) {
    console.error('Failed to create WebSocket server:', error);
    return null;
  }

  // Handle WebSocket server errors
  wss.on('error', (error) => {
    console.error('WebSocket Server error:', error);
    // Don't crash - just log
  });

  wss.on('connection', (ws, req) => {
    console.log('Terminal WebSocket connected from:', req.socket.remoteAddress);

    let ptyProcess = null;
    let ptyEntry = null;
    let currentCwd = process.cwd();

    // Create PTY process
    const createPty = (cwd) => {
      // Clean up existing PTY
      if (ptyProcess) {
        ptyProcess.kill();
        if (ptyEntry) {
          processManager.unregisterPtyProcess(ptyEntry);
          ptyEntry = null;
        }
      }

      try {
        ptyProcess = (pty.default || pty).spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: cwd || process.cwd(),
          env: {
            ...process.env,
            TERM: 'xterm-256color'
          },
          useConpty: true // Use Windows ConPTY for better compatibility
        });

        // Register with process manager for graceful shutdown
        ptyEntry = processManager.registerPtyProcess(ptyProcess, ws);

        ptyProcess.onData((data) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(data);
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          console.log(`PTY process exited with code ${exitCode}`);
          // Unregister from process manager
          if (ptyEntry) {
            processManager.unregisterPtyProcess(ptyEntry);
            ptyEntry = null;
          }
          try {
            if (ws.readyState === ws.OPEN) {
              ws.send(`\r\nProcess exited with code ${exitCode}\r\n`);
            }
          } catch (e) {
            console.error('Error sending exit message:', e);
          }
        });

        currentCwd = cwd || process.cwd();
      } catch (error) {
        console.error('Failed to create PTY:', error);
        if (ws.readyState === ws.OPEN) {
          ws.send(`\r\nFailed to start terminal: ${error.message}\r\n`);
        }
      }
    };

    // Initial PTY creation
    createPty();

    ws.on('message', (message) => {
      try {
        const msgStr = message.toString();
        const data = JSON.parse(msgStr);

        switch (data.type) {
          case 'input':
            if (ptyProcess && data.data) {
              // Write input directly without any modification
              ptyProcess.write(data.data);
            }
            break;

          case 'resize':
            if (ptyProcess && data.cols && data.rows) {
              ptyProcess.resize(data.cols, data.rows);
            }
            break;

          case 'cwd':
            if (data.path) {
              // Change directory in the existing PTY
              if (ptyProcess) {
                const cdCommand = os.platform() === 'win32'
                  ? `cd "${data.path}"\r`
                  : `cd "${data.path}"\n`;
                ptyProcess.write(cdCommand);
              }
              currentCwd = data.path;
            }
            break;

          case 'restart':
            createPty(currentCwd);
            break;

          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (error) {
        // If not JSON, treat as raw input
        if (ptyProcess) {
          ptyProcess.write(message.toString());
        }
      }
    });

    ws.on('close', () => {
      console.log('Terminal WebSocket disconnected');
      if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
      }
      if (ptyEntry) {
        processManager.unregisterPtyProcess(ptyEntry);
        ptyEntry = null;
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      if (ptyProcess) {
        ptyProcess.kill();
        ptyProcess = null;
      }
      if (ptyEntry) {
        processManager.unregisterPtyProcess(ptyEntry);
        ptyEntry = null;
      }
    });
  });

  return wss;
}

export default setupTerminalWebSocket;
