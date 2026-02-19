// ═══════════════════════════════════════════════════════════════════════════════
// LOCAL DATABASE SERVICE
// Uses IndexedDB for persistent local storage
// ═══════════════════════════════════════════════════════════════════════════════

const DB_NAME = 'OmnipotentDB';
const DB_VERSION = 5; // Incremented to add usage tracking store

// Store names
const STORES = {
  TRAINING_ITEMS: 'trainingItems',
  SETTINGS: 'settings',
  CHAT_HISTORY: 'chatHistory',
  MEMORIES: 'memories',
  WORKSPACE_FILES: 'workspaceFiles',
  CONTEXT_FOLDERS: 'contextFolders',
  CHAT_LEARNINGS: 'chatLearnings', // New store for things learned from chat
  USAGE_RECORDS: 'usageRecords' // Store for token usage tracking
};

let db = null;
let dbInitPromise = null;

// ─────────────────────────────────────────────────────────────────────────────────
// Database Initialization
// ─────────────────────────────────────────────────────────────────────────────────

function isDbAlive() {
  if (!db) return false;
  try {
    // Accessing objectStoreNames on a closed db throws
    db.objectStoreNames;
    return true;
  } catch {
    return false;
  }
}

export async function initDatabase() {
  if (isDbAlive()) return db;

  // If a connection attempt is already in progress, reuse it
  if (dbInitPromise) return dbInitPromise;

  // Clear stale reference
  db = null;

  dbInitPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open database:', request.error);
      dbInitPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;

      // Auto-reconnect if the browser closes the connection
      db.onclose = () => {
        console.warn('IndexedDB connection closed unexpectedly, will reconnect on next operation');
        db = null;
        dbInitPromise = null;
      };

      db.onversionchange = () => {
        db.close();
        db = null;
        dbInitPromise = null;
        console.warn('IndexedDB version changed, connection closed');
      };

      console.log('Database initialized successfully');
      dbInitPromise = null;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Training items store
      if (!database.objectStoreNames.contains(STORES.TRAINING_ITEMS)) {
        const trainingStore = database.createObjectStore(STORES.TRAINING_ITEMS, { keyPath: 'id' });
        trainingStore.createIndex('title', 'title', { unique: false });
        trainingStore.createIndex('isTrained', 'isTrained', { unique: false });
        trainingStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Settings store
      if (!database.objectStoreNames.contains(STORES.SETTINGS)) {
        database.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }

      // Chat history store
      if (!database.objectStoreNames.contains(STORES.CHAT_HISTORY)) {
        const chatStore = database.createObjectStore(STORES.CHAT_HISTORY, { keyPath: 'id', autoIncrement: true });
        chatStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Memories store - for learned facts from conversations
      if (!database.objectStoreNames.contains(STORES.MEMORIES)) {
        const memoriesStore = database.createObjectStore(STORES.MEMORIES, { keyPath: 'id' });
        memoriesStore.createIndex('type', 'type', { unique: false });
        memoriesStore.createIndex('createdAt', 'createdAt', { unique: false });
        memoriesStore.createIndex('importance', 'importance', { unique: false });
      }

      // Workspace files store - cached file contents for context
      if (!database.objectStoreNames.contains(STORES.WORKSPACE_FILES)) {
        const filesStore = database.createObjectStore(STORES.WORKSPACE_FILES, { keyPath: 'path' });
        filesStore.createIndex('lastModified', 'lastModified', { unique: false });
        filesStore.createIndex('type', 'type', { unique: false });
      }

      // Context folders store - folders designated as AI context
      if (!database.objectStoreNames.contains(STORES.CONTEXT_FOLDERS)) {
        const foldersStore = database.createObjectStore(STORES.CONTEXT_FOLDERS, { keyPath: 'path' });
        foldersStore.createIndex('addedAt', 'addedAt', { unique: false });
      }

      // Chat learnings store - knowledge learned from conversations
      if (!database.objectStoreNames.contains(STORES.CHAT_LEARNINGS)) {
        const learningsStore = database.createObjectStore(STORES.CHAT_LEARNINGS, { keyPath: 'id' });
        learningsStore.createIndex('learnedAt', 'learnedAt', { unique: false });
        learningsStore.createIndex('category', 'category', { unique: false });
        learningsStore.createIndex('isTrained', 'isTrained', { unique: false });
        learningsStore.createIndex('sessionId', 'sessionId', { unique: false });
      }

      // Usage records store - for tracking token usage and resource consumption
      if (!database.objectStoreNames.contains(STORES.USAGE_RECORDS)) {
        const usageStore = database.createObjectStore(STORES.USAGE_RECORDS, { keyPath: 'id' });
        usageStore.createIndex('date', 'date', { unique: false });
        usageStore.createIndex('month', 'month', { unique: false });
        usageStore.createIndex('year', 'year', { unique: false });
      }

      console.log('Database schema created/upgraded');
    };
  });

  return dbInitPromise;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Generic CRUD Operations
// ─────────────────────────────────────────────────────────────────────────────────

async function getStore(storeName, mode = 'readonly') {
  if (!isDbAlive()) await initDatabase();
  try {
    // Check if store exists before attempting transaction
    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error(`Object store "${storeName}" not found. Please refresh the page to upgrade the database.`);
    }
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  } catch (error) {
    // Connection went stale between the check and the transaction — reconnect once
    if (error.name === 'InvalidStateError' || error.name === 'TransactionInactiveError') {
      console.warn('Database connection stale, reconnecting...');
      db = null;
      dbInitPromise = null;
      await initDatabase();
      const transaction = db.transaction(storeName, mode);
      return transaction.objectStore(storeName);
    }
    throw error;
  }
}

async function getAllFromStore(storeName) {
  const store = await getStore(storeName);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getFromStore(storeName, key) {
  const store = await getStore(storeName);
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addToStore(storeName, item) {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.add(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putToStore(storeName, item) {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteFromStore(storeName, key) {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearStore(storeName) {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// Training Items API
// ─────────────────────────────────────────────────────────────────────────────────

export async function getTrainingItems() {
  try {
    const items = await getAllFromStore(STORES.TRAINING_ITEMS);
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.error('Failed to get training items:', error);
    return [];
  }
}

export async function getTrainingItem(id) {
  try {
    return await getFromStore(STORES.TRAINING_ITEMS, id);
  } catch (error) {
    console.error('Failed to get training item:', error);
    return null;
  }
}

export async function addTrainingItem(item) {
  // Analyze the content to determine what was learned
  const analysis = analyzeTrainingContent(item.content, item.fileName);

  const newItem = {
    id: crypto.randomUUID(),
    title: item.title,
    description: item.description || '',
    content: item.content,
    fileName: item.fileName || null,
    source: item.source || 'manual',
    isTrained: false,
    trainedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Content analysis
    analysis: analysis
  };

  try {
    await addToStore(STORES.TRAINING_ITEMS, newItem);
    return newItem;
  } catch (error) {
    console.error('Failed to add training item:', error);
    throw error;
  }
}

export async function updateTrainingItem(id, updates) {
  try {
    const existing = await getFromStore(STORES.TRAINING_ITEMS, id);
    if (!existing) throw new Error('Item not found');

    // Re-analyze if content changed
    const analysis = updates.content !== undefined
      ? analyzeTrainingContent(updates.content, existing.fileName)
      : existing.analysis;

    const updatedItem = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
      // Reset trained status if content changed
      isTrained: updates.content !== undefined ? false : existing.isTrained,
      trainedAt: updates.content !== undefined ? null : existing.trainedAt,
      analysis: analysis
    };

    await putToStore(STORES.TRAINING_ITEMS, updatedItem);
    return updatedItem;
  } catch (error) {
    console.error('Failed to update training item:', error);
    throw error;
  }
}

export async function deleteTrainingItem(id) {
  try {
    await deleteFromStore(STORES.TRAINING_ITEMS, id);
    return true;
  } catch (error) {
    console.error('Failed to delete training item:', error);
    throw error;
  }
}

export async function clearTrainingItems() {
  try {
    await clearStore(STORES.TRAINING_ITEMS);
    return true;
  } catch (error) {
    console.error('Failed to clear training items:', error);
    throw error;
  }
}

export async function markItemTrained(id) {
  try {
    const existing = await getFromStore(STORES.TRAINING_ITEMS, id);
    if (!existing) throw new Error('Item not found');

    const updatedItem = {
      ...existing,
      isTrained: true,
      trainedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putToStore(STORES.TRAINING_ITEMS, updatedItem);
    return updatedItem;
  } catch (error) {
    console.error('Failed to mark item as trained:', error);
    throw error;
  }
}

export async function getTrainingStats() {
  try {
    const items = await getAllFromStore(STORES.TRAINING_ITEMS);
    return {
      totalItems: items.length,
      trainedItems: items.filter(i => i.isTrained).length
    };
  } catch (error) {
    console.error('Failed to get training stats:', error);
    return { totalItems: 0, trainedItems: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Settings API
// ─────────────────────────────────────────────────────────────────────────────────

export async function getSetting(key, defaultValue = null) {
  try {
    const result = await getFromStore(STORES.SETTINGS, key);
    return result?.value ?? defaultValue;
  } catch (error) {
    console.error('Failed to get setting:', error);
    return defaultValue;
  }
}

export async function setSetting(key, value) {
  try {
    await putToStore(STORES.SETTINGS, { key, value });
    return true;
  } catch (error) {
    console.error('Failed to set setting:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Chat History API
// ─────────────────────────────────────────────────────────────────────────────────

export async function getChatHistory(limit = 100) {
  try {
    const messages = await getAllFromStore(STORES.CHAT_HISTORY);
    return messages
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-limit);
  } catch (error) {
    console.error('Failed to get chat history:', error);
    return [];
  }
}

export async function addChatMessage(message) {
  const newMessage = {
    ...message,
    timestamp: new Date().toISOString()
  };

  try {
    await addToStore(STORES.CHAT_HISTORY, newMessage);
    return newMessage;
  } catch (error) {
    console.error('Failed to add chat message:', error);
    throw error;
  }
}

export async function clearChatHistory() {
  try {
    await clearStore(STORES.CHAT_HISTORY);
    return true;
  } catch (error) {
    console.error('Failed to clear chat history:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Memories API - Persistent memory from conversations
// ─────────────────────────────────────────────────────────────────────────────────

export async function getMemories(limit = 50) {
  try {
    const memories = await getAllFromStore(STORES.MEMORIES);
    return memories
      .sort((a, b) => b.importance - a.importance || new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  } catch (error) {
    console.error('Failed to get memories:', error);
    return [];
  }
}

export async function addMemory(memory) {
  const newMemory = {
    id: crypto.randomUUID(),
    type: memory.type || 'fact', // fact, preference, context, correction
    content: memory.content,
    summary: memory.summary || '', // Short 5-10 word summary
    context: memory.context || '', // How/where this was learned
    source: memory.source || 'conversation', // conversation, manual, file
    importance: memory.importance || 5, // 1-10 scale
    relatedTopics: memory.relatedTopics || [], // Array of related keywords
    examples: memory.examples || [], // Array of example use cases
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    useCount: 0
  };

  try {
    await putToStore(STORES.MEMORIES, newMemory);
    return newMemory;
  } catch (error) {
    console.error('Failed to add memory:', error);
    throw error;
  }
}

export async function updateMemoryUsage(id) {
  try {
    const memory = await getFromStore(STORES.MEMORIES, id);
    if (memory) {
      memory.lastUsed = new Date().toISOString();
      memory.useCount = (memory.useCount || 0) + 1;
      await putToStore(STORES.MEMORIES, memory);
    }
  } catch (error) {
    console.error('Failed to update memory usage:', error);
  }
}

export async function updateMemory(memory) {
  try {
    if (!memory.id) {
      throw new Error('Memory ID is required for update');
    }
    await putToStore(STORES.MEMORIES, memory);
    return memory;
  } catch (error) {
    console.error('Failed to update memory:', error);
    throw error;
  }
}

export async function deleteMemory(id) {
  try {
    await deleteFromStore(STORES.MEMORIES, id);
    return true;
  } catch (error) {
    console.error('Failed to delete memory:', error);
    throw error;
  }
}

export async function clearMemories() {
  try {
    await clearStore(STORES.MEMORIES);
    return true;
  } catch (error) {
    console.error('Failed to clear memories:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Workspace Files API - Cache file contents for context
// ─────────────────────────────────────────────────────────────────────────────────

export async function getWorkspaceFiles() {
  try {
    return await getAllFromStore(STORES.WORKSPACE_FILES);
  } catch (error) {
    console.error('Failed to get workspace files:', error);
    return [];
  }
}

export async function getWorkspaceFile(path) {
  try {
    return await getFromStore(STORES.WORKSPACE_FILES, path);
  } catch (error) {
    console.error('Failed to get workspace file:', error);
    return null;
  }
}

export async function cacheWorkspaceFile(file) {
  const cachedFile = {
    path: file.path,
    name: file.name,
    content: file.content,
    type: file.type || getFileType(file.name),
    size: file.content?.length || 0,
    lastModified: new Date().toISOString(),
    summary: file.summary || null
  };

  try {
    await putToStore(STORES.WORKSPACE_FILES, cachedFile);
    return cachedFile;
  } catch (error) {
    console.error('Failed to cache workspace file:', error);
    throw error;
  }
}

export async function removeWorkspaceFile(path) {
  try {
    await deleteFromStore(STORES.WORKSPACE_FILES, path);
    return true;
  } catch (error) {
    console.error('Failed to remove workspace file:', error);
    throw error;
  }
}

export async function clearWorkspaceFiles() {
  try {
    await clearStore(STORES.WORKSPACE_FILES);
    return true;
  } catch (error) {
    console.error('Failed to clear workspace files:', error);
    throw error;
  }
}

// Helper to determine file type
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types = {
    lua: 'lua',
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    md: 'markdown',
    txt: 'text',
    css: 'css',
    html: 'html',
    xml: 'xml',
    sql: 'sql',
    py: 'python',
    php: 'php'
  };
  return types[ext] || 'text';
}

// ─────────────────────────────────────────────────────────────────────────────────
// Content Analysis - Analyze what was learned from training content
// ─────────────────────────────────────────────────────────────────────────────────

export function analyzeTrainingContent(content, fileName = '') {
  const analysis = {
    contentType: 'unknown',
    language: null,
    framework: null,
    concepts: [],
    features: [],
    codePatterns: [],
    learningHighlights: [],
    stats: {
      lines: 0,
      codeBlocks: 0,
      functions: 0,
      classes: 0,
      comments: 0
    }
  };

  if (!content) return analysis;

  const lines = content.split('\n');
  analysis.stats.lines = lines.length;

  // Detect file extension from fileName
  const ext = fileName?.split('.').pop()?.toLowerCase() || '';

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONTENT TYPE DETECTION
  // ═══════════════════════════════════════════════════════════════════════════════

  // Check for code patterns
  const hasCodeBlocks = /```[\s\S]*?```/.test(content);
  const hasFunctions = /function\s+\w+|local\s+function|const\s+\w+\s*=\s*(?:async\s*)?\(|def\s+\w+|fn\s+\w+/.test(content);
  const hasClasses = /class\s+\w+|local\s+\w+\s*=\s*{/.test(content);
  const hasImports = /import\s+|require\s*\(|from\s+.*\s+import/.test(content);
  const hasVariables = /local\s+\w+\s*=|const\s+\w+|let\s+\w+|var\s+\w+/.test(content);

  // Check for documentation patterns
  const hasHeaders = /^#{1,6}\s+/m.test(content);
  const hasBulletPoints = /^[\s]*[-*]\s+/m.test(content);
  const hasNumberedList = /^[\s]*\d+\.\s+/m.test(content);

  // Check for config/data patterns
  const isJson = ext === 'json' || /^\s*[\[{]/.test(content.trim());
  const isXml = ext === 'xml' || /<\?xml/.test(content) || /<\w+[^>]*>[\s\S]*<\/\w+>/.test(content);
  const isYaml = ext === 'yaml' || ext === 'yml';

  // Determine primary content type
  if (isJson) {
    analysis.contentType = 'configuration';
    analysis.learningHighlights.push('JSON configuration/data structure');
  } else if (isXml) {
    analysis.contentType = 'configuration';
    analysis.learningHighlights.push('XML document structure');
  } else if (isYaml) {
    analysis.contentType = 'configuration';
    analysis.learningHighlights.push('YAML configuration');
  } else if (hasFunctions || hasClasses || hasImports) {
    analysis.contentType = 'code';
    analysis.learningHighlights.push('Source code with executable logic');
  } else if (hasHeaders && (hasBulletPoints || hasNumberedList)) {
    analysis.contentType = 'documentation';
    analysis.learningHighlights.push('Documentation/reference material');
  } else if (hasCodeBlocks) {
    analysis.contentType = 'tutorial';
    analysis.learningHighlights.push('Tutorial with code examples');
  } else {
    analysis.contentType = 'text';
    analysis.learningHighlights.push('Text content/notes');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LANGUAGE DETECTION
  // ═══════════════════════════════════════════════════════════════════════════════

  // Lua detection
  const luaPatterns = [
    /\blocal\s+\w+\s*=/, /\bfunction\s*\(/, /\bend\b/, /\bthen\b/,
    /\belseif\b/, /\brepeat\b/, /\buntil\b/, /\.\.\s*["']/, /~=/
  ];
  const luaMatches = luaPatterns.filter(p => p.test(content)).length;

  // JavaScript detection
  const jsPatterns = [
    /\bconst\s+\w+/, /\blet\s+\w+/, /\bvar\s+\w+/, /=>\s*{/, /===/, /!==/,
    /\basync\s+function/, /\bawait\s+/, /\.then\s*\(/, /\.catch\s*\(/
  ];
  const jsMatches = jsPatterns.filter(p => p.test(content)).length;

  // Python detection
  const pyPatterns = [
    /\bdef\s+\w+\s*\(/, /\bclass\s+\w+:/, /\bimport\s+\w+/, /\bfrom\s+\w+\s+import/,
    /\bif\s+.*:$/, /\belif\s+.*:$/, /\bfor\s+\w+\s+in\s+/
  ];
  const pyMatches = pyPatterns.filter(p => p.test(content)).length;

  // Set language based on matches
  if (ext === 'lua' || luaMatches >= 3) {
    analysis.language = 'Lua';
  } else if (['js', 'jsx', 'ts', 'tsx'].includes(ext) || jsMatches >= 3) {
    analysis.language = ext === 'ts' || ext === 'tsx' ? 'TypeScript' : 'JavaScript';
  } else if (ext === 'py' || pyMatches >= 2) {
    analysis.language = 'Python';
  } else if (ext === 'html' || /<html|<body|<div/.test(content)) {
    analysis.language = 'HTML';
  } else if (ext === 'css' || /\{[\s\S]*?[a-z-]+\s*:[\s\S]*?\}/.test(content)) {
    analysis.language = 'CSS';
  } else if (ext === 'sql' || /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(content)) {
    analysis.language = 'SQL';
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FRAMEWORK DETECTION
  // ═══════════════════════════════════════════════════════════════════════════════

  // RedM/FiveM/CFX detection
  if (/Citizen\.|TriggerServerEvent|TriggerClientEvent|RegisterNetEvent|RegisterServerEvent|RegisterCommand|GetPlayerPed|CreateThread|QBCore|ESX|VORP|RSGCore/.test(content)) {
    analysis.framework = 'RedM/FiveM (CFX)';
    analysis.learningHighlights.push('RedM/FiveM game modding code');

    // Detect specific frameworks
    if (/QBCore/.test(content)) {
      analysis.concepts.push('QBCore Framework');
    }
    if (/ESX/.test(content)) {
      analysis.concepts.push('ESX Framework');
    }
    if (/VORP/.test(content)) {
      analysis.concepts.push('VORP Framework (RedM)');
    }
    if (/RSGCore/.test(content)) {
      analysis.concepts.push('RSGCore Framework (RedM)');
    }
  }

  // Vue.js detection
  if (/<template>|<script setup>|defineComponent|ref\s*\(|reactive\s*\(|computed\s*\(|@click|v-if|v-for|v-model/.test(content)) {
    analysis.framework = 'Vue.js';
    analysis.learningHighlights.push('Vue.js component patterns');

    if (/Composition API|<script setup>|ref\s*\(|reactive\s*\(/.test(content)) {
      analysis.concepts.push('Vue 3 Composition API');
    }
    if (/Options API|data\s*\(\s*\)|methods\s*:/.test(content)) {
      analysis.concepts.push('Vue Options API');
    }
  }

  // React detection
  if (/import\s+React|from\s+['"]react['"]|useState|useEffect|useRef|useCallback|useMemo|<\w+\s+.*\/>/.test(content)) {
    analysis.framework = 'React';
    analysis.learningHighlights.push('React component patterns');

    if (/useState|useEffect|useRef/.test(content)) {
      analysis.concepts.push('React Hooks');
    }
  }

  // Node.js/Express detection
  if (/express\s*\(\)|app\.get|app\.post|req\s*,\s*res|module\.exports|require\s*\(['"]/.test(content)) {
    analysis.framework = analysis.framework ? `${analysis.framework} + Node.js` : 'Node.js';
    analysis.learningHighlights.push('Node.js/Express patterns');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CONCEPTS & FEATURES EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════════

  // Count code elements
  const functionMatches = content.match(/function\s+\w+|local\s+function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(/g);
  analysis.stats.functions = functionMatches?.length || 0;

  const classMatches = content.match(/class\s+\w+/g);
  analysis.stats.classes = classMatches?.length || 0;

  const codeBlockMatches = content.match(/```[\s\S]*?```/g);
  analysis.stats.codeBlocks = codeBlockMatches?.length || 0;

  const commentMatches = content.match(/\/\/.*|--.*|\/\*[\s\S]*?\*\/|#.*/g);
  analysis.stats.comments = commentMatches?.length || 0;

  // Extract concepts based on content patterns
  if (/async|await|Promise|\.then\(/.test(content)) {
    analysis.concepts.push('Async/Promise patterns');
  }
  if (/try\s*{|catch\s*\(|pcall\s*\(/.test(content)) {
    analysis.concepts.push('Error handling');
  }
  if (/SELECT|INSERT|UPDATE|DELETE|CREATE TABLE/i.test(content)) {
    analysis.concepts.push('Database operations');
  }
  if (/fetch\s*\(|axios|XMLHttpRequest|http\.request/.test(content)) {
    analysis.concepts.push('HTTP/API calls');
  }
  if (/addEventListener|\.on\s*\(|RegisterNetEvent|AddEventHandler/.test(content)) {
    analysis.concepts.push('Event handling');
  }
  if (/setInterval|setTimeout|Citizen\.Wait|Wait\s*\(/.test(content)) {
    analysis.concepts.push('Timers/Threading');
  }
  if (/localStorage|sessionStorage|IndexedDB|better-sqlite/.test(content)) {
    analysis.concepts.push('Data persistence');
  }
  if (/JSON\.parse|JSON\.stringify|json\.decode|json\.encode/.test(content)) {
    analysis.concepts.push('JSON handling');
  }
  if (/\.map\s*\(|\.filter\s*\(|\.reduce\s*\(|ipairs|pairs/.test(content)) {
    analysis.concepts.push('Array/Table iteration');
  }

  // Extract features from documentation
  if (analysis.contentType === 'documentation' || analysis.contentType === 'tutorial') {
    // Look for feature-like patterns in headers
    const headerMatches = content.match(/^#{1,6}\s+(.+)$/gm);
    if (headerMatches) {
      analysis.features = headerMatches
        .map(h => h.replace(/^#+\s+/, '').trim())
        .filter(h => h.length > 2 && h.length < 60)
        .slice(0, 8);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CODE PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════════

  if (analysis.contentType === 'code' || analysis.contentType === 'tutorial') {
    // Detect common patterns
    if (/CreateThread|Citizen\.CreateThread/.test(content)) {
      analysis.codePatterns.push('Game threads');
    }
    if (/RegisterCommand/.test(content)) {
      analysis.codePatterns.push('Chat commands');
    }
    if (/TriggerServerEvent|TriggerClientEvent/.test(content)) {
      analysis.codePatterns.push('Client-Server events');
    }
    if (/exports\[|GetExport/.test(content)) {
      analysis.codePatterns.push('Resource exports');
    }
    if (/DrawText|DrawSprite|RequestStreamedTextureDict/.test(content)) {
      analysis.codePatterns.push('UI/Drawing');
    }
    if (/GetEntityCoords|SetEntityCoords|GetEntityHeading/.test(content)) {
      analysis.codePatterns.push('Entity manipulation');
    }
    if (/CreatePed|CreateVehicle|CreateObject/.test(content)) {
      analysis.codePatterns.push('Entity spawning');
    }
    if (/TaskWanderStandard|TaskGoToEntity|TaskPlayAnim/.test(content)) {
      analysis.codePatterns.push('NPC/Ped tasks');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GENERATE SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════════

  // Build learning highlights summary
  if (analysis.stats.functions > 0) {
    analysis.learningHighlights.push(`${analysis.stats.functions} function definition${analysis.stats.functions > 1 ? 's' : ''}`);
  }
  if (analysis.stats.classes > 0) {
    analysis.learningHighlights.push(`${analysis.stats.classes} class definition${analysis.stats.classes > 1 ? 's' : ''}`);
  }
  if (analysis.concepts.length > 0) {
    analysis.learningHighlights.push(`Concepts: ${analysis.concepts.slice(0, 3).join(', ')}`);
  }
  if (analysis.codePatterns.length > 0) {
    analysis.learningHighlights.push(`Patterns: ${analysis.codePatterns.slice(0, 3).join(', ')}`);
  }

  return analysis;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Chat Learnings API - Knowledge learned from conversations (contributes to Brain)
// ─────────────────────────────────────────────────────────────────────────────────

export async function getChatLearnings(limit = 100) {
  try {
    const learnings = await getAllFromStore(STORES.CHAT_LEARNINGS);
    return learnings
      .sort((a, b) => new Date(b.learnedAt) - new Date(a.learnedAt))
      .slice(0, limit);
  } catch (error) {
    console.error('Failed to get chat learnings:', error);
    return [];
  }
}

export async function getChatLearning(id) {
  try {
    return await getFromStore(STORES.CHAT_LEARNINGS, id);
  } catch (error) {
    console.error('Failed to get chat learning:', error);
    return null;
  }
}

export async function addChatLearning(learning) {
  const newLearning = {
    id: crypto.randomUUID(),
    // What was learned
    title: learning.title || 'Learned from conversation',
    description: learning.description || '',
    content: learning.content,
    // Categorization
    category: learning.category || 'general', // general, code, concept, preference, correction, context
    appliesTo: learning.appliesTo || [], // e.g., ['RedM', 'Lua', 'server-side']
    relatedTopics: learning.relatedTopics || [],
    // Source tracking
    sessionId: learning.sessionId || null,
    sessionName: learning.sessionName || null,
    userMessage: learning.userMessage || null,
    assistantResponse: learning.assistantResponse || null,
    // Timing
    learnedAt: new Date().toISOString(),
    learnedDate: new Date().toLocaleDateString(),
    learnedTime: new Date().toLocaleTimeString(),
    // Training status
    isTrained: false,
    trainedAt: null,
    chunksCreated: 0,
    // Metadata
    importance: learning.importance || 5, // 1-10
    verified: false // Can be verified by user later
  };

  try {
    // Save to IndexedDB (client-side)
    await putToStore(STORES.CHAT_LEARNINGS, newLearning);

    // Sync to server SQLite so training endpoint can find it by ID
    try {
      const apiUrl = import.meta.env?.VITE_API_URL || 'http://localhost:3001';
      await fetch(`${apiUrl}/api/training/chat-learnings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newLearning.id,
          title: newLearning.title,
          description: newLearning.description,
          content: newLearning.content,
          category: newLearning.category,
          appliesTo: newLearning.appliesTo,
          relatedTopics: newLearning.relatedTopics,
          sessionId: newLearning.sessionId,
          sessionName: newLearning.sessionName,
          userMessage: newLearning.userMessage,
          assistantResponse: newLearning.assistantResponse,
          importance: newLearning.importance
        })
      });
    } catch (syncError) {
      // Server sync is best-effort — don't block if server is down
      console.warn('Failed to sync chat learning to server:', syncError.message);
    }

    return newLearning;
  } catch (error) {
    console.error('Failed to add chat learning:', error);
    throw error;
  }
}

export async function updateChatLearning(id, updates) {
  try {
    const existing = await getFromStore(STORES.CHAT_LEARNINGS, id);
    if (!existing) throw new Error('Learning not found');

    const updatedLearning = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await putToStore(STORES.CHAT_LEARNINGS, updatedLearning);
    return updatedLearning;
  } catch (error) {
    console.error('Failed to update chat learning:', error);
    throw error;
  }
}

export async function markChatLearningTrained(id, chunksCreated = 0) {
  try {
    const existing = await getFromStore(STORES.CHAT_LEARNINGS, id);
    if (!existing) throw new Error('Learning not found');

    const updatedLearning = {
      ...existing,
      isTrained: true,
      trainedAt: new Date().toISOString(),
      chunksCreated: chunksCreated
    };

    await putToStore(STORES.CHAT_LEARNINGS, updatedLearning);
    return updatedLearning;
  } catch (error) {
    console.error('Failed to mark chat learning as trained:', error);
    throw error;
  }
}

export async function deleteChatLearning(id) {
  try {
    await deleteFromStore(STORES.CHAT_LEARNINGS, id);
    return true;
  } catch (error) {
    console.error('Failed to delete chat learning:', error);
    throw error;
  }
}

export async function clearChatLearnings() {
  try {
    await clearStore(STORES.CHAT_LEARNINGS);
    return true;
  } catch (error) {
    console.error('Failed to clear chat learnings:', error);
    throw error;
  }
}

export async function getChatLearningsStats() {
  try {
    const learnings = await getAllFromStore(STORES.CHAT_LEARNINGS);
    const trained = learnings.filter(l => l.isTrained);
    const totalChunks = trained.reduce((sum, l) => sum + (l.chunksCreated || 0), 0);

    // Group by category
    const byCategory = learnings.reduce((acc, l) => {
      acc[l.category] = (acc[l.category] || 0) + 1;
      return acc;
    }, {});

    return {
      totalLearnings: learnings.length,
      trainedLearnings: trained.length,
      untrainedLearnings: learnings.length - trained.length,
      totalChunks: totalChunks,
      byCategory: byCategory
    };
  } catch (error) {
    console.error('Failed to get chat learnings stats:', error);
    return { totalLearnings: 0, trainedLearnings: 0, untrainedLearnings: 0, totalChunks: 0, byCategory: {} };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Context Folders API - Designate folders as AI context
// ─────────────────────────────────────────────────────────────────────────────────

export async function getContextFolders() {
  try {
    return await getAllFromStore(STORES.CONTEXT_FOLDERS);
  } catch (error) {
    console.error('Failed to get context folders:', error);
    return [];
  }
}

export async function addContextFolder(folderPath) {
  const contextFolder = {
    path: folderPath,
    addedAt: new Date().toISOString()
  };

  try {
    await putToStore(STORES.CONTEXT_FOLDERS, contextFolder);
    return contextFolder;
  } catch (error) {
    console.error('Failed to add context folder:', error);
    throw error;
  }
}

export async function removeContextFolder(folderPath) {
  try {
    await deleteFromStore(STORES.CONTEXT_FOLDERS, folderPath);
    return true;
  } catch (error) {
    console.error('Failed to remove context folder:', error);
    throw error;
  }
}

export async function isContextFolder(folderPath) {
  try {
    const folder = await getFromStore(STORES.CONTEXT_FOLDERS, folderPath);
    return !!folder;
  } catch (error) {
    console.error('Failed to check context folder:', error);
    return false;
  }
}

export async function clearContextFolders() {
  try {
    await clearStore(STORES.CONTEXT_FOLDERS);
    return true;
  } catch (error) {
    console.error('Failed to clear context folders:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Consolidated Context Builder - Get all context for AI
// ─────────────────────────────────────────────────────────────────────────────────

// Helper to load context folder contents from server
async function loadContextFolderContents(folderPath) {
  try {
    const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3001';
    const response = await fetch(`${API_URL}/api/files/read-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath,
        maxFiles: 30,
        maxFileSize: 30000
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.files || [];
    }
  } catch (error) {
    console.error(`Failed to load context folder ${folderPath}:`, error);
  }
  return [];
}

export async function buildAgentContext(maxLength = 50000) {
  const sections = [];

  try {
    // 1. Get trained items
    const trainedItems = await getTrainingItems();
    const trained = trainedItems.filter(item => item.isTrained);
    if (trained.length > 0) {
      const trainingSection = trained.map(item =>
        `### ${item.title}\n${item.description}\n\n${item.content}`
      ).join('\n\n---\n\n');
      sections.push(`## TRAINING DATA\n${trainingSection}`);
    }

    // 2. Get memories
    const memories = await getMemories(30);
    if (memories.length > 0) {
      const memorySection = memories.map(m =>
        `- [${m.type.toUpperCase()}] ${m.content}`
      ).join('\n');
      sections.push(`## REMEMBERED FACTS\n${memorySection}`);
    }

    // 3. Get context folders and their contents (PRIMARY CODE CONTEXT)
    const contextFolders = await getContextFolders();
    if (contextFolders.length > 0) {
      const allContextFiles = [];

      for (const folder of contextFolders) {
        const files = await loadContextFolderContents(folder.path);
        allContextFiles.push(...files);
      }

      if (allContextFiles.length > 0) {
        const contextSection = allContextFiles.map(f => {
          const relativePath = f.path.split(/[/\\]/).slice(-2).join('/');
          return `### ${relativePath}\n\`\`\`\n${f.content}\n\`\`\``;
        }).join('\n\n');
        sections.push(`## CONTEXT FOLDER FILES (${allContextFiles.length} files)\n${contextSection}`);
      }
    }

    // 4. Get cached workspace files (summaries only for context efficiency)
    const files = await getWorkspaceFiles();
    if (files.length > 0) {
      const fileSection = files.slice(0, 10).map(f => {
        const preview = f.content?.slice(0, 500) || '';
        return `### ${f.name} (${f.type})\n${f.summary || preview}${preview.length >= 500 ? '...' : ''}`;
      }).join('\n\n');
      sections.push(`## RECENTLY OPENED FILES\n${fileSection}`);
    }

    // 5. Get recent chat history for continuity
    const history = await getChatHistory(20);
    if (history.length > 5) {
      const historySection = history.slice(-10).map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`
      ).join('\n');
      sections.push(`## RECENT CONVERSATION CONTEXT\n${historySection}`);
    }

    // 6. Get email context (if enabled)
    try {
      const settingsStr = localStorage.getItem('callumony_settings');
      const emailContextEnabled = settingsStr ? (JSON.parse(settingsStr).emailContextEnabled !== false) : true;
      if (emailContextEnabled) {
        const cachedEmails = JSON.parse(localStorage.getItem('omnipotent_email_cache') || '[]');
        if (cachedEmails.length > 0) {
          const emailSection = cachedEmails.slice(0, 20).map(e =>
            `- [${e.tag?.label || 'Email'}] From: ${e.from?.name || (typeof e.from === 'string' ? e.from : 'Unknown')} | Subject: ${e.subject || '(no subject)'} | Preview: ${(e.preview || '').substring(0, 200)}`
          ).join('\n');
          sections.push(`## RECENT EMAILS\n${emailSection}`);
        }
      }
    } catch (e) {
      console.error('Failed to load email context:', e);
    }

  } catch (error) {
    console.error('Failed to build agent context:', error);
  }

  // Combine and truncate
  let fullContext = sections.join('\n\n' + '='.repeat(50) + '\n\n');

  if (fullContext.length > maxLength) {
    fullContext = fullContext.slice(0, maxLength) + '\n\n[Context truncated due to size limits]';
  }

  return fullContext;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Usage Tracking API - Token usage and resource consumption tracking
// ─────────────────────────────────────────────────────────────────────────────────

export async function getUsageRecords(limit = 100) {
  try {
    const records = await getAllFromStore(STORES.USAGE_RECORDS);
    return records
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  } catch (error) {
    console.error('Failed to get usage records:', error);
    return [];
  }
}

export async function addUsageRecord(record) {
  const now = new Date();
  const newRecord = {
    id: crypto.randomUUID(),
    timestamp: now.toISOString(),
    date: now.toISOString().split('T')[0], // YYYY-MM-DD
    month: now.getMonth() + 1, // 1-12
    year: now.getFullYear(),
    day: now.getDate(),
    // Token usage
    tokensUsed: record.tokensUsed || 0,
    promptTokens: record.promptTokens || 0,
    completionTokens: record.completionTokens || 0,
    // Activity tracking
    messagesCount: record.messagesCount || 1,
    learningsCount: record.learningsCount || 0,
    exportsCount: record.exportsCount || 0,
    backupsCount: record.backupsCount || 0,
    // Metadata
    sessionId: record.sessionId || null,
    type: record.type || 'chat' // chat, learning, export, backup
  };

  try {
    await putToStore(STORES.USAGE_RECORDS, newRecord);
    return newRecord;
  } catch (error) {
    console.error('Failed to add usage record:', error);
    throw error;
  }
}

export async function getUsageStats() {
  try {
    const records = await getAllFromStore(STORES.USAGE_RECORDS);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Filter records for current month
    const thisMonthRecords = records.filter(r =>
      r.month === currentMonth && r.year === currentYear
    );

    // Calculate totals
    const totalTokens = records.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
    const monthlyTokens = thisMonthRecords.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
    const totalMessages = records.reduce((sum, r) => sum + (r.messagesCount || 0), 0);
    const monthlyMessages = thisMonthRecords.reduce((sum, r) => sum + (r.messagesCount || 0), 0);
    const totalLearnings = records.reduce((sum, r) => sum + (r.learningsCount || 0), 0);
    const monthlyLearnings = thisMonthRecords.reduce((sum, r) => sum + (r.learningsCount || 0), 0);
    const totalExports = records.reduce((sum, r) => sum + (r.exportsCount || 0), 0);
    const monthlyExports = thisMonthRecords.reduce((sum, r) => sum + (r.exportsCount || 0), 0);
    const totalBackups = records.reduce((sum, r) => sum + (r.backupsCount || 0), 0);
    const monthlyBackups = thisMonthRecords.reduce((sum, r) => sum + (r.backupsCount || 0), 0);

    return {
      totalTokens,
      monthlyTokens,
      totalMessages,
      monthlyMessages,
      totalLearnings,
      monthlyLearnings,
      totalExports,
      monthlyExports,
      totalBackups,
      monthlyBackups,
      currentMonth,
      currentYear,
      recordCount: records.length,
      monthlyRecordCount: thisMonthRecords.length
    };
  } catch (error) {
    console.error('Failed to get usage stats:', error);
    return {
      totalTokens: 0, monthlyTokens: 0,
      totalMessages: 0, monthlyMessages: 0,
      totalLearnings: 0, monthlyLearnings: 0,
      totalExports: 0, monthlyExports: 0,
      totalBackups: 0, monthlyBackups: 0,
      currentMonth: new Date().getMonth() + 1,
      currentYear: new Date().getFullYear(),
      recordCount: 0, monthlyRecordCount: 0
    };
  }
}

export async function getMonthlyUsageHistory(months = 12) {
  try {
    const records = await getAllFromStore(STORES.USAGE_RECORDS);
    const now = new Date();

    // Group by month/year
    const monthlyData = {};

    for (let i = 0; i < months; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = date.getMonth() + 1;
      const year = date.getFullYear();
      const key = `${year}-${String(month).padStart(2, '0')}`;

      const monthRecords = records.filter(r => r.month === month && r.year === year);

      monthlyData[key] = {
        month,
        year,
        monthName: date.toLocaleString('default', { month: 'long' }),
        tokensUsed: monthRecords.reduce((sum, r) => sum + (r.tokensUsed || 0), 0),
        messagesCount: monthRecords.reduce((sum, r) => sum + (r.messagesCount || 0), 0),
        learningsCount: monthRecords.reduce((sum, r) => sum + (r.learningsCount || 0), 0),
        exportsCount: monthRecords.reduce((sum, r) => sum + (r.exportsCount || 0), 0),
        backupsCount: monthRecords.reduce((sum, r) => sum + (r.backupsCount || 0), 0)
      };
    }

    // Convert to array and sort by date descending
    return Object.values(monthlyData).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  } catch (error) {
    console.error('Failed to get monthly usage history:', error);
    return [];
  }
}

export async function clearUsageRecords() {
  try {
    await clearStore(STORES.USAGE_RECORDS);
    return true;
  } catch (error) {
    console.error('Failed to clear usage records:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Database Optimization API
// ─────────────────────────────────────────────────────────────────────────────────

export async function getDatabaseSize() {
  try {
    if (!isDbAlive()) await initDatabase();

    let totalSize = 0;
    const storeSizes = {};

    // Get size of each store
    for (const storeName of Object.values(STORES)) {
      try {
        const items = await getAllFromStore(storeName);
        const storeContent = JSON.stringify(items);
        const size = new Blob([storeContent]).size;
        storeSizes[storeName] = size;
        totalSize += size;
      } catch (e) {
        storeSizes[storeName] = 0;
      }
    }

    return {
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      storeSizes,
      storeCount: Object.keys(STORES).length
    };
  } catch (error) {
    console.error('Failed to get database size:', error);
    return { totalSize: 0, totalSizeFormatted: '0 B', storeSizes: {}, storeCount: 0 };
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function optimizeDatabase() {
  const startTime = Date.now();
  const results = {
    beforeSize: 0,
    afterSize: 0,
    recordsProcessed: 0,
    recordsCleaned: 0,
    duplicatesRemoved: 0,
    errors: []
  };

  try {
    // Get initial size
    const beforeStats = await getDatabaseSize();
    results.beforeSize = beforeStats.totalSize;

    // 1. Optimize Chat History - Remove very old messages, keep last 500
    try {
      const chatHistory = await getAllFromStore(STORES.CHAT_HISTORY);
      results.recordsProcessed += chatHistory.length;

      if (chatHistory.length > 500) {
        const sorted = chatHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const toKeep = sorted.slice(0, 500);
        const toRemove = sorted.slice(500);

        await clearStore(STORES.CHAT_HISTORY);
        for (const msg of toKeep) {
          await addToStore(STORES.CHAT_HISTORY, msg);
        }
        results.recordsCleaned += toRemove.length;
      }

      // Trim long messages
      const updatedHistory = await getAllFromStore(STORES.CHAT_HISTORY);
      for (const msg of updatedHistory) {
        if (msg.content && msg.content.length > 10000) {
          msg.content = msg.content.slice(0, 10000) + '... [truncated]';
          await putToStore(STORES.CHAT_HISTORY, msg);
          results.recordsCleaned++;
        }
      }
    } catch (e) {
      results.errors.push(`Chat history: ${e.message}`);
    }

    // 2. Optimize Memories - Remove duplicates by content hash
    try {
      const memories = await getAllFromStore(STORES.MEMORIES);
      results.recordsProcessed += memories.length;

      const seen = new Map();
      const duplicates = [];

      for (const memory of memories) {
        const hash = memory.content?.toLowerCase().trim().slice(0, 100);
        if (seen.has(hash)) {
          duplicates.push(memory.id);
        } else {
          seen.set(hash, memory.id);
        }
      }

      for (const id of duplicates) {
        await deleteFromStore(STORES.MEMORIES, id);
        results.duplicatesRemoved++;
      }
    } catch (e) {
      results.errors.push(`Memories: ${e.message}`);
    }

    // 3. Optimize Training Items - Trim excessive content
    try {
      const trainingItems = await getAllFromStore(STORES.TRAINING_ITEMS);
      results.recordsProcessed += trainingItems.length;

      for (const item of trainingItems) {
        let updated = false;

        // Trim very long content
        if (item.content && item.content.length > 50000) {
          item.content = item.content.slice(0, 50000) + '... [truncated]';
          updated = true;
        }

        // Remove empty analysis fields
        if (item.analysis) {
          const cleanAnalysis = {};
          for (const [key, value] of Object.entries(item.analysis)) {
            if (value && (Array.isArray(value) ? value.length > 0 : true)) {
              cleanAnalysis[key] = value;
            }
          }
          if (Object.keys(cleanAnalysis).length !== Object.keys(item.analysis).length) {
            item.analysis = cleanAnalysis;
            updated = true;
          }
        }

        if (updated) {
          await putToStore(STORES.TRAINING_ITEMS, item);
          results.recordsCleaned++;
        }
      }
    } catch (e) {
      results.errors.push(`Training items: ${e.message}`);
    }

    // 4. Optimize Chat Learnings - Remove duplicates
    try {
      const learnings = await getAllFromStore(STORES.CHAT_LEARNINGS);
      results.recordsProcessed += learnings.length;

      const seen = new Map();
      const duplicates = [];

      for (const learning of learnings) {
        const hash = learning.content?.toLowerCase().trim().slice(0, 100);
        if (seen.has(hash)) {
          duplicates.push(learning.id);
        } else {
          seen.set(hash, learning.id);
        }
      }

      for (const id of duplicates) {
        await deleteFromStore(STORES.CHAT_LEARNINGS, id);
        results.duplicatesRemoved++;
      }
    } catch (e) {
      results.errors.push(`Chat learnings: ${e.message}`);
    }

    // 5. Optimize Workspace Files - Clear stale cache entries older than 7 days
    try {
      const files = await getAllFromStore(STORES.WORKSPACE_FILES);
      results.recordsProcessed += files.length;

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      for (const file of files) {
        if (new Date(file.lastModified) < sevenDaysAgo) {
          await deleteFromStore(STORES.WORKSPACE_FILES, file.path);
          results.recordsCleaned++;
        }
      }
    } catch (e) {
      results.errors.push(`Workspace files: ${e.message}`);
    }

    // 6. Optimize Usage Records - Aggregate old daily records into monthly summaries
    try {
      const records = await getAllFromStore(STORES.USAGE_RECORDS);
      results.recordsProcessed += records.length;

      // Keep last 30 days of detailed records, aggregate older ones
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const oldRecords = records.filter(r => new Date(r.timestamp) < thirtyDaysAgo);

      if (oldRecords.length > 100) {
        // Group by month
        const monthlyAggregates = {};
        for (const record of oldRecords) {
          const key = `${record.year}-${record.month}`;
          if (!monthlyAggregates[key]) {
            monthlyAggregates[key] = {
              id: crypto.randomUUID(),
              timestamp: new Date(record.year, record.month - 1, 1).toISOString(),
              date: `${record.year}-${String(record.month).padStart(2, '0')}-01`,
              month: record.month,
              year: record.year,
              day: 1,
              tokensUsed: 0,
              promptTokens: 0,
              completionTokens: 0,
              messagesCount: 0,
              learningsCount: 0,
              exportsCount: 0,
              backupsCount: 0,
              type: 'aggregated'
            };
          }
          monthlyAggregates[key].tokensUsed += record.tokensUsed || 0;
          monthlyAggregates[key].promptTokens += record.promptTokens || 0;
          monthlyAggregates[key].completionTokens += record.completionTokens || 0;
          monthlyAggregates[key].messagesCount += record.messagesCount || 0;
          monthlyAggregates[key].learningsCount += record.learningsCount || 0;
          monthlyAggregates[key].exportsCount += record.exportsCount || 0;
          monthlyAggregates[key].backupsCount += record.backupsCount || 0;
        }

        // Remove old records and add aggregates
        for (const record of oldRecords) {
          await deleteFromStore(STORES.USAGE_RECORDS, record.id);
          results.recordsCleaned++;
        }

        for (const aggregate of Object.values(monthlyAggregates)) {
          await putToStore(STORES.USAGE_RECORDS, aggregate);
        }
      }
    } catch (e) {
      results.errors.push(`Usage records: ${e.message}`);
    }

    // Get final size
    const afterStats = await getDatabaseSize();
    results.afterSize = afterStats.totalSize;
    results.beforeSizeFormatted = formatBytes(results.beforeSize);
    results.afterSizeFormatted = formatBytes(results.afterSize);
    results.savedBytes = results.beforeSize - results.afterSize;
    results.savedFormatted = formatBytes(Math.max(0, results.savedBytes));
    results.duration = Date.now() - startTime;
    results.success = results.errors.length === 0;

    // Store optimization timestamp
    await setSetting('lastOptimization', {
      timestamp: new Date().toISOString(),
      beforeSize: results.beforeSize,
      afterSize: results.afterSize,
      saved: results.savedBytes
    });

    return results;
  } catch (error) {
    console.error('Failed to optimize database:', error);
    results.errors.push(error.message);
    return results;
  }
}

export async function getLastOptimization() {
  try {
    return await getSetting('lastOptimization', null);
  } catch (error) {
    console.error('Failed to get last optimization:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Training Duplicate Removal (Server-side)
// ─────────────────────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function previewTrainingDuplicates() {
  try {
    const response = await fetch(`${API_URL}/api/training/preview-duplicates`);
    if (!response.ok) {
      throw new Error('Failed to preview duplicates');
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to preview training duplicates:', error);
    throw error;
  }
}

export async function removeTrainingDuplicates() {
  try {
    const response = await fetch(`${API_URL}/api/training/remove-duplicates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error('Failed to remove duplicates');
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to remove training duplicates:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Export/Import Database
// ─────────────────────────────────────────────────────────────────────────────────

export async function exportDatabase() {
  try {
    const trainingItems = await getAllFromStore(STORES.TRAINING_ITEMS);
    const settings = await getAllFromStore(STORES.SETTINGS);
    const chatHistory = await getAllFromStore(STORES.CHAT_HISTORY);

    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        trainingItems,
        settings,
        chatHistory
      }
    };
  } catch (error) {
    console.error('Failed to export database:', error);
    throw error;
  }
}

export async function importDatabase(data) {
  try {
    if (data.data.trainingItems) {
      await clearStore(STORES.TRAINING_ITEMS);
      for (const item of data.data.trainingItems) {
        await addToStore(STORES.TRAINING_ITEMS, item);
      }
    }

    if (data.data.settings) {
      await clearStore(STORES.SETTINGS);
      for (const setting of data.data.settings) {
        await addToStore(STORES.SETTINGS, setting);
      }
    }

    if (data.data.chatHistory) {
      await clearStore(STORES.CHAT_HISTORY);
      for (const message of data.data.chatHistory) {
        await addToStore(STORES.CHAT_HISTORY, message);
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to import database:', error);
    throw error;
  }
}

// Initialize database on module load
initDatabase().catch(console.error);

export default {
  initDatabase,
  // Training Items (Manual Training - does NOT count toward Brain)
  getTrainingItems,
  getTrainingItem,
  addTrainingItem,
  updateTrainingItem,
  deleteTrainingItem,
  clearTrainingItems,
  markItemTrained,
  getTrainingStats,
  analyzeTrainingContent,
  // Chat Learnings (Learned from chat - DOES count toward Brain)
  getChatLearnings,
  getChatLearning,
  addChatLearning,
  updateChatLearning,
  markChatLearningTrained,
  deleteChatLearning,
  clearChatLearnings,
  getChatLearningsStats,
  // Settings
  getSetting,
  setSetting,
  // Chat
  getChatHistory,
  addChatMessage,
  clearChatHistory,
  // Memories
  getMemories,
  addMemory,
  updateMemoryUsage,
  updateMemory,
  deleteMemory,
  clearMemories,
  // Workspace Files
  getWorkspaceFiles,
  getWorkspaceFile,
  cacheWorkspaceFile,
  removeWorkspaceFile,
  clearWorkspaceFiles,
  // Context Folders
  getContextFolders,
  addContextFolder,
  removeContextFolder,
  isContextFolder,
  clearContextFolders,
  // Context Builder
  buildAgentContext,
  // Usage Tracking
  getUsageRecords,
  addUsageRecord,
  getUsageStats,
  getMonthlyUsageHistory,
  clearUsageRecords,
  // Database Optimization
  getDatabaseSize,
  optimizeDatabase,
  getLastOptimization,
  // Training Duplicate Removal
  previewTrainingDuplicates,
  removeTrainingDuplicates,
  // Export/Import
  exportDatabase,
  importDatabase
};
