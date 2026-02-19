import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TerminalIcon, RotateCcw, Trash2 } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import './PowerShellTerminal.css';

const WS_URL = import.meta.env.VITE_WS_URL || `ws://localhost:${new URL(import.meta.env.VITE_API_URL || 'http://localhost:3001').port || 3001}`;

export default function PowerShellTerminal() {
  const terminalRef = useRef(null);
  const terminalInstanceRef = useRef(null);
  const wsRef = useRef(null);
  const fitAddonRef = useRef(null);
  const inputHandlerRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { workspacePath } = useWorkspace();
  const workspacePathRef = useRef(workspacePath);

  // Keep workspacePath ref updated
  useEffect(() => {
    workspacePathRef.current = workspacePath;
  }, [workspacePath]);

  // Create WebSocket connection
  const connectWebSocket = useCallback((terminal, retryCount = 0) => {
    // Clear any existing retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent onclose from firing
      wsRef.current.close();
      wsRef.current = null;
    }

    // Dispose of existing input handler
    if (inputHandlerRef.current) {
      inputHandlerRef.current.dispose();
      inputHandlerRef.current = null;
    }

    setIsConnecting(true);

    try {
      const ws = new WebSocket(`${WS_URL}/terminal`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        terminal.writeln('\x1b[1;32m✓ Connected to PowerShell\x1b[0m');
        terminal.writeln('');

        // Focus terminal for immediate typing
        terminal.focus();

        // Send initial resize
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          ws.send(JSON.stringify({
            type: 'resize',
            cols: terminal.cols,
            rows: terminal.rows
          }));
        }

        // Send workspace path if available
        if (workspacePathRef.current) {
          ws.send(JSON.stringify({ type: 'cwd', path: workspacePathRef.current }));
        }
      };

      ws.onmessage = (event) => {
        terminal.write(event.data);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        terminal.writeln('');
        terminal.writeln('\x1b[1;31m✗ Disconnected from PowerShell\x1b[0m');
        terminal.writeln('\x1b[90mClick Restart to reconnect\x1b[0m');
      };

      ws.onerror = () => {
        setIsConnecting(false);
        if (retryCount === 0) {
          terminal.writeln('\x1b[1;31mConnection error - server may be offline\x1b[0m');
          terminal.writeln('\x1b[90mClick Restart to try again\x1b[0m');
        }
      };

      // Register input handler
      inputHandlerRef.current = terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'input', data }));
        }
      });

    } catch (error) {
      console.error('WebSocket connection failed:', error);
      setIsConnecting(false);
      terminal.writeln('\x1b[1;31mFailed to connect to terminal server\x1b[0m');
    }
  }, []);

  // Initialize terminal
  useEffect(() => {
    let terminal = null;
    let fitAddon = null;

    const initTerminal = async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        await import('@xterm/xterm/css/xterm.css');

        terminal = new Terminal({
          cursorBlink: true,
          cursorStyle: 'block',
          fontSize: 13,
          fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
          scrollback: 1000,
          theme: {
            background: '#0d0d14',
            foreground: '#e5e7eb',
            cursor: '#6366f1',
            cursorAccent: '#0d0d14',
            selectionBackground: 'rgba(99, 102, 241, 0.3)',
            black: '#1a1b26',
            red: '#f87171',
            green: '#4ade80',
            yellow: '#fbbf24',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#22d3ee',
            white: '#e5e7eb',
            brightBlack: '#6b7280',
            brightRed: '#fca5a5',
            brightGreen: '#86efac',
            brightYellow: '#fde047',
            brightBlue: '#93c5fd',
            brightMagenta: '#d8b4fe',
            brightCyan: '#67e8f9',
            brightWhite: '#f9fafb'
          },
          allowProposedApi: true
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);

        terminalInstanceRef.current = terminal;
        fitAddonRef.current = fitAddon;

        if (terminalRef.current) {
          terminal.open(terminalRef.current);
          fitAddon.fit();
          connectWebSocket(terminal);
        }

        setIsLoading(false);
      } catch (error) {
        console.error('Failed to initialize terminal:', error);
        setIsLoading(false);
      }
    };

    initTerminal();

    // Handle resize
    const handleResize = () => {
      if (fitAddonRef.current && terminalInstanceRef.current) {
        fitAddonRef.current.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: terminalInstanceRef.current.cols,
            rows: terminalInstanceRef.current.rows
          }));
        }
      }
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (inputHandlerRef.current) {
        inputHandlerRef.current.dispose();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (terminal) {
        terminal.dispose();
      }
    };
  }, [connectWebSocket]);

  // Update working directory when workspace changes
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && workspacePath) {
      wsRef.current.send(JSON.stringify({ type: 'cwd', path: workspacePath }));
    }
  }, [workspacePath]);

  // Restart handler - reconnects to server
  const handleRestart = useCallback(() => {
    if (!terminalInstanceRef.current || isConnecting) return;

    // Clear the terminal
    terminalInstanceRef.current.reset();
    terminalInstanceRef.current.clear();
    terminalInstanceRef.current.writeln('\x1b[1;33mReconnecting to PowerShell...\x1b[0m');

    // Connect to WebSocket
    connectWebSocket(terminalInstanceRef.current);
  }, [connectWebSocket, isConnecting]);

  // Clear handler - clears terminal display
  const handleClear = useCallback(() => {
    if (!terminalInstanceRef.current) return;

    terminalInstanceRef.current.clear();
    terminalInstanceRef.current.reset();

    // If connected, just clear; if not, show status
    if (isConnected) {
      terminalInstanceRef.current.writeln('\x1b[2J\x1b[H');
    } else {
      terminalInstanceRef.current.writeln('\x1b[1;31m✗ Not connected\x1b[0m');
      terminalInstanceRef.current.writeln('\x1b[90mClick Restart to connect\x1b[0m');
    }
  }, [isConnected]);

  // Focus terminal when clicking on container
  const handleTerminalClick = useCallback(() => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.focus();
    }
  }, []);

  return (
    <div className="powershell-terminal" onClick={handleTerminalClick}>
      <div className="terminal-toolbar" onClick={(e) => e.stopPropagation()}>
        <div className="terminal-status">
          <span className={`status-dot ${isConnected ? 'connected' : ''} ${isConnecting ? 'connecting' : ''}`} />
          <span className="status-text">
            {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="terminal-actions">
          <button
            type="button"
            className="terminal-action-btn"
            onClick={handleClear}
            title="Clear terminal"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="terminal-action-btn"
            onClick={handleRestart}
            disabled={isConnecting}
            title="Restart/Reconnect"
          >
            <RotateCcw size={14} className={isConnecting ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      <div className="terminal-container" ref={terminalRef}>
        {isLoading && (
          <div className="terminal-loading">
            <TerminalIcon size={24} />
            <span>Initializing terminal...</span>
          </div>
        )}
      </div>
    </div>
  );
}
