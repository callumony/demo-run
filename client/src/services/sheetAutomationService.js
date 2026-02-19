// ═══════════════════════════════════════════════════════════════════════════════
// SHEET AUTOMATION SERVICE
// Automate action creation from spreadsheet data
// ═══════════════════════════════════════════════════════════════════════════════

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3001';

/**
 * Fetch spreadsheet data and parse it into a structured format
 * @param {string} sheetId - Google Sheets ID
 * @param {string} range - Optional sheet range (e.g., "Sheet1!A1:Z100")
 * @returns {Promise<Object>} - { headers, rows, data }
 */
export async function fetchSheetData(sheetId, range = '') {
  try {
    const params = range ? `?range=${encodeURIComponent(range)}` : '';
    const response = await fetch(`${API_URL}/api/drive/sheets/${sheetId}/values${params}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch sheet data: ${response.status}`);
    }

    const data = await response.json();
    const { values = [] } = data;

    if (values.length < 2) {
      return { headers: [], rows: [], data: [] };
    }

    const headers = values[0];
    const rows = values.slice(1).filter(row => row.some(cell => cell)); // Filter empty rows

    // Convert rows to objects with headers as keys
    const dataObjects = rows.map(row => {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header?.toLowerCase()?.trim() || `col_${idx}`] = row[idx] || '';
      });
      return obj;
    });

    return { headers, rows, data: dataObjects };
  } catch (error) {
    console.error('Error fetching sheet data:', error);
    throw error;
  }
}

/**
 * Parse project data from a spreadsheet and prepare for action creation
 * Supports flexible column naming: title/name, description/details, project, assignee, priority, duedate, etc.
 * @param {Array} records - Array of row objects from spreadsheet
 * @returns {Array} - Normalized action records
 */
export function parseProjectActions(records) {
  if (!Array.isArray(records)) return [];

  return records
    .filter(record => {
      // Filter out empty rows
      return Object.values(record).some(v => v && String(v).trim());
    })
    .map(record => {
      const normalized = {};

      // Map common field names for title
      const titleKeys = ['title', 'name', 'action', 'task', 'item', 'description'];
      const titleKey = Object.keys(record).find(k => titleKeys.includes(k.toLowerCase()));
      normalized.title = titleKey ? String(record[titleKey]).trim() : 'Untitled';

      // Map common field names for description/details
      const descKeys = ['description', 'details', 'notes', 'body', 'content'];
      const descKey = Object.keys(record).find(k => descKeys.includes(k.toLowerCase()));
      normalized.description = descKey ? String(record[descKey]).trim() : '';

      // Map project
      const projKeys = ['project', 'project_id', 'projectid', 'workspace', 'category'];
      const projKey = Object.keys(record).find(k => projKeys.includes(k.toLowerCase()));
      normalized.projectId = projKey ? String(record[projKey]).trim() : '';

      // Map assignee
      const assignKeys = ['assignee', 'assigned_to', 'owner', 'member', 'user'];
      const assignKey = Object.keys(record).find(k => assignKeys.includes(k.toLowerCase()));
      normalized.assignee = assignKey ? String(record[assignKey]).trim() : '';

      // Map priority
      const priorKeys = ['priority', 'level', 'importance'];
      const priorKey = Object.keys(record).find(k => priorKeys.includes(k.toLowerCase()));
      normalized.priority = priorKey ? String(record[priorKey]).trim().toUpperCase() : 'MEDIUM';

      // Map due date
      const dueKeys = ['duedate', 'due_date', 'deadline', 'date'];
      const dueKey = Object.keys(record).find(k => dueKeys.includes(k.toLowerCase()));
      normalized.dueDate = dueKey ? parseDate(String(record[dueKey])) : null;

      // Map status
      const statusKeys = ['status', 'state', 'stage'];
      const statusKey = Object.keys(record).find(k => statusKeys.includes(k.toLowerCase()));
      normalized.status = statusKey ? String(record[statusKey]).trim().toUpperCase() : 'TODO';

      // Map labels/tags
      const labelKeys = ['label', 'labels', 'tag', 'tags', 'category', 'categories'];
      const labelKey = Object.keys(record).find(k => labelKeys.includes(k.toLowerCase()));
      normalized.labels = labelKey ? String(record[labelKey]).split(',').map(l => l.trim()).filter(l => l) : [];

      // Map attachments (URLs)
      const attachKeys = ['attachment', 'attachments', 'file', 'files', 'url', 'urls', 'link', 'links'];
      const attachKey = Object.keys(record).find(k => attachKeys.includes(k.toLowerCase()));
      normalized.attachments = attachKey 
        ? String(record[attachKey]).split(',').map(u => u.trim()).filter(u => u && u.startsWith('http'))
        : [];

      // Store raw data for reference
      normalized.raw = record;

      return normalized;
    });
}

/**
 * Parse dates in various formats (ISO, MM/DD/YYYY, etc.)
 * @param {string} dateStr - Date string
 * @returns {string|null} - ISO date string or null
 */
export function parseDate(dateStr) {
  if (!dateStr || !String(dateStr).trim()) return null;

  const str = String(dateStr).trim();

  // Try ISO format
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return new Date(`${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`).toISOString().split('T')[0];
  }

  // Try MM/DD/YYYY
  const usMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    return new Date(`${usMatch[3]}-${String(usMatch[1]).padStart(2, '0')}-${String(usMatch[2]).padStart(2, '0')}`).toISOString().split('T')[0];
  }

  // Try DD.MM.YYYY
  const euMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (euMatch) {
    return new Date(`${euMatch[3]}-${String(euMatch[2]).padStart(2, '0')}-${String(euMatch[1]).padStart(2, '0')}`).toISOString().split('T')[0];
  }

  // Try natural date parsing
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  } catch (e) {
    // Fall through to null
  }

  return null;
}

/**
 * Create Hive actions from spreadsheet data
 * @param {Array} records - Normalized action records from parseProjectActions
 * @param {string} hiveApiKey - Hive API key
 * @param {string} hiveUserId - Hive user ID
 * @param {Function} onProgress - Progress callback: (phase, current, total)
 * @returns {Promise<Object>} - { success, created, failed, errors }
 */
export async function createActionsFromSheet(records, hiveApiKey, hiveUserId, onProgress = null) {
  const results = {
    success: true,
    created: [],
    failed: [],
    errors: []
  };

  if (!records || records.length === 0) {
    return { ...results, success: false, errors: ['No records to process'] };
  }

  if (!hiveApiKey || !hiveUserId) {
    return { ...results, success: false, errors: ['Hive credentials not configured'] };
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    
    if (onProgress) {
      onProgress('creating', i + 1, records.length);
    }

    try {
      // Validate required fields
      if (!record.title) {
        results.failed.push({ record, error: 'Missing title' });
        continue;
      }

      if (!record.projectId) {
        results.failed.push({ record, error: 'Missing project ID' });
        continue;
      }

      // Build action payload
      const actionPayload = {
        title: record.title,
        description: record.description || '',
        status: mapStatus(record.status),
        priority: mapPriority(record.priority),
        labels: record.labels || [],
        dueDate: record.dueDate || undefined
      };

      // Build assignees array from assignee field
      if (record.assignee) {
        actionPayload.assignees = [record.assignee];
      }

      // Create action via Hive API (backend proxy expected)
      const response = await fetch(`${API_URL}/api/hive/actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hive-API-Key': hiveApiKey,
          'X-Hive-User-ID': hiveUserId
        },
        body: JSON.stringify({
          projectId: record.projectId,
          ...actionPayload
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const createdAction = await response.json();
      results.created.push({ record, action: createdAction });

    } catch (error) {
      results.failed.push({ record, error: error.message });
      console.error('Error creating action:', record.title, error);
    }
  }

  results.success = results.failed.length === 0;
  return results;
}

/**
 * Map priority string to Hive priority level
 * @param {string} priority - Priority string (HIGH, MEDIUM, LOW, URGENT, etc.)
 * @returns {number} - Hive priority level (0-5 scale)
 */
function mapPriority(priority) {
  const p = String(priority).toUpperCase();
  if (p.includes('URGENT') || p.includes('CRITICAL')) return 5;
  if (p.includes('HIGH')) return 4;
  if (p.includes('MEDIUM') || p === '') return 3;
  if (p.includes('LOW')) return 2;
  if (p.includes('MINIMAL')) return 1;
  return 3; // Default to medium
}

/**
 * Map status string to Hive status
 * @param {string} status - Status string (TODO, IN_PROGRESS, DONE, etc.)
 * @returns {string} - Hive status
 */
function mapStatus(status) {
  const s = String(status).toUpperCase();
  if (s.includes('DONE') || s.includes('COMPLETE') || s.includes('FINISHED')) return 'DONE';
  if (s.includes('PROGRESS') || s.includes('IN_PROGRESS') || s.includes('DOING')) return 'IN_PROGRESS';
  if (s.includes('HOLD') || s.includes('PAUSED') || s.includes('BLOCKED')) return 'HOLD';
  return 'TODO'; // Default
}

/**
 * Validate spreadsheet data structure
 * @param {Object} sheetData - Sheet data from fetchSheetData
 * @returns {Object} - { valid, errors, warnings }
 */
export function validateSheetStructure(sheetData) {
  const result = { valid: true, errors: [], warnings: [] };
  const { headers, data } = sheetData;

  if (!headers || headers.length === 0) {
    result.valid = false;
    result.errors.push('Spreadsheet has no headers');
    return result;
  }

  if (!data || data.length === 0) {
    result.warnings.push('Spreadsheet has no data rows');
    return result;
  }

  // Check for required fields
  const headerLower = headers.map(h => String(h).toLowerCase().trim());
  const hasTitleField = headerLower.some(h => ['title', 'name', 'action', 'task'].includes(h));
  const hasProjectField = headerLower.some(h => ['project', 'project_id', 'workspace'].includes(h));

  if (!hasTitleField) {
    result.warnings.push('No title/name column found. First non-empty column will be used.');
  }

  if (!hasProjectField) {
    result.warnings.push('No project column found. Actions must specify project ID manually.');
  }

  return result;
}
