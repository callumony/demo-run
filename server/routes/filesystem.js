import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────────
// Security Utilities
// ─────────────────────────────────────────────────────────────────────────────────

// Blocked paths that should never be accessible
const BLOCKED_PATHS = [
  '.env',
  '.git',
  'node_modules',
  '.ssh',
  '.aws',
  '.config',
  'package-lock.json',
  '.npmrc',
  '.docker',
  'credentials',
  'secrets'
];

// Blocked file extensions
const BLOCKED_EXTENSIONS = [
  '.pem', '.key', '.crt', '.p12', '.pfx', '.jks',
  '.env', '.secrets', '.credentials'
];

// Security: Validate path doesn't contain dangerous patterns
const containsDangerousPattern = (filePath) => {
  const normalized = path.normalize(filePath).toLowerCase();

  // Check for path traversal attempts
  if (normalized.includes('..')) return true;

  // Check for blocked paths
  for (const blocked of BLOCKED_PATHS) {
    if (normalized.includes(blocked.toLowerCase())) return true;
  }

  // Check for blocked extensions
  const ext = path.extname(normalized).toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(ext)) return true;

  return false;
};

// Security: Validate path is within allowed workspace
const validatePath = (requestedPath, workspacePath) => {
  if (!requestedPath || !workspacePath) return false;

  const normalizedRequested = path.normalize(path.resolve(requestedPath));
  const normalizedWorkspace = path.normalize(path.resolve(workspacePath));

  // Check path traversal
  if (!normalizedRequested.startsWith(normalizedWorkspace)) return false;

  // Check for dangerous patterns
  if (containsDangerousPattern(requestedPath)) return false;

  return true;
};

// Sanitize file path input
const sanitizePath = (inputPath) => {
  if (!inputPath || typeof inputPath !== 'string') return null;

  // Remove null bytes
  let sanitized = inputPath.replace(/\0/g, '');

  // Normalize path separators
  sanitized = sanitized.replace(/\\/g, '/');

  return sanitized;
};

// Get directory tree
router.get('/tree', async (req, res) => {
  try {
    const { path: dirPath } = req.query;

    if (!dirPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    // Security: Sanitize path
    const sanitizedPath = sanitizePath(dirPath);
    if (!sanitizedPath || containsDangerousPattern(sanitizedPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }

    const buildTree = async (dirPath, depth = 0, maxDepth = 5) => {
      if (depth > maxDepth) return [];

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const items = [];

        // Sort: directories first, then files, alphabetically
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const entry of sorted) {
          // Skip hidden files and node_modules
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            const children = await buildTree(fullPath, depth + 1, maxDepth);
            items.push({
              name: entry.name,
              path: fullPath,
              type: 'directory',
              children
            });
          } else {
            items.push({
              name: entry.name,
              path: fullPath,
              type: 'file'
            });
          }
        }

        return items;
      } catch (error) {
        console.error(`Error reading directory ${dirPath}:`, error.message);
        return [];
      }
    };

    const tree = await buildTree(sanitizedPath);
    res.json({ tree, rootPath: sanitizedPath });
  } catch (error) {
    console.error('Error building file tree:', error);
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// Read file content
router.get('/read', async (req, res) => {
  try {
    const { path: filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    // Security: Sanitize and validate path
    const sanitizedPath = sanitizePath(filePath);
    if (!sanitizedPath || containsDangerousPattern(sanitizedPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }

    const content = await fs.readFile(sanitizedPath, 'utf-8');
    res.json({ content, path: sanitizedPath });
  } catch (error) {
    console.error('Error reading file:', error);
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Write file content
router.post('/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Security: Sanitize and validate path
    const sanitizedPath = sanitizePath(filePath);
    if (!sanitizedPath || containsDangerousPattern(sanitizedPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }

    await fs.writeFile(sanitizedPath, content, 'utf-8');
    res.json({ success: true, path: sanitizedPath });
  } catch (error) {
    console.error('Error writing file:', error);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// Create file or directory
router.post('/create', async (req, res) => {
  try {
    const { path: itemPath, type, content = '' } = req.body;

    if (!itemPath || !type) {
      return res.status(400).json({ error: 'Path and type are required' });
    }

    // Security: Sanitize and validate path
    const sanitizedPath = sanitizePath(itemPath);
    if (!sanitizedPath || containsDangerousPattern(sanitizedPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }

    if (type === 'directory') {
      await fs.mkdir(sanitizedPath, { recursive: true });
    } else {
      // Ensure parent directory exists
      const parentDir = path.dirname(sanitizedPath);
      await fs.mkdir(parentDir, { recursive: true });
      await fs.writeFile(sanitizedPath, content, 'utf-8');
    }

    res.json({ success: true, path: sanitizedPath, type });
  } catch (error) {
    console.error('Error creating:', error);
    res.status(500).json({ error: 'Failed to create file/directory' });
  }
});

// Delete file or directory
router.delete('/delete', async (req, res) => {
  try {
    const { path: itemPath } = req.body;

    if (!itemPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    // Security: Sanitize and validate path
    const sanitizedPath = sanitizePath(itemPath);
    if (!sanitizedPath || containsDangerousPattern(sanitizedPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }

    const stats = await fs.stat(sanitizedPath);

    if (stats.isDirectory()) {
      await fs.rm(sanitizedPath, { recursive: true });
    } else {
      await fs.unlink(sanitizedPath);
    }

    res.json({ success: true, path: sanitizedPath });
  } catch (error) {
    console.error('Error deleting:', error);
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File/directory not found' });
    }
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Rename file or directory
router.post('/rename', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;

    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Old path and new path are required' });
    }

    // Security: Sanitize and validate both paths
    const sanitizedOldPath = sanitizePath(oldPath);
    const sanitizedNewPath = sanitizePath(newPath);

    if (!sanitizedOldPath || containsDangerousPattern(sanitizedOldPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid source path' });
    }
    if (!sanitizedNewPath || containsDangerousPattern(sanitizedNewPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid destination path' });
    }

    await fs.rename(sanitizedOldPath, sanitizedNewPath);
    res.json({ success: true, oldPath: sanitizedOldPath, newPath: sanitizedNewPath });
  } catch (error) {
    console.error('Error renaming:', error);
    res.status(500).json({ error: 'Failed to rename' });
  }
});

// Get all files in a folder recursively (for context loading)
// Supported file extensions for code/text files
const SUPPORTED_EXTENSIONS = [
  '.lua', '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt',
  '.css', '.html', '.xml', '.sql', '.py', '.php', '.c', '.cpp',
  '.h', '.hpp', '.java', '.rb', '.go', '.rs', '.sh', '.bat',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.fxmanifest'
];

router.post('/read-folder', async (req, res) => {
  try {
    const { folderPath, maxFiles = 50, maxFileSize = 50000 } = req.body;

    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }

    // Security: Sanitize and validate path
    const sanitizedPath = sanitizePath(folderPath);
    if (!sanitizedPath || containsDangerousPattern(sanitizedPath)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }

    const files = [];
    let fileCount = 0;

    const readFolderRecursive = async (dirPath, depth = 0) => {
      if (depth > 5 || fileCount >= maxFiles) return;

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (fileCount >= maxFiles) break;

          // Skip hidden files/folders and node_modules
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            await readFolderRecursive(fullPath, depth + 1);
          } else {
            // Check if it's a supported file type
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXTENSIONS.includes(ext) || entry.name === 'fxmanifest.lua') {
              try {
                const stats = await fs.stat(fullPath);

                // Skip files that are too large
                if (stats.size > maxFileSize) {
                  files.push({
                    path: fullPath,
                    name: entry.name,
                    content: `[File too large: ${(stats.size / 1024).toFixed(1)}KB]`,
                    size: stats.size,
                    truncated: true
                  });
                } else {
                  const content = await fs.readFile(fullPath, 'utf-8');
                  files.push({
                    path: fullPath,
                    name: entry.name,
                    content: content,
                    size: stats.size,
                    truncated: false
                  });
                }
                fileCount++;
              } catch (readError) {
                console.error(`Error reading file ${fullPath}:`, readError.message);
              }
            }
          }
        }
      } catch (dirError) {
        console.error(`Error reading directory ${dirPath}:`, dirError.message);
      }
    };

    await readFolderRecursive(sanitizedPath);

    res.json({
      success: true,
      folderPath: sanitizedPath,
      files,
      totalFiles: files.length,
      reachedLimit: fileCount >= maxFiles
    });
  } catch (error) {
    console.error('Error reading folder:', error);
    res.status(500).json({ error: 'Failed to read folder contents' });
  }
});

export default router;
