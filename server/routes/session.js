import { Router } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Initialize SQLite database
const dbPath = path.join(__dirname, '..', '..', 'data', 'sessions.db');
const db = new Database(dbPath);

// Create sessions table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    user_id TEXT PRIMARY KEY,
    settings TEXT,
    workspace_state TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Get session
router.get('/:userId', (req, res) => {
  try {
    const { userId } = req.params;

    const stmt = db.prepare('SELECT * FROM sessions WHERE user_id = ?');
    const session = stmt.get(userId);

    if (!session) {
      return res.json({ settings: null, workspaceState: null });
    }

    res.json({
      settings: session.settings ? JSON.parse(session.settings) : null,
      workspaceState: session.workspace_state ? JSON.parse(session.workspace_state) : null
    });
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Save session
router.post('/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const { settings, workspaceState } = req.body;

    const stmt = db.prepare(`
      INSERT INTO sessions (user_id, settings, workspace_state, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        settings = COALESCE(excluded.settings, sessions.settings),
        workspace_state = COALESCE(excluded.workspace_state, sessions.workspace_state),
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      userId,
      settings ? JSON.stringify(settings) : null,
      workspaceState ? JSON.stringify(workspaceState) : null
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving session:', error);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

// Delete session
router.delete('/:userId', (req, res) => {
  try {
    const { userId } = req.params;

    const stmt = db.prepare('DELETE FROM sessions WHERE user_id = ?');
    stmt.run(userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
