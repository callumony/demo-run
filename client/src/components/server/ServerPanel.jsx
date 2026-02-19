import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Server, Play, Square, RefreshCw, Settings, Wifi, WifiOff,
  CheckCircle, XCircle, AlertCircle, Loader
} from 'lucide-react';
import './ServerPanel.css';

const DEFAULT_PORT = parseInt(new URL(import.meta.env.VITE_API_URL || 'http://localhost:3001').port) || 3001;
const API_BASE = 'http://localhost';
const RECONNECT_INTERVALS = [2000, 5000, 10000, 30000]; // Escalating reconnect intervals

export default function ServerPanel() {
  const [serverStatus, setServerStatus] = useState('unknown'); // unknown, online, offline, checking, reconnecting
  const [port, setPort] = useState(DEFAULT_PORT);
  const [editingPort, setEditingPort] = useState(false);
  const [tempPort, setTempPort] = useState(DEFAULT_PORT.toString());
  const [lastChecked, setLastChecked] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [logs, setLogs] = useState([]);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [autoReconnectEnabled, setAutoReconnectEnabled] = useState(true);
  const reconnectTimerRef = useRef(null);
  const wasOnlineRef = useRef(false);

  // Add log entry
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-50), { message, type, timestamp }]);
  }, []);

  // Clear any pending reconnect timer
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Schedule a reconnect attempt
  const scheduleReconnect = useCallback((attempt) => {
    if (!autoReconnectEnabled) return;

    clearReconnectTimer();
    const interval = RECONNECT_INTERVALS[Math.min(attempt, RECONNECT_INTERVALS.length - 1)];
    const seconds = Math.round(interval / 1000);

    addLog(`Auto-reconnect in ${seconds}s (attempt ${attempt + 1})...`, 'info');
    setServerStatus('reconnecting');

    reconnectTimerRef.current = setTimeout(() => {
      setReconnectAttempt(attempt);
      checkServerStatus(false, true);
    }, interval);
  }, [autoReconnectEnabled, addLog, clearReconnectTimer]);

  // Check server status
  const checkServerStatus = useCallback(async (isManualRefresh = false, isReconnectAttempt = false) => {
    if (!isReconnectAttempt) {
      clearReconnectTimer();
    }
    setServerStatus('checking');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(`${API_BASE}:${port}/api/config`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        setServerStatus('online');
        setServerInfo(data);
        setLastChecked(new Date());
        setReconnectAttempt(0); // Reset reconnect counter on success
        clearReconnectTimer();

        if (isReconnectAttempt) {
          addLog(`Reconnected to server at port ${port}`, 'success');
        } else if (isManualRefresh) {
          addLog(`Connected to server at port ${port}`, 'success');
        } else if (!wasOnlineRef.current) {
          addLog(`Server online at port ${port}`, 'success');
        }
        wasOnlineRef.current = true;
        return true;
      } else {
        setServerStatus('offline');
        setServerInfo(null);
        addLog(`Server returned status ${response.status}`, 'error');

        // Schedule reconnect if we were previously online
        if (wasOnlineRef.current && autoReconnectEnabled) {
          scheduleReconnect(reconnectAttempt + 1);
        }
        wasOnlineRef.current = false;
        return false;
      }
    } catch (error) {
      setServerStatus('offline');
      setServerInfo(null);

      if (error.name === 'AbortError') {
        addLog(`Connection timeout - server not responding`, 'error');
      } else {
        addLog(`Connection failed: ${error.message}`, 'error');
      }

      // Schedule reconnect if we were previously online or this is a reconnect attempt
      if ((wasOnlineRef.current || isReconnectAttempt) && autoReconnectEnabled) {
        scheduleReconnect(reconnectAttempt + 1);
      }
      wasOnlineRef.current = false;
      return false;
    }
  }, [port, addLog, autoReconnectEnabled, reconnectAttempt, scheduleReconnect, clearReconnectTimer]);

  // Clean up on unmount
  useEffect(() => {
    return () => clearReconnectTimer();
  }, [clearReconnectTimer]);

  // Check status on mount and periodically
  useEffect(() => {
    checkServerStatus();
    const interval = setInterval(() => checkServerStatus(), 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [port]); // Only re-run when port changes, not on every checkServerStatus change

  // Handle port change
  const handlePortSave = () => {
    const newPort = parseInt(tempPort, 10);
    if (newPort >= 1 && newPort <= 65535) {
      setPort(newPort);
      setEditingPort(false);
      addLog(`Port changed to ${newPort}`, 'info');
      // Check status with new port
      setTimeout(() => checkServerStatus(), 100);
    } else {
      addLog('Invalid port number (1-65535)', 'error');
    }
  };

  // Refresh/reconnect
  const handleRefresh = () => {
    addLog('Attempting to connect...', 'info');
    checkServerStatus(true);
  };

  // Cancel auto-reconnect
  const cancelReconnect = () => {
    clearReconnectTimer();
    setReconnectAttempt(0);
    setServerStatus('offline');
    addLog('Auto-reconnect cancelled', 'info');
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (serverStatus) {
      case 'online':
        return <CheckCircle size={16} className="status-icon online" />;
      case 'offline':
        return <XCircle size={16} className="status-icon offline" />;
      case 'checking':
        return <Loader size={16} className="status-icon checking spinning" />;
      case 'reconnecting':
        return <RefreshCw size={16} className="status-icon reconnecting spinning" />;
      default:
        return <AlertCircle size={16} className="status-icon unknown" />;
    }
  };

  // Get status text
  const getStatusText = () => {
    switch (serverStatus) {
      case 'online':
        return 'Connected';
      case 'offline':
        return 'Disconnected';
      case 'checking':
        return 'Checking...';
      case 'reconnecting':
        return 'Reconnecting...';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="server-panel">
      {/* Status Header */}
      <div className="server-header">
        <div className="server-status">
          {getStatusIcon()}
          <span className="status-text">{getStatusText()}</span>
        </div>
        <div className="server-actions">
          <button
            className="server-action-btn"
            onClick={handleRefresh}
            disabled={serverStatus === 'checking'}
            title="Refresh Status"
          >
            <RefreshCw size={14} className={serverStatus === 'checking' ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* Server Info */}
      <div className="server-content">
        {/* Connection Settings */}
        <div className="server-section">
          <h4>Connection Settings</h4>

          <div className="setting-row">
            <label>Host</label>
            <span className="setting-value">localhost</span>
          </div>

          <div className="setting-row">
            <label>Port</label>
            {editingPort ? (
              <div className="port-edit">
                <input
                  type="number"
                  value={tempPort}
                  onChange={(e) => setTempPort(e.target.value)}
                  min="1"
                  max="65535"
                  autoFocus
                />
                <button className="btn-small" onClick={handlePortSave}>Save</button>
                <button className="btn-small cancel" onClick={() => {
                  setEditingPort(false);
                  setTempPort(port.toString());
                }}>Cancel</button>
              </div>
            ) : (
              <div className="port-display">
                <span className="setting-value">{port}</span>
                <button className="btn-edit" onClick={() => {
                  setTempPort(port.toString());
                  setEditingPort(true);
                }}>
                  <Settings size={12} />
                </button>
              </div>
            )}
          </div>

          <div className="setting-row">
            <label>URL</label>
            <span className="setting-value url">{API_BASE}:{port}</span>
          </div>
        </div>

        {/* Server Info (when connected) */}
        {serverStatus === 'online' && serverInfo && (
          <div className="server-section">
            <h4>Server Info</h4>
            <div className="setting-row">
              <label>Name</label>
              <span className="setting-value">{serverInfo.companyName || 'Unknown'}</span>
            </div>
            <div className="setting-row">
              <label>Bot</label>
              <span className="setting-value">{serverInfo.botName || 'AI Assistant'}</span>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="server-section">
          <h4>Quick Actions</h4>
          <div className="server-buttons">
            <button
              className={`server-btn ${serverStatus === 'online' ? 'connected' : ''}`}
              onClick={handleRefresh}
              disabled={serverStatus === 'checking'}
            >
              {serverStatus === 'online' ? <Wifi size={16} /> : <WifiOff size={16} />}
              {serverStatus === 'online' ? 'Reconnect' : 'Connect'}
            </button>
          </div>
        </div>

        {/* Connection Log */}
        <div className="server-section logs">
          <h4>Connection Log</h4>
          <div className="server-logs">
            {logs.length === 0 ? (
              <div className="log-empty">No activity yet</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={`log-entry ${log.type}`}>
                  <span className="log-time">{log.timestamp}</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Last Checked */}
        {lastChecked && (
          <div className="last-checked">
            Last checked: {lastChecked.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
