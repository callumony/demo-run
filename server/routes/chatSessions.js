// ═══════════════════════════════════════════════════════════════════════════════
// CHAT SESSIONS ROUTES
// Manages chat history sessions with archive, delete, and context features
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { OpenAI } from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Initialize database
const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'chat_sessions.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
  -- Chat sessions table
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    message_count INTEGER DEFAULT 0,
    summary TEXT,
    smart_title TEXT,
    smart_description TEXT,
    learned_points TEXT,
    use_as_context INTEGER DEFAULT 0
  );

  -- Chat messages table
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );

  -- Create indexes
  CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON chat_sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_context ON chat_sessions(use_as_context);
`);

// Migrate existing tables to add new columns if missing
try {
  const cols = db.pragma('table_info(chat_sessions)').map(c => c.name);
  if (!cols.includes('smart_title')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN smart_title TEXT');
  }
  if (!cols.includes('smart_description')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN smart_description TEXT');
  }
  if (!cols.includes('learned_points')) {
    db.exec('ALTER TABLE chat_sessions ADD COLUMN learned_points TEXT');
  }
} catch (migrationErr) {
  console.warn('Chat sessions migration warning:', migrationErr.message);
}

// ─────────────────────────────────────────────────────────────────────────────────
// SESSIONS API
// ─────────────────────────────────────────────────────────────────────────────────

// Get all sessions (optionally filter by status)
router.get('/sessions', (req, res) => {
  try {
    const { status, includeArchived } = req.query;

    let query = 'SELECT * FROM chat_sessions';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    } else if (!includeArchived || includeArchived === 'false') {
      // By default, exclude deleted sessions
      query += ' WHERE status != ?';
      params.push('deleted');
    }

    query += ' ORDER BY updated_at DESC';

    const sessions = db.prepare(query).all(...params);
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get active sessions only
router.get('/sessions/active', (req, res) => {
  try {
    const sessions = db.prepare(
      'SELECT * FROM chat_sessions WHERE status = ? ORDER BY updated_at DESC'
    ).all('active');
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching active sessions:', error);
    res.status(500).json({ error: 'Failed to fetch active sessions' });
  }
});

// Get archived sessions only
router.get('/sessions/archived', (req, res) => {
  try {
    const sessions = db.prepare(
      'SELECT * FROM chat_sessions WHERE status = ? ORDER BY updated_at DESC'
    ).all('archived');
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching archived sessions:', error);
    res.status(500).json({ error: 'Failed to fetch archived sessions' });
  }
});

// Get sessions used as context
router.get('/sessions/context', (req, res) => {
  try {
    const sessions = db.prepare(
      'SELECT * FROM chat_sessions WHERE use_as_context = 1 AND status != ? ORDER BY updated_at DESC'
    ).all('deleted');
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching context sessions:', error);
    res.status(500).json({ error: 'Failed to fetch context sessions' });
  }
});

// Create a new session
router.post('/sessions', (req, res) => {
  try {
    const { name } = req.body;
    const id = uuidv4();
    const sessionName = name || `Chat ${new Date().toLocaleString()}`;

    db.prepare(
      'INSERT INTO chat_sessions (id, name) VALUES (?, ?)'
    ).run(id, sessionName);

    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    res.json({ session });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Get a specific session with messages
router.get('/sessions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messages = db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
    ).all(id);

    res.json({ session, messages });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Rename a session
router.put('/sessions/:id/rename', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = db.prepare(
      'UPDATE chat_sessions SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(name.trim(), id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    res.json({ session });
  } catch (error) {
    console.error('Error renaming session:', error);
    res.status(500).json({ error: 'Failed to rename session' });
  }
});

// Archive a session
router.put('/sessions/:id/archive', (req, res) => {
  try {
    const { id } = req.params;

    const result = db.prepare(
      'UPDATE chat_sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('archived', id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    res.json({ session, message: 'Session archived successfully' });
  } catch (error) {
    console.error('Error archiving session:', error);
    res.status(500).json({ error: 'Failed to archive session' });
  }
});

// Unarchive a session (restore to active)
router.put('/sessions/:id/unarchive', (req, res) => {
  try {
    const { id } = req.params;

    const result = db.prepare(
      'UPDATE chat_sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('active', id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    res.json({ session, message: 'Session restored successfully' });
  } catch (error) {
    console.error('Error unarchiving session:', error);
    res.status(500).json({ error: 'Failed to unarchive session' });
  }
});

// Toggle use as context
router.put('/sessions/:id/context', (req, res) => {
  try {
    const { id } = req.params;
    const { useAsContext } = req.body;

    const result = db.prepare(
      'UPDATE chat_sessions SET use_as_context = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(useAsContext ? 1 : 0, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    res.json({ session });
  } catch (error) {
    console.error('Error updating context setting:', error);
    res.status(500).json({ error: 'Failed to update context setting' });
  }
});

// Delete a session (requires confirmation word)
router.delete('/sessions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { confirmation } = req.body;

    // Require "DELETE" confirmation word for permanent deletion
    if (confirmation !== 'DELETE') {
      return res.status(400).json({
        error: 'Confirmation required',
        message: 'To permanently delete this session, send { "confirmation": "DELETE" } in the request body'
      });
    }

    // Get session first to verify it exists
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Delete messages first (though CASCADE should handle this)
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);

    // Delete the session
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);

    res.json({
      success: true,
      message: 'Session permanently deleted',
      deletedSession: session.name
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// MESSAGES API
// ─────────────────────────────────────────────────────────────────────────────────

// Get messages for a session
router.get('/sessions/:sessionId/messages', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    const messages = db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
    ).all(sessionId, parseInt(limit), parseInt(offset));

    const total = db.prepare(
      'SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?'
    ).get(sessionId);

    res.json({ messages, total: total.count });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Add a message to a session
router.post('/sessions/:sessionId/messages', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { role, content, metadata } = req.body;

    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' });
    }

    // Verify session exists
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const id = uuidv4();
    db.prepare(
      'INSERT INTO chat_messages (id, session_id, role, content, metadata) VALUES (?, ?, ?, ?, ?)'
    ).run(id, sessionId, role, content, metadata ? JSON.stringify(metadata) : null);

    // Update session message count and timestamp
    db.prepare(
      'UPDATE chat_sessions SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(sessionId);

    const message = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
    res.json({ message });
  } catch (error) {
    console.error('Error adding message:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// CONTEXT BUILDING
// ─────────────────────────────────────────────────────────────────────────────────

// Get all context from sessions marked for context
router.get('/context', (req, res) => {
  try {
    const { maxLength = 30000 } = req.query;

    // Get all sessions marked as context
    const sessions = db.prepare(
      'SELECT * FROM chat_sessions WHERE use_as_context = 1 AND status != ? ORDER BY updated_at DESC'
    ).all('deleted');

    if (sessions.length === 0) {
      return res.json({ context: '', sessionCount: 0 });
    }

    let contextParts = [];
    let totalLength = 0;

    for (const session of sessions) {
      // Get messages for this session
      const messages = db.prepare(
        'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
      ).all(session.id);

      if (messages.length === 0) continue;

      // Format session context
      let sessionContext = `\n### Session: ${session.name}\n`;
      for (const msg of messages) {
        const prefix = msg.role === 'user' ? 'User' : 'Assistant';
        const truncatedContent = msg.content.length > 500
          ? msg.content.slice(0, 500) + '...'
          : msg.content;
        sessionContext += `${prefix}: ${truncatedContent}\n`;
      }

      // Check if adding this session would exceed max length
      if (totalLength + sessionContext.length > parseInt(maxLength)) {
        break;
      }

      contextParts.push(sessionContext);
      totalLength += sessionContext.length;
    }

    const context = contextParts.length > 0
      ? `## CONTEXT FROM PREVIOUS SESSIONS\n${contextParts.join('\n---\n')}`
      : '';

    res.json({
      context,
      sessionCount: contextParts.length,
      totalSessions: sessions.length
    });
  } catch (error) {
    console.error('Error building context:', error);
    res.status(500).json({ error: 'Failed to build context' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────────

// Clear session for fresh start (creates new session, archives current)
router.post('/fresh-start', (req, res) => {
  try {
    // Archive all active sessions
    db.prepare(
      'UPDATE chat_sessions SET status = ? WHERE status = ?'
    ).run('archived', 'active');

    // Create a new session
    const id = uuidv4();
    const name = `New Chat ${new Date().toLocaleString()}`;

    db.prepare(
      'INSERT INTO chat_sessions (id, name, status) VALUES (?, ?, ?)'
    ).run(id, name, 'active');

    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);

    res.json({
      session,
      message: 'Fresh session started. Previous sessions have been archived.'
    });
  } catch (error) {
    console.error('Error starting fresh session:', error);
    res.status(500).json({ error: 'Failed to start fresh session' });
  }
});

// Get current active session (or create one if none exists)
router.get('/current', (req, res) => {
  try {
    let session = db.prepare(
      'SELECT * FROM chat_sessions WHERE status = ? ORDER BY updated_at DESC LIMIT 1'
    ).get('active');

    if (!session) {
      // Create a new session
      const id = uuidv4();
      const name = `Chat ${new Date().toLocaleString()}`;

      db.prepare(
        'INSERT INTO chat_sessions (id, name, status) VALUES (?, ?, ?)'
      ).run(id, name, 'active');

      session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);
    }

    // Get message count
    const messages = db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
    ).all(session.id);

    res.json({ session, messages });
  } catch (error) {
    console.error('Error getting current session:', error);
    res.status(500).json({ error: 'Failed to get current session' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// INTELLIGENT SUMMARY GENERATION
// ─────────────────────────────────────────────────────────────────────────────────

// Generate intelligent title, description, and learned points for a session
router.post('/sessions/:id/generate-summary', async (req, res) => {
  try {
    const { id } = req.params;
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get all messages for this session
    const messages = db.prepare(
      'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
    ).all(id);

    if (messages.length === 0) {
      return res.json({
        session,
        smart_title: session.name,
        smart_description: 'Empty session',
        learned_points: []
      });
    }

    // Build conversation text for analysis (truncated to fit context)
    const conversationText = messages.map(m => {
      const prefix = m.role === 'user' ? 'User' : 'Assistant';
      const truncated = m.content.length > 600 ? m.content.slice(0, 600) + '...' : m.content;
      return `${prefix}: ${truncated}`;
    }).join('\n').slice(0, 8000);

    // Try to use OpenAI for intelligent summary
    let smartTitle = session.name;
    let smartDescription = '';
    let learnedPoints = [];

    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: process.env.CHAT_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a conversation analyzer. Given a chat conversation, generate:
1. A concise, descriptive title (max 60 characters) that captures the main topic
2. A brief description (1-2 sentences, max 150 characters) summarizing what was discussed
3. A list of key points or facts that were learned or discussed (max 5 points, each max 100 chars)

Respond in JSON format:
{
  "title": "...",
  "description": "...",
  "learned_points": ["point 1", "point 2", ...]
}`
          },
          {
            role: 'user',
            content: `Analyze this conversation and generate a smart summary:\n\n${conversationText}`
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      const responseText = completion.choices[0]?.message?.content || '';

      // Try to parse JSON from response
      try {
        // Extract JSON from potential markdown code blocks
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          smartTitle = parsed.title || session.name;
          smartDescription = parsed.description || '';
          learnedPoints = Array.isArray(parsed.learned_points) ? parsed.learned_points : [];
        }
      } catch (parseErr) {
        console.warn('Failed to parse AI summary response:', parseErr.message);
        // Fallback: use first user message as title basis
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          smartTitle = firstUserMsg.content.slice(0, 60).replace(/\n/g, ' ').trim();
          if (smartTitle.length >= 57) smartTitle = smartTitle.slice(0, 57) + '...';
        }
      }
    } catch (aiErr) {
      console.warn('AI summary generation failed (falling back to basic):', aiErr.message);
      // Basic fallback: use first user message
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        smartTitle = firstUserMsg.content.slice(0, 60).replace(/\n/g, ' ').trim();
        if (smartTitle.length >= 57) smartTitle = smartTitle.slice(0, 57) + '...';
      }
      smartDescription = `${messages.length} messages exchanged`;
    }

    // Save to database
    const learnedPointsJson = JSON.stringify(learnedPoints);
    db.prepare(
      'UPDATE chat_sessions SET smart_title = ?, smart_description = ?, learned_points = ?, name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(smartTitle, smartDescription, learnedPointsJson, smartTitle, id);

    const updatedSession = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id);

    res.json({
      session: updatedSession,
      smart_title: smartTitle,
      smart_description: smartDescription,
      learned_points: learnedPoints
    });
  } catch (error) {
    console.error('Error generating session summary:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

export default router;
