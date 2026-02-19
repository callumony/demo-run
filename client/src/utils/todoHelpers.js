// ═══════════════════════════════════════════════════════════════════════════════
// SHARED TODO HELPERS
// Used by TodoPanel and EmailPanel
// ═══════════════════════════════════════════════════════════════════════════════

const TODO_ARCHIVE_KEY = 'omnipotent_todo_archive';

export function getTodoArchive() {
  try { return JSON.parse(localStorage.getItem(TODO_ARCHIVE_KEY) || '[]'); } catch { return []; }
}

export function setTodoArchive(items) {
  localStorage.setItem(TODO_ARCHIVE_KEY, JSON.stringify(items));
}

// Estimate time for a task based on email content
export function estimateTaskTime(email) {
  const content = ((email.subject || '') + ' ' + (email.preview || '')).toLowerCase();
  const bigWords = ['redesign', 'overhaul', 'rebuild', 'rewrite', 'new website', 'migration'];
  const urgentWords = ['urgent', 'asap', 'immediately', 'critical', 'emergency'];
  const smallWords = ['typo', 'text change', 'small', 'quick', 'minor'];
  const medWords = ['update', 'change', 'modify', 'add', 'fix', 'edit', 'revision'];

  if (bigWords.some(w => content.includes(w))) return 120;
  if (urgentWords.some(w => content.includes(w))) return 30;
  if (smallWords.some(w => content.includes(w))) return 15;
  if (medWords.some(w => content.includes(w))) return 45;
  return 60;
}

// Estimate time for a mention-based todo
export function estimateMentionTime(mention) {
  const content = ((mention.action?.title || '') + ' ' + (mention.body || mention.content || '')).toLowerCase();
  const bigWords = ['redesign', 'overhaul', 'rebuild', 'rewrite', 'new website', 'migration'];
  const urgentWords = ['urgent', 'asap', 'immediately', 'critical', 'emergency'];
  const smallWords = ['typo', 'text change', 'small', 'quick', 'minor'];
  const medWords = ['update', 'change', 'modify', 'add', 'fix', 'edit', 'revision'];

  if (bigWords.some(w => content.includes(w))) return 120;
  if (urgentWords.some(w => content.includes(w))) return 30;
  if (smallWords.some(w => content.includes(w))) return 15;
  if (medWords.some(w => content.includes(w))) return 45;
  return 60;
}

export function getTimeColor(minutes) {
  if (minutes <= 30) return '#22c55e';
  if (minutes < 90) return '#f59e0b';
  return '#ef4444';
}

// Format file size for display
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Determine if a Hive mention is actionable (task-like)
export function isActionableMention(mention) {
  const content = (mention.body || mention.content || '').toLowerCase();
  const actionKeywords = [
    'can you', 'could you', 'please', 'need you to', 'assign', 'handle',
    'take care', 'look into', 'fix', 'update', 'change', 'add', 'remove',
    'create', 'build', 'review', 'check', 'do this', 'work on', 'complete',
    'finish', 'make sure', 'follow up', 'respond', 'send', 'prepare',
    'submit', 'deliver', 'implement', 'resolve', 'address', 'todo', 'to-do',
    'task', 'action item', 'deadline', 'by end of', 'before', 'asap', 'urgent'
  ];
  return actionKeywords.some(kw => content.includes(kw));
}
