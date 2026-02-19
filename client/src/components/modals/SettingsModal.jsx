import { useState, useEffect } from 'react';
import {
  X, Folder, Settings, Code, Palette, CheckCircle, HardDrive, Cloud,
  Download, Trash2, RefreshCw, Clock, Github, AlertCircle,
  Check, Archive, LogIn, LogOut, User, Zap, Info, FileText, HelpCircle,
  Shield, TrendingUp, Calendar, CreditCard, ExternalLink, Mail, MessageSquare,
  Wrench, Database, Bug, Bell, Heart, Sparkles, Copy, Brain, Hexagon, Key,
  Server, Wifi, WifiOff, XCircle, Loader, ChevronDown, Sliders, Briefcase,
  Eye, EyeOff, Save, ChevronRight, Phone, Building2, Users, Lightbulb
} from 'lucide-react';
import {
  getUsageStats,
  getMonthlyUsageHistory,
  getDatabaseSize,
  optimizeDatabase,
  getLastOptimization,
  previewTrainingDuplicates,
  removeTrainingDuplicates
} from '../../services/localDatabase';
import {
  getErrorLogs as getLoggedErrors,
  clearErrorLogs as clearLoggedErrors
} from '../../services/errorLogger';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useSettings } from '../../contexts/SettingsContext';
import {
  getBackupStatus,
  listBackups,
  createBackup,
  downloadBackup,
  deleteBackup,
  getBackupSettings,
  updateBackupSettings,
  getCloudConnections,
  loginWithGoogleDrive,
  disconnectGoogleDrive,
  createLocalBackup,
  formatSize,
  formatDate,
  handleOAuthCallback
} from '../../services/backupService';
import { validateHiveCredentials, saveHiveConnection, disconnectHive, fetchWorkspaces as fetchHiveWorkspaces, fetchProjects as fetchHiveProjects, getHiveConnection } from '../../services/hiveService';
import { loginWithGmail, disconnectGmail, getGmailConnectionStatus, fetchContactDirectory } from '../../services/emailService';
import './SettingsModal.css';

// Google Drive icon component (not in lucide)
const GoogleDriveIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M7.71 3.5L1.15 15l3.42 5.94L11.14 9.44 7.71 3.5zm8.56 0l-3.43 5.94 6.57 11.56h6.86L15.7 9.44 16.27 3.5h-0.01zM8 17l3.42-5.94L7.99 3.5 1.43 15.06 4.85 21H8v-4z"/>
  </svg>
);

export default function SettingsModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('general');
  const [workspaceInput, setWorkspaceInput] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const { workspacePath, setWorkspacePath } = useWorkspace();
  const { settings, updateSettingLocal } = useSettings();

  // Backup state
  const [backups, setBackups] = useState([]);
  const [backupSettings, setBackupSettingsState] = useState({
    enabled: false,
    schedule: 'manual',
    time: '03:00', // Default backup time
    cloudProvider: null,
    backupDestination: 'local', // 'local' | 'google'
    notifyOnBackup: false,
    notifyEmail: ''
  });
  const [backupStatus, setBackupStatus] = useState(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');

  // Cloud connections state
  const [connections, setConnections] = useState({
    google: { connected: false, email: null }
  });
  const [isLocalBackingUp, setIsLocalBackingUp] = useState(false);
  const [isConnecting, setIsConnecting] = useState(null);

  // Usage tracking state
  const [usageStats, setUsageStats] = useState(null);
  const [monthlyHistory, setMonthlyHistory] = useState([]);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

  // Utilities state
  const [dbSize, setDbSize] = useState(null);
  const [lastOptimization, setLastOptimizationState] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState(null);
  const [errorLogs, setErrorLogs] = useState([]);
  const [newVersionAvailable, setNewVersionAvailable] = useState(null);
  const [serverAccordionOpen, setServerAccordionOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [expandedErrorId, setExpandedErrorId] = useState(null);

  // Help center state (standalone Help tab)
  const [helpFaqIndex, setHelpFaqIndex] = useState(null);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessProjects, setAccessProjects] = useState([]);
  const [accessContacts, setAccessContacts] = useState([]);
  const [isAccessLoading, setIsAccessLoading] = useState(false);
  const [expandedAccessProject, setExpandedAccessProject] = useState(null);
  const [accessRequest, setAccessRequest] = useState('');

  // Help center FAQ data
  const HELP_FAQ_ITEMS = [
    {
      question: "Why isn't my page loading correctly?",
      answer: "Check your network connection and ensure all resources are accessible. Clear your browser cache and try refreshing. If the issue persists, inspect the console for any error messages that might indicate missing files or failed requests."
    },
    {
      question: "How do I fix styling issues?",
      answer: "Review your CSS for conflicting rules or specificity problems. Use your browser's developer tools to inspect elements and see which styles are being applied or overridden. Check for typos in class names and ensure stylesheets are properly linked."
    },
    {
      question: "What should I do when scripts aren't working?",
      answer: "Open the browser console to check for JavaScript errors. Verify that scripts are loaded in the correct order and that dependencies are available. Look for syntax errors, undefined variables, or issues with asynchronous operations."
    },
    {
      question: "How can I improve performance?",
      answer: "Optimize images and assets, minimize HTTP requests, and leverage caching. Consider lazy loading for content below the fold. Profile your code to identify bottlenecks and reduce unnecessary re-renders or computations."
    },
    {
      question: "Why are my forms not submitting?",
      answer: "Ensure form elements have proper attributes and event handlers are attached correctly. Check for validation errors that might be preventing submission. Verify that the server endpoint is accessible and handling requests properly."
    },
    {
      question: "How do I debug API connections?",
      answer: "Use the network tab in developer tools to monitor requests and responses. Check for CORS issues, authentication problems, or incorrect endpoints. Log request payloads and responses to identify where communication is failing."
    }
  ];

  // Load access data when access modal opens
  const loadAccessData = async () => {
    setIsAccessLoading(true);
    try {
      const conn = getHiveConnection();
      if (conn) {
        const workspaces = await fetchHiveWorkspaces(conn.apiKey, conn.userId);
        if (workspaces.length > 0) {
          const hiveProjects = await fetchHiveProjects(conn.apiKey, conn.userId, workspaces[0].id);
          setAccessProjects(Array.isArray(hiveProjects) ? hiveProjects : []);
        }
      }
      if (settings.contactSheetId) {
        const contactList = await fetchContactDirectory(settings.contactSheetId);
        setAccessContacts(contactList);
      }
    } catch (e) {
      console.error('Failed to load access data:', e);
    } finally {
      setIsAccessLoading(false);
    }
  };

  const getContactForProject = (projectName) => {
    if (!accessContacts.length || !projectName) return null;
    const name = projectName.toLowerCase();
    return accessContacts.find(c =>
      (c.company && name.includes(c.company.toLowerCase())) ||
      (c.name && name.includes(c.name.toLowerCase()))
    );
  };

  // Duplicate removal state
  const [duplicatePreview, setDuplicatePreview] = useState(null);
  const [isLoadingDuplicates, setIsLoadingDuplicates] = useState(false);
  const [isRemovingDuplicates, setIsRemovingDuplicates] = useState(false);
  const [duplicateRemovalResult, setDuplicateRemovalResult] = useState(null);

  // Server connection state
  const [serverStatus, setServerStatus] = useState('unknown');
  const defaultPort = parseInt(new URL(import.meta.env.VITE_API_URL || 'http://localhost:3001').port) || 3001;
  const [serverPort, setServerPort] = useState(defaultPort);
  const [editingPort, setEditingPort] = useState(false);
  const [tempPort, setTempPort] = useState(String(defaultPort));
  const [serverInfo, setServerInfo] = useState(null);
  const [serverLogs, setServerLogs] = useState([]);
  const [lastServerCheck, setLastServerCheck] = useState(null);

  // Hive integration state - initialize from persisted settings
  const [hiveApiKey, setHiveApiKey] = useState(settings.hiveApiKey || '');
  const [hiveUserId, setHiveUserId] = useState(settings.hiveUserId || '');
  const [isConnectingHive, setIsConnectingHive] = useState(false);
  const [hiveError, setHiveError] = useState('');
  const [hiveSettingsProjects, setHiveSettingsProjects] = useState([]);
  const [isLoadingHiveProjects, setIsLoadingHiveProjects] = useState(false);

  // Gmail integration state
  const [gmailConnection, setGmailConnection] = useState({ connected: false, email: null });
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [gmailError, setGmailError] = useState('');

  // Integration API info state
  const [integrationsInfo, setIntegrationsInfo] = useState(null);

  // Setup tab state
  const [setupInfo, setSetupInfo] = useState(null);
  const [isLoadingSetup, setIsLoadingSetup] = useState(false);
  const [setupEdits, setSetupEdits] = useState({});
  const [isSavingSetup, setIsSavingSetup] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const [showSecrets, setShowSecrets] = useState({});

  // Prevent background page scroll while this modal is open
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  // Initialize input with current workspace path
  useEffect(() => {
    if (workspacePath) {
      setWorkspaceInput(workspacePath);
    }
  }, [workspacePath]);

  // Sync Hive input fields when settings change (e.g., on first load)
  useEffect(() => {
    if (settings.hiveApiKey && !hiveApiKey) {
      setHiveApiKey(settings.hiveApiKey);
    }
    if (settings.hiveUserId && !hiveUserId) {
      setHiveUserId(settings.hiveUserId);
    }
  }, [settings.hiveApiKey, settings.hiveUserId]);

  // Fetch Hive projects when connected (for default project selector)
  useEffect(() => {
    const loadHiveProjects = async () => {
      if (!settings.hiveConnected) return;
      const conn = getHiveConnection();
      if (!conn || !conn.apiKey || !conn.userId) return;
      setIsLoadingHiveProjects(true);
      try {
        const workspaces = await fetchHiveWorkspaces(conn.apiKey, conn.userId);
        if (workspaces && workspaces.length > 0) {
          const wsId = workspaces[0].id || workspaces[0]._id;
          const projects = await fetchHiveProjects(conn.apiKey, conn.userId, wsId);
          setHiveSettingsProjects(Array.isArray(projects) ? projects : []);
        }
      } catch (err) {
        console.error('Error loading Hive projects for settings:', err);
      } finally {
        setIsLoadingHiveProjects(false);
      }
    };
    if ((activeTab === 'integrations' || activeTab === 'apikeys') && settings.hiveConnected) {
      loadHiveProjects();
    }
  }, [activeTab, settings.hiveConnected]);

  // Server connection functions
  const addServerLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setServerLogs(prev => [...prev.slice(-30), { message, type, timestamp }]);
  };

  const checkServerStatus = async (isManualRefresh = false) => {
    setServerStatus('checking');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`http://localhost:${serverPort}/api/config`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        setServerStatus('online');
        setServerInfo(data);
        setLastServerCheck(new Date());
        if (isManualRefresh) {
          addServerLog(`Connected to server at port ${serverPort}`, 'success');
        }
        return true;
      } else {
        setServerStatus('offline');
        setServerInfo(null);
        addServerLog(`Server returned status ${response.status}`, 'error');
        return false;
      }
    } catch (error) {
      setServerStatus('offline');
      setServerInfo(null);
      if (error.name === 'AbortError') {
        addServerLog(`Connection timeout`, 'error');
      } else {
        addServerLog(`Connection failed: ${error.message}`, 'error');
      }
      return false;
    }
  };

  const handlePortSave = () => {
    const newPort = parseInt(tempPort, 10);
    if (newPort >= 1 && newPort <= 65535) {
      setServerPort(newPort);
      setEditingPort(false);
      addServerLog(`Port changed to ${newPort}`, 'info');
      setTimeout(() => checkServerStatus(true), 100);
    } else {
      addServerLog('Invalid port number (1-65535)', 'error');
    }
  };

  // Check server status when utilities tab is active (server section moved there)
  useEffect(() => {
    if (activeTab === 'utilities') {
      checkServerStatus();
    }
  }, [activeTab, serverPort]);

  const getServerStatusIcon = () => {
    switch (serverStatus) {
      case 'online':
        return <CheckCircle size={16} className="server-status-icon online" />;
      case 'offline':
        return <XCircle size={16} className="server-status-icon offline" />;
      case 'checking':
        return <Loader size={16} className="server-status-icon checking spinning" />;
      default:
        return <AlertCircle size={16} className="server-status-icon unknown" />;
    }
  };

  const getServerStatusText = () => {
    switch (serverStatus) {
      case 'online': return 'Connected';
      case 'offline': return 'Disconnected';
      case 'checking': return 'Checking...';
      default: return 'Unknown';
    }
  };

  // Check for OAuth callback on mount
  useEffect(() => {
    const oauthResult = handleOAuthCallback();
    if (oauthResult.success === true) {
      setBackupMessage(`Connected to ${oauthResult.provider} as ${oauthResult.user}`);
      setActiveTab('apikeys');
      loadBackupData();
    } else if (oauthResult.success === false) {
      setBackupMessage(`Connection failed: ${oauthResult.error}`);
      setActiveTab('apikeys');
    }

    // Check for Gmail OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('oauth_success') === 'gmail') {
      const user = urlParams.get('user');
      setGmailConnection({ connected: true, email: user });
      updateSettingLocal('gmailConnected', true);
      updateSettingLocal('gmailEmail', user);
      setStatusMessage(`Gmail connected as ${user}`);
      setActiveTab('apikeys');
      window.history.replaceState({}, document.title, window.location.pathname);
      setTimeout(() => setStatusMessage(''), 5000);
    } else if (urlParams.get('oauth_error') && !oauthResult.success) {
      const error = urlParams.get('oauth_error');
      setGmailError(error);
      setActiveTab('apikeys');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Check Gmail connection and load integration API info when integrations or apikeys tab is active
  useEffect(() => {
    if (activeTab === 'integrations' || activeTab === 'apikeys') {
      getGmailConnectionStatus()
        .then(status => setGmailConnection(status))
        .catch(() => {});

      // Fetch integration API info from server
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      fetch(`${apiUrl}/api/integrations-info`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setIntegrationsInfo(data); })
        .catch(() => {});
    }
  }, [activeTab]);

  // Load backup data when backup or apikeys tab is active
  useEffect(() => {
    if (activeTab === 'backup' || activeTab === 'apikeys') {
      loadBackupData();
    }
  }, [activeTab]);

  // Load usage data when usage tab is active
  useEffect(() => {
    if (activeTab === 'usage') {
      loadUsageData();
    }
  }, [activeTab]);

  // Load setup info when setup or apikeys tab is active
  useEffect(() => {
    if (activeTab === 'setup' || activeTab === 'apikeys') {
      setIsLoadingSetup(true);
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      fetch(`${apiUrl}/api/setup-info`)
        .then(r => r.json())
        .then(data => {
          setSetupInfo(data);
          // Initialize edits from current values
          const edits = {};
          Object.values(data).forEach(group => {
            Object.entries(group).forEach(([envKey, info]) => {
              edits[envKey] = info.value || '';
            });
          });
          setSetupEdits(edits);
        })
        .catch(err => console.error('Error loading setup info:', err))
        .finally(() => setIsLoadingSetup(false));
    }
  }, [activeTab]);

  // Save setup handler
  const handleSaveSetup = async () => {
    setIsSavingSetup(true);
    setSetupMessage('');
    try {
      // Only send values that changed from the original setupInfo
      const changes = {};
      Object.values(setupInfo).forEach(group => {
        Object.entries(group).forEach(([envKey, info]) => {
          if (setupEdits[envKey] !== undefined && setupEdits[envKey] !== info.value) {
            changes[envKey] = setupEdits[envKey];
          }
        });
      });

      if (Object.keys(changes).length === 0) {
        setSetupMessage('No changes to save.');
        setTimeout(() => setSetupMessage(''), 3000);
        setIsSavingSetup(false);
        return;
      }

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/setup-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes)
      });

      const result = await response.json();
      if (result.success) {
        setSetupMessage(`Saved ${result.updatedKeys.length} setting(s) successfully! Changes are live.`);
        // Refresh setup info to reflect new values
        const refreshResp = await fetch(`${apiUrl}/api/setup-info`);
        const refreshData = await refreshResp.json();
        setSetupInfo(refreshData);
        const edits = {};
        Object.values(refreshData).forEach(group => {
          Object.entries(group).forEach(([envKey, info]) => {
            edits[envKey] = info.value || '';
          });
        });
        setSetupEdits(edits);
      } else {
        setSetupMessage(`Error: ${result.error}`);
      }
      setTimeout(() => setSetupMessage(''), 5000);
    } catch (error) {
      setSetupMessage(`Error: ${error.message}`);
    } finally {
      setIsSavingSetup(false);
    }
  };

  const handleSetupEditChange = (envKey, value) => {
    setSetupEdits(prev => ({ ...prev, [envKey]: value }));
  };

  const toggleSecretVisibility = (envKey) => {
    setShowSecrets(prev => ({ ...prev, [envKey]: !prev[envKey] }));
  };

  const loadUsageData = async () => {
    setIsLoadingUsage(true);
    try {
      const [stats, history] = await Promise.all([
        getUsageStats(),
        getMonthlyUsageHistory(12)
      ]);
      setUsageStats(stats);
      setMonthlyHistory(history);
    } catch (error) {
      console.error('Error loading usage data:', error);
    } finally {
      setIsLoadingUsage(false);
    }
  };

  // Load utilities data when utilities tab is active
  useEffect(() => {
    if (activeTab === 'utilities') {
      loadUtilitiesData();
    }
  }, [activeTab]);

  const loadUtilitiesData = async () => {
    try {
      const [size, lastOpt] = await Promise.all([
        getDatabaseSize(),
        getLastOptimization()
      ]);
      setDbSize(size);
      setLastOptimizationState(lastOpt);

      // Check for new version (mock for now - replace with actual API)
      try {
        const response = await fetch('https://api.github.com/repos/your-repo/agent-redm/releases/latest');
        if (response.ok) {
          const data = await response.json();
          const currentVersion = '1.0.0';
          if (data.tag_name && data.tag_name.replace('v', '') !== currentVersion) {
            setNewVersionAvailable({
              version: data.tag_name,
              url: data.html_url,
              notes: data.body?.slice(0, 200)
            });
          }
        }
      } catch (e) {
        // Version check failed, ignore
      }

      // Load error logs from error logger service
      const logs = getLoggedErrors();
      setErrorLogs(logs.slice(0, 50));
    } catch (error) {
      console.error('Error loading utilities data:', error);
    }
  };

  const handleOptimizeDatabase = async () => {
    setIsOptimizing(true);
    setOptimizationResult(null);
    try {
      const result = await optimizeDatabase();
      setOptimizationResult(result);
      // Refresh sizes
      const newSize = await getDatabaseSize();
      setDbSize(newSize);
      const lastOpt = await getLastOptimization();
      setLastOptimizationState(lastOpt);
    } catch (error) {
      setOptimizationResult({ success: false, errors: [error.message] });
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleClearErrorLogs = () => {
    clearLoggedErrors();
    setErrorLogs([]);
  };

  const handlePreviewDuplicates = async () => {
    setIsLoadingDuplicates(true);
    setDuplicatePreview(null);
    setDuplicateRemovalResult(null);
    try {
      const preview = await previewTrainingDuplicates();
      setDuplicatePreview(preview);
    } catch (error) {
      console.error('Error previewing duplicates:', error);
    } finally {
      setIsLoadingDuplicates(false);
    }
  };

  const handleRemoveDuplicates = async () => {
    if (!duplicatePreview || duplicatePreview.totalDuplicates === 0) return;

    setIsRemovingDuplicates(true);
    try {
      const result = await removeTrainingDuplicates();
      setDuplicateRemovalResult(result);
      setDuplicatePreview(null); // Clear preview after removal
    } catch (error) {
      console.error('Error removing duplicates:', error);
      setDuplicateRemovalResult({ success: false, error: error.message });
    } finally {
      setIsRemovingDuplicates(false);
    }
  };

  const loadBackupData = async () => {
    try {
      const [status, backupList, settings, cloudConns] = await Promise.all([
        getBackupStatus(),
        listBackups(),
        getBackupSettings(),
        getCloudConnections()
      ]);
      setBackupStatus(status);
      setBackups(backupList.backups || []);
      setBackupSettingsState(settings);
      setConnections(cloudConns);
    } catch (error) {
      console.error('Error loading backup data:', error);
      setBackupMessage('Error loading backup data');
    }
  };

  const handleSetWorkspace = async () => {
    const path = workspaceInput.trim();
    if (path) {
      try {
        await setWorkspacePath(path);
        setStatusMessage('Workspace set successfully!');
        setTimeout(() => setStatusMessage(''), 3000);
      } catch (error) {
        setStatusMessage('Error: ' + error.message);
      }
    } else {
      setStatusMessage('Please enter a valid path');
    }
  };

  // Backup handlers
  const handleCreateBackup = async (options = {}) => {
    setIsBackingUp(true);
    const isDownload = options.downloadOnly;
    setBackupMessage(isDownload ? 'Creating & downloading backup...' : 'Creating backup...');
    try {
      const result = await createBackup(options);
      if (isDownload) {
        setBackupMessage(`Backup downloaded: ${result.sizeFormatted}`);
      } else {
        setBackupMessage(`Backup stored: ${result.sizeFormatted}`);
        await loadBackupData();
      }
      setTimeout(() => setBackupMessage(''), 5000);
    } catch (error) {
      setBackupMessage(`Error: ${error.message}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadBackup = async (backupName) => {
    try {
      await downloadBackup(backupName);
    } catch (error) {
      setBackupMessage(`Download error: ${error.message}`);
    }
  };

  const handleDeleteBackup = async (backupName) => {
    if (!confirm(`Delete backup "${backupName}"? This cannot be undone.`)) return;
    try {
      await deleteBackup(backupName);
      setBackupMessage('Backup deleted');
      await loadBackupData();
      setTimeout(() => setBackupMessage(''), 3000);
    } catch (error) {
      setBackupMessage(`Delete error: ${error.message}`);
    }
  };

  const handleSaveBackupSettings = async () => {
    try {
      await updateBackupSettings(backupSettings);
      setBackupMessage('Settings saved');
      setTimeout(() => setBackupMessage(''), 3000);
    } catch (error) {
      setBackupMessage(`Error: ${error.message}`);
    }
  };

  // OAuth handlers
  const handleGoogleDriveLogin = async () => {
    setIsConnecting('google');
    setBackupMessage('');
    try {
      const result = await loginWithGoogleDrive();
      setBackupMessage(`Connected to Google Drive as ${result.user}`);
      await loadBackupData();
    } catch (error) {
      setBackupMessage(`Google Drive login failed: ${error.message}`);
    } finally {
      setIsConnecting(null);
    }
  };

  const handleGoogleDriveDisconnect = async () => {
    if (!confirm('Disconnect Google Drive account?')) return;
    try {
      await disconnectGoogleDrive();
      setBackupMessage('Google Drive disconnected');
      await loadBackupData();
    } catch (error) {
      setBackupMessage(`Error: ${error.message}`);
    }
  };

  const handleLocalBackup = async () => {
    setIsLocalBackingUp(true);
    setBackupMessage('Creating local backup...');
    try {
      const result = await createLocalBackup();
      setBackupMessage(`Local backup downloaded: ${result.sizeFormatted}`);
      setTimeout(() => setBackupMessage(''), 5000);
    } catch (error) {
      setBackupMessage(`Error: ${error.message}`);
    } finally {
      setIsLocalBackingUp(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'GENERAL', icon: Settings },
    { id: 'workspace', label: 'WORKSPACE', icon: Folder },
    { id: 'editor', label: 'EDITOR', icon: Code },
    { id: 'backup', label: 'BACKUP', icon: HardDrive },
    { id: 'integrations', label: 'INTEGRATIONS', icon: Hexagon },
    { id: 'utilities', label: 'UTILITIES', icon: Wrench },
    { id: 'usage', label: 'USAGE', icon: TrendingUp },
    { id: 'setup', label: 'SETUP', icon: Sliders },
    { id: 'apikeys', label: 'API KEYS', icon: Key },
    { id: 'help', label: 'HELP', icon: HelpCircle },
    { id: 'about', label: 'ABOUT', icon: Info },
    { id: 'license', label: 'LICENSE', icon: FileText }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {/* Sidebar Tabs */}
          <div className="settings-sidebar">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon size={18} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="settings-content">
            {activeTab === 'workspace' && (
              <div className="settings-section">
                <h3>Workspace</h3>
                <p className="settings-description">
                  Set the root folder for the file explorer. All files and folders within this directory will be shown in the sidebar.
                </p>

                <div className="setting-item">
                  <label>Workspace Folder</label>
                  <div className="input-group">
                    <input
                      type="text"
                      value={workspaceInput}
                      onChange={(e) => setWorkspaceInput(e.target.value)}
                      placeholder="C:\Path\To\Your\Project"
                      onKeyDown={(e) => e.key === 'Enter' && handleSetWorkspace()}
                    />
                    <button type="button" className="btn-primary" onClick={handleSetWorkspace}>
                      Set Folder
                    </button>
                  </div>
                  {statusMessage && (
                    <span className={`status-message ${statusMessage.includes('Error') ? 'error' : 'success'}`}>
                      {statusMessage}
                    </span>
                  )}
                  {workspacePath && !statusMessage && (
                    <span className="current-value">
                      Current: {workspacePath}
                    </span>
                  )}
                </div>

                <div className="setting-item">
                  <label>Theme</label>
                  <select
                    value={settings.theme || 'dark'}
                    onChange={(e) => updateSettingLocal('theme', e.target.value)}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>

                <div className="setting-item">
                  <label>To-Do List Default State</label>
                  <select
                    value={settings.todoListCollapsed ? 'closed' : 'open'}
                    onChange={(e) => updateSettingLocal('todoListCollapsed', e.target.value === 'closed')}
                  >
                    <option value="open">Open by default</option>
                    <option value="closed">Closed by default</option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'editor' && (
              <div className="settings-section">
                <h3>Editor</h3>
                <p className="settings-description">
                  Customize the code editor behavior and appearance.
                </p>

                <div className="setting-item">
                  <label>Font Size</label>
                  <input
                    type="number"
                    min="10"
                    max="24"
                    value={settings.fontSize || 14}
                    onChange={(e) => updateSettingLocal('fontSize', parseInt(e.target.value))}
                  />
                </div>

                <div className="setting-item">
                  <label>Tab Size</label>
                  <select
                    value={settings.tabSize || 4}
                    onChange={(e) => updateSettingLocal('tabSize', parseInt(e.target.value))}
                  >
                    <option value={2}>2 spaces</option>
                    <option value={4}>4 spaces</option>
                    <option value={8}>8 spaces</option>
                  </select>
                </div>

                <div className="setting-item">
                  <label>Default Language</label>
                  <select
                    value={settings.defaultLanguage || 'lua'}
                    onChange={(e) => updateSettingLocal('defaultLanguage', e.target.value)}
                  >
                    <option value="lua">Lua</option>
                    <option value="javascript">JavaScript</option>
                    <option value="typescript">TypeScript</option>
                    <option value="python">Python</option>
                    <option value="html">HTML</option>
                    <option value="css">CSS</option>
                    <option value="json">JSON</option>
                    <option value="markdown">Markdown</option>
                    <option value="csharp">C#</option>
                    <option value="cpp">C++</option>
                    <option value="plaintext">Plain Text</option>
                  </select>
                </div>

                <div className="setting-item">
                  <label>Word Wrap</label>
                  <select
                    value={settings.wordWrap || 'on'}
                    onChange={(e) => updateSettingLocal('wordWrap', e.target.value)}
                  >
                    <option value="on">On</option>
                    <option value="off">Off</option>
                    <option value="wordWrapColumn">Column</option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'backup' && (
              <div className="settings-section backup-section">
                <h3>Backup & Restore</h3>
                <p className="settings-description">
                  Create backups of all your data including training datasets, embeddings, chat history, databases, and settings.
                  Backups are stored in the <strong>OmniBAK</strong> folder (Documents/OmniBAK for local, or OmniBAK folder in Google Drive). Only the 3 most recent backups are retained.
                </p>

                {/* Backup Message */}
                {backupMessage && (
                  <div className={`backup-message ${backupMessage.includes('Error') || backupMessage.includes('failed') ? 'error' : 'success'}`}>
                    {backupMessage.includes('Error') || backupMessage.includes('failed') ? <AlertCircle size={16} /> : <Check size={16} />}
                    {backupMessage}
                  </div>
                )}

                {/* Backup Destination Selector */}
                <div className="backup-destination-section">
                  <h4>Backup Destination</h4>
                  <p className="backup-destination-desc">Choose where to save your backup. Only the selected location will be used.</p>
                  <div className="backup-destination-grid">
                    {[
                      { id: 'local', label: 'Local (HDD)', icon: HardDrive, desc: 'Save to Documents/OmniBAK' },
                      { id: 'google', label: 'Google Drive', icon: GoogleDriveIcon, desc: 'Upload to OmniBAK folder in Drive' }
                    ].map(dest => {
                      const isSelected = backupSettings.backupDestination === dest.id;
                      const DestIcon = dest.icon;
                      // Check if cloud credentials exist in Setup
                      let hasCredentials = dest.id === 'local';
                      let credentialHint = '';
                      if (dest.id === 'google') {
                        const hasToken = connections.google?.connected || (setupInfo?.oauthGoogle?.GOOGLE_CLIENT_ID?.value && setupInfo?.oauthGoogle?.GOOGLE_CLIENT_SECRET?.value);
                        hasCredentials = !!hasToken;
                        credentialHint = hasCredentials ? 'Credentials found' : 'Set Google keys in API KEYS tab';
                      }

                      return (
                        <div
                          key={dest.id}
                          className={`backup-dest-card ${isSelected ? 'selected' : ''} ${!hasCredentials && dest.id !== 'local' ? 'no-creds' : ''}`}
                          onClick={() => setBackupSettingsState(prev => ({ ...prev, backupDestination: dest.id }))}
                        >
                          <div className="backup-dest-icon">
                            <DestIcon size={22} />
                          </div>
                          <div className="backup-dest-info">
                            <span className="backup-dest-label">{dest.label}</span>
                            <span className="backup-dest-desc">{dest.desc}</span>
                            {dest.id !== 'local' && (
                              <span className={`backup-dest-cred ${hasCredentials ? 'ok' : 'missing'}`}>
                                {hasCredentials ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                                {credentialHint}
                              </span>
                            )}
                          </div>
                          <div className="backup-dest-radio">
                            <div className={`radio-dot ${isSelected ? 'active' : ''}`} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Cloud-specific: connection status & link to API KEYS */}
                  {backupSettings.backupDestination === 'google' && (
                    <div className="backup-cloud-config">
                      {connections.google?.connected ? (
                        <div className="cloud-connected-info">
                          <CheckCircle size={14} />
                          <span>Connected as <strong>{connections.google.email}</strong></span>
                        </div>
                      ) : (
                        <div className="backup-cloud-cta">
                          <AlertCircle size={14} />
                          <span>Not connected.</span>
                          <button className="link-to-tab" onClick={() => setActiveTab('apikeys')}>Sign in via API KEYS tab</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Create Backup Button */}
                <div className="backup-actions">
                  <button
                    className="btn-primary backup-btn full-width"
                    onClick={() => {
                      const dest = backupSettings.backupDestination;
                      if (dest === 'local') {
                        handleCreateBackup({ downloadOnly: true });
                      } else if (dest === 'google') {
                        handleCreateBackup({ uploadToCloud: true, cloudProvider: 'google' });
                      }
                    }}
                    disabled={isBackingUp}
                  >
                    {isBackingUp ? <RefreshCw size={16} className="spinning" /> : (
                      backupSettings.backupDestination === 'local' ? <Download size={16} /> : <Cloud size={16} />
                    )}
                    {isBackingUp ? 'Creating Backup...' : `Create Backup to ${
                      backupSettings.backupDestination === 'local' ? 'Local Drive' : 'Google Drive'
                    }`}
                  </button>
                </div>

                {/* Backup Status */}
                {backupStatus && (
                  <div className="backup-status-card">
                    <div className="backup-status-item">
                      <Clock size={16} />
                      <span>Last backup: {backupStatus.lastBackupTime ? formatDate(backupStatus.lastBackupTime) : 'Never'}</span>
                    </div>
                    {backupStatus.schedulerActive && (
                      <div className="backup-status-item active">
                        <RefreshCw size={16} />
                        <span>Scheduler active ({backupSettings.schedule})</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Existing Backups (local) */}
                {backups.length > 0 && (
                  <div className="backup-list-section">
                    <h4>Stored Backups (Local)</h4>
                    <div className="backup-list">
                      {backups.map((backup) => (
                        <div key={backup.name} className="backup-item">
                          <div className="backup-info">
                            <span className="backup-name">{backup.name}</span>
                            <span className="backup-meta">
                              {backup.sizeFormatted} • {formatDate(backup.createdAt)}
                            </span>
                          </div>
                          <div className="backup-item-actions">
                            <button className="btn-icon" onClick={() => handleDownloadBackup(backup.name)} title="Download">
                              <Download size={16} />
                            </button>
                            <button className="btn-icon delete" onClick={() => handleDeleteBackup(backup.name)} title="Delete">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Schedule Settings */}
                <div className="backup-schedule-section">
                  <h4>Automatic Backups</h4>
                  <div className="setting-item checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={backupSettings.enabled}
                        onChange={(e) => setBackupSettingsState(prev => ({ ...prev, enabled: e.target.checked }))}
                      />
                      Enable scheduled backups
                    </label>
                  </div>

                  {backupSettings.enabled && (
                    <>
                      <div className="setting-item">
                        <label>Schedule</label>
                        <select
                          value={backupSettings.schedule}
                          onChange={(e) => setBackupSettingsState(prev => ({ ...prev, schedule: e.target.value }))}
                        >
                          <option value="manual">Manual only</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                        </select>
                      </div>

                      {(backupSettings.schedule === 'daily' || backupSettings.schedule === 'weekly') && (
                        <div className="setting-item">
                          <label>
                            <Clock size={14} />
                            Backup Time
                          </label>
                          <input
                            type="time"
                            value={backupSettings.time || '03:00'}
                            onChange={(e) => setBackupSettingsState(prev => ({ ...prev, time: e.target.value }))}
                            style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)' }}
                          />
                          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                            {backupSettings.schedule === 'daily' 
                              ? `Backup will run daily at ${backupSettings.time || '03:00'}`
                              : `Backup will run weekly at ${backupSettings.time || '03:00'}`}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Email Notification */}
                <div className="backup-schedule-section">
                  <h4>Email Notifications</h4>
                  <div className="setting-item checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={backupSettings.notifyOnBackup || false}
                        onChange={(e) => setBackupSettingsState(prev => ({ ...prev, notifyOnBackup: e.target.checked }))}
                      />
                      Email me when a backup completes or if an error occurs
                    </label>
                  </div>
                  {backupSettings.notifyOnBackup && (
                    <div className="setting-item">
                      <label>
                        <Mail size={14} />
                        Notification Email
                      </label>
                      <input
                        type="email"
                        value={backupSettings.notifyEmail || ''}
                        onChange={(e) => setBackupSettingsState(prev => ({ ...prev, notifyEmail: e.target.value }))}
                        placeholder="you@example.com"
                        style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)', width: '100%' }}
                      />
                      <span className="current-value">
                        Notifications will be sent from your connected Gmail account.
                      </span>
                    </div>
                  )}
                </div>

                {/* Save Settings Button */}
                <div className="backup-save-section">
                  <button className="btn-primary" onClick={handleSaveBackupSettings}>
                    Save Backup Settings
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'integrations' && (
              <div className="settings-section integrations-section">
                <h3>Integrations</h3>
                <p className="settings-description">
                  Overview of connected services. Manage API keys and sign in to services from the <button className="link-to-tab" onClick={() => setActiveTab('apikeys')}>API KEYS</button> tab.
                </p>

                <div className="integrations-content">
                  {/* API Configuration Summary */}
                  {integrationsInfo && (
                    <div className="api-info-summary">
                      <div className="api-info-header">
                        <Server size={16} />
                        <h4>API Configuration</h4>
                      </div>
                      <div className="api-info-grid">
                        <div className={`api-info-item ${integrationsInfo.openai?.configured ? 'configured' : 'missing'}`}>
                          <div className="api-info-label">
                            <Zap size={13} />
                            <span>OpenAI</span>
                          </div>
                          <div className="api-info-value">
                            {integrationsInfo.openai?.configured ? (
                              <><CheckCircle size={12} /><span className="api-key-preview">{integrationsInfo.openai.keyPrefix}</span></>
                            ) : (
                              <><XCircle size={12} /><span>Not configured</span></>
                            )}
                          </div>
                        </div>
                        <div className={`api-info-item ${integrationsInfo.google?.configured ? 'configured' : 'missing'}`}>
                          <div className="api-info-label">
                            <Mail size={13} />
                            <span>Google OAuth</span>
                          </div>
                          <div className="api-info-value">
                            {integrationsInfo.google?.configured ? (
                              <><CheckCircle size={12} /><span className="api-key-preview">{integrationsInfo.google.clientId?.substring(0, 20)}...</span></>
                            ) : (
                              <><XCircle size={12} /><span>Not configured</span></>
                            )}
                          </div>
                        </div>
                        <div className={`api-info-item ${settings.hiveConnected ? 'configured' : 'missing'}`}>
                          <div className="api-info-label">
                            <Hexagon size={13} />
                            <span>Hive</span>
                          </div>
                          <div className="api-info-value">
                            {settings.hiveConnected ? (
                              <><CheckCircle size={12} /><span className="api-key-preview">User: {settings.hiveUserId?.substring(0, 12)}...</span></>
                            ) : (
                              <><XCircle size={12} /><span>Not connected</span></>
                            )}
                          </div>
                        </div>
                        <div className={`api-info-item ${gmailConnection.connected ? 'configured' : 'missing'}`}>
                          <div className="api-info-label">
                            <Mail size={13} />
                            <span>Gmail</span>
                          </div>
                          <div className="api-info-value">
                            {gmailConnection.connected ? (
                              <><CheckCircle size={12} /><span className="api-key-preview">{gmailConnection.email}</span></>
                            ) : (
                              <><XCircle size={12} /><span>Not connected</span></>
                            )}
                          </div>
                        </div>
                      </div>
                      <button className="btn-secondary apikeys-manage-btn" onClick={() => setActiveTab('apikeys')}>
                        <Key size={14} /> Manage API Keys & Connections
                      </button>
                    </div>
                  )}


                </div>
              </div>
            )}

            {activeTab === 'general' && (
              <div className="settings-section">
                <h3>General</h3>
                <p className="settings-description">
                  General application settings.
                </p>

                <div className="setting-item">
                  <label>Theme</label>
                  <select
                    value={settings.theme || 'dark'}
                    onChange={(e) => updateSettingLocal('theme', e.target.value)}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>

                <div className="setting-item checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.autoSave ?? true}
                      onChange={(e) => updateSettingLocal('autoSave', e.target.checked)}
                    />
                    Auto-save files
                  </label>
                </div>

                {/* File Operations Permissions */}
                <div className="setting-item">
                  <label>Agent File Permissions</label>
                  <select
                    value={settings.filePermissions || 'unrestricted'}
                    onChange={(e) => updateSettingLocal('filePermissions', e.target.value)}
                  >
                    <option value="unrestricted">Unrestricted (Full Access)</option>
                    <option value="relaxed">Relaxed (Minor Restrictions)</option>
                    <option value="moderate">Moderate (Confirm Dangerous Ops)</option>
                    <option value="strict">Strict (Read Only)</option>
                  </select>
                  <span className="current-value">
                    Controls how freely the agent can create, modify, write, read, extract, or zip files within the workspace.
                  </span>
                </div>

                {/* Image Generation Permissions */}
                <div className="setting-item">
                  <label>Image & File Generation</label>
                  <select
                    value={settings.generationPermissions || 'unrestricted'}
                    onChange={(e) => updateSettingLocal('generationPermissions', e.target.value)}
                  >
                    <option value="unrestricted">Unrestricted (Creative Freedom)</option>
                    <option value="relaxed">Relaxed (Minor Restrictions)</option>
                    <option value="moderate">Moderate (Confirm Before Generate)</option>
                    <option value="strict">Strict (Disabled)</option>
                  </select>
                  <span className="current-value">
                    Controls the agent's ability to generate creative and complex images and files.
                  </span>
                </div>

                {/* Break Time Section */}
                <div className="break-time-settings">
                  <h4>
                    <Clock size={16} />
                    Break Time!
                  </h4>
                  <p className="settings-description">
                    Get reminded to take breaks during your working hours. Alerts only fire while the app is open.
                  </p>

                  <div className="setting-item checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.breakTimeEnabled ?? false}
                        onChange={(e) => updateSettingLocal('breakTimeEnabled', e.target.checked)}
                      />
                      Enable Break Time Alerts
                    </label>
                  </div>

                  {settings.breakTimeEnabled && (
                    <div className="break-time-controls-row">
                      <div className="break-time-control">
                        <label>Interval</label>
                        <select
                          value={settings.breakTimeInterval || 60}
                          onChange={(e) => updateSettingLocal('breakTimeInterval', parseInt(e.target.value))}
                        >
                          <option value={15}>15 min</option>
                          <option value={30}>30 min</option>
                          <option value={60}>60 min</option>
                          <option value={120}>120 min</option>
                        </select>
                      </div>

                      <div className="break-time-control">
                        <label>Start</label>
                        <input
                          type="time"
                          value={settings.breakTimeWorkStart || '09:00'}
                          onChange={(e) => updateSettingLocal('breakTimeWorkStart', e.target.value)}
                        />
                      </div>

                      <div className="break-time-control">
                        <label>End</label>
                        <input
                          type="time"
                          value={settings.breakTimeWorkEnd || '17:00'}
                          onChange={(e) => updateSettingLocal('breakTimeWorkEnd', e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'utilities' && (
              <div className="settings-section utilities-section">
                <h3>Utilities</h3>
                <p className="settings-description">
                  Database optimization, error logs, and system maintenance tools.
                </p>

                {/* Server Connection (moved from Server tab) */}
                <div className="utility-card server-accordion">
                  <div className="utility-header clickable" onClick={() => setServerAccordionOpen(!serverAccordionOpen)}>
                    <Server size={20} />
                    <div>
                      <h4>Server Connection</h4>
                      <p>Configure and monitor the local server connection.</p>
                    </div>
                    <ChevronDown size={16} className={`accordion-chevron ${serverAccordionOpen ? 'open' : ''}`} />
                  </div>
                  {serverAccordionOpen && (
                    <div className="server-accordion-body">
                      <div className="server-status-card">
                        <div className="server-status-row">
                          {getServerStatusIcon()}
                          <span className={`server-status-text ${serverStatus}`}>{getServerStatusText()}</span>
                          <button
                            className="server-refresh-btn"
                            onClick={() => checkServerStatus(true)}
                            disabled={serverStatus === 'checking'}
                            title="Refresh Status"
                          >
                            <RefreshCw size={14} className={serverStatus === 'checking' ? 'spinning' : ''} />
                          </button>
                        </div>
                        {lastServerCheck && (
                          <div className="server-last-check">
                            Last checked: {lastServerCheck.toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                      <div className="server-settings-card">
                        <h4>Connection Settings</h4>
                        <div className="server-setting-row">
                          <label>Host</label>
                          <span className="server-setting-value">localhost</span>
                        </div>
                        <div className="server-setting-row">
                          <label>Port</label>
                          {editingPort ? (
                            <div className="server-port-edit">
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
                                setTempPort(serverPort.toString());
                              }}>Cancel</button>
                            </div>
                          ) : (
                            <div className="server-port-display">
                              <span className="server-setting-value">{serverPort}</span>
                              <button className="server-edit-btn" onClick={() => {
                                setTempPort(serverPort.toString());
                                setEditingPort(true);
                              }}>
                                <Settings size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="server-setting-row">
                          <label>URL</label>
                          <span className="server-setting-value url">http://localhost:{serverPort}</span>
                        </div>
                      </div>
                      <div className="server-actions-card">
                        <button
                          className={`server-connect-btn ${serverStatus === 'online' ? 'connected' : ''}`}
                          onClick={() => checkServerStatus(true)}
                          disabled={serverStatus === 'checking'}
                        >
                          {serverStatus === 'online' ? <Wifi size={16} /> : <WifiOff size={16} />}
                          {serverStatus === 'online' ? 'Reconnect' : 'Connect'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* New Version Alert */}
                {newVersionAvailable && (
                  <div className="new-version-alert">
                    <div className="alert-header">
                      <Bell size={18} />
                      <span>New Version Available!</span>
                    </div>
                    <p>Version {newVersionAvailable.version} is now available.</p>
                    {newVersionAvailable.notes && (
                      <p className="version-notes">{newVersionAvailable.notes}...</p>
                    )}
                    <a
                      href={newVersionAvailable.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="update-link"
                    >
                      <ExternalLink size={14} />
                      View Release Notes
                    </a>
                  </div>
                )}

                {/* Database Optimization */}
                <div className="utility-card">
                  <div className="utility-header">
                    <Database size={20} />
                    <div>
                      <h4>Optimize Database</h4>
                      <p>Clean, compress, and optimize local storage for better performance.</p>
                    </div>
                  </div>

                  <div className="db-size-info">
                    <div className="size-item">
                      <span className="size-label">Current Size:</span>
                      <span className="size-value">{dbSize?.totalSizeFormatted || 'Loading...'}</span>
                    </div>
                    {optimizationResult && (
                      <div className="size-item optimized">
                        <span className="size-label">After Optimization:</span>
                        <span className="size-value">{optimizationResult.afterSizeFormatted}</span>
                        {optimizationResult.savedBytes > 0 && (
                          <span className="size-saved">(-{optimizationResult.savedFormatted})</span>
                        )}
                      </div>
                    )}
                    {lastOptimization && (
                      <div className="last-optimization">
                        <Clock size={12} />
                        <span>Last optimized: {new Date(lastOptimization.timestamp).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>

                  {optimizationResult && (
                    <div className={`optimization-result ${optimizationResult.success ? 'success' : 'error'}`}>
                      {optimizationResult.success ? (
                        <>
                          <Sparkles size={14} />
                          <span>
                            Optimization complete! Processed {optimizationResult.recordsProcessed} records,
                            cleaned {optimizationResult.recordsCleaned}, removed {optimizationResult.duplicatesRemoved} duplicates.
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={14} />
                          <span>Some errors occurred: {optimizationResult.errors.join(', ')}</span>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    className="btn-optimize"
                    onClick={handleOptimizeDatabase}
                    disabled={isOptimizing}
                  >
                    {isOptimizing ? (
                      <>
                        <RefreshCw size={16} className="spinning" />
                        Optimizing...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        Optimize Database
                      </>
                    )}
                  </button>
                </div>

                {/* Remove Duplicate Training Records */}
                <div className="utility-card">
                  <div className="utility-header">
                    <Copy size={20} />
                    <div>
                      <h4>Remove Duplicate Training</h4>
                      <p>Find and remove duplicate training records and chat learnings to keep your data clean.</p>
                    </div>
                  </div>

                  {/* Preview Results */}
                  {duplicatePreview && (
                    <div className="duplicate-preview">
                      <div className="duplicate-stats">
                        <div className="duplicate-stat-row">
                          <span className="duplicate-label">Training Items:</span>
                          <span className="duplicate-value">
                            {duplicatePreview.trainingItems.duplicates.length} duplicates of {duplicatePreview.trainingItems.total} total
                          </span>
                        </div>
                        <div className="duplicate-stat-row">
                          <span className="duplicate-label">Chat Learnings:</span>
                          <span className="duplicate-value">
                            {duplicatePreview.chatLearnings.duplicates.length} duplicates of {duplicatePreview.chatLearnings.total} total
                          </span>
                        </div>
                        <div className="duplicate-stat-row total">
                          <span className="duplicate-label">Total Duplicates Found:</span>
                          <span className="duplicate-value highlight">{duplicatePreview.totalDuplicates}</span>
                        </div>
                      </div>

                      {duplicatePreview.totalDuplicates > 0 && (
                        <div className="duplicate-list-preview">
                          {duplicatePreview.trainingItems.duplicates.slice(0, 3).map((dup, idx) => (
                            <div key={idx} className="duplicate-item-preview">
                              <span className="dup-title">"{dup.title}"</span>
                              <span className="dup-info">duplicate of "{dup.duplicateOfTitle}"</span>
                            </div>
                          ))}
                          {duplicatePreview.chatLearnings.duplicates.slice(0, 3).map((dup, idx) => (
                            <div key={`cl-${idx}`} className="duplicate-item-preview">
                              <Brain size={12} />
                              <span className="dup-title">"{dup.title}"</span>
                              <span className="dup-info">duplicate of "{dup.duplicateOfTitle}"</span>
                            </div>
                          ))}
                          {duplicatePreview.totalDuplicates > 6 && (
                            <div className="duplicate-more">
                              ...and {duplicatePreview.totalDuplicates - 6} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Removal Result */}
                  {duplicateRemovalResult && (
                    <div className={`duplicate-result ${duplicateRemovalResult.success ? 'success' : 'error'}`}>
                      {duplicateRemovalResult.success ? (
                        <>
                          <CheckCircle size={14} />
                          <span>
                            Removed {duplicateRemovalResult.totalRemoved} duplicates
                            ({duplicateRemovalResult.trainingItems.removed} training items,
                            {duplicateRemovalResult.chatLearnings.removed} chat learnings).
                            {duplicateRemovalResult.totalKept} unique records kept.
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={14} />
                          <span>Error: {duplicateRemovalResult.error || 'Failed to remove duplicates'}</span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="duplicate-actions">
                    <button
                      className="btn-secondary"
                      onClick={handlePreviewDuplicates}
                      disabled={isLoadingDuplicates || isRemovingDuplicates}
                    >
                      {isLoadingDuplicates ? (
                        <>
                          <RefreshCw size={16} className="spinning" />
                          Scanning...
                        </>
                      ) : (
                        <>
                          <Database size={16} />
                          Scan for Duplicates
                        </>
                      )}
                    </button>
                    {duplicatePreview && duplicatePreview.totalDuplicates > 0 && (
                      <button
                        className="btn-danger"
                        onClick={handleRemoveDuplicates}
                        disabled={isRemovingDuplicates}
                      >
                        {isRemovingDuplicates ? (
                          <>
                            <RefreshCw size={16} className="spinning" />
                            Removing...
                          </>
                        ) : (
                          <>
                            <Trash2 size={16} />
                            Remove {duplicatePreview.totalDuplicates} Duplicates
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Error Log */}
                <div className="utility-card">
                  <div className="utility-header">
                    <Bug size={20} />
                    <div>
                      <h4>Error Log</h4>
                      <p>View recent application errors and warnings. Logs clear on app restart.</p>
                    </div>
                    {errorLogs.length > 0 && (
                      <button className="clear-logs-btn" onClick={handleClearErrorLogs}>
                        <Trash2 size={14} />
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="error-log-container">
                    {errorLogs.length === 0 ? (
                      <div className="no-errors">
                        <CheckCircle size={24} />
                        <span>No errors logged</span>
                      </div>
                    ) : (
                      <div className="error-log-list">
                        {errorLogs.map((error, index) => (
                          <div key={index} className={`error-log-item ${error.severity || 'error'} ${expandedErrorId === index ? 'expanded' : ''}`}>
                            <div className="error-log-header" onClick={() => setExpandedErrorId(expandedErrorId === index ? null : index)}>
                              <span className="error-severity">{error.severity || 'error'}</span>
                              <span className="error-message-preview">{error.message}</span>
                              <ChevronDown size={14} className={`error-chevron ${expandedErrorId === index ? 'open' : ''}`} />
                            </div>
                            {expandedErrorId === index && (
                              <div className="error-details">
                                <div className="error-detail-row">
                                  <span className="error-detail-label">What:</span>
                                  <span className="error-detail-value">{error.message}</span>
                                </div>
                                {error.file && (
                                  <div className="error-detail-row">
                                    <span className="error-detail-label">Where:</span>
                                    <span className="error-detail-value">{error.file}</span>
                                  </div>
                                )}
                                <div className="error-detail-row">
                                  <span className="error-detail-label">When:</span>
                                  <span className="error-detail-value">
                                    {error.timestamp ? new Date(error.timestamp).toLocaleString() : 'Unknown'}
                                  </span>
                                </div>
                                {error.stack && (
                                  <div className="error-detail-row">
                                    <span className="error-detail-label">Stack:</span>
                                    <pre className="error-stack">{error.stack}</pre>
                                  </div>
                                )}
                                <button
                                  className="error-copy-btn"
                                  onClick={() => {
                                    const text = `[${error.severity || 'error'}] ${error.message}${error.file ? `\nFile: ${error.file}` : ''}${error.timestamp ? `\nTime: ${new Date(error.timestamp).toLocaleString()}` : ''}${error.stack ? `\nStack: ${error.stack}` : ''}`;
                                    navigator.clipboard.writeText(text);
                                  }}
                                >
                                  <Copy size={12} />
                                  Copy Error
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}

            {activeTab === 'usage' && (
              <div className="settings-section usage-section">
                <h3>Usage & Analytics</h3>
                <p className="settings-description">
                  Track token usage, message counts, and resource consumption over time.
                </p>

                {isLoadingUsage ? (
                  <div className="loading-usage">
                    <RefreshCw size={24} className="spinning" />
                    <span>Loading usage data...</span>
                  </div>
                ) : (
                  <>
                    {/* Current Month Stats */}
                    <div className="usage-stats-grid">
                      <div className="usage-stat-card">
                        <div className="stat-icon tokens">
                          <Zap size={20} />
                        </div>
                        <div className="stat-info">
                          <span className="stat-value">{(usageStats?.monthlyTokens || 0).toLocaleString()}</span>
                          <span className="stat-label">Tokens This Month</span>
                        </div>
                      </div>
                      <div className="usage-stat-card">
                        <div className="stat-icon messages">
                          <MessageSquare size={20} />
                        </div>
                        <div className="stat-info">
                          <span className="stat-value">{(usageStats?.monthlyMessages || 0).toLocaleString()}</span>
                          <span className="stat-label">Messages Sent</span>
                        </div>
                      </div>
                      <div className="usage-stat-card">
                        <div className="stat-icon learnings">
                          <TrendingUp size={20} />
                        </div>
                        <div className="stat-info">
                          <span className="stat-value">{usageStats?.monthlyLearnings || 0}</span>
                          <span className="stat-label">Learnings</span>
                        </div>
                      </div>
                      <div className="usage-stat-card">
                        <div className="stat-icon backups">
                          <HardDrive size={20} />
                        </div>
                        <div className="stat-info">
                          <span className="stat-value">{usageStats?.monthlyBackups || 0}</span>
                          <span className="stat-label">Backups</span>
                        </div>
                      </div>
                    </div>

                    {/* Token Limit Display */}
                    <div className="token-limit-section">
                      <h4>Token Allocation</h4>
                      <div className="token-limit-bar">
                        <div className="token-limit-fill" style={{ width: '0%' }} />
                      </div>
                      <div className="token-limit-info">
                        <span>{(usageStats?.monthlyTokens || 0).toLocaleString()} / Unlimited</span>
                        <button className="btn-upgrade" disabled>
                          <CreditCard size={14} />
                          Upgrade (Coming Soon)
                        </button>
                      </div>
                    </div>

                    {/* Monthly History */}
                    <div className="usage-history-section">
                      <h4>Monthly Usage History</h4>
                      {monthlyHistory.length === 0 ? (
                        <p className="no-history">No usage history recorded yet.</p>
                      ) : (
                        <div className="usage-history-list">
                          {monthlyHistory.map((month, index) => (
                            <div key={index} className="usage-history-item">
                              <div className="history-month">
                                <Calendar size={14} />
                                <span>{month.monthName} {month.year}</span>
                              </div>
                              <div className="history-stats">
                                <span className="history-stat">
                                  <Zap size={12} />
                                  {month.tokensUsed.toLocaleString()} tokens
                                </span>
                                <span className="history-stat">
                                  <MessageSquare size={12} />
                                  {month.messagesCount} msgs
                                </span>
                                <span className="history-stat">
                                  <TrendingUp size={12} />
                                  {month.learningsCount} learned
                                </span>
                                <span className="history-stat">
                                  <Download size={12} />
                                  {month.exportsCount} exports
                                </span>
                                <span className="history-stat">
                                  <HardDrive size={12} />
                                  {month.backupsCount} backups
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'setup' && (
              <div className="settings-section setup-section">
                <h3>Environment Setup</h3>
                <p className="settings-description">
                  Application configuration from the .env file. Edit any field below and click Save to persist changes. API keys and OAuth credentials are managed in the <strong>API Keys</strong> tab.
                </p>

                {setupMessage && (
                  <div className={`backup-message ${setupMessage.includes('Error') ? 'error' : 'success'}`}>
                    {setupMessage.includes('Error') ? <AlertCircle size={16} /> : <Check size={16} />}
                    {setupMessage}
                  </div>
                )}

                {isLoadingSetup && (
                  <div className="setup-loading">
                    <Loader size={20} className="spinning" />
                    <span>Loading configuration...</span>
                  </div>
                )}

                {setupInfo && (
                  <>
                    <div className="setup-groups">
                      {[
                        { key: 'companyIdentity', label: 'Company Identity', icon: Briefcase },
                        { key: 'chatbotAppearance', label: 'Chatbot Appearance', icon: Palette },
                        { key: 'chatbotBehavior', label: 'Chatbot Behavior', icon: Brain },
                        { key: 'serverConfig', label: 'Server Configuration', icon: Server },
                        { key: 'vectorDatabase', label: 'Vector Database', icon: Database }
                      ].map(group => (
                        <div key={group.key} className="setup-group">
                          <div className="setup-group-header">
                            <group.icon size={14} />
                            <span>{group.label}</span>
                          </div>
                          <div className="setup-group-items">
                            {Object.entries(setupInfo[group.key]).map(([envKey, info]) => (
                              <div key={envKey} className="setup-edit-item">
                                <label className="setup-edit-label">{info.label}</label>
                                <div className="setup-edit-input-wrap">
                                  {info.type === 'color' ? (
                                    <div className="setup-color-input">
                                      <input
                                        type="color"
                                        value={setupEdits[envKey] || '#000000'}
                                        onChange={(e) => handleSetupEditChange(envKey, e.target.value)}
                                        className="setup-color-picker"
                                      />
                                      <input
                                        type="text"
                                        value={setupEdits[envKey] || ''}
                                        onChange={(e) => handleSetupEditChange(envKey, e.target.value)}
                                        placeholder={info.label}
                                        className="setup-edit-input"
                                      />
                                    </div>
                                  ) : info.type === 'textarea' ? (
                                    <textarea
                                      value={setupEdits[envKey] || ''}
                                      onChange={(e) => handleSetupEditChange(envKey, e.target.value)}
                                      placeholder={info.label}
                                      className="setup-edit-textarea"
                                      rows={3}
                                    />
                                  ) : info.secret ? (
                                    <div className="setup-secret-input">
                                      <input
                                        type={showSecrets[envKey] ? 'text' : 'password'}
                                        value={setupEdits[envKey] || ''}
                                        onChange={(e) => handleSetupEditChange(envKey, e.target.value)}
                                        placeholder={info.label}
                                        className="setup-edit-input"
                                      />
                                      <button
                                        type="button"
                                        className="setup-toggle-secret"
                                        onClick={() => toggleSecretVisibility(envKey)}
                                        title={showSecrets[envKey] ? 'Hide' : 'Show'}
                                      >
                                        {showSecrets[envKey] ? <EyeOff size={14} /> : <Eye size={14} />}
                                      </button>
                                    </div>
                                  ) : (
                                    <input
                                      type={info.type === 'number' ? 'number' : 'text'}
                                      value={setupEdits[envKey] || ''}
                                      onChange={(e) => handleSetupEditChange(envKey, e.target.value)}
                                      placeholder={info.label}
                                      className="setup-edit-input"
                                    />
                                  )}
                                  <span className="setup-env-key">{envKey}</span>
                                  {info.description && (
                                    <span className="setup-field-help">{info.description}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="setup-save-bar">
                      <button
                        className="btn-primary setup-save-btn"
                        onClick={handleSaveSetup}
                        disabled={isSavingSetup}
                      >
                        {isSavingSetup ? (
                          <><Loader size={14} className="spinning" /> Saving...</>
                        ) : (
                          <><Save size={14} /> Save All Changes</>
                        )}
                      </button>
                      <span className="setup-save-note">Changes are applied immediately to the server.</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'apikeys' && (
              <div className="settings-section apikeys-section">
                <h3>API Keys & Authentication</h3>
                <p className="settings-description">
                  Manage all credentials, API keys, and service connections in one place. Changes to environment variables are saved to the server immediately.
                </p>

                {/* Status Messages */}
                {setupMessage && (
                  <div className={`backup-message ${setupMessage.includes('Error') ? 'error' : 'success'}`}>
                    {setupMessage.includes('Error') ? <AlertCircle size={16} /> : <Check size={16} />}
                    {setupMessage}
                  </div>
                )}
                {backupMessage && (
                  <div className={`backup-message ${backupMessage.includes('Error') || backupMessage.includes('failed') ? 'error' : 'success'}`}>
                    {backupMessage.includes('Error') || backupMessage.includes('failed') ? <AlertCircle size={16} /> : <Check size={16} />}
                    {backupMessage}
                  </div>
                )}

                {isLoadingSetup && (
                  <div className="setup-loading">
                    <Loader size={20} className="spinning" />
                    <span>Loading configuration...</span>
                  </div>
                )}

                <div className="apikeys-content">

                  {/* ── Section 1: Environment API Keys (.env) ── */}
                  {setupInfo && (
                    <div className="apikeys-card">
                      <div className="apikeys-card-header">
                        <Key size={18} />
                        <div>
                          <h4>Environment API Keys</h4>
                          <p>Server-side keys stored in .env — used by the backend for API access.</p>
                        </div>
                      </div>
                      <div className="apikeys-card-body">
                        {[
                          { key: 'apiKeys', label: 'API Keys', icon: Zap },
                          { key: 'oauthGoogle', label: 'Google / Gmail OAuth', icon: Mail }
                        ].map(group => (
                          setupInfo[group.key] && (
                            <div key={group.key} className="apikeys-env-group">
                              <div className="apikeys-env-group-label">
                                <group.icon size={14} />
                                <span>{group.label}</span>
                              </div>
                              {Object.entries(setupInfo[group.key]).map(([envKey, info]) => (
                                <div key={envKey} className="apikeys-env-item">
                                  <label className="apikeys-env-label">{info.label}</label>
                                  <div className="apikeys-env-input-wrap">
                                    {info.secret ? (
                                      <div className="setup-secret-input">
                                        <input
                                          type={showSecrets[envKey] ? 'text' : 'password'}
                                          value={setupEdits[envKey] || ''}
                                          onChange={(e) => handleSetupEditChange(envKey, e.target.value)}
                                          placeholder={info.label}
                                          className="setup-edit-input"
                                        />
                                        <button
                                          type="button"
                                          className="setup-toggle-secret"
                                          onClick={() => toggleSecretVisibility(envKey)}
                                          title={showSecrets[envKey] ? 'Hide' : 'Show'}
                                        >
                                          {showSecrets[envKey] ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                      </div>
                                    ) : (
                                      <input
                                        type="text"
                                        value={setupEdits[envKey] || ''}
                                        onChange={(e) => handleSetupEditChange(envKey, e.target.value)}
                                        placeholder={info.label}
                                        className="setup-edit-input"
                                      />
                                    )}
                                    <span className="setup-env-key">{envKey}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        ))}
                        <div className="apikeys-save-bar">
                          <button
                            className="btn-primary setup-save-btn"
                            onClick={handleSaveSetup}
                            disabled={isSavingSetup}
                          >
                            {isSavingSetup ? (
                              <><Loader size={14} className="spinning" /> Saving...</>
                            ) : (
                              <><Save size={14} /> Save Environment Keys</>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Section 2: Hive Integration ── */}
                  <div className="apikeys-card">
                    <div className="apikeys-card-header">
                      <Hexagon size={18} />
                      <div>
                        <h4>Hive</h4>
                        <p>Connect to App.Hive.com for task and project management.</p>
                      </div>
                      <div className="apikeys-status">
                        {settings.hiveConnected ? (
                          <span className="status-badge connected"><CheckCircle size={14} /> Connected</span>
                        ) : (
                          <span className="status-badge disconnected"><AlertCircle size={14} /> Not Connected</span>
                        )}
                      </div>
                    </div>
                    <div className="apikeys-card-body">
                      {settings.hiveConnected ? (
                        <div className="apikeys-connected-row">
                          <div className="apikeys-connected-info">
                            <CheckCircle size={14} />
                            <span>Connected: {settings.hiveUserId}</span>
                          </div>
                          <button
                            type="button"
                            className="btn-disconnect"
                            onClick={() => {
                              disconnectHive();
                              updateSettingLocal('hiveConnected', false);
                              updateSettingLocal('hiveApiKey', '');
                              updateSettingLocal('hiveUserId', '');
                              updateSettingLocal('hiveDefaultProjectId', '');
                              updateSettingLocal('hiveDefaultProjectName', '');
                              setHiveApiKey('');
                              setHiveUserId('');
                              setHiveSettingsProjects([]);
                              setStatusMessage('Hive disconnected');
                              setTimeout(() => setStatusMessage(''), 3000);
                            }}
                          >
                            <LogOut size={14} /> Disconnect
                          </button>
                        </div>
                      ) : (
                        <>
                          {hiveError && (
                            <div className="hive-error-message">
                              <AlertCircle size={14} />
                              <span>{hiveError}</span>
                            </div>
                          )}
                          <div className="setting-item">
                            <label><Key size={14} /> API Key</label>
                            <input
                              type="password"
                              value={hiveApiKey}
                              onChange={(e) => setHiveApiKey(e.target.value)}
                              placeholder="Enter your Hive API key"
                            />
                          </div>
                          <div className="setting-item">
                            <label><User size={14} /> User ID</label>
                            <input
                              type="text"
                              value={hiveUserId}
                              onChange={(e) => setHiveUserId(e.target.value)}
                              placeholder="Enter your Hive User ID"
                            />
                          </div>
                          <button
                            type="button"
                            className="btn-primary hive-connect-btn"
                            disabled={isConnectingHive || !hiveApiKey || !hiveUserId}
                            onClick={async () => {
                              setIsConnectingHive(true);
                              setHiveError('');
                              try {
                                const result = await validateHiveCredentials(hiveApiKey, hiveUserId);
                                if (result.valid) {
                                  saveHiveConnection({
                                    apiKey: hiveApiKey,
                                    userId: hiveUserId,
                                    userName: result.userName || null,
                                    userEmail: result.userEmail || null
                                  });
                                  updateSettingLocal('hiveConnected', true);
                                  updateSettingLocal('hiveApiKey', hiveApiKey);
                                  updateSettingLocal('hiveUserId', hiveUserId);
                                  if (result.userName) {
                                    updateSettingLocal('hiveUserName', result.userName);
                                  }
                                  setStatusMessage(result.userName
                                    ? `Hive connected as ${result.userName}!`
                                    : 'Hive connected successfully!');
                                  setTimeout(() => setStatusMessage(''), 3000);
                                } else {
                                  setHiveError(result.error || 'Failed to validate credentials');
                                }
                              } catch (e) {
                                setHiveError(e.message || 'Connection failed');
                              } finally {
                                setIsConnectingHive(false);
                              }
                            }}
                          >
                            {isConnectingHive ? (
                              <><RefreshCw size={14} className="spinning" /> Validating...</>
                            ) : (
                              <><LogIn size={14} /> Connect to Hive</>
                            )}
                          </button>
                          <div className="hive-api-help">
                            <span>Get your API key and User ID from </span>
                            <a href="https://app.hive.com" target="_blank" rel="noopener noreferrer">
                              <ExternalLink size={12} /> Hive → My Profile → API Info
                            </a>
                          </div>
                        </>
                      )}

                      {/* Default Project selector (when connected) */}
                      {settings.hiveConnected && (
                        <div className="hive-project-selector-inline" style={{ marginTop: '12px' }}>
                          <label><Folder size={14} /> Default Project for New Actions</label>
                          {isLoadingHiveProjects ? (
                            <span className="hive-loading-projects">Loading...</span>
                          ) : (
                            <select
                              value={settings.hiveDefaultProjectId || ''}
                              onChange={(e) => {
                                const projectId = e.target.value;
                                const project = hiveSettingsProjects.find(p => (p.id || p._id) === projectId);
                                updateSettingLocal('hiveDefaultProjectId', projectId);
                                updateSettingLocal('hiveDefaultProjectName', project ? project.name : '');
                              }}
                            >
                              <option value="">No default project</option>
                              {hiveSettingsProjects.map(p => (
                                <option key={p.id || p._id} value={p.id || p._id}>{p.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Section 3: Gmail / Google Workspace ── */}
                  <div className="apikeys-card">
                    <div className="apikeys-card-header">
                      <Mail size={18} />
                      <div>
                        <h4>Gmail / Google Workspace</h4>
                        <p>Sign in with Google for email, Drive, Sheets, and Docs access.</p>
                      </div>
                      <div className="apikeys-status">
                        {gmailConnection.connected ? (
                          <span className="status-badge connected"><CheckCircle size={14} /> Connected</span>
                        ) : (
                          <span className="status-badge disconnected"><AlertCircle size={14} /> Not Connected</span>
                        )}
                      </div>
                    </div>
                    <div className="apikeys-card-body">
                      {gmailConnection.connected ? (
                        <>
                          <div className="apikeys-connected-row">
                            <div className="apikeys-connected-info">
                              <CheckCircle size={14} />
                              <span>Connected as: {gmailConnection.email}</span>
                            </div>
                            <button
                              type="button"
                              className="btn-disconnect"
                              onClick={async () => {
                                try {
                                  await disconnectGmail();
                                  setGmailConnection({ connected: false, email: null });
                                  updateSettingLocal('gmailConnected', false);
                                  updateSettingLocal('gmailEmail', '');
                                  updateSettingLocal('gmailAccessToken', '');
                                  setStatusMessage('Gmail disconnected');
                                  setTimeout(() => setStatusMessage(''), 3000);
                                } catch (e) {
                                  setGmailError(e.message);
                                }
                              }}
                            >
                              <LogOut size={14} /> Disconnect
                            </button>
                          </div>

                          {/* Gmail-specific settings */}
                          <div className="apikeys-gmail-settings">
                            <div className="setting-item email-refresh-setting">
                              <label><RefreshCw size={14} /> Auto-Refresh Interval</label>
                              <select
                                value={settings.emailRefreshInterval || 5}
                                onChange={(e) => updateSettingLocal('emailRefreshInterval', parseInt(e.target.value))}
                              >
                                <option value={1}>Every 1 minute</option>
                                <option value={2}>Every 2 minutes</option>
                                <option value={5}>Every 5 minutes</option>
                                <option value={10}>Every 10 minutes</option>
                                <option value={15}>Every 15 minutes</option>
                                <option value={30}>Every 30 minutes</option>
                              </select>
                            </div>
                            <div className="setting-item email-refresh-setting">
                              <label><FileText size={14} /> Contact Directory Sheet ID</label>
                              <input
                                type="text"
                                value={settings.contactSheetId || ''}
                                onChange={(e) => updateSettingLocal('contactSheetId', e.target.value)}
                                placeholder="Paste Google Sheets spreadsheet ID"
                                style={{ flex: 1, padding: '6px 10px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '6px', color: 'var(--text-primary, #e2e8f0)', fontSize: '12px', outline: 'none' }}
                              />
                              <span style={{ fontSize: '10px', color: 'var(--text-muted, #64748b)', marginTop: '4px', display: 'block' }}>
                                Populates a contact dropdown in email compose. Sheet should have Name, Email, Company columns.
                              </span>
                            </div>
                            <div className="setting-item email-refresh-setting">
                              <label><Settings size={14} /> Remember Login</label>
                              <select
                                value={settings.authRememberDays || 1}
                                onChange={(e) => updateSettingLocal('authRememberDays', parseInt(e.target.value))}
                              >
                                <option value={1}>24 hours</option>
                                <option value={7}>7 days</option>
                                <option value={30}>30 days</option>
                              </select>
                            </div>
                            <div className="setting-item email-refresh-setting">
                              <label><HardDrive size={14} /> G-DRV Folder ID</label>
                              <input
                                type="text"
                                value={settings.googleDriveFolderId || ''}
                                onChange={(e) => updateSettingLocal('googleDriveFolderId', e.target.value.trim())}
                                placeholder="Paste Google Drive folder ID"
                                style={{ flex: 1, padding: '6px 10px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '6px', color: 'var(--text-primary, #e2e8f0)', fontSize: '12px', outline: 'none' }}
                              />
                              <span style={{ fontSize: '10px', color: 'var(--text-muted, #64748b)', marginTop: '4px', display: 'block' }}>
                                Files in this folder will appear in the G-DRV tab. Find the ID in the folder's URL.
                              </span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {gmailError && (
                            <div className="hive-error-message">
                              <AlertCircle size={14} />
                              <span>{gmailError}</span>
                            </div>
                          )}
                          <button
                            type="button"
                            className="btn-oauth google"
                            disabled={isConnectingGmail}
                            onClick={async () => {
                              setIsConnectingGmail(true);
                              setGmailError('');
                              try {
                                const result = await loginWithGmail();
                                if (result.success) {
                                  setGmailConnection({ connected: true, email: result.user });
                                  updateSettingLocal('gmailConnected', true);
                                  updateSettingLocal('gmailEmail', result.user);
                                  setStatusMessage('Gmail connected successfully!');
                                  setTimeout(() => setStatusMessage(''), 3000);
                                }
                              } catch (e) {
                                if (e.message !== 'Login cancelled') {
                                  setGmailError(e.message || 'Connection failed');
                                }
                              } finally {
                                setIsConnectingGmail(false);
                              }
                            }}
                          >
                            {isConnectingGmail ? (
                              <><Loader size={18} className="spinning" /> Connecting...</>
                            ) : (
                              <><Mail size={18} /> Sign in with Google</>
                            )}
                          </button>
                          <div className="hive-api-help">
                            <span>Requires OAuth credentials in </span>
                            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">
                              <ExternalLink size={12} /> Google Cloud Console
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── Section 4: Cloud Backup OAuth ── */}
                  <div className="apikeys-card">
                    <div className="apikeys-card-header">
                      <Cloud size={18} />
                      <div>
                        <h4>Cloud Backup Connections</h4>
                        <p>Sign in to cloud providers for backup storage.</p>
                      </div>
                    </div>
                    <div className="apikeys-card-body">
                      {/* Google Drive */}
                      <div className="apikeys-cloud-item">
                        <div className="apikeys-cloud-label">
                          <GoogleDriveIcon size={16} />
                          <span>Google Drive</span>
                        </div>
                        {connections.google?.connected ? (
                          <div className="apikeys-connected-row">
                            <div className="apikeys-connected-info">
                              <CheckCircle size={14} />
                              <span>Connected as <strong>{connections.google.email}</strong></span>
                            </div>
                            <button className="btn-disconnect-sm" onClick={handleGoogleDriveDisconnect}>
                              <LogOut size={12} /> Disconnect
                            </button>
                          </div>
                        ) : (
                          <button className="btn-oauth google" onClick={handleGoogleDriveLogin} disabled={isConnecting === 'google'}>
                            {isConnecting === 'google' ? <RefreshCw size={16} className="spinning" /> : <LogIn size={16} />}
                            Sign in with Google Drive
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {activeTab === 'help' && (
              <div className="settings-section help-section">
                <h3>Help Center</h3>
                <p className="settings-description">
                  Browse frequently asked questions for quick solutions, or use the action buttons for additional resources.
                </p>

                <div className="help-tab-content">
                  {/* Action Buttons */}
                  <div className="help-action-buttons">
                    <button className="help-action-btn" onClick={() => { setShowAccessModal(true); loadAccessData(); }}>
                      <Key size={16} />
                      <span>ACCESS</span>
                    </button>
                    <button className="help-action-btn" onClick={() => window.open('https://drive.google.com/drive/u/1/folders/1-iz06_6kvHQ_5BRE1VIGqYJKk2kdMsVW?ths=true', '_blank')}>
                      <FileText size={16} />
                      <span>S.O.Ps</span>
                    </button>
                  </div>

                  {/* FAQ Items */}
                  <div className="help-faq-list">
                    <h4><Lightbulb size={16} /> Frequently Asked Questions</h4>
                    {HELP_FAQ_ITEMS.map((item, index) => (
                      <div key={index} className={`faq-item ${helpFaqIndex === index ? 'open' : ''}`}>
                        <h5 onClick={() => setHelpFaqIndex(helpFaqIndex === index ? null : index)}>
                          <ChevronDown size={14} className="faq-chevron" />
                          {item.question}
                        </h5>
                        {helpFaqIndex === index && (
                          <p>{item.answer}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Access Section (inline) */}
                  {showAccessModal && (
                    <div className="help-access-section">
                      <div className="help-access-header">
                        <h4><Key size={16} /> Request Access</h4>
                        <button className="help-access-close" onClick={() => setShowAccessModal(false)}><X size={14} /></button>
                      </div>

                      <div className="help-access-field">
                        <label>What website or service do you need access to?</label>
                        <input
                          type="text"
                          value={accessRequest}
                          onChange={e => setAccessRequest(e.target.value)}
                          placeholder="e.g., WordPress admin, Google Analytics, hosting panel..."
                        />
                      </div>

                      <div className="help-access-projects-title">
                        <Building2 size={14} />
                        <span>Client Projects</span>
                      </div>

                      {isAccessLoading ? (
                        <div className="help-access-loading">
                          <Loader size={20} className="spinning" />
                          <span>Loading projects...</span>
                        </div>
                      ) : accessProjects.length === 0 ? (
                        <div className="help-access-empty">
                          <Building2 size={24} style={{ opacity: 0.3 }} />
                          <p>No Hive projects found. Connect Hive in Settings to view client projects.</p>
                        </div>
                      ) : (
                        <div className="help-access-projects-list">
                          {accessProjects.map((project, idx) => {
                            const contact = getContactForProject(project.name || project.title);
                            const isOpen = expandedAccessProject === idx;
                            return (
                              <div key={project.id || idx} className={`help-access-project-item ${isOpen ? 'open' : ''}`}>
                                <div
                                  className="help-access-project-header"
                                  onClick={() => setExpandedAccessProject(isOpen ? null : idx)}
                                >
                                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  <span>{project.name || project.title}</span>
                                </div>
                                {isOpen && (
                                  <div className="help-access-project-details">
                                    {contact ? (
                                      <>
                                        <div className="help-access-contact-row">
                                          <Users size={12} />
                                          <span className="help-contact-label">Contact:</span>
                                          <span>{contact.name}</span>
                                        </div>
                                        <div className="help-access-contact-row">
                                          <Mail size={12} />
                                          <span className="help-contact-label">Email:</span>
                                          <span>{contact.email}</span>
                                        </div>
                                        {contact.phone && (
                                          <div className="help-access-contact-row">
                                            <Phone size={12} />
                                            <span className="help-contact-label">Phone:</span>
                                            <span>{contact.phone}</span>
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <p style={{ fontSize: '11px', opacity: 0.6, margin: '4px 0' }}>No contact info found for this project.</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="settings-section about-section">
                <h3>About OMNIPOTENT-AI</h3>
                <p className="settings-description">
                  Your intelligent AI coding assistant.
                </p>

                <div className="about-content">
                  {/* Donations - hidden */}
                  <div className="donate-card-about" style={{ display: 'none' }}>
                    <div className="utility-header">
                      <Heart size={20} className="heart-icon" />
                      <div>
                        <h4>Support Development</h4>
                        <p>Help us continue improving OMNIPOTENT-AI with a donation.</p>
                      </div>
                    </div>
                    <button className="btn-donate">
                      <Heart size={16} />
                      Donate
                    </button>
                  </div>

                  <div className="app-info-card">
                    <div className="app-logo-container">
                      <div className="app-logo-placeholder">OMNI</div>
                    </div>
                    <div className="app-details">
                      <h4>OMNIPOTENT-AI</h4>
                      <span className="about-creator">
                        Created by <a href="https://www.om.agency" target="_blank" rel="noopener noreferrer">ONYMOUS MEDIA MARKETING</a>
                      </span>
                      <span className="version-badge">Version 1.0.0</span>
                      <p>An AI-powered development environment with organic learning capabilities and comprehensive code assistance.</p>
                    </div>
                  </div>

                  <div className="features-list">
                    <h4>Key Features</h4>
                    <ul>
                      <li><Shield size={14} /> Intelligent code analysis and suggestions</li>
                      <li><TrendingUp size={14} /> Organic learning from conversations</li>
                      <li><Code size={14} /> Multi-language support</li>
                      <li><HardDrive size={14} /> Cloud backup integration</li>
                      <li><Zap size={14} /> Real-time assistance</li>
                    </ul>
                  </div>

                  {/* Support Section */}
                  <div className="support-in-about">
                    <h4>Support & Help</h4>
                    <div className="support-content">
                      <div className="support-card">
                        <div className="support-icon">
                          <HelpCircle size={24} />
                        </div>
                        <div className="support-info">
                          <h4>Documentation</h4>
                          <p>Access comprehensive guides and tutorials.</p>
                          <a href="#" className="support-link" onClick={(e) => e.preventDefault()}>
                            <ExternalLink size={14} />
                            View Documentation
                          </a>
                        </div>
                      </div>


                      <div className="support-card">
                        <div className="support-icon">
                          <MessageSquare size={24} />
                        </div>
                        <div className="support-info">
                          <h4>Discord Community</h4>
                          <p>Join our community for real-time support.</p>
                          <a href="#" className="support-link" onClick={(e) => e.preventDefault()}>
                            <ExternalLink size={14} />
                            Join Discord
                          </a>
                        </div>
                      </div>

                      <div className="support-card">
                        <div className="support-icon">
                          <Mail size={24} />
                        </div>
                        <div className="support-info">
                          <h4>Email Support</h4>
                          <p>Contact us directly for personalized assistance.</p>
                          <a href="mailto:support@credm-ai.com" className="support-link">
                            <ExternalLink size={14} />
                            support@credm-ai.com
                          </a>
                        </div>
                      </div>

                      {/* FAQ Accordion */}
                      <div className="faq-section">
                        <h4>Frequently Asked Questions</h4>
                        <div className={`faq-item ${openFaq === 0 ? 'open' : ''}`}>
                          <h5 onClick={() => setOpenFaq(openFaq === 0 ? null : 0)}>
                            <ChevronDown size={14} className="faq-chevron" />
                            How do I train the agent with custom data?
                          </h5>
                          {openFaq === 0 && (
                            <p>Use the Training section in the header menu to add custom training data, documentation, or code examples that the agent will learn from.</p>
                          )}
                        </div>
                        <div className={`faq-item ${openFaq === 1 ? 'open' : ''}`}>
                          <h5 onClick={() => setOpenFaq(openFaq === 1 ? null : 1)}>
                            <ChevronDown size={14} className="faq-chevron" />
                            What is the green badge in the chat header?
                          </h5>
                          {openFaq === 1 && (
                            <p>The green badge shows organic learnings that the agent has picked up from your conversations. Click it to review and train these learnings into the agent's brain.</p>
                          )}
                        </div>
                        <div className={`faq-item ${openFaq === 2 ? 'open' : ''}`}>
                          <h5 onClick={() => setOpenFaq(openFaq === 2 ? null : 2)}>
                            <ChevronDown size={14} className="faq-chevron" />
                            How do I backup my data?
                          </h5>
                          {openFaq === 2 && (
                            <p>Go to the Backup tab in Settings to create local backups or sync with Google Drive.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Credits - last section */}
                  <div className="credits-section">
                    <p>Powered by <strong>OMNIPOTENT-AI</strong> | Created by <a href="https://www.om.agency" target="_blank" rel="noopener noreferrer">Onymous Media Marketing</a></p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'license' && (
              <div className="settings-section license-section">
                <h3>License Agreement</h3>
                <p className="settings-description">
                  Software license and terms of use.
                </p>

                <div className="license-content">
                  <div className="license-card">
                    <h4>MIT License</h4>
                    <div className="license-text">
                      <p>Copyright (c) 2024 OMNIPOTENT</p>
                      <p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p>
                      <p>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>
                      <p><strong>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</strong></p>
                    </div>
                  </div>

                  <div className="third-party-section">
                    <h4>Third-Party Licenses</h4>
                    <p>This software uses open-source libraries. See the documentation for a complete list of dependencies and their respective licenses.</p>
                  </div>
                </div>
              </div>
            )}

                      </div>
        </div>
      </div>
    </div>
  );
}
