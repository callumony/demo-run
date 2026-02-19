import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const SettingsContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const DEFAULT_SETTINGS = {
  workspacePath: '',
  theme: 'dark',
  fontSize: 14,
  tabSize: 4,
  showMinimap: false,
  wordWrap: 'on',
  autoSave: true,
  panelSizes: {
    leftSidebar: 20,
    rightPanel: 30,
    bottomPanel: 200
  },
  // Integration settings (persisted)
  hiveConnected: false,
  hiveApiKey: '',
  hiveUserId: '',
  hiveDefaultProjectId: '',
  hiveDefaultProjectName: '',
  gmailConnected: false,
  gmailEmail: '',
  gmailAccessToken: '',
  // New settings
  emailRefreshInterval: 5,
  defaultLanguage: 'lua',
  breakTimeEnabled: false,
  breakTimeInterval: 60,
  breakTimeWorkStart: '09:00',
  breakTimeWorkEnd: '17:00',
  // Contact directory
  contactSheetId: '',
  // Auth persistence
  authRememberDays: 1,
  // Chatbot email context
  emailContextEnabled: true,
  // Todo list default state
  todoListCollapsed: false,
  // Google Drive designated folder
  googleDriveFolderId: ''
};

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    // Initialize from localStorage immediately
    let baseSettings = DEFAULT_SETTINGS;
    const localSettings = localStorage.getItem('callumony_settings');
    if (localSettings) {
      try {
        baseSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(localSettings) };
      } catch (e) {
        baseSettings = DEFAULT_SETTINGS;
      }
    }

    // Also check for integration-specific localStorage keys and sync them
    try {
      // Sync Hive credentials
      const storedHive = localStorage.getItem('omnipotent_hive_connection');
      if (storedHive) {
        const hiveData = JSON.parse(storedHive);
        if (hiveData.apiKey && hiveData.userId) {
          baseSettings.hiveConnected = true;
          baseSettings.hiveApiKey = hiveData.apiKey;
          baseSettings.hiveUserId = hiveData.userId;
        }
      }

      // Sync Gmail credentials
      const storedGmail = localStorage.getItem('omnipotent_gmail_connection');
      if (storedGmail) {
        const gmailData = JSON.parse(storedGmail);
        if (gmailData.email) {
          baseSettings.gmailConnected = true;
          baseSettings.gmailEmail = gmailData.email;
          if (gmailData.accessToken) {
            baseSettings.gmailAccessToken = gmailData.accessToken;
          }
        }
      }
    } catch (e) {
      console.error('Error syncing integration credentials:', e);
    }

    return baseSettings;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [serverAvailable, setServerAvailable] = useState(false);
  const saveTimeoutRef = useRef(null);

  // Check server availability on mount
  useEffect(() => {
    const checkServer = async () => {
      try {
        const response = await fetch(`${API_URL}/api/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000)
        });
        setServerAvailable(response.ok);
      } catch {
        setServerAvailable(false);
      }
    };
    checkServer();
  }, []);

  // Update a single setting locally (no server call, just localStorage)
  const updateSettingLocal = useCallback((key, value) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      localStorage.setItem('callumony_settings', JSON.stringify(newSettings));

      // Also sync integration credentials to their separate localStorage keys
      // This ensures HivePanel and other components can read them directly
      if (key === 'hiveConnected' || key === 'hiveApiKey' || key === 'hiveUserId') {
        if (newSettings.hiveConnected && newSettings.hiveApiKey && newSettings.hiveUserId) {
          localStorage.setItem('omnipotent_hive_connection', JSON.stringify({
            apiKey: newSettings.hiveApiKey,
            userId: newSettings.hiveUserId,
            connectedAt: Date.now()
          }));
        } else if (key === 'hiveConnected' && !value) {
          localStorage.removeItem('omnipotent_hive_connection');
        }
      }

      if (key === 'gmailConnected' || key === 'gmailEmail' || key === 'gmailAccessToken') {
        if (newSettings.gmailConnected && newSettings.gmailEmail) {
          localStorage.setItem('omnipotent_gmail_connection', JSON.stringify({
            email: newSettings.gmailEmail,
            accessToken: newSettings.gmailAccessToken || '',
            connectedAt: Date.now()
          }));
        } else if (key === 'gmailConnected' && !value) {
          localStorage.removeItem('omnipotent_gmail_connection');
        }
      }

      return newSettings;
    });
  }, []);

  // Update panel size with debouncing (don't spam server)
  const updatePanelSize = useCallback((panel, size) => {
    setSettings(prev => {
      const newPanelSizes = { ...prev.panelSizes, [panel]: size };
      const newSettings = { ...prev, panelSizes: newPanelSizes };

      // Debounce localStorage save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        localStorage.setItem('callumony_settings', JSON.stringify(newSettings));
      }, 500);

      return newSettings;
    });
  }, []);

  // Save all settings
  const saveSettings = useCallback((newSettings) => {
    const mergedSettings = { ...settings, ...newSettings };
    setSettings(mergedSettings);
    localStorage.setItem('callumony_settings', JSON.stringify(mergedSettings));
  }, [settings]);

  const value = {
    settings,
    updateSettingLocal,
    updatePanelSize,
    saveSettings,
    isLoading,
    serverAvailable
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

export default SettingsContext;
