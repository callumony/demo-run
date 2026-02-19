// ═══════════════════════════════════════════════════════════════════════════════
// TRAINING API ROUTES
// Manage training items and execute training operations
// ═══════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { OpenAI } from 'openai';
import * as lancedb from '@lancedb/lancedb';
import fs from 'fs/promises';
import libraryBackup from '../services/libraryBackup.js';
import multer from 'multer';
import documentProcessor from '../services/documentProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────────
// Database Setup
// ─────────────────────────────────────────────────────────────────────────────────

const dbPath = path.join(__dirname, '..', '..', 'data', 'training.db');
const db = new Database(dbPath);

// Create training_items table (Manual Training - does NOT count toward Brain)
db.exec(`
  CREATE TABLE IF NOT EXISTS training_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    is_trained INTEGER DEFAULT 0,
    trained_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'manual'
  )
`);

// Create chat_learnings table (Learned from Chat - DOES count toward Brain)
db.exec(`
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

// ─────────────────────────────────────────────────────────────────────────────────
// Training Configuration
// ─────────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  lanceDbPath: process.env.LANCEDB_PATH || './data/lancedb',
  tableName: process.env.COLLECTION_NAME || 'company_knowledge',
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  chunkSize: 1000,
  chunkOverlap: 200,
  batchSize: 50
};

// Lazy-initialize OpenAI (only when needed for training)
let openai = null;
function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set. Please configure your API key in the .env file.');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Training Utilities
// ─────────────────────────────────────────────────────────────────────────────────

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
// CRUD Routes for Training Items
// ─────────────────────────────────────────────────────────────────────────────────

// Get all training items
router.get('/items', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM training_items ORDER BY created_at DESC');
    const items = stmt.all();

    res.json(items.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      content: item.content,
      isTrained: item.is_trained === 1,
      trainedAt: item.trained_at,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    })));
  } catch (error) {
    console.error('Error getting training items:', error);
    res.status(500).json({ error: 'Failed to get training items' });
  }
});

// Add new training item
router.post('/items', (req, res) => {
  try {
    const { title, description, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO training_items (id, title, description, content)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(id, title, description || '', content);

    res.json({
      id,
      title,
      description: description || '',
      content,
      isTrained: false,
      trainedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error adding training item:', error);
    res.status(500).json({ error: 'Failed to add training item' });
  }
});

// Update training item
router.put('/items/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    // Reset trained status when content changes
    const stmt = db.prepare(`
      UPDATE training_items
      SET title = ?, description = ?, content = ?, is_trained = 0, trained_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const result = stmt.run(title, description || '', content, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Training item not found' });
    }

    res.json({
      id,
      title,
      description: description || '',
      content,
      isTrained: false,
      trainedAt: null,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error updating training item:', error);
    res.status(500).json({ error: 'Failed to update training item' });
  }
});

// Delete training item
router.delete('/items/:id', (req, res) => {
  try {
    const { id } = req.params;

    const stmt = db.prepare('DELETE FROM training_items WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Training item not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting training item:', error);
    res.status(500).json({ error: 'Failed to delete training item' });
  }
});

// Clear all training items
router.post('/clear', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM training_items');
    stmt.run();
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing training items:', error);
    res.status(500).json({ error: 'Failed to clear training items' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// Training Execution
// ─────────────────────────────────────────────────────────────────────────────────

// Train selected items
router.post('/train', async (req, res) => {
  const { itemIds, retrain = false } = req.body;

  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'No items selected for training' });
  }

  // Set up SSE for progress updates
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Get items to train
    const placeholders = itemIds.map(() => '?').join(',');
    const query = retrain
      ? `SELECT * FROM training_items WHERE id IN (${placeholders})`
      : `SELECT * FROM training_items WHERE id IN (${placeholders}) AND is_trained = 0`;

    const stmt = db.prepare(query);
    const items = stmt.all(...itemIds);

    if (items.length === 0) {
      sendProgress({ type: 'complete', message: 'No items to train', trained: 0 });
      res.end();
      return;
    }

    sendProgress({ type: 'start', message: `Starting training for ${items.length} items...`, total: items.length });

    // Connect to LanceDB
    const dataDir = path.join(__dirname, '..', '..', 'data');
    const lanceDbPath = path.resolve(dataDir, 'lancedb');
    await fs.mkdir(lanceDbPath, { recursive: true });

    const lanceDb = await lancedb.connect(lanceDbPath);

    // Check if table exists
    let table = null;
    const tables = await lanceDb.tableNames();

    if (tables.includes(CONFIG.tableName)) {
      table = await lanceDb.openTable(CONFIG.tableName);
    }

    let trainedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      sendProgress({
        type: 'progress',
        message: `Training: ${item.title}`,
        current: i + 1,
        total: items.length,
        itemId: item.id
      });

      try {
        // Process content into chunks
        const contextHeader = `Title: ${item.title}\nDescription: ${item.description || 'N/A'}\n\n`;
        const chunks = chunkText(item.content);

        if (chunks.length === 0) {
          sendProgress({
            type: 'warning',
            message: `Skipped "${item.title}" - content too short`,
            itemId: item.id
          });
          continue;
        }

        // Generate embeddings
        const textsToEmbed = chunks.map(chunk => contextHeader + chunk);
        const embeddings = await getEmbeddings(textsToEmbed);

        // Prepare records
        const records = chunks.map((chunk, idx) => ({
          id: `${item.id}-chunk-${idx}`,
          text: contextHeader + chunk,
          vector: embeddings[idx],
          title: item.title,
          url: '',
          type: 'training',
          source: 'manual',
          chunkIndex: idx,
          totalChunks: chunks.length,
          crawledAt: new Date().toISOString()
        }));

        // Add to LanceDB
        if (!table) {
          table = await lanceDb.createTable(CONFIG.tableName, records);
        } else {
          await table.add(records);
        }

        // Mark as trained in SQLite
        const updateStmt = db.prepare(`
          UPDATE training_items
          SET is_trained = 1, trained_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        updateStmt.run(item.id);

        trainedCount++;

        sendProgress({
          type: 'success',
          message: `Trained: ${item.title} (${chunks.length} chunks)`,
          itemId: item.id,
          chunks: chunks.length
        });

      } catch (error) {
        errorCount++;
        sendProgress({
          type: 'error',
          message: `Failed to train "${item.title}": ${error.message}`,
          itemId: item.id
        });
      }

      // Small delay to prevent rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    // Get total count from database
    let totalCount = 0;
    try {
      if (table) {
        totalCount = await table.countRows();
      }
    } catch (e) {
      console.error('Error counting rows:', e);
    }

    sendProgress({
      type: 'complete',
      message: `Training complete! ${trainedCount} items trained, ${errorCount} errors.`,
      trained: trainedCount,
      errors: errorCount,
      totalInDatabase: totalCount
    });

    // Trigger library backup after successful training
    if (trainedCount > 0) {
      libraryBackup.triggerDebouncedBackup();
    }

  } catch (error) {
    console.error('Training error:', error);
    sendProgress({ type: 'error', message: `Training failed: ${error.message}` });
  }

  res.end();
});

// Relearn a training item: remove old vectors from LanceDB, untrain in SQLite, then retrain
router.post('/relearn/:id', async (req, res) => {
  const { id } = req.params;

  // Set up SSE for progress updates
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 1. Fetch the item from SQLite
    const item = db.prepare('SELECT * FROM training_items WHERE id = ?').get(id);
    if (!item) {
      sendProgress({ type: 'error', message: 'Training item not found' });
      res.end();
      return;
    }

    sendProgress({ type: 'start', message: `Relearning: ${item.title}`, total: 1 });

    // 2. Remove old vectors from LanceDB
    sendProgress({ type: 'progress', message: 'Removing old vectors from knowledge base...', itemId: id });
    const dataDir = path.join(__dirname, '..', '..', 'data');
    const lanceDbPath = path.resolve(dataDir, 'lancedb');
    await fs.mkdir(lanceDbPath, { recursive: true });

    const lanceDb = await lancedb.connect(lanceDbPath);
    const tables = await lanceDb.tableNames();

    let table = null;
    if (tables.includes(CONFIG.tableName)) {
      table = await lanceDb.openTable(CONFIG.tableName);
      try {
        // Delete all chunks belonging to this item (id pattern: {itemId}-chunk-{n})
        await table.delete(`id LIKE '${id}-chunk-%'`);
        sendProgress({ type: 'progress', message: 'Old vectors removed successfully', itemId: id });
      } catch (delErr) {
        console.warn('Could not delete old vectors (may not exist):', delErr.message);
        sendProgress({ type: 'warning', message: 'No old vectors found (first time training)', itemId: id });
      }
    }

    // 3. Reset trained status in SQLite
    db.prepare('UPDATE training_items SET is_trained = 0, trained_at = NULL WHERE id = ?').run(id);
    sendProgress({ type: 'progress', message: 'Reset training status', itemId: id });

    // 4. Re-train: generate embeddings and add to LanceDB
    sendProgress({ type: 'progress', message: `Training: ${item.title}`, current: 1, total: 1, itemId: id });

    const contextHeader = `Title: ${item.title}\nDescription: ${item.description || 'N/A'}\n\n`;
    const chunks = chunkText(item.content);

    if (chunks.length === 0) {
      sendProgress({ type: 'warning', message: `Skipped "${item.title}" - content too short`, itemId: id });
      sendProgress({ type: 'complete', message: 'Relearn complete (content too short to train)', trained: 0, errors: 0 });
      res.end();
      return;
    }

    const textsToEmbed = chunks.map(chunk => contextHeader + chunk);
    const embeddings = await getEmbeddings(textsToEmbed);

    const records = chunks.map((chunk, idx) => ({
      id: `${item.id}-chunk-${idx}`,
      text: contextHeader + chunk,
      vector: embeddings[idx],
      title: item.title,
      url: '',
      type: 'training',
      source: 'manual',
      chunkIndex: idx,
      totalChunks: chunks.length,
      crawledAt: new Date().toISOString()
    }));

    if (!table) {
      table = await lanceDb.createTable(CONFIG.tableName, records);
    } else {
      await table.add(records);
    }

    // 5. Mark as trained in SQLite
    db.prepare('UPDATE training_items SET is_trained = 1, trained_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

    sendProgress({
      type: 'success',
      message: `Relearned: ${item.title} (${chunks.length} chunks)`,
      itemId: id,
      chunks: chunks.length
    });

    let totalCount = 0;
    try {
      if (table) totalCount = await table.countRows();
    } catch (e) { /* ignore */ }

    sendProgress({
      type: 'complete',
      message: `Relearn complete! "${item.title}" retrained with ${chunks.length} chunks.`,
      trained: 1,
      errors: 0,
      totalInDatabase: totalCount
    });

    // Trigger library backup
    libraryBackup.triggerDebouncedBackup();

  } catch (error) {
    console.error('Relearn error:', error);
    sendProgress({ type: 'error', message: `Relearn failed: ${error.message}` });
  }

  res.end();
});

// ─────────────────────────────────────────────────────────────────────────────────
// Chat Learnings Routes (Brain Knowledge - learned from conversations)
// ─────────────────────────────────────────────────────────────────────────────────

// Get all chat learnings
router.get('/chat-learnings', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM chat_learnings ORDER BY learned_at DESC');
    const learnings = stmt.all();

    res.json(learnings.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      content: item.content,
      category: item.category,
      appliesTo: item.applies_to ? JSON.parse(item.applies_to) : [],
      relatedTopics: item.related_topics ? JSON.parse(item.related_topics) : [],
      sessionId: item.session_id,
      sessionName: item.session_name,
      userMessage: item.user_message,
      assistantResponse: item.assistant_response,
      learnedAt: item.learned_at,
      isTrained: item.is_trained === 1,
      trainedAt: item.trained_at,
      chunksCreated: item.chunks_created,
      importance: item.importance,
      verified: item.verified === 1
    })));
  } catch (error) {
    console.error('Error getting chat learnings:', error);
    res.status(500).json({ error: 'Failed to get chat learnings' });
  }
});

// Add new chat learning
router.post('/chat-learnings', (req, res) => {
  try {
    const {
      id: clientId, title, description, content, category, appliesTo, relatedTopics,
      sessionId, sessionName, userMessage, assistantResponse, importance
    } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Use client-provided ID if available so both IndexedDB and SQLite stay in sync
    const id = clientId || uuidv4();

    // Upsert: if the ID already exists (re-sync), update instead of fail
    const existing = db.prepare('SELECT id FROM chat_learnings WHERE id = ?').get(id);

    if (existing) {
      const updateStmt = db.prepare(`
        UPDATE chat_learnings
        SET title = ?, description = ?, content = ?, category = ?, applies_to = ?,
            related_topics = ?, session_id = ?, session_name = ?, user_message = ?,
            assistant_response = ?, importance = ?
        WHERE id = ?
      `);
      updateStmt.run(
        title || 'Learned from conversation',
        description || '',
        content,
        category || 'general',
        JSON.stringify(appliesTo || []),
        JSON.stringify(relatedTopics || []),
        sessionId || null,
        sessionName || null,
        userMessage || null,
        assistantResponse || null,
        importance || 5,
        id
      );
    } else {
      const stmt = db.prepare(`
        INSERT INTO chat_learnings
        (id, title, description, content, category, applies_to, related_topics,
         session_id, session_name, user_message, assistant_response, importance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        title || 'Learned from conversation',
        description || '',
        content,
        category || 'general',
        JSON.stringify(appliesTo || []),
        JSON.stringify(relatedTopics || []),
        sessionId || null,
        sessionName || null,
        userMessage || null,
        assistantResponse || null,
        importance || 5
      );
    }

    // Trigger backup when new learning is added
    libraryBackup.triggerDebouncedBackup();

    res.json({
      id,
      title: title || 'Learned from conversation',
      description: description || '',
      content,
      category: category || 'general',
      appliesTo: appliesTo || [],
      relatedTopics: relatedTopics || [],
      sessionId,
      sessionName,
      learnedAt: new Date().toISOString(),
      isTrained: false,
      importance: importance || 5
    });
  } catch (error) {
    console.error('Error adding chat learning:', error);
    res.status(500).json({ error: 'Failed to add chat learning' });
  }
});

// Delete chat learning
router.delete('/chat-learnings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('DELETE FROM chat_learnings WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Chat learning not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting chat learning:', error);
    res.status(500).json({ error: 'Failed to delete chat learning' });
  }
});

// Train chat learnings (adds to Brain)
router.post('/train-chat-learnings', async (req, res) => {
  const { learningIds, retrain = false } = req.body;

  if (!learningIds || !Array.isArray(learningIds) || learningIds.length === 0) {
    return res.status(400).json({ error: 'No learnings selected for training' });
  }

  // Set up SSE for progress updates
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Get learnings to train
    const placeholders = learningIds.map(() => '?').join(',');
    const query = retrain
      ? `SELECT * FROM chat_learnings WHERE id IN (${placeholders})`
      : `SELECT * FROM chat_learnings WHERE id IN (${placeholders}) AND is_trained = 0`;

    const stmt = db.prepare(query);
    const learnings = stmt.all(...learningIds);

    if (learnings.length === 0) {
      sendProgress({ type: 'complete', message: 'No learnings to train', trained: 0 });
      res.end();
      return;
    }

    sendProgress({ type: 'start', message: `Training ${learnings.length} chat learnings to Brain...`, total: learnings.length });

    // Connect to LanceDB
    const dataDir = path.join(__dirname, '..', '..', 'data');
    const lanceDbPath = path.resolve(dataDir, 'lancedb');
    await fs.mkdir(lanceDbPath, { recursive: true });

    const lanceDb = await lancedb.connect(lanceDbPath);
    let table = null;
    const tables = await lanceDb.tableNames();

    if (tables.includes(CONFIG.tableName)) {
      table = await lanceDb.openTable(CONFIG.tableName);
    }

    let trainedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < learnings.length; i++) {
      const learning = learnings[i];

      sendProgress({
        type: 'progress',
        message: `Training: ${learning.title}`,
        current: i + 1,
        total: learnings.length,
        learningId: learning.id
      });

      try {
        // Process content into chunks
        const contextHeader = `[LEARNED FROM CHAT]\nTitle: ${learning.title}\nCategory: ${learning.category}\nDescription: ${learning.description || 'N/A'}\n\n`;
        const chunks = chunkText(learning.content);

        if (chunks.length === 0) {
          sendProgress({
            type: 'warning',
            message: `Skipped "${learning.title}" - content too short`,
            learningId: learning.id
          });
          continue;
        }

        // Generate embeddings
        const textsToEmbed = chunks.map(chunk => contextHeader + chunk);
        const embeddings = await getEmbeddings(textsToEmbed);

        // Prepare records with 'chat-learning' source
        const records = chunks.map((chunk, idx) => ({
          id: `chat-${learning.id}-chunk-${idx}`,
          text: contextHeader + chunk,
          vector: embeddings[idx],
          title: learning.title,
          url: '',
          type: 'training',
          source: 'chat-learning', // Distinguishes from manual training
          category: learning.category,
          chunkIndex: idx,
          totalChunks: chunks.length,
          crawledAt: new Date().toISOString()
        }));

        // Add to LanceDB
        if (!table) {
          table = await lanceDb.createTable(CONFIG.tableName, records);
        } else {
          await table.add(records);
        }

        // Mark as trained in SQLite
        const updateStmt = db.prepare(`
          UPDATE chat_learnings
          SET is_trained = 1, trained_at = CURRENT_TIMESTAMP, chunks_created = ?
          WHERE id = ?
        `);
        updateStmt.run(chunks.length, learning.id);

        trainedCount++;

        sendProgress({
          type: 'success',
          message: `Trained: ${learning.title} (${chunks.length} chunks added to Brain)`,
          learningId: learning.id,
          chunks: chunks.length
        });

      } catch (error) {
        errorCount++;
        sendProgress({
          type: 'error',
          message: `Failed to train "${learning.title}": ${error.message}`,
          learningId: learning.id
        });
      }

      await new Promise(r => setTimeout(r, 300));
    }

    // Get brain count (only chat-learnings)
    let brainCount = 0;
    try {
      if (table) {
        // Count only chat-learning source records
        const allRecords = await table.search([0]).limit(100000).toArray();
        brainCount = allRecords.filter(r => r.source === 'chat-learning').length;
      }
    } catch (e) {
      console.error('Error counting brain records:', e);
    }

    sendProgress({
      type: 'complete',
      message: `Training complete! ${trainedCount} learnings added to Brain, ${errorCount} errors.`,
      trained: trainedCount,
      errors: errorCount,
      brainCount: brainCount
    });

    // Trigger library backup after successful training
    if (trainedCount > 0) {
      libraryBackup.triggerDebouncedBackup();
    }

  } catch (error) {
    console.error('Chat learning training error:', error);
    sendProgress({ type: 'error', message: `Training failed: ${error.message}` });
  }

  res.end();
});

// Get chat learnings stats
router.get('/chat-learnings/stats', async (req, res) => {
  try {
    const learningsStmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(is_trained) as trained,
        SUM(chunks_created) as total_chunks
      FROM chat_learnings
    `);
    const learningStats = learningsStmt.get();

    // Group by category
    const categoryStmt = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM chat_learnings
      GROUP BY category
    `);
    const categories = categoryStmt.all();

    res.json({
      totalLearnings: learningStats.total || 0,
      trainedLearnings: learningStats.trained || 0,
      untrainedLearnings: (learningStats.total || 0) - (learningStats.trained || 0),
      totalChunksInBrain: learningStats.total_chunks || 0,
      byCategory: categories.reduce((acc, c) => {
        acc[c.category] = c.count;
        return acc;
      }, {})
    });
  } catch (error) {
    console.error('Error getting chat learnings stats:', error);
    res.status(500).json({ error: 'Failed to get chat learnings stats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// TXT to JSON Conversion
// ─────────────────────────────────────────────────────────────────────────────────

// Format raw text content into structured JSON for AI training
function formatTextForTraining(content, fileName) {
  const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

  // Detect content type and structure
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter(line => line.trim().length > 0);

  // Extract potential title from first lines
  let title = fileNameWithoutExt;
  let description = '';

  // Check if first line looks like a title (short, no punctuation at end except ?)
  if (nonEmptyLines.length > 0) {
    const firstLine = nonEmptyLines[0].trim();
    if (firstLine.length < 100 && !firstLine.endsWith('.') && !firstLine.endsWith(',')) {
      title = firstLine.replace(/^#+\s*/, ''); // Remove markdown headers
    }
  }

  // Extract description from first paragraph or first few lines
  const firstParagraph = content.split(/\n\n+/)[0];
  if (firstParagraph && firstParagraph.length < 500) {
    description = firstParagraph.trim().substring(0, 200);
    if (description.length === 200) description += '...';
  }

  // Detect content characteristics
  const hasCodeBlocks = /```[\s\S]*?```/.test(content) || /^\s{4,}\S/m.test(content);
  const hasLuaCode = /function\s*\(|local\s+\w+|RegisterNetEvent|AddEventHandler|Citizen\./.test(content);
  const hasJsCode = /const\s+|let\s+|function\s+\w+\s*\(|=>\s*\{|import\s+/.test(content);
  const hasMarkdown = /^#+\s|\*\*[\w\s]+\*\*|^\s*[-*]\s/.test(content);
  const hasBulletPoints = /^\s*[-*•]\s/m.test(content);
  const hasNumberedList = /^\s*\d+\.\s/m.test(content);

  // Determine content type
  let contentType = 'general';
  if (hasLuaCode) contentType = 'lua-code';
  else if (hasJsCode) contentType = 'javascript-code';
  else if (hasCodeBlocks) contentType = 'code-documentation';
  else if (hasMarkdown) contentType = 'documentation';
  else if (hasBulletPoints || hasNumberedList) contentType = 'structured-notes';

  // Extract sections if content has headers
  const sections = [];
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  let lastIndex = 0;
  let lastHeader = null;

  while ((match = headerRegex.exec(content)) !== null) {
    if (lastHeader !== null) {
      sections.push({
        title: lastHeader.title,
        level: lastHeader.level,
        content: content.substring(lastHeader.index, match.index).trim()
      });
    }
    lastHeader = {
      title: match[2],
      level: match[1].length,
      index: match.index + match[0].length
    };
    lastIndex = match.index + match[0].length;
  }

  if (lastHeader !== null) {
    sections.push({
      title: lastHeader.title,
      level: lastHeader.level,
      content: content.substring(lastHeader.index).trim()
    });
  }

  // Extract code snippets
  const codeSnippets = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeSnippets.push({
      language: match[1] || 'plaintext',
      code: match[2].trim()
    });
  }

  // Extract key topics/keywords
  const topics = extractTopics(content);

  // Build the structured training JSON
  const trainingData = {
    metadata: {
      title: title,
      description: description || `Training data from ${fileName}`,
      sourceFile: fileName,
      contentType: contentType,
      createdAt: new Date().toISOString(),
      version: '1.0'
    },
    content: {
      raw: content,
      sections: sections.length > 0 ? sections : undefined,
      codeSnippets: codeSnippets.length > 0 ? codeSnippets : undefined
    },
    analysis: {
      lineCount: lines.length,
      characterCount: content.length,
      wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
      hasCode: hasCodeBlocks || hasLuaCode || hasJsCode,
      topics: topics
    },
    training: {
      chunks: createTrainingChunks(content, title),
      embedReady: true
    }
  };

  return trainingData;
}

// Extract key topics from content
function extractTopics(content) {
  const topics = new Set();

  // General programming concepts
  if (/async|await|Promise/.test(content)) topics.add('async-programming');
  if (/class\s+\w+|constructor/.test(content)) topics.add('object-oriented');
  if (/useState|useEffect|React/.test(content)) topics.add('react');
  if (/function\s+\w+|const\s+\w+\s*=/.test(content)) topics.add('functions');
  if (/import\s+|export\s+/.test(content)) topics.add('modules');
  if (/interface\s+|type\s+\w+\s*=/.test(content)) topics.add('typescript');

  return Array.from(topics).slice(0, 10);
}

// Create training-ready chunks from content
function createTrainingChunks(content, title, maxChunkSize = 1000) {
  const chunks = [];
  const paragraphs = content.split(/\n\n+/);
  let currentChunk = '';
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        index: chunkIndex++,
        text: currentChunk.trim(),
        context: title
      });
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      index: chunkIndex,
      text: currentChunk.trim(),
      context: title
    });
  }

  return chunks;
}

// Convert TXT to JSON endpoint
router.post('/convert-txt', async (req, res) => {
  try {
    const { content, fileName, savePath } = req.body;

    if (!content || !fileName) {
      return res.status(400).json({ error: 'Content and fileName are required' });
    }

    // Format the content for training
    const trainingData = formatTextForTraining(content, fileName);

    // Generate JSON filename
    const jsonFileName = fileName.replace(/\.txt$/i, '.json');

    // If savePath provided, save the JSON file
    if (savePath) {
      const jsonPath = path.join(savePath, jsonFileName);
      await fs.mkdir(savePath, { recursive: true });
      await fs.writeFile(jsonPath, JSON.stringify(trainingData, null, 2), 'utf-8');

      return res.json({
        success: true,
        jsonFileName,
        jsonPath,
        trainingData,
        message: `Converted ${fileName} to ${jsonFileName}`
      });
    }

    // Return the formatted data without saving
    res.json({
      success: true,
      jsonFileName,
      trainingData,
      message: `Formatted ${fileName} for training`
    });
  } catch (error) {
    console.error('Error converting TXT to JSON:', error);
    res.status(500).json({ error: 'Failed to convert TXT to JSON' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// Remove Duplicate Training Records
// ─────────────────────────────────────────────────────────────────────────────────

router.post('/remove-duplicates', async (req, res) => {
  try {
    const results = {
      trainingItems: { found: 0, removed: 0, kept: [] },
      chatLearnings: { found: 0, removed: 0, kept: [] },
      errors: []
    };

    // 1. Find and remove duplicates in training_items (by content hash)
    try {
      const trainingItems = db.prepare('SELECT * FROM training_items ORDER BY created_at ASC').all();
      results.trainingItems.found = trainingItems.length;

      const seenContent = new Map();
      const duplicateIds = [];

      for (const item of trainingItems) {
        // Create hash from content (normalized - lowercase, trimmed, first 500 chars)
        const contentHash = (item.content || '').toLowerCase().trim().slice(0, 500);

        if (seenContent.has(contentHash)) {
          // This is a duplicate - mark for removal
          duplicateIds.push(item.id);
        } else {
          // First occurrence - keep it
          seenContent.set(contentHash, item.id);
          results.trainingItems.kept.push({
            id: item.id,
            title: item.title,
            createdAt: item.created_at
          });
        }
      }

      // Delete duplicates
      if (duplicateIds.length > 0) {
        const deleteStmt = db.prepare('DELETE FROM training_items WHERE id = ?');
        for (const id of duplicateIds) {
          deleteStmt.run(id);
        }
        results.trainingItems.removed = duplicateIds.length;
      }
    } catch (e) {
      results.errors.push(`Training items: ${e.message}`);
    }

    // 2. Find and remove duplicates in chat_learnings (by content hash)
    try {
      const chatLearnings = db.prepare('SELECT * FROM chat_learnings ORDER BY learned_at ASC').all();
      results.chatLearnings.found = chatLearnings.length;

      const seenContent = new Map();
      const duplicateIds = [];

      for (const learning of chatLearnings) {
        // Create hash from content (normalized)
        const contentHash = (learning.content || '').toLowerCase().trim().slice(0, 500);

        if (seenContent.has(contentHash)) {
          // This is a duplicate - mark for removal
          duplicateIds.push(learning.id);
        } else {
          // First occurrence - keep it
          seenContent.set(contentHash, learning.id);
          results.chatLearnings.kept.push({
            id: learning.id,
            title: learning.title,
            learnedAt: learning.learned_at
          });
        }
      }

      // Delete duplicates
      if (duplicateIds.length > 0) {
        const deleteStmt = db.prepare('DELETE FROM chat_learnings WHERE id = ?');
        for (const id of duplicateIds) {
          deleteStmt.run(id);
        }
        results.chatLearnings.removed = duplicateIds.length;
      }
    } catch (e) {
      results.errors.push(`Chat learnings: ${e.message}`);
    }

    // Calculate totals
    results.totalFound = results.trainingItems.found + results.chatLearnings.found;
    results.totalRemoved = results.trainingItems.removed + results.chatLearnings.removed;
    results.totalKept = results.trainingItems.kept.length + results.chatLearnings.kept.length;
    results.success = results.errors.length === 0;

    res.json(results);
  } catch (error) {
    console.error('Error removing duplicates:', error);
    res.status(500).json({ error: 'Failed to remove duplicates', message: error.message });
  }
});

// Preview duplicates without removing them
router.get('/preview-duplicates', (req, res) => {
  try {
    const results = {
      trainingItems: { total: 0, duplicates: [], unique: 0 },
      chatLearnings: { total: 0, duplicates: [], unique: 0 }
    };

    // 1. Preview duplicates in training_items
    const trainingItems = db.prepare('SELECT * FROM training_items ORDER BY created_at ASC').all();
    results.trainingItems.total = trainingItems.length;

    const seenTraining = new Map();
    for (const item of trainingItems) {
      const contentHash = (item.content || '').toLowerCase().trim().slice(0, 500);

      if (seenTraining.has(contentHash)) {
        const original = seenTraining.get(contentHash);
        results.trainingItems.duplicates.push({
          id: item.id,
          title: item.title,
          createdAt: item.created_at,
          duplicateOf: original.id,
          duplicateOfTitle: original.title
        });
      } else {
        seenTraining.set(contentHash, { id: item.id, title: item.title });
      }
    }
    results.trainingItems.unique = results.trainingItems.total - results.trainingItems.duplicates.length;

    // 2. Preview duplicates in chat_learnings
    const chatLearnings = db.prepare('SELECT * FROM chat_learnings ORDER BY learned_at ASC').all();
    results.chatLearnings.total = chatLearnings.length;

    const seenLearnings = new Map();
    for (const learning of chatLearnings) {
      const contentHash = (learning.content || '').toLowerCase().trim().slice(0, 500);

      if (seenLearnings.has(contentHash)) {
        const original = seenLearnings.get(contentHash);
        results.chatLearnings.duplicates.push({
          id: learning.id,
          title: learning.title,
          learnedAt: learning.learned_at,
          duplicateOf: original.id,
          duplicateOfTitle: original.title
        });
      } else {
        seenLearnings.set(contentHash, { id: learning.id, title: learning.title });
      }
    }
    results.chatLearnings.unique = results.chatLearnings.total - results.chatLearnings.duplicates.length;

    results.totalDuplicates = results.trainingItems.duplicates.length + results.chatLearnings.duplicates.length;

    res.json(results);
  } catch (error) {
    console.error('Error previewing duplicates:', error);
    res.status(500).json({ error: 'Failed to preview duplicates', message: error.message });
  }
});

// Get training stats (separated: Manual Training vs Brain/Chat Learnings)
router.get('/stats', async (req, res) => {
  try {
    // Manual training stats (does NOT count toward brain)
    const manualStmt = db.prepare('SELECT COUNT(*) as total, SUM(is_trained) as trained FROM training_items');
    const manualStats = manualStmt.get();

    // Chat learnings stats (DOES count toward brain)
    const chatStmt = db.prepare(`
      SELECT COUNT(*) as total, SUM(is_trained) as trained, SUM(chunks_created) as chunks
      FROM chat_learnings
    `);
    const chatStats = chatStmt.get();

    // Get vector database counts by source
    let vectorStats = { total: 0, manual: 0, chatLearning: 0, other: 0 };
    try {
      const dataDir = path.join(__dirname, '..', '..', 'data');
      const lanceDbPath = path.resolve(dataDir, 'lancedb');
      const lanceDb = await lancedb.connect(lanceDbPath);
      const tables = await lanceDb.tableNames();

      if (tables.includes(CONFIG.tableName)) {
        const table = await lanceDb.openTable(CONFIG.tableName);
        vectorStats.total = await table.countRows();

        // Note: LanceDB doesn't have easy filtering without search
        // We'll estimate based on the database records
        vectorStats.chatLearning = chatStats.chunks || 0;
        vectorStats.manual = vectorStats.total - vectorStats.chatLearning;
      }
    } catch (e) {
      console.error('Error getting vector count:', e);
    }

    res.json({
      // Manual Training (separate from brain)
      manualTraining: {
        totalItems: manualStats.total || 0,
        trainedItems: manualStats.trained || 0,
        vectorChunks: vectorStats.manual
      },
      // Brain (only chat learnings count)
      brain: {
        totalLearnings: chatStats.total || 0,
        trainedLearnings: chatStats.trained || 0,
        vectorChunks: chatStats.chunks || 0
      },
      // Legacy fields for backward compatibility
      totalItems: manualStats.total || 0,
      trainedItems: manualStats.trained || 0,
      vectorChunks: vectorStats.total,
      // Brain count is only chat learnings
      brainCount: chatStats.chunks || 0
    });
  } catch (error) {
    console.error('Error getting training stats:', error);
    res.status(500).json({ error: 'Failed to get training stats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// Universal File Upload (multer + document processor)
// ─────────────────────────────────────────────────────────────────────────────────

const uploadDir = path.join(__dirname, '..', '..', 'data', 'uploads');
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Upload & process a single file (any type)
router.post('/upload-file', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const { path: tempPath, originalname } = req.file;

  try {
    const result = await documentProcessor.processFile(tempPath, originalname);
    const items = [];

    // For ZIPs with sub-files, create separate training items per sub-file
    if (result.subFiles && result.subFiles.length > 0) {
      for (const sub of result.subFiles) {
        const id = uuidv4();
        const stmt = db.prepare(`
          INSERT INTO training_items (id, title, description, content, source)
          VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(id, sub.title, sub.description, sub.content, 'document-upload');
        items.push({
          id,
          title: sub.title,
          description: sub.description,
          content: sub.content,
          isTrained: false,
          trainedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'document-upload',
          fileType: sub.fileType,
          sourceFile: sub.sourceFile || originalname
        });
      }
    } else {
      // Single file → single training item
      const id = uuidv4();
      const stmt = db.prepare(`
        INSERT INTO training_items (id, title, description, content, source)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(id, result.title, result.description, result.content, 'document-upload');
      items.push({
        id,
        title: result.title,
        description: result.description,
        content: result.content,
        isTrained: false,
        trainedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: 'document-upload',
        fileType: result.fileType
      });
    }

    res.json({
      success: true,
      title: result.title,
      description: result.description,
      content: result.content,
      fileType: result.fileType,
      metadata: result.metadata,
      items
    });
  } catch (error) {
    console.error('Error processing uploaded file:', error);
    res.status(500).json({ error: `Failed to process file: ${error.message}` });
  } finally {
    // Clean up multer temp file
    try { await fs.unlink(tempPath); } catch { /* already cleaned up */ }
  }
});

// Bulk upload & process multiple files
router.post('/upload-files', upload.array('files', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  const results = [];

  for (const file of req.files) {
    try {
      const result = await documentProcessor.processFile(file.path, file.originalname);
      const items = [];

      if (result.subFiles && result.subFiles.length > 0) {
        for (const sub of result.subFiles) {
          const id = uuidv4();
          db.prepare(`INSERT INTO training_items (id, title, description, content, source) VALUES (?, ?, ?, ?, ?)`)
            .run(id, sub.title, sub.description, sub.content, 'document-upload');
          items.push({ id, title: sub.title, description: sub.description, content: sub.content, isTrained: false, createdAt: new Date().toISOString(), source: 'document-upload', fileType: sub.fileType });
        }
      } else {
        const id = uuidv4();
        db.prepare(`INSERT INTO training_items (id, title, description, content, source) VALUES (?, ?, ?, ?, ?)`)
          .run(id, result.title, result.description, result.content, 'document-upload');
        items.push({ id, title: result.title, description: result.description, content: result.content, isTrained: false, createdAt: new Date().toISOString(), source: 'document-upload', fileType: result.fileType });
      }

      results.push({ fileName: file.originalname, status: 'success', items });
    } catch (error) {
      results.push({ fileName: file.originalname, status: 'error', message: error.message, items: [] });
    } finally {
      try { await fs.unlink(file.path); } catch { /* already cleaned up */ }
    }
  }

  res.json({ success: true, results });
});

export default router;
