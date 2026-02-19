import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { cacheWorkspaceFile, clearWorkspaceFiles } from '../services/localDatabase';

const WorkspaceContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function WorkspaceProvider({ children }) {
  const [workspacePath, setWorkspacePathState] = useState(() => {
    // Load from localStorage on init
    const saved = localStorage.getItem('callumony_workspace_path');
    return saved || '';
  });
  const [fileTree, setFileTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load file tree from backend
  const loadFileTree = useCallback(async (path) => {
    if (!path) return;

    console.log('Loading file tree for path:', path);
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/files/tree?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error(`Failed to load file tree: ${response.status}`);
      }
      const data = await response.json();
      console.log('File tree loaded:', data.tree?.length || 0, 'items');
      setFileTree(data.tree || []);
    } catch (err) {
      console.error('Error loading file tree:', err);
      setError('Server offline - file tree unavailable');
      setFileTree([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Set workspace path (always works, saves to localStorage)
  const setWorkspacePath = useCallback(async (path) => {
    if (!path) {
      console.log('setWorkspacePath called with empty path');
      return;
    }

    console.log('Setting workspace path:', path);

    // Clear cached workspace files when changing workspace
    clearWorkspaceFiles().catch(err => console.log('Failed to clear workspace cache:', err));

    // Always save to localStorage first
    localStorage.setItem('callumony_workspace_path', path);
    setWorkspacePathState(path);

    // Then try to load file tree from server
    await loadFileTree(path);
  }, [loadFileTree]);

  // Auto-load file tree on mount if workspace path exists
  useEffect(() => {
    if (workspacePath) {
      console.log('Auto-loading file tree on mount for:', workspacePath);
      loadFileTree(workspacePath);
    }
  }, []);

  // Read file content
  const readFile = useCallback(async (filePath) => {
    try {
      const response = await fetch(`${API_URL}/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.status}`);
      }
      const data = await response.json();
      return data.content;
    } catch (err) {
      console.error('Error reading file:', err);
      throw err;
    }
  }, []);

  // Write file content
  const writeFile = useCallback(async (filePath, content) => {
    try {
      const response = await fetch(`${API_URL}/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content })
      });
      if (!response.ok) {
        throw new Error(`Failed to write file: ${response.status}`);
      }
      return true;
    } catch (err) {
      console.error('Error writing file:', err);
      throw err;
    }
  }, []);

  // Open a file in the editor
  const openFile = useCallback(async (filePath, fileName) => {
    // Check if file is already open
    const existing = openFiles.find(f => f.path === filePath);
    if (existing) {
      setActiveFile(filePath);
      return;
    }

    try {
      const content = await readFile(filePath);
      const newFile = {
        path: filePath,
        name: fileName,
        content,
        originalContent: content,
        isDirty: false
      };
      setOpenFiles(prev => [...prev, newFile]);
      setActiveFile(filePath);

      // Cache the file content for AI context (non-blocking)
      cacheWorkspaceFile({
        path: filePath,
        name: fileName,
        content: content
      }).catch(err => console.log('File cache skipped:', err.message));

    } catch (err) {
      console.error('Error opening file:', err);
    }
  }, [openFiles, readFile]);

  // Open a Google Drive file in the editor (read-only, uses drive:// prefix)
  const openDriveFile = useCallback((fileId, fileName, content, metadata) => {
    const drivePath = `drive://${fileId}`;

    // Check if already open
    const existing = openFiles.find(f => f.path === drivePath);
    if (existing) {
      setActiveFile(drivePath);
      return;
    }

    const newFile = {
      path: drivePath,
      name: fileName,
      content: content || '',
      originalContent: content || '',
      isDirty: false,
      isDriveFile: true,
      driveMetadata: metadata || {}
    };

    setOpenFiles(prev => [...prev, newFile]);
    setActiveFile(drivePath);
  }, [openFiles]);

  // Close a file (auto-saves if dirty, skips Drive files)
  const closeFile = useCallback(async (filePath) => {
    // Auto-save dirty file before closing (skip Drive files — they're read-only)
    const file = openFiles.find(f => f.path === filePath);
    if (file && file.isDirty && !file.isDriveFile) {
      try {
        await writeFile(filePath, file.content);
      } catch (err) {
        console.error('Auto-save on close failed:', err);
      }
    }

    setOpenFiles(prev => {
      const remaining = prev.filter(f => f.path !== filePath);
      return remaining;
    });

    if (activeFile === filePath) {
      // Pick the next file that isn't the one being closed
      const remaining = openFiles.filter(f => f.path !== filePath);
      setActiveFile(remaining.length > 0 ? remaining[0].path : null);
    }
  }, [activeFile, openFiles, writeFile]);

  // Update file content in editor
  const updateFileContent = useCallback((filePath, newContent) => {
    setOpenFiles(prev => prev.map(f => {
      if (f.path === filePath) {
        return {
          ...f,
          content: newContent,
          isDirty: newContent !== f.originalContent
        };
      }
      return f;
    }));
  }, []);

  // Save active file (skips Drive files — they're read-only)
  const saveFile = useCallback(async (filePath) => {
    const file = openFiles.find(f => f.path === filePath);
    if (!file || !file.isDirty || file.isDriveFile) return;

    try {
      await writeFile(filePath, file.content);
      setOpenFiles(prev => prev.map(f => {
        if (f.path === filePath) {
          return { ...f, originalContent: f.content, isDirty: false };
        }
        return f;
      }));

      // Update cached file content for AI context (non-blocking)
      cacheWorkspaceFile({
        path: filePath,
        name: file.name,
        content: file.content
      }).catch(err => console.log('File cache update skipped:', err.message));

      return true;
    } catch (err) {
      console.error('Error saving file:', err);
      return false;
    }
  }, [openFiles, writeFile]);

  const value = {
    workspacePath,
    setWorkspacePath,
    fileTree,
    selectedFile,
    setSelectedFile,
    openFiles,
    activeFile,
    setActiveFile,
    openFile,
    openDriveFile,
    closeFile,
    updateFileContent,
    saveFile,
    isLoading,
    error,
    refreshFileTree: () => loadFileTree(workspacePath)
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

export default WorkspaceContext;
