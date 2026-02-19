// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE SERVICE
// Google Drive / Docs / Sheets API integration (read-only)
// Reuses OAuth tokens from emailService
// ═══════════════════════════════════════════════════════════════════════════════

import emailService from './emailService.js';

class DriveService {
  // ═══════════════════════════════════════════════════════════════════════════════
  // API REQUEST HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  async _driveRequest(endpoint, options = {}) {
    if (!emailService.isConnected()) {
      throw new Error('Google account not connected. Please connect via Settings → Integrations.');
    }

    let token;
    try {
      token = await emailService.getValidAccessToken();
    } catch (err) {
      throw new Error(`Google auth failed: ${err.message}`);
    }

    const url = `https://www.googleapis.com/drive/v3${endpoint}`;
    console.log(`[Drive API] GET ${url}`);

    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      headers: {
        'Authorization': `Bearer ${token}`,
        ...options.headers
      }
    });

    console.log(`[Drive API] Response status: ${response.status}`);

    // Handle redirects (Google sends 302 to login page when token is invalid)
    if (response.status >= 300 && response.status < 400) {
      // Token is likely invalid — force disconnect and ask user to reconnect
      throw new Error('Google session expired. Please reconnect your Google account in Settings.');
    }

    // Check content type before parsing
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text().catch(() => '');
      console.error(`[Drive API] Non-JSON response: ${text.substring(0, 500)}`);
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        throw new Error('Google session expired. Please reconnect your Google account in Settings.');
      }
      throw new Error(`Unexpected response from Google Drive API: ${response.status}`);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const msg = error.error?.message || `Drive API error: ${response.status}`;
      console.error(`[Drive API] Error ${response.status}: ${msg}`);
      // If 401 Unauthorized, the token is bad
      if (response.status === 401) {
        throw new Error('Google session expired. Please reconnect your Google account in Settings.');
      }
      throw new Error(msg);
    }

    const data = await response.json();
    console.log(`[Drive API] Response keys: ${Object.keys(data).join(', ')}, files count: ${data.files?.length ?? 'N/A'}`);
    return data;
  }

  async _docsRequest(endpoint) {
    if (!emailService.isConnected()) {
      throw new Error('Google account not connected. Please connect via Settings → Integrations.');
    }

    let token;
    try {
      token = await emailService.getValidAccessToken();
    } catch (err) {
      throw new Error(`Google auth failed: ${err.message}`);
    }

    const url = `https://docs.googleapis.com/v1${endpoint}`;

    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error('Google session expired. Please reconnect your Google account in Settings.');
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Google session expired. Please reconnect your Google account in Settings.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error('Google session expired. Please reconnect your Google account in Settings.');
      }
      throw new Error(error.error?.message || `Docs API error: ${response.status}`);
    }

    return await response.json();
  }

  async _sheetsRequest(endpoint) {
    if (!emailService.isConnected()) {
      throw new Error('Google account not connected. Please connect via Settings → Integrations.');
    }

    let token;
    try {
      token = await emailService.getValidAccessToken();
    } catch (err) {
      throw new Error(`Google auth failed: ${err.message}`);
    }

    const url = `https://sheets.googleapis.com/v4${endpoint}`;

    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error('Google session expired. Please reconnect your Google account in Settings.');
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Google session expired. Please reconnect your Google account in Settings.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error('Google session expired. Please reconnect your Google account in Settings.');
      }
      throw new Error(error.error?.message || `Sheets API error: ${response.status}`);
    }

    return await response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DRIVE API METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * List files from Google Drive
   * @param {string} query - Search query (Drive API q parameter)
   * @param {number} pageSize - Number of results per page
   * @param {string} pageToken - Token for pagination
   * @param {string} folderId - Folder ID to list contents of (defaults to root)
   */
  async listFiles(query = '', pageSize = 50, pageToken = '', folderId = '') {
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,iconLink,webViewLink,parents,starred,trashed)',
      orderBy: 'folder,name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });

    // Build query
    const queryParts = ['trashed=false'];

    if (folderId) {
      queryParts.push(`'${folderId}' in parents`);
    }

    if (query) {
      queryParts.push(`name contains '${query.replace(/'/g, "\\'")}'`);
    }

    params.set('q', queryParts.join(' and '));

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const result = await this._driveRequest(`/files?${params.toString()}`);

    // Log for debugging empty results
    if (!result.files || result.files.length === 0) {
      console.log(`Drive listFiles returned 0 files. Query: ${params.get('q')}, folderId: ${folderId || '(none)'}`);
    } else {
      console.log(`Drive listFiles returned ${result.files.length} files`);
    }

    return result;
  }

  /**
   * Get file metadata
   */
  async getFile(fileId) {
    return await this._driveRequest(
      `/files/${fileId}?fields=id,name,mimeType,modifiedTime,size,iconLink,webViewLink,parents,starred,description&supportsAllDrives=true`
    );
  }

  /**
   * List contents of a folder
   */
  async listFolderContents(folderId, pageSize = 100, pageToken = '') {
    return await this.listFiles('', pageSize, pageToken, folderId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DOCS API METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Get Google Doc content — returns both HTML (for rich rendering) and plain text (for learning)
   */
  async getDocument(documentId) {
    // Get document metadata + plain text via Docs API
    const doc = await this._docsRequest(`/documents/${documentId}`);
    const text = this._extractDocText(doc.body?.content || []);

    // Also export as HTML for rich rendering (preserves bold, italic, headers, links, images)
    let html = '';
    try {
      const htmlBuffer = await this.exportFile(documentId, 'text/html');
      html = htmlBuffer.toString('utf-8');
    } catch (err) {
      console.warn(`[Drive] HTML export failed for doc ${documentId}, falling back to plain text:`, err.message);
    }

    return {
      id: doc.documentId,
      title: doc.title,
      text,
      html,
      revisionId: doc.revisionId
    };
  }

  /**
   * Recursively extract text from Google Docs structural elements
   */
  _extractDocText(content) {
    let text = '';

    for (const element of content) {
      if (element.paragraph) {
        for (const el of element.paragraph.elements || []) {
          if (el.textRun) {
            text += el.textRun.content;
          }
        }
      } else if (element.table) {
        for (const row of element.table.tableRows || []) {
          const cells = [];
          for (const cell of row.tableCells || []) {
            cells.push(this._extractDocText(cell.content || []).trim());
          }
          text += cells.join('\t') + '\n';
        }
        text += '\n';
      } else if (element.sectionBreak) {
        // Skip section breaks
      }
    }

    return text;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SHEETS API METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Get spreadsheet metadata (sheet names, properties)
   */
  async getSpreadsheet(spreadsheetId) {
    const data = await this._sheetsRequest(`/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties,sheets.properties`);

    return {
      id: data.spreadsheetId,
      title: data.properties?.title,
      sheets: (data.sheets || []).map(s => ({
        id: s.properties?.sheetId,
        title: s.properties?.title,
        index: s.properties?.index,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount
      }))
    };
  }

  /**
   * Get cell values from a sheet
   * @param {string} spreadsheetId
   * @param {string} range - A1 notation range (e.g., 'Sheet1!A1:Z100')
   */
  async getSheetValues(spreadsheetId, range = '') {
    const endpoint = range
      ? `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`
      : `/spreadsheets/${spreadsheetId}/values/A1:Z100`;

    const data = await this._sheetsRequest(endpoint);

    return {
      range: data.range,
      values: data.values || []
    };
  }

  /**
   * Download raw file bytes from Google Drive (for non-Google Workspace files)
   * Uses the Drive API alt=media parameter to get binary content
   * @param {string} fileId - Google Drive file ID
   * @returns {Promise<Buffer>} - Raw file content as a Buffer
   */
  async downloadFileBuffer(fileId) {
    if (!emailService.isConnected()) {
      throw new Error('Google account not connected. Please connect via Settings → Integrations.');
    }

    let token;
    try {
      token = await emailService.getValidAccessToken();
    } catch (err) {
      throw new Error(`Google auth failed: ${err.message}`);
    }

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    console.log(`[Drive API] Downloading file: ${fileId}`);

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Drive API] Download failed: ${response.status} ${errText.substring(0, 300)}`);
      if (response.status === 401) {
        throw new Error('Google session expired. Please reconnect your Google account in Settings.');
      }
      throw new Error(`File download failed: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`[Drive API] Downloaded ${buffer.length} bytes`);
    return buffer;
  }

  /**
   * Export a Google Workspace file (Docs, Sheets, Slides) to a specific format
   * @param {string} fileId - Google Drive file ID
   * @param {string} mimeType - Target export MIME type (e.g., 'text/plain', 'application/pdf')
   * @returns {Promise<Buffer>} - Exported file content as a Buffer
   */
  async exportFile(fileId, mimeType) {
    if (!emailService.isConnected()) {
      throw new Error('Google account not connected. Please connect via Settings → Integrations.');
    }

    let token;
    try {
      token = await emailService.getValidAccessToken();
    } catch (err) {
      throw new Error(`Google auth failed: ${err.message}`);
    }

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`;
    console.log(`[Drive API] Exporting file ${fileId} as ${mimeType}`);

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[Drive API] Export failed: ${response.status} ${errText.substring(0, 300)}`);
      throw new Error(`File export failed: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`[Drive API] Exported ${buffer.length} bytes`);
    return buffer;
  }

  /**
   * Check if Google services are connected (delegates to emailService)
   */
  isConnected() {
    return emailService.isConnected();
  }
}

const driveService = new DriveService();
export default driveService;
