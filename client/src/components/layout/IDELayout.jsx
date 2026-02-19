import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import Header from './Header';
import LeftSidebar from './LeftSidebar';
import RightPanel from './RightPanel';
import CodeEditor from '../editor/CodeEditor';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useSettings } from '../../contexts/SettingsContext';
import { checkSyntax, checkSecurity, reviewCode, validateModStructure, generateManifest } from '../../services/codeService';
import useBreakTimer from '../../hooks/useBreakTimer';
import BreakTimeAlert from '../common/BreakTimeAlert';
import './IDELayout.css';

// Lazy load modals for code splitting (reduces initial bundle size)
const SettingsModal = lazy(() => import('../modals/SettingsModal'));
const TrainingModal = lazy(() => import('../modals/TrainingModal'));
const ResultModal = lazy(() => import('../modals/ResultModal'));

// Loading fallback for modals
const ModalLoader = () => (
  <div className="modal-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading...</div>
  </div>
);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function IDELayout() {
  const [config, setConfig] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [showSettings, setShowSettings] = useState(false);
  const [showTraining, setShowTraining] = useState(false);
  const [resultModal, setResultModal] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { saveFile, activeFile, openFiles, fileTree, workspacePath, openFile } = useWorkspace();
  const { settings } = useSettings();
  const { isBreakTime, dismissBreak, breakTimeEnabled } = useBreakTimer();
  const [chatbotLogoUrl, setChatbotLogoUrl] = useState('');
  const fileInputRef = useRef(null);
  const settingsInputRef = useRef(null);

  // Chat session selection state (passed between LeftSidebar and RightPanel/ChatPanel)
  const [selectedSession, setSelectedSession] = useState(null);

  const handleSessionSelect = useCallback((session) => {
    setSelectedSession(session);
  }, []);

  // Fetch config on mount with retry logic
  useEffect(() => {
    let cancelled = false;
    const MAX_RETRIES = 8;
    const RETRY_DELAYS = [500, 1000, 1500, 2000, 3000, 4000, 5000, 5000];

    const fetchConfig = async () => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (cancelled) return;
        try {
          const response = await fetch(`${API_URL}/api/config`);
          if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
          }
          const data = await response.json();
          if (cancelled) return;
          setConfig(data);
          setConnectionStatus('connected');
          return;
        } catch (error) {
          console.warn(`Connection attempt ${attempt + 1}/${MAX_RETRIES} failed:`, error.message);
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          }
        }
      }
      if (cancelled) return;
      console.error('Failed to connect to server after all retries');
      setConnectionStatus('disconnected');
      setConfig({
        companyName: 'OMNIPOTENT',
        botName: 'OMNIPOTENT',
        welcomeMessage: '**Server Offline**\n\nThe chat server is not running. Please start the backend server:\n\n```\nnpm run server\n```'
      });
    };
    fetchConfig();
    return () => { cancelled = true; };
  }, []);

  // Fetch chatbot logo URL from setup info
  useEffect(() => {
    fetch(`${API_URL}/api/setup-info`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.chatbotAppearance?.CHATBOT_LOGO_URL?.value) {
          setChatbotLogoUrl(data.chatbotAppearance.CHATBOT_LOGO_URL.value);
        }
      })
      .catch(() => {});
  }, []);

  // Get current file content
  const getCurrentFileContent = () => {
    const currentFile = openFiles.find(f => f.path === activeFile);
    return currentFile?.content || '';
  };

  // Get file language from extension
  const getFileLanguage = () => {
    if (!activeFile) return 'lua';
    const ext = activeFile.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'lua': return 'lua';
      case 'js': return 'javascript';
      case 'json': return 'json';
      default: return 'lua';
    }
  };

  // Handle menu actions
  const handleMenuAction = async (action) => {
    switch (action) {
      case 'save':
        if (activeFile) {
          const success = await saveFile(activeFile);
          if (success) {
            setResultModal({ title: 'Saved', content: `File saved successfully: ${activeFile.split(/[\\/]/).pop()}`, type: 'success' });
            setTimeout(() => setResultModal(null), 2000);
          }
        } else {
          setResultModal({ title: 'No File', content: 'No file is currently open to save.', type: 'warning' });
        }
        break;

      case 'saveAll':
        const dirtyFiles = openFiles.filter(f => f.isDirty);
        if (dirtyFiles.length === 0) {
          setResultModal({ title: 'Nothing to Save', content: 'All files are already saved.', type: 'info' });
        } else {
          for (const file of dirtyFiles) {
            await saveFile(file.path);
          }
          setResultModal({ title: 'Saved All', content: `Saved ${dirtyFiles.length} file(s).`, type: 'success' });
        }
        break;

      case 'newFile':
        const newFileName = prompt('Enter new file name:', 'untitled.lua');
        if (newFileName && workspacePath) {
          const newPath = `${workspacePath}\\${newFileName}`;
          try {
            const response = await fetch(`${API_URL}/api/files/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: newPath, type: 'file', content: '-- New file\n' })
            });
            if (response.ok) {
              openFile(newPath, newFileName);
              setResultModal({ title: 'Created', content: `Created new file: ${newFileName}`, type: 'success' });
            }
          } catch (error) {
            setResultModal({ title: 'Error', content: 'Failed to create file. Make sure the server is running.', type: 'error' });
          }
        } else if (!workspacePath) {
          setResultModal({ title: 'No Workspace', content: 'Please set a workspace folder in Settings first.', type: 'warning' });
        }
        break;

      case 'openFile':
        fileInputRef.current?.click();
        break;

      case 'openSettings':
      case 'settings':
        setShowSettings(true);
        break;

      case 'import':
        settingsInputRef.current?.click();
        break;

      case 'export':
        try {
          const exportData = { version: 1, exportedAt: new Date().toISOString(), settings: {} };
          const settingsKeys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('callumony_') || key.startsWith('omnipotent_') || key.startsWith('credm_'))) {
              settingsKeys.push(key);
            }
          }
          settingsKeys.forEach(key => {
            try {
              const val = localStorage.getItem(key);
              exportData.settings[key] = val ? JSON.parse(val) : val;
            } catch {
              exportData.settings[key] = localStorage.getItem(key);
            }
          });
          const dateStr = new Date().toISOString().split('T')[0];
          const exportBlob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
          const exportUrl = URL.createObjectURL(exportBlob);
          const exportAnchor = document.createElement('a');
          exportAnchor.href = exportUrl;
          exportAnchor.download = `omnipotent-settings-${dateStr}.json`;
          exportAnchor.click();
          URL.revokeObjectURL(exportUrl);
          setResultModal({ title: 'Settings Exported', content: `Exported ${settingsKeys.length} setting(s) to omnipotent-settings-${dateStr}.json`, type: 'success' });
        } catch (exportErr) {
          setResultModal({ title: 'Export Failed', content: `Could not export settings: ${exportErr.message}`, type: 'error' });
        }
        break;

      case 'syntaxCheck':
        if (!activeFile || !getCurrentFileContent()) {
          setResultModal({ title: 'No File', content: 'Open a file first to check syntax.', type: 'warning' });
          break;
        }
        if (connectionStatus === 'disconnected') {
          setResultModal({ title: 'Server Offline', content: 'Start the server to use AI-powered syntax checking.', type: 'error' });
          break;
        }
        setIsProcessing(true);
        setResultModal({ title: 'Checking Syntax...', content: 'Analyzing your code...', type: 'loading' });
        const syntaxResult = await checkSyntax(getCurrentFileContent(), getFileLanguage());
        setIsProcessing(false);
        setResultModal({
          title: 'Syntax Check Results',
          content: syntaxResult.success ? syntaxResult.result : `Error: ${syntaxResult.error}`,
          type: syntaxResult.success ? 'info' : 'error'
        });
        break;

      case 'securityCheck':
        if (!activeFile || !getCurrentFileContent()) {
          setResultModal({ title: 'No File', content: 'Open a file first to check security.', type: 'warning' });
          break;
        }
        if (connectionStatus === 'disconnected') {
          setResultModal({ title: 'Server Offline', content: 'Start the server to use AI-powered security checking.', type: 'error' });
          break;
        }
        setIsProcessing(true);
        setResultModal({ title: 'Security Check...', content: 'Analyzing for vulnerabilities...', type: 'loading' });
        const securityResult = await checkSecurity(getCurrentFileContent(), getFileLanguage());
        setIsProcessing(false);
        setResultModal({
          title: 'Security Check Results',
          content: securityResult.success ? securityResult.result : `Error: ${securityResult.error}`,
          type: securityResult.success ? 'info' : 'error'
        });
        break;

      case 'codeReview':
        if (!activeFile || !getCurrentFileContent()) {
          setResultModal({ title: 'No File', content: 'Open a file first for code review.', type: 'warning' });
          break;
        }
        if (connectionStatus === 'disconnected') {
          setResultModal({ title: 'Server Offline', content: 'Start the server to use AI-powered code review.', type: 'error' });
          break;
        }
        setIsProcessing(true);
        setResultModal({ title: 'Reviewing Code...', content: 'Getting suggestions...', type: 'loading' });
        const reviewResult = await reviewCode(getCurrentFileContent(), getFileLanguage());
        setIsProcessing(false);
        setResultModal({
          title: 'Code Review',
          content: reviewResult.success ? reviewResult.result : `Error: ${reviewResult.error}`,
          type: reviewResult.success ? 'info' : 'error'
        });
        break;

      case 'runScript':
        setResultModal({
          title: 'Run Script',
          content: 'To run scripts, use the PowerShell terminal tab. You can execute Lua scripts with your RedM server.',
          type: 'info'
        });
        break;

      case 'exportMod':
        if (!workspacePath) {
          setResultModal({ title: 'No Workspace', content: 'Set a workspace folder first to export as a mod.', type: 'warning' });
          break;
        }
        const resourceName = workspacePath.split(/[\\/]/).pop() || 'my_resource';
        const manifest = generateManifest(resourceName, {
          author: 'Callumony',
          description: `${resourceName} - RedM Resource`,
          clientScripts: ['client/*.lua'],
          serverScripts: ['server/*.lua']
        });
        setResultModal({
          title: 'RedM Mod Export',
          content: `**Generated fxmanifest.lua:**\n\n\`\`\`lua\n${manifest}\`\`\`\n\nCopy this to your resource folder, or create the file using File > New File.`,
          type: 'info'
        });
        break;

      case 'validateMod':
        if (!workspacePath || fileTree.length === 0) {
          setResultModal({ title: 'No Workspace', content: 'Set a workspace folder and load files first.', type: 'warning' });
          break;
        }
        const validation = await validateModStructure(fileTree);
        setResultModal({
          title: 'Mod Validation',
          content: validation.valid
            ? '**Structure looks good!** Your resource has the required files.'
            : `**Issues Found:**\n\n${validation.issues.map(i => `- ${i}`).join('\n')}`,
          type: validation.valid ? 'success' : 'warning'
        });
        break;

      case 'openDocs':
        window.open('https://docs.fivem.net/natives/', '_blank');
        break;

      case 'reconnect': {
        setConnectionStatus('connecting');
        const RECONNECT_RETRIES = 5;
        const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 4000];
        let reconnected = false;
        for (let i = 0; i < RECONNECT_RETRIES; i++) {
          try {
            const reconnectResponse = await fetch(`${API_URL}/api/config`);
            if (!reconnectResponse.ok) throw new Error(`Server returned ${reconnectResponse.status}`);
            const reconnectData = await reconnectResponse.json();
            setConfig(reconnectData);
            setConnectionStatus('connected');
            setResultModal({ title: 'Connected', content: 'Successfully reconnected to the server.', type: 'success' });
            setTimeout(() => setResultModal(null), 2000);
            reconnected = true;
            break;
          } catch (err) {
            console.warn(`Reconnect attempt ${i + 1}/${RECONNECT_RETRIES} failed:`, err.message);
            if (i < RECONNECT_RETRIES - 1) {
              await new Promise(r => setTimeout(r, RECONNECT_DELAYS[i]));
            }
          }
        }
        if (!reconnected) {
          setConnectionStatus('disconnected');
          setResultModal({ title: 'Connection Failed', content: 'Could not connect to the server. Make sure it is running.', type: 'error' });
        }
        break;
      }

      default:
        console.log('Unknown action:', action);
    }
  };

  // Handle file input change
  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result;
        // Open as temporary file
        const tempPath = `temp://${file.name}`;
        openFile(tempPath, file.name);
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  // Handle settings import file
  const handleSettingsImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result);
        if (!data.version || !data.settings) {
          setResultModal({ title: 'Invalid File', content: 'This does not appear to be a valid OMNIPOTENT settings file.', type: 'error' });
          return;
        }
        let restoredCount = 0;
        Object.entries(data.settings).forEach(([key, value]) => {
          try {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            restoredCount++;
          } catch (err) {
            console.error(`Failed to restore key ${key}:`, err);
          }
        });
        setResultModal({
          title: 'Settings Imported',
          content: `Restored ${restoredCount} setting(s) from backup. The app will reload to apply changes.`,
          type: 'success'
        });
        setTimeout(() => window.location.reload(), 2500);
      } catch (parseErr) {
        setResultModal({ title: 'Import Failed', content: `Could not parse settings file: ${parseErr.message}`, type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleMenuAction('save');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
      }
      if (e.key === 'F7') {
        e.preventDefault();
        handleMenuAction('syntaxCheck');
      }
      if (e.key === 'F5') {
        e.preventDefault();
        handleMenuAction('runScript');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFile, openFiles, connectionStatus]);

  const isLightTheme = settings.theme === 'light';

  return (
    <div className={`ide-layout ${isLightTheme ? 'light-theme' : ''}`}>
      <Header
        onOpenSettings={() => setShowSettings(true)}
        onOpenTraining={() => setShowTraining(true)}
        onMenuAction={handleMenuAction}
        breakActive={breakTimeEnabled}
        connectionStatus={connectionStatus}
        logoUrl={chatbotLogoUrl}
      />

      <div className="ide-content">
        <Group orientation="horizontal" style={{ height: '100%' }}>
          {/* Left Sidebar - 20% default (+5% wider) */}
          <Panel
            id="left-sidebar"
            defaultSize={20}
            minSize={15}
            maxSize={30}
          >
            <LeftSidebar
              onSessionSelect={handleSessionSelect}
              currentSessionId={selectedSession?.id}
            />
          </Panel>

          <Separator
            style={{
              width: '6px',
              background: isLightTheme ? '#d1d5db' : '#211814',
              cursor: 'col-resize',
              transition: 'background 0.15s'
            }}
          />

          {/* Main Content - Code Editor - 55% default (narrower to accommodate wider sidebars) */}
          <Panel id="editor" defaultSize={55} minSize={30} maxSize={70}>
            <CodeEditor />
          </Panel>

          <Separator
            style={{
              width: '6px',
              background: isLightTheme ? '#d1d5db' : '#211814',
              cursor: 'col-resize',
              transition: 'background 0.15s'
            }}
          />

          {/* Right Panel - Chat/Terminal/Errors - 25% default (+5% wider) */}
          <Panel
            id="right-panel"
            defaultSize={25}
            minSize={18}
            maxSize={40}
          >
            <RightPanel
              config={config}
              connectionStatus={connectionStatus}
              setConnectionStatus={setConnectionStatus}
              selectedSession={selectedSession}
              onSessionSelect={handleSessionSelect}
            />
          </Panel>
        </Group>
      </div>

      {/* Hidden file input for Open File */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
        accept=".lua,.js,.json,.txt,.md,.xml,.html,.css"
      />

      {/* Hidden file input for Settings Import */}
      <input
        ref={settingsInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleSettingsImport}
        accept=".json"
      />

      {/* Settings Modal - Lazy loaded */}
      {showSettings && (
        <Suspense fallback={<ModalLoader />}>
          <SettingsModal onClose={() => setShowSettings(false)} />
        </Suspense>
      )}

      {/* Training Modal - Lazy loaded */}
      {showTraining && (
        <Suspense fallback={<ModalLoader />}>
          <TrainingModal onClose={() => setShowTraining(false)} />
        </Suspense>
      )}

      {/* Break Time Alert */}
      {isBreakTime && (
        <BreakTimeAlert onDismiss={dismissBreak} />
      )}

      {/* Result Modal - Lazy loaded */}
      {resultModal && (
        <Suspense fallback={<ModalLoader />}>
          <ResultModal
            title={resultModal.title}
            content={resultModal.content}
            type={resultModal.type}
            onClose={() => !isProcessing && setResultModal(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
