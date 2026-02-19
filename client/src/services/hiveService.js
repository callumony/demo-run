// ═══════════════════════════════════════════════════════════════════════════════
// HIVE SERVICE - Hive App Integration
// API Documentation: https://developers.hive.com/reference/api-keys-and-auth
// ═══════════════════════════════════════════════════════════════════════════════

const HIVE_STORAGE_KEY = 'omnipotent_hive_connection';
const HIVE_CACHE_KEY = 'omnipotent_hive_cache';

// Hive API Base URL
const HIVE_API_BASE = 'https://app.hive.com/api/v1';

// Get stored Hive connection
export function getHiveConnection() {
  try {
    const stored = localStorage.getItem(HIVE_STORAGE_KEY);
    if (stored) {
      const connection = JSON.parse(stored);
      // Ensure we have all required fields
      if (connection.apiKey && connection.userId) {
        // Check auth expiration if set
        if (connection.authExpiresAt && Date.now() > connection.authExpiresAt) {
          console.log('Hive auth session expired. Re-login required.');
          localStorage.removeItem(HIVE_STORAGE_KEY);
          return null;
        }
        return connection;
      }
    }
  } catch (e) {
    console.error('Error getting Hive connection:', e);
  }
  return null;
}

// Save Hive connection (only after validation)
export function saveHiveConnection(connectionData) {
  try {
    if (!connectionData.apiKey || !connectionData.userId) {
      console.error('Missing required Hive credentials');
      return false;
    }
    // Read auth remember days from settings
    let rememberDays = 1;
    try {
      const settingsStr = localStorage.getItem('callumony_settings');
      if (settingsStr) {
        const s = JSON.parse(settingsStr);
        rememberDays = s.authRememberDays || 1;
      }
    } catch { /* ignore */ }
    localStorage.setItem(HIVE_STORAGE_KEY, JSON.stringify({
      ...connectionData,
      connectedAt: Date.now(),
      authExpiresAt: Date.now() + (rememberDays * 86400000)
    }));
    return true;
  } catch (e) {
    console.error('Error saving Hive connection:', e);
    return false;
  }
}

// Disconnect Hive
export function disconnectHive() {
  try {
    localStorage.removeItem(HIVE_STORAGE_KEY);
    localStorage.removeItem(HIVE_CACHE_KEY);
    return true;
  } catch (e) {
    console.error('Error disconnecting Hive:', e);
    return false;
  }
}

// Validate Hive credentials using the official test endpoint
// Per Hive docs: api_key in header, user_id as query param
// Also attempts to discover the user's display name for mention matching
export async function validateHiveCredentials(apiKey, userId) {
  try {
    if (!apiKey || !userId) {
      return {
        valid: false,
        error: 'API Key and User ID are required'
      };
    }

    const response = await fetch(`${HIVE_API_BASE}/testcredentials?user_id=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          error: 'Invalid API Key or User ID'
        };
      }
      const errorText = await response.text();
      return {
        valid: false,
        error: `Authentication failed: ${response.status} - ${errorText}`
      };
    }

    // Successful response should indicate "User authenticated"
    const data = await response.text();

    // After validation, try to discover the user's display name
    // by fetching workspaces → members and finding the matching user
    let userName = null;
    let userEmail = null;
    try {
      const wsResponse = await fetch(`${HIVE_API_BASE}/workspaces?user_id=${encodeURIComponent(userId)}`, {
        headers: { 'api_key': apiKey, 'Content-Type': 'application/json' }
      });
      if (wsResponse.ok) {
        const wsData = await wsResponse.json();
        const workspaces = Array.isArray(wsData) ? wsData : (wsData.workspaces || wsData.data || []);
        if (workspaces.length > 0) {
          const wsId = workspaces[0].id || workspaces[0]._id;
          const usersResponse = await fetch(
            `${HIVE_API_BASE}/workspaces/${wsId}/users?user_id=${encodeURIComponent(userId)}&api_key=${encodeURIComponent(apiKey)}`,
            { headers: { 'api_key': apiKey, 'Content-Type': 'application/json' } }
          );
          if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            const users = Array.isArray(usersData) ? usersData : (usersData.users || usersData.members || usersData.data || []);
            // Find current user by ID or email
            const me = users.find(u =>
              u.id === userId || u._id === userId ||
              u.userId === userId || u.user_id === userId ||
              (userId.includes('@') && (u.email?.toLowerCase() === userId.toLowerCase() ||
                u.emails?.some(e => e.toLowerCase() === userId.toLowerCase())))
            );
            if (me) {
              userName = me.name || me.full_name || me.fullName || me.username || me.display_name || null;
              userEmail = me.email || (me.emails && me.emails[0]) || null;
            }
            // If no match by ID, log available members for debugging
            if (!me && users.length > 0) {
              console.log('[Hive] Could not match userId to member. Available members:',
                users.map(u => ({ id: u.id || u._id, name: u.name || u.full_name, email: u.email })));
            }
          }
        }
      }
    } catch (nameErr) {
      console.warn('[Hive] Could not discover user name during validation:', nameErr.message);
    }

    return {
      valid: true,
      message: data || 'User authenticated',
      userName,
      userEmail
    };
  } catch (e) {
    console.error('Error validating Hive credentials:', e);
    return {
      valid: false,
      error: e.message || 'Connection failed. Please check your credentials.'
    };
  }
}

// Legacy function for backward compatibility
export async function validateHiveApiKey(apiKey, userId) {
  return validateHiveCredentials(apiKey, userId);
}

// Fetch workspaces
// Per Hive docs: api_key in header, user_id as query param
export async function fetchWorkspaces(apiKey, userId) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/workspaces?user_id=${encodeURIComponent(userId)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch workspaces');
    return await response.json();
  } catch (e) {
    console.error('Error fetching Hive workspaces:', e);
    return [];
  }
}

// Fetch projects for a workspace
export async function fetchProjects(apiKey, userId, workspaceId) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/projects?user_id=${encodeURIComponent(userId)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch projects');
    return await response.json();
  } catch (e) {
    console.error('Error fetching Hive projects:', e);
    return [];
  }
}

// Fetch actions/tasks with filtering
// Hive API only supports these filter fields: status, parent, archived, milestone
// Filter format: filters[fieldName]=value
export async function fetchActions(apiKey, userId, workspaceId, options = {}) {
  try {
    const params = new URLSearchParams();
    params.set('user_id', userId);
    params.set('limit', options.limit || '500');
    if (options.projectId) params.set('project_id', options.projectId);
    // Use Hive's supported filter syntax
    if (options.status) params.set('filters[status]', options.status);
    if (options.archived === false) params.set('filters[archived]', 'false');

    const url = `${HIVE_API_BASE}/workspaces/${workspaceId}/actions?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Hive] fetchActions failed: ${response.status}`, errText.substring(0, 300));
      throw new Error('Failed to fetch actions');
    }
    const data = await response.json();

    // Return array from response (handle different response formats)
    const actions = Array.isArray(data) ? data : (data.actions || data.data || []);
    console.log(`[Hive] fetchActions returned ${actions.length} actions (raw response type: ${Array.isArray(data) ? 'array' : typeof data}, keys: ${Object.keys(data || {}).join(',')})`);
    return actions;
  } catch (e) {
    console.error('Error fetching Hive actions:', e);
    return [];
  }
}

// Fetch my assigned tasks (excluding archived, completed, and blocked)
// Hive API doesn't support filtering by assignee, so we fetch all and filter client-side
// Hive assignees field contains User ID strings (not names)
// Also fetches subactions so they appear in the task list when assigned to the selected member
export async function fetchMyTasks(apiKey, userId, workspaceId) {
  // Fetch actions - try with and without archived filter for broader results
  let actions = await fetchActions(apiKey, userId, workspaceId, {
    archived: false,
    limit: '1000'
  });

  // If we got very few results, try without the archived filter (API may not support it)
  if (actions.length <= 5) {
    const allActions = await fetchActions(apiKey, userId, workspaceId, { limit: '1000' });
    if (allActions.length > actions.length) {
      actions = allActions;
    }
  }

  console.log(`Hive: Fetched ${actions.length} total actions from workspace`);

  // Filter out truly completed/archived/blocked actions
  // Use exact match (===) not substring match (.includes) to avoid filtering out
  // statuses like "unresolved" matching "resolved"
  const completedStatuses = ['completed', 'complete', 'done', 'closed', 'resolved', 'archived'];
  const blockedStatuses = ['blocked'];
  actions = actions.filter(action => {
    const status = String(action.status || '').toLowerCase().trim();
    const isArchived = action.archived === true;
    const isCompleted = action.completed === true || completedStatuses.some(s => status === s);
    const isBlocked = blockedStatuses.some(s => status === s);
    return !isArchived && !isCompleted && !isBlocked;
  });

  console.log(`Hive: ${actions.length} actions after filtering completed/archived/blocked`);

  // Fetch subactions for all parent actions that have children
  // This ensures subactions assigned to a member show up in their task list
  const parentActions = actions.filter(a =>
    (a.subactions?.length || a.children?.length || a.sub_actions_count || 0) > 0
  );

  if (parentActions.length > 0) {
    console.log(`Hive: Fetching subactions for ${parentActions.length} parent actions...`);
    const batchSize = 10;
    const allSubActions = [];

    for (let i = 0; i < parentActions.length; i += batchSize) {
      const batch = parentActions.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(parent =>
          fetchSubActions(apiKey, userId, workspaceId, parent.id)
            .then(subs => (subs || []).map(sub => ({ ...sub, _parentAction: { id: parent.id, title: parent.title || parent.name } })))
            .catch(() => [])
        )
      );
      results.forEach(r => allSubActions.push(...r));
    }

    // Filter subactions the same way (no completed/archived/blocked)
    const filteredSubs = allSubActions.filter(sub => {
      const status = String(sub.status || '').toLowerCase().trim();
      const isArchived = sub.archived === true;
      const isCompleted = sub.completed === true || completedStatuses.some(s => status === s);
      const isBlocked = blockedStatuses.some(s => status === s);
      return !isArchived && !isCompleted && !isBlocked;
    });

    // Mark subactions and add them to the actions list (avoid duplicates)
    const existingIds = new Set(actions.map(a => a.id));
    for (const sub of filteredSubs) {
      if (!existingIds.has(sub.id)) {
        sub._isSubAction = true;
        actions.push(sub);
        existingIds.add(sub.id);
      }
    }

    console.log(`Hive: Added ${filteredSubs.filter(s => !existingIds.has(s.id)).length || 0} unique subactions, total: ${actions.length}`);
  }

  console.log(`Hive: Returning all ${actions.length} non-completed/non-archived actions (member filtering done in UI)`);

  // Log sample action structure for debugging assignee format
  if (actions.length > 0) {
    const sample = actions[0];
    console.log(`Hive: Sample action assignees:`, JSON.stringify(sample.assignees || sample.assigned_members || []).substring(0, 200));
    console.log(`Hive: Sample action labels:`, JSON.stringify(sample.labels || []).substring(0, 200));
  }

  return actions;
}

// Fetch actions for a specific project
// Shows: actions with due date this month, last comment/change this month,
// or status of Unstarted/In Progress/Waiting variants
export async function fetchProjectActions(apiKey, userId, workspaceId, projectId) {
  try {
    const params = new URLSearchParams();
    params.set('user_id', userId);
    params.set('project_id', projectId);
    params.set('limit', '500');

    const url = `${HIVE_API_BASE}/workspaces/${workspaceId}/actions?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch project actions');
    const data = await response.json();
    let actions = Array.isArray(data) ? data : (data.actions || data.data || []);

    // Filter: exclude truly archived actions
    actions = actions.filter(action => action.archived !== true);

    // Get start of current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Keep actions that are relevant:
    // 1. Status is Unstarted, In Progress, or any Waiting variant
    // 2. Due date is this month or later
    // 3. Last modified/commented this month
    // 4. Exclude completed/archived
    const activeStatusPatterns = [
      'unstarted', 'not_started', 'not started',
      'in_progress', 'in progress',
      'waiting', 'waiting_on', 'waiting on', 'waiting for',
      'on_hold', 'on hold',
      'in_review', 'in review',
      'blocked', 'pending', 'open', 'new', 'todo', 'to do'
    ];
    const completedStatuses = ['completed', 'complete', 'done', 'closed', 'resolved'];

    return actions.filter(action => {
      const status = String(action.status || '').toLowerCase().trim();
      const isCompleted = completedStatuses.some(s => status.includes(s)) || action.completed === true;
      if (isCompleted) return false;

      const deadline = action.deadline ? new Date(action.deadline) : null;
      const modifiedAt = action.modified_at || action.updated_at || action.modifiedAt || action.createdAt || action.created_at;
      const modified = modifiedAt ? new Date(modifiedAt) : null;

      // Active status (partial match for flexibility with Hive status names)
      if (activeStatusPatterns.some(s => status.includes(s))) return true;
      // Due this month or later
      if (deadline && deadline >= monthStart) return true;
      // Modified this month
      if (modified && modified >= monthStart) return true;
      // If no status set, include by default
      if (!status || status === 'null' || status === 'undefined') return true;
      return false;
    });
  } catch (e) {
    console.error('Error fetching project actions:', e);
    return [];
  }
}

// Fetch a single action with full details
export async function fetchActionDetails(apiKey, userId, actionId) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/actions/${actionId}?user_id=${encodeURIComponent(userId)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch action details');
    return await response.json();
  } catch (e) {
    console.error('Error fetching action details:', e);
    return null;
  }
}

// Fetch action comments
export async function fetchActionComments(apiKey, userId, actionId) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/actions/${actionId}/comments?user_id=${encodeURIComponent(userId)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch comments');
    const data = await response.json();
    return Array.isArray(data) ? data : (data.comments || data.data || []);
  } catch (e) {
    console.error('Error fetching action comments:', e);
    return [];
  }
}

// Fetch chats/conversations
export async function fetchChats(apiKey, userId, workspaceId) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/chats?user_id=${encodeURIComponent(userId)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch chats');
    const data = await response.json();
    return Array.isArray(data) ? data : (data.chats || data.conversations || data.data || []);
  } catch (e) {
    console.error('Error fetching chats:', e);
    return [];
  }
}

// Fetch messages in a chat
export async function fetchChatMessages(apiKey, userId, chatId) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/chats/${chatId}/messages?user_id=${encodeURIComponent(userId)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch chat messages');
    const data = await response.json();
    return Array.isArray(data) ? data : (data.messages || data.data || []);
  } catch (e) {
    console.error('Error fetching chat messages:', e);
    return [];
  }
}

// Send a chat message
export async function sendChatMessage(apiKey, userId, chatId, message) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/chats/${chatId}/messages?user_id=${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: message, content: message })
    });

    if (!response.ok) throw new Error('Failed to send message');
    return await response.json();
  } catch (e) {
    console.error('Error sending chat message:', e);
    return null;
  }
}

// Create a new chat
export async function createChat(apiKey, userId, workspaceId, participants, name = null) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/chats?user_id=${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        participants,
        name,
        type: participants.length > 2 ? 'group' : 'direct'
      })
    });

    if (!response.ok) throw new Error('Failed to create chat');
    return await response.json();
  } catch (e) {
    console.error('Error creating chat:', e);
    return null;
  }
}

// Fetch workspace users/members
// Per Hive API docs: GET /workspaces/{workspaceId}/users
export async function fetchWorkspaceMembers(apiKey, userId, workspaceId) {
  try {
    // The correct Hive API endpoint is /users, not /members
    const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/users?user_id=${encodeURIComponent(userId)}&api_key=${encodeURIComponent(apiKey)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn(`Hive /users endpoint returned ${response.status}, trying fallback...`);
      // Fallback: try /members in case older API version
      const fallbackResponse = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/members?user_id=${encodeURIComponent(userId)}&api_key=${encodeURIComponent(apiKey)}`, {
        headers: {
          'api_key': apiKey,
          'Content-Type': 'application/json'
        }
      });
      if (!fallbackResponse.ok) throw new Error('Failed to fetch workspace users');
      const fallbackData = await fallbackResponse.json();
      console.log('Hive members fallback response:', fallbackData);
      return Array.isArray(fallbackData) ? fallbackData : (fallbackData.members || fallbackData.users || fallbackData.data || []);
    }

    const data = await response.json();
    console.log('Hive users response:', data);
    return Array.isArray(data) ? data : (data.users || data.members || data.data || []);
  } catch (e) {
    console.error('Error fetching workspace members:', e);
    return [];
  }
}

// Create a new action/task
// If no project_id is set, auto-apply the default project from settings
export async function createAction(apiKey, userId, workspaceId, actionData) {
  // Apply default project if none specified
  if (!actionData.project_id) {
    try {
      const settingsStr = localStorage.getItem('callumony_settings');
      if (settingsStr) {
        const s = JSON.parse(settingsStr);
        if (s.hiveDefaultProjectId) {
          actionData = { ...actionData, project_id: s.hiveDefaultProjectId };
        }
      }
    } catch { /* ignore */ }
  }

  console.log('[Hive] Creating action:', JSON.stringify(actionData).substring(0, 300));

  const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/actions?user_id=${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: {
      'api_key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(actionData)
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    console.error('[Hive] Create action failed:', response.status, errBody.substring(0, 500));
    throw new Error(`Failed to create action: ${response.status} ${errBody.substring(0, 200)}`);
  }

  const result = await response.json();
  console.log('[Hive] Action created successfully:', result?.id || result?._id);
  return result;
}

// Update an action/task
export async function updateAction(apiKey, userId, workspaceId, actionId, updates) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/actions/${actionId}?user_id=${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) throw new Error('Failed to update action');
    return await response.json();
  } catch (e) {
    console.error('Error updating Hive action:', e);
    return null;
  }
}

// Fetch messages/comments for an action
export async function fetchActionMessages(apiKey, userId, workspaceId, actionId) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/actions/${actionId}/messages?user_id=${encodeURIComponent(userId)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch messages');
    return await response.json();
  } catch (e) {
    console.error('Error fetching Hive messages:', e);
    return [];
  }
}

// Post a message/comment to an action
export async function postActionMessage(apiKey, userId, workspaceId, actionId, message) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/actions/${actionId}/messages?user_id=${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: message })
    });

    if (!response.ok) throw new Error('Failed to post message');
    return await response.json();
  } catch (e) {
    console.error('Error posting Hive message:', e);
    return null;
  }
}

// Post a comment to an action (using the /comments endpoint)
export async function postActionComment(apiKey, userId, actionId, commentBody) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/actions/${actionId}/comments?user_id=${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: commentBody })
    });

    if (!response.ok) throw new Error('Failed to post comment');
    return await response.json();
  } catch (e) {
    console.error('Error posting action comment:', e);
    return null;
  }
}

// Get cached Hive data
export function getCachedHiveData() {
  try {
    const cached = localStorage.getItem(HIVE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.error('Error getting cached Hive data:', e);
  }
  return null;
}

// Cache Hive data
export function cacheHiveData(data) {
  try {
    localStorage.setItem(HIVE_CACHE_KEY, JSON.stringify({
      ...data,
      cachedAt: Date.now()
    }));
  } catch (e) {
    console.error('Error caching Hive data:', e);
  }
}

// Format relative time
export function formatRelativeTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Fetch notifications/mentions
export async function fetchNotifications(apiKey, userId, workspaceId) {
  try {
    const response = await fetch(`${HIVE_API_BASE}/workspaces/${workspaceId}/notifications?user_id=${encodeURIComponent(userId)}`, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch notifications');
    const data = await response.json();
    return Array.isArray(data) ? data : (data.notifications || data.data || []);
  } catch (e) {
    console.error('Error fetching notifications:', e);
    return [];
  }
}

// Fetch @mentions directed at the user by scanning action comments and messages.
// Only returns mentions from the last 48 hours that contain @username.
export async function fetchMentions(apiKey, userId, workspaceId, userName = null) {
  try {
    if (!userName) {
      console.warn('[Hive Mentions] No userName provided, cannot scan for @mentions');
      return [];
    }

    const mentions = [];
    const seenIds = new Set();
    const now = Date.now();
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

    const addMention = (m) => {
      const id = m.id || m._id || `${m.created_at}-${m.body?.substring(0, 20)}`;
      if (seenIds.has(id)) return;

      // Enforce 48-hour window
      const createdAt = m.created_at ? new Date(m.created_at).getTime() : 0;
      if (createdAt > 0 && (now - createdAt) > FORTY_EIGHT_HOURS) return;

      seenIds.add(id);
      mentions.push(m);
    };

    // Build name variants for matching @mentions
    const userNameLower = userName.toLowerCase();
    const nameParts = userNameLower.split(/\s+/);
    const nameVariants = [
      userNameLower,
      ...nameParts,
      nameParts.join(''),
      nameParts.join('.'),
      nameParts.join('_'),
    ].filter(v => v.length > 1);

    console.log(`[Hive Mentions] Scanning for @mentions matching:`, nameVariants);

    // Check if a text body contains an @mention directed at the user
    const containsAtMention = (body) => {
      const bodyLower = (body || '').toLowerCase();
      return nameVariants.some(variant => bodyLower.includes(`@${variant}`));
    };

    // Scan action comments and messages for @username references
    try {
      const actions = await fetchActions(apiKey, userId, workspaceId, { archived: false, limit: '200' });
      if (actions && actions.length > 0) {
        console.log(`[Hive Mentions] Scanning ${actions.length} actions for @mentions`);

        // Scan in batches of 10
        const actionsToScan = actions.slice(0, 100);
        const batchSize = 10;

        for (let i = 0; i < actionsToScan.length; i += batchSize) {
          const batch = actionsToScan.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (action) => {
              const foundMentions = [];
              const actionId = action.id || action._id;
              const actionTitle = action.title || action.name || 'Unknown Action';

              // Scan comments
              try {
                const comments = await fetchActionComments(apiKey, userId, actionId);
                if (comments && comments.length > 0) {
                  for (const comment of comments) {
                    const body = comment.body || comment.content || comment.message || comment.text || '';
                    if (containsAtMention(body)) {
                      foundMentions.push({
                        id: comment.id || comment._id,
                        body,
                        content: body,
                        created_at: comment.created_at || comment.createdAt || comment.timestamp,
                        sender: comment.user || comment.created_by || comment.author || { name: 'Unknown' },
                        action: { id: actionId, title: actionTitle },
                        actionTitle,
                        type: 'mention',
                        read: false,
                        is_read: false
                      });
                    }
                  }
                }
              } catch { /* skip */ }

              // Also scan action messages
              try {
                const messagesResponse = await fetch(
                  `${HIVE_API_BASE}/workspaces/${workspaceId}/actions/${actionId}/messages?user_id=${encodeURIComponent(userId)}`,
                  {
                    headers: {
                      'api_key': apiKey,
                      'Content-Type': 'application/json'
                    }
                  }
                );
                if (messagesResponse.ok) {
                  const messagesData = await messagesResponse.json();
                  const messages = Array.isArray(messagesData) ? messagesData : (messagesData.messages || messagesData.data || []);
                  for (const msg of messages) {
                    const body = msg.body || msg.content || msg.message || msg.text || '';
                    if (containsAtMention(body)) {
                      foundMentions.push({
                        id: msg.id || msg._id,
                        body,
                        content: body,
                        created_at: msg.created_at || msg.createdAt || msg.timestamp,
                        sender: msg.user || msg.created_by || msg.author || msg.sender || { name: 'Unknown' },
                        action: { id: actionId, title: actionTitle },
                        actionTitle,
                        type: 'mention',
                        read: false,
                        is_read: false
                      });
                    }
                  }
                }
              } catch { /* skip */ }

              return foundMentions;
            })
          );
          results.forEach(r => r.forEach(m => addMention(m)));
        }
      }
    } catch (scanErr) {
      console.warn('[Hive Mentions] Comment/message scan failed:', scanErr.message);
    }

    // Sort by most recent first
    mentions.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
      const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
      return dateB - dateA;
    });

    console.log(`[Hive Mentions] Total unique @mentions found (last 48h): ${mentions.length}`);
    return mentions;
  } catch (e) {
    console.error('Error fetching mentions:', e);
    return [];
  }
}

// Get status color
export function getStatusColor(status) {
  if (!status) return '#64748b';

  // Convert to string and lowercase safely
  const statusStr = String(status).toLowerCase();

  const statusColors = {
    'not_started': '#64748b',
    'in_progress': '#3b82f6',
    'in_review': '#f59e0b',
    'complete': '#22c55e',
    'completed': '#22c55e',
    'blocked': '#ef4444',
    'on_hold': '#8b5cf6'
  };
  return statusColors[statusStr] || '#64748b';
}

// Fetch workspace labels
// Hive API returns labels separately; action objects don't include their labels
export async function fetchLabels(apiKey, userId, workspaceId) {
  try {
    const params = new URLSearchParams();
    params.set('user_id', userId);
    params.set('limit', '200');

    const url = `${HIVE_API_BASE}/workspaces/${workspaceId}/labels?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[Hive] Labels fetch failed: ${response.status}`);
      throw new Error('Failed to fetch labels');
    }
    const data = await response.json();
    const labels = Array.isArray(data) ? data : (data.labels || data.data || []);
    console.log(`[Hive] Fetched ${labels.length} labels`);
    if (labels.length > 0) {
      console.log(`[Hive] Sample label:`, JSON.stringify(labels[0]).substring(0, 200));
    }
    return labels;
  } catch (e) {
    console.error('Error fetching Hive labels:', e);
    return [];
  }
}

// Fetch sub-actions (children) of a parent action
export async function fetchSubActions(apiKey, userId, workspaceId, parentActionId) {
  try {
    // Try with parent filter first
    const params = new URLSearchParams();
    params.set('user_id', userId);
    params.set('limit', '100');
    params.set('filters[parent]', parentActionId);

    const url = `${HIVE_API_BASE}/workspaces/${workspaceId}/actions?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[Hive] Sub-actions fetch failed: ${response.status} for parent ${parentActionId}`);
      throw new Error('Failed to fetch sub-actions');
    }
    const data = await response.json();
    let subs = Array.isArray(data) ? data : (data.actions || data.data || []);

    // If filters[parent] returned nothing, try fetching the parent action's children directly
    if (subs.length === 0) {
      try {
        const detailUrl = `${HIVE_API_BASE}/actions/${parentActionId}?user_id=${encodeURIComponent(userId)}`;
        const detailResp = await fetch(detailUrl, {
          headers: {
            'api_key': apiKey,
            'Content-Type': 'application/json'
          }
        });
        if (detailResp.ok) {
          const detail = await detailResp.json();
          // Some Hive API versions include children/subactions inline
          if (detail.subactions?.length > 0) subs = detail.subactions;
          else if (detail.children?.length > 0) subs = detail.children;
          else if (detail.sub_actions?.length > 0) subs = detail.sub_actions;
        }
      } catch { /* fallback failed, return empty */ }
    }

    console.log(`[Hive] Sub-actions for ${parentActionId}: ${subs.length} found`);
    return subs;
  } catch (e) {
    console.error('Error fetching Hive sub-actions:', e);
    return [];
  }
}

// Upload a file attachment to a Hive action
// Proxies through the server: downloads from Gmail, uploads to Hive, cleans up
export async function uploadAttachmentToHiveAction({ messageId, attachmentId, filename, mimeType, hiveActionId, hiveApiKey, hiveUserId }) {
  const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3001';
  const response = await fetch(`${API_URL}/api/email/attachments/upload-to-hive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, attachmentId, filename, mimeType, hiveActionId, hiveApiKey, hiveUserId })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to upload ${filename || 'attachment'} to Hive`);
  }
  return await response.json();
}

// Get priority color
export function getPriorityColor(priority) {
  if (!priority) return '#64748b';

  // Handle numeric priorities (1-4 or similar)
  if (typeof priority === 'number') {
    if (priority <= 1) return '#dc2626';  // urgent
    if (priority <= 2) return '#ef4444';  // high
    if (priority <= 3) return '#f59e0b';  // medium
    return '#64748b';  // low
  }

  // Convert to string and lowercase safely
  const priorityStr = String(priority).toLowerCase();

  const priorityColors = {
    'low': '#64748b',
    'medium': '#f59e0b',
    'high': '#ef4444',
    'urgent': '#dc2626',
    '1': '#dc2626',
    '2': '#ef4444',
    '3': '#f59e0b',
    '4': '#64748b'
  };
  return priorityColors[priorityStr] || '#64748b';
}
