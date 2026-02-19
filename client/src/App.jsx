import { useEffect } from 'react';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { SettingsProvider } from './contexts/SettingsContext';
import IDELayout from './components/layout/IDELayout';
import { setupGlobalErrorHandlers } from './services/errorLogger';
import { exportDatabase } from './services/localDatabase';
import './App.css';

// Set up global error handlers on app load
setupGlobalErrorHandlers();

// Clear error logs on app startup so they don't persist between sessions
try { localStorage.removeItem('credm_error_logs'); } catch (e) { /* ignore */ }

export default function App() {
  // Auto-backup learned data when the app is closing
  useEffect(() => {
    const handleBeforeUnload = () => {
      const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3001';
      try {
        // Use sendBeacon for reliable fire-and-forget on page unload
        const payload = JSON.stringify({ uploadToCloud: true, autoSave: true });
        navigator.sendBeacon(`${API_URL}/api/backup/create`, new Blob([payload], { type: 'application/json' }));
      } catch (e) {
        // Silently fail — the Electron main process backup is the primary mechanism
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return (
    <div
      className="app-background app-loaded"
      style={{
        backgroundImage: `url('/credm-ai-background.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
        minHeight: '100vh',
        width: '100%',
        position: 'relative'
      }}
    >
      <SettingsProvider>
        <WorkspaceProvider>
          <IDELayout />
        </WorkspaceProvider>
      </SettingsProvider>
    </div>
  );
}
