// ═══════════════════════════════════════════════════════════════════════════════
// MANUAL FOLDER WATCHER SERVICE
// Automatically learns new .txt files added to data/manual folder
// ═══════════════════════════════════════════════════════════════════════════════

import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { OpenAI } from 'openai';
import * as lancedb from '@lancedb/lancedb';
import { v4 as uuidv4 } from 'uuid';
import libraryBackup from './libraryBackup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const MANUAL_DIR = path.join(DATA_DIR, 'manual');
const ARCHIVE_DIR = path.join(DATA_DIR, 'manual_archive');
const WATCHED_FILES_DB = path.join(DATA_DIR, 'watched_files.db');
const TRAINING_DB_PATH = path.join(DATA_DIR, 'training.db');

const CONFIG = {
  tableName: process.env.COLLECTION_NAME || 'company_knowledge',
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  chunkSize: 1000,
  chunkOverlap: 200,
  batchSize: 50
};

// ─────────────────────────────────────────────────────────────────────────────────
// Database for tracking processed files
// ─────────────────────────────────────────────────────────────────────────────────

let watchedDb = null;
let trainingDb = null;

function initWatchedFilesDB() {
  watchedDb = new Database(WATCHED_FILES_DB);

  watchedDb.exec(`
    CREATE TABLE IF NOT EXISTS processed_files (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      filepath TEXT NOT NULL,
      file_hash TEXT,
      title TEXT,
      description TEXT,
      content_summary TEXT,
      chunks_created INTEGER DEFAULT 0,
      archived_path TEXT,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return watchedDb;
}

function initTrainingDB() {
  if (!trainingDb) {
    trainingDb = new Database(TRAINING_DB_PATH);

    // Ensure chat_learnings table exists
    trainingDb.exec(`
      CREATE TABLE IF NOT EXISTS chat_learnings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        applies_to TEXT,
        related_topics TEXT,
        session_id TEXT,
        session_name TEXT,
        user_message TEXT,
        assistant_response TEXT,
        learned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_trained INTEGER DEFAULT 0,
        trained_at DATETIME,
        chunks_created INTEGER DEFAULT 0,
        importance INTEGER DEFAULT 5,
        verified INTEGER DEFAULT 0
      )
    `);
  }
  return trainingDb;
}

function isFileProcessed(filename) {
  if (!watchedDb) initWatchedFilesDB();
  const stmt = watchedDb.prepare('SELECT id FROM processed_files WHERE filename = ?');
  const result = stmt.get(filename);
  return !!result;
}

function markFileProcessed(filename, filepath, title, description, contentSummary, chunksCreated, archivedPath = null) {
  if (!watchedDb) initWatchedFilesDB();
  const stmt = watchedDb.prepare(`
    INSERT OR REPLACE INTO processed_files (id, filename, filepath, title, description, content_summary, chunks_created, archived_path, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  stmt.run(uuidv4(), filename, filepath, title, description, contentSummary, chunksCreated, archivedPath);
}

function getProcessedFilesCount() {
  if (!watchedDb) initWatchedFilesDB();
  const stmt = watchedDb.prepare('SELECT COUNT(*) as count FROM processed_files');
  return stmt.get().count;
}

function getAllProcessedFiles() {
  if (!watchedDb) initWatchedFilesDB();
  const stmt = watchedDb.prepare('SELECT * FROM processed_files ORDER BY processed_at DESC');
  return stmt.all();
}

// ─────────────────────────────────────────────────────────────────────────────────
// Training Utilities
// ─────────────────────────────────────────────────────────────────────────────────

let openai = null;

function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function chunkText(text, maxChunkSize = CONFIG.chunkSize, overlap = CONFIG.chunkOverlap) {
  const chunks = [];
  if (!text || text.length === 0) return chunks;

  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const overlapStart = Math.max(0, currentChunk.length - overlap);
      currentChunk = currentChunk.slice(overlapStart) + '\n\n' + paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 50);
}

async function getEmbeddings(texts) {
  const client = getOpenAI();
  const response = await client.embeddings.create({
    model: CONFIG.embeddingModel,
    input: texts.map(t => t.slice(0, 8000))
  });
  return response.data.map(d => d.embedding);
}

// ─────────────────────────────────────────────────────────────────────────────────
// Content Analysis
// ─────────────────────────────────────────────────────────────────────────────────

function analyzeContent(content, filename) {
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

  // Extract key topics
  const topics = [];

  // RedM/FiveM specific
  if (/RegisterNetEvent|TriggerServerEvent|TriggerClientEvent/.test(content)) topics.push('events');
  if (/AddEventHandler|Citizen/.test(content)) topics.push('citizen');
  if (/ESX|QBCore|vRP/.test(content)) topics.push('framework');
  if (/GetPlayerPed|GetEntityCoords|SetEntityCoords/.test(content)) topics.push('entities');
  if (/DrawText|Draw3DText/.test(content)) topics.push('UI/drawing');
  if (/native|GetHashKey/.test(content)) topics.push('natives');
  if (/MySQL|exports\[/.test(content)) topics.push('database');
  if (/NUI|SendNUIMessage/.test(content)) topics.push('NUI');

  // General programming
  if (/function|local\s+\w+/.test(content)) topics.push('Lua');
  if (/const\s+|let\s+|import\s+/.test(content)) topics.push('JavaScript');
  if (/class\s+\w+|public\s+/.test(content)) topics.push('C#');
  if (/SELECT|INSERT|UPDATE|DELETE/.test(content)) topics.push('SQL');

  // Content type detection
  let contentType = 'general';
  if (/```lua|function\s*\(|local\s+/.test(content)) contentType = 'Lua code/examples';
  else if (/```javascript|```js|const\s+|=>\s*\{/.test(content)) contentType = 'JavaScript code';
  else if (/^#+\s|\*\*[\w\s]+\*\*/.test(content)) contentType = 'documentation';
  else if (/^\s*[-*•]\s/m.test(content)) contentType = 'structured notes';

  // Create summary of what was learned
  const summary = [
    `${wordCount} words`,
    `${nonEmptyLines.length} lines`,
    contentType,
    topics.length > 0 ? `Topics: ${topics.join(', ')}` : null
  ].filter(Boolean).join(' | ');

  return {
    wordCount,
    lineCount: nonEmptyLines.length,
    topics,
    contentType,
    summary
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
// Format Content into Structured Training Data
// ─────────────────────────────────────────────────────────────────────────────────

function formatAsStructuredData(content, filename, analysis) {
  const fileNameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  // Extract potential title from content
  const lines = content.split('\n').filter(l => l.trim());
  let title = fileNameWithoutExt;

  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    // If first line looks like a title (short, no punctuation at end)
    if (firstLine.length < 100 && !firstLine.endsWith('.') && !firstLine.endsWith(',')) {
      title = firstLine.replace(/^#+\s*/, ''); // Remove markdown headers
    }
  }

  // Extract description from first paragraph
  const firstParagraph = content.split(/\n\n+/)[0];
  let description = '';
  if (firstParagraph && firstParagraph.length < 500) {
    description = firstParagraph.trim().substring(0, 200);
    if (description.length === 200) description += '...';
  }

  // Build structured training data
  const structuredData = {
    metadata: {
      title: title,
      description: description || `Training data from ${filename}`,
      sourceFile: filename,
      contentType: analysis.contentType,
      topics: analysis.topics,
      importedAt: new Date().toISOString()
    },
    content: {
      raw: content,
      wordCount: analysis.wordCount,
      lineCount: analysis.lineCount
    },
    training: {
      category: detectCategory(content, analysis),
      importance: calculateImportance(analysis),
      appliesTo: analysis.topics
    }
  };

  return structuredData;
}

function detectCategory(content, analysis) {
  // Detect category based on content
  if (analysis.topics.includes('Lua') || /function\s*\(|local\s+/.test(content)) {
    return 'code';
  }
  if (analysis.topics.includes('framework') || /ESX|QBCore/.test(content)) {
    return 'concept';
  }
  if (/^#+\s|documentation|guide|tutorial/i.test(content)) {
    return 'general';
  }
  if (/config|settings|options/i.test(content)) {
    return 'preference';
  }
  return 'general';
}

function calculateImportance(analysis) {
  // Calculate importance score (1-10) based on content
  let importance = 5;

  // More content = more important
  if (analysis.wordCount > 500) importance += 1;
  if (analysis.wordCount > 1000) importance += 1;

  // More topics = more relevant
  if (analysis.topics.length > 2) importance += 1;
  if (analysis.topics.length > 4) importance += 1;

  // Code is important
  if (analysis.contentType.includes('code')) importance += 1;

  return Math.min(10, importance);
}

// ─────────────────────────────────────────────────────────────────────────────────
// Auto-Learning Function
// ─────────────────────────────────────────────────────────────────────────────────

async function autoLearnFile(filepath, archiveAfterLearning = true) {
  const filename = path.basename(filepath);

  // Skip non-txt files
  if (!filename.endsWith('.txt')) {
    return null;
  }

  // Skip already processed files
  if (isFileProcessed(filename)) {
    console.log(`📚 [ManualWatcher] Skipping already learned: ${filename}`);
    return null;
  }

  console.log(`🧠 [ManualWatcher] Learning new file: ${filename}`);

  try {
    // Read file content
    const content = await fs.readFile(filepath, 'utf-8');

    if (!content || content.trim().length < 50) {
      console.log(`⚠️ [ManualWatcher] File too short, skipping: ${filename}`);
      return null;
    }

    // Analyze content
    const analysis = analyzeContent(content, filename);

    // Format into structured training data
    const structuredData = formatAsStructuredData(content, filename, analysis);

    // Create training record
    const title = structuredData.metadata.title;
    const description = `Manual import: ${structuredData.metadata.description} | ${analysis.summary}`;

    // Build context header
    const contextHeader = `[MANUAL TRAINING FILE]\nTitle: ${title}\nSource: ${filename}\nCategory: ${structuredData.training.category}\nTopics: ${analysis.topics.join(', ')}\n\n`;

    // Chunk the content
    const chunks = chunkText(content);

    if (chunks.length === 0) {
      console.log(`⚠️ [ManualWatcher] No valid chunks from: ${filename}`);
      return null;
    }

    // Generate embeddings
    const textsToEmbed = chunks.map(chunk => contextHeader + chunk);
    const embeddings = await getEmbeddings(textsToEmbed);

    // Prepare records for LanceDB
    const fileId = uuidv4();
    const records = chunks.map((chunk, idx) => ({
      id: `manual-${fileId}-chunk-${idx}`,
      text: contextHeader + chunk,
      vector: embeddings[idx],
      title: title,
      url: '',
      type: 'training',
      source: 'manual-import',
      category: structuredData.training.category,
      chunkIndex: idx,
      totalChunks: chunks.length,
      crawledAt: new Date().toISOString()
    }));

    // Connect to LanceDB and add records
    const lanceDbPath = path.resolve(DATA_DIR, 'lancedb');
    await fs.mkdir(lanceDbPath, { recursive: true });

    const lanceDb = await lancedb.connect(lanceDbPath);
    const tables = await lanceDb.tableNames();

    let table;
    if (tables.includes(CONFIG.tableName)) {
      table = await lanceDb.openTable(CONFIG.tableName);
      await table.add(records);
    } else {
      table = await lanceDb.createTable(CONFIG.tableName, records);
    }

    // Also add to chat_learnings table so it appears in Brain Knowledge UI
    const db = initTrainingDB();
    const learningId = uuidv4();
    const insertLearning = db.prepare(`
      INSERT INTO chat_learnings
      (id, title, description, content, category, applies_to, related_topics,
       session_name, learned_at, is_trained, trained_at, chunks_created, importance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, ?, ?)
    `);

    insertLearning.run(
      learningId,
      title,
      description,
      content,
      structuredData.training.category,
      JSON.stringify(structuredData.training.appliesTo || []),
      JSON.stringify(analysis.topics || []),
      `Manual Import: ${filename}`,
      chunks.length,
      structuredData.training.importance
    );

    // Archive the file (move to archive folder)
    let archivedPath = null;
    if (archiveAfterLearning) {
      try {
        await fs.mkdir(ARCHIVE_DIR, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveFilename = `${timestamp}_${filename}`;
        archivedPath = path.join(ARCHIVE_DIR, archiveFilename);

        await fs.copyFile(filepath, archivedPath);
        await fs.unlink(filepath);

        console.log(`📦 [ManualWatcher] Archived to: ${archiveFilename}`);
      } catch (archiveError) {
        console.error(`⚠️ [ManualWatcher] Failed to archive file:`, archiveError.message);
        archivedPath = filepath; // Keep original path if archive fails
      }
    }

    // Mark file as processed
    markFileProcessed(filename, filepath, title, description, analysis.summary, chunks.length, archivedPath);

    // Get total brain count
    const totalCount = await table.countRows();

    console.log(`✅ [ManualWatcher] Learned "${filename}"`);
    console.log(`   📊 Created ${chunks.length} chunks (importance: ${structuredData.training.importance}/10)`);
    console.log(`   🧠 Total brain: ${totalCount} chunks`);
    console.log(`   📝 Category: ${structuredData.training.category} | Topics: ${analysis.topics.join(', ')}`);

    // Trigger library backup after successful learning
    libraryBackup.triggerDebouncedBackup();

    return {
      filename,
      title,
      description,
      category: structuredData.training.category,
      importance: structuredData.training.importance,
      chunksCreated: chunks.length,
      totalBrainCount: totalCount,
      archivedPath,
      analysis,
      structuredData
    };

  } catch (error) {
    console.error(`❌ [ManualWatcher] Failed to learn "${filename}":`, error.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// File Watcher
// ─────────────────────────────────────────────────────────────────────────────────

let watcher = null;

async function startWatcher() {
  // Ensure manual directory exists
  await fs.mkdir(MANUAL_DIR, { recursive: true });

  // Initialize database
  initWatchedFilesDB();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📂 Manual Folder Watcher Starting');
  console.log(`  📍 Watching: ${MANUAL_DIR}`);
  console.log(`  📚 Previously learned: ${getProcessedFilesCount()} files`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Process existing files that haven't been learned yet
  try {
    const existingFiles = await fs.readdir(MANUAL_DIR);
    const txtFiles = existingFiles.filter(f => f.endsWith('.txt'));

    let newFilesCount = 0;
    for (const file of txtFiles) {
      if (!isFileProcessed(file)) {
        const filepath = path.join(MANUAL_DIR, file);
        const stat = await fs.stat(filepath);
        if (stat.isFile()) {
          await autoLearnFile(filepath);
          newFilesCount++;
        }
      }
    }

    if (newFilesCount > 0) {
      console.log(`🎉 [ManualWatcher] Learned ${newFilesCount} new files on startup`);
    }
  } catch (error) {
    console.error('❌ [ManualWatcher] Error processing existing files:', error.message);
  }

  // Start watching for new files
  watcher = chokidar.watch(path.join(MANUAL_DIR, '*.txt'), {
    persistent: true,
    ignoreInitial: true, // Don't trigger for existing files (we handle them above)
    awaitWriteFinish: {
      stabilityThreshold: 2000, // Wait for file to finish writing
      pollInterval: 100
    }
  });

  watcher.on('add', async (filepath) => {
    console.log(`📥 [ManualWatcher] New file detected: ${path.basename(filepath)}`);
    // Small delay to ensure file is fully written
    await new Promise(r => setTimeout(r, 500));
    await autoLearnFile(filepath);
  });

  watcher.on('change', async (filepath) => {
    const filename = path.basename(filepath);
    // If file was modified and was already processed, we could re-learn it
    // For now, we'll skip re-learning to avoid duplicates
    console.log(`📝 [ManualWatcher] File modified (not re-learning): ${filename}`);
  });

  watcher.on('error', (error) => {
    console.error('❌ [ManualWatcher] Watcher error:', error);
  });

  console.log('👀 [ManualWatcher] Now watching for new .txt files...');

  return watcher;
}

function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('🛑 [ManualWatcher] Stopped watching');
  }
  if (watchedDb) {
    watchedDb.close();
    watchedDb = null;
  }
  if (trainingDb) {
    trainingDb.close();
    trainingDb = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────────

export default {
  startWatcher,
  stopWatcher,
  autoLearnFile,
  isFileProcessed,
  getProcessedFilesCount,
  getAllProcessedFiles
};

export {
  startWatcher,
  stopWatcher,
  autoLearnFile,
  isFileProcessed,
  getProcessedFilesCount,
  getAllProcessedFiles
};
