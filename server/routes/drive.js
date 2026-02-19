// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE ROUTES
// Google Drive / Docs / Sheets API proxy endpoints (read-only)
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import emailService from '../services/emailService.js';
import driveService from '../services/driveService.js';
import documentProcessor from '../services/documentProcessor.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────────

function requireGoogleConnection(req, res, next) {
  if (!emailService.isConnected()) {
    return res.status(401).json({ error: 'Google account not connected' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/drive/debug
// Debug endpoint — raw Drive API call to diagnose empty results
router.get('/debug', requireGoogleConnection, async (req, res) => {
  try {
    const token = await emailService.getValidAccessToken();

    // Test 1: Simplest possible call — just list files, no query
    const url1 = 'https://www.googleapis.com/drive/v3/files?pageSize=10&fields=files(id,name,mimeType)';
    const r1 = await fetch(url1, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d1 = await r1.json();

    // Test 2: List with trashed=false
    const url2 = 'https://www.googleapis.com/drive/v3/files?pageSize=10&q=trashed%3Dfalse&fields=files(id,name,mimeType)';
    const r2 = await fetch(url2, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d2 = await r2.json();

    // Test 3: About — shows user info and storage
    const url3 = 'https://www.googleapis.com/drive/v3/about?fields=user,storageQuota';
    const r3 = await fetch(url3, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const d3 = await r3.json();

    // Test 4: Check granted scopes via tokeninfo
    const url4 = `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`;
    const r4 = await fetch(url4);
    const d4 = await r4.json();

    res.json({
      test1_simple_list: { status: r1.status, fileCount: d1.files?.length ?? 0, files: d1.files?.map(f => f.name) ?? [], error: d1.error || null },
      test2_not_trashed: { status: r2.status, fileCount: d2.files?.length ?? 0, files: d2.files?.map(f => f.name) ?? [], error: d2.error || null },
      test3_about: { status: r3.status, user: d3.user?.emailAddress, error: d3.error || null },
      test4_scopes: { status: r4.status, scope: d4.scope, error: d4.error_description || null }
    });
  } catch (error) {
    console.error('Drive debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drive/files
// List/search files
router.get('/files', requireGoogleConnection, async (req, res) => {
  try {
    const { q = '', pageSize = 50, pageToken = '', folderId = '' } = req.query;
    const result = await driveService.listFiles(q, parseInt(pageSize), pageToken, folderId);
    res.json(result);
  } catch (error) {
    console.error('Error listing Drive files:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drive/files/:id
// Get file metadata
router.get('/files/:id', requireGoogleConnection, async (req, res) => {
  try {
    const file = await driveService.getFile(req.params.id);
    res.json(file);
  } catch (error) {
    console.error('Error getting Drive file:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drive/files/:id/processed
// Download and process any file for in-app viewing (text extraction for binary formats)
router.get('/files/:id/processed', requireGoogleConnection, async (req, res) => {
  try {
    const file = await driveService.getFile(req.params.id);
    const mimeType = file.mimeType;
    const fileName = file.name;

    console.log(`[Drive] Processing file: ${fileName} (${mimeType})`);

    // Google Docs — export as HTML for rich formatting, plain text for learning
    if (mimeType === 'application/vnd.google-apps.document') {
      const doc = await driveService.getDocument(req.params.id);
      return res.json({
        type: 'document',
        fileId: file.id,
        fileName,
        mimeType,
        webViewLink: file.webViewLink,
        title: doc.title,
        text: doc.text,
        html: doc.html || '',
        content: doc.text  // Plain text for Learn button
      });
    }

    // Google Sheets — use Sheets API for structured data
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const sheet = await driveService.getSpreadsheet(req.params.id);
      const allSheetData = [];
      let textContent = `Spreadsheet: ${sheet.title}\n\n`;

      // Fetch data from all sheets (up to 10)
      const sheetsToFetch = (sheet.sheets || []).slice(0, 10);
      for (const s of sheetsToFetch) {
        try {
          const range = `${s.title}!A1:Z200`;
          const values = await driveService.getSheetValues(req.params.id, range);
          allSheetData.push({ sheetTitle: s.title, sheetId: s.id, values: values.values || [] });

          // Build text representation for Learn button
          if (values.values && values.values.length > 0) {
            textContent += `=== Sheet: ${s.title} ===\n`;
            const headers = values.values[0];
            textContent += headers.join(' | ') + '\n';
            textContent += headers.map(() => '---').join(' | ') + '\n';
            values.values.slice(1).forEach(row => {
              textContent += row.join(' | ') + '\n';
            });
            textContent += '\n';
          }
        } catch (e) {
          console.warn(`[Drive] Failed to fetch sheet "${s.title}":`, e.message);
        }
      }

      return res.json({
        type: 'spreadsheet',
        fileId: file.id,
        fileName,
        mimeType,
        webViewLink: file.webViewLink,
        title: sheet.title,
        sheets: sheet.sheets,
        sheetData: allSheetData,
        content: textContent
      });
    }

    // Google Slides — export as plain text
    if (mimeType === 'application/vnd.google-apps.presentation') {
      try {
        const buffer = await driveService.exportFile(req.params.id, 'text/plain');
        const text = buffer.toString('utf-8');
        return res.json({
          type: 'processed',
          fileId: file.id,
          fileName,
          mimeType,
          webViewLink: file.webViewLink,
          title: fileName.replace(/\.[^/.]+$/, ''),
          description: 'Google Slides presentation exported as text',
          content: text,
          fileType: 'text'
        });
      } catch {
        return res.json({
          type: 'unsupported',
          fileId: file.id,
          fileName,
          mimeType,
          webViewLink: file.webViewLink,
          content: '',
          message: 'This file type cannot be viewed in-app. Open in Google Drive instead.'
        });
      }
    }

    // Google Forms, Sites, etc — unsupported for in-app viewing
    if (mimeType.startsWith('application/vnd.google-apps.')) {
      return res.json({
        type: 'unsupported',
        fileId: file.id,
        fileName,
        mimeType,
        webViewLink: file.webViewLink,
        content: '',
        message: 'This Google Workspace file type cannot be viewed in-app. Open in Google Drive instead.'
      });
    }

    // Binary / uploaded files — download and process with documentProcessor
    const buffer = await driveService.downloadFileBuffer(req.params.id);

    // Check file size (reject > 50MB)
    if (buffer.length > 50 * 1024 * 1024) {
      return res.json({
        type: 'unsupported',
        fileId: file.id,
        fileName,
        mimeType,
        webViewLink: file.webViewLink,
        content: '',
        message: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum is 50MB.`
      });
    }

    const tempPath = path.join(os.tmpdir(), `drive-${uuidv4()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`);

    try {
      await fs.writeFile(tempPath, buffer);
      const result = await documentProcessor.processFile(tempPath, fileName);

      // For DOCX files, also extract HTML via mammoth for rich rendering
      let html = '';
      const ext = path.extname(fileName).toLowerCase();
      if (ext === '.docx') {
        try {
          const mammoth = await import('mammoth');
          const htmlResult = await mammoth.convertToHtml({ buffer });
          html = htmlResult.value || '';
        } catch (e) {
          console.warn(`[Drive] DOCX HTML extraction failed:`, e.message);
        }
      }

      return res.json({
        type: 'processed',
        fileId: file.id,
        fileName,
        mimeType,
        webViewLink: file.webViewLink,
        title: result.title,
        description: result.description,
        content: result.content,
        html,
        fileType: result.fileType,
        metadata: result.metadata
      });
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }

  } catch (error) {
    console.error('Error processing Drive file:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drive/files/:id/content
// Get file content (auto-detects Doc vs Sheet)
router.get('/files/:id/content', requireGoogleConnection, async (req, res) => {
  try {
    // First get file metadata to determine type
    const file = await driveService.getFile(req.params.id);
    const mimeType = file.mimeType;

    if (mimeType === 'application/vnd.google-apps.document') {
      const doc = await driveService.getDocument(req.params.id);
      res.json({ type: 'document', ...doc });
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const sheet = await driveService.getSpreadsheet(req.params.id);
      // Also get first sheet values
      const firstSheet = sheet.sheets?.[0];
      const range = firstSheet ? `${firstSheet.title}!A1:Z100` : 'A1:Z100';
      const values = await driveService.getSheetValues(req.params.id, range);
      res.json({ type: 'spreadsheet', ...sheet, values: values.values });
    } else {
      // For other file types, return metadata with webViewLink
      res.json({
        type: 'other',
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink
      });
    }
  } catch (error) {
    console.error('Error getting file content:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drive/folders/:id
// List folder contents
router.get('/folders/:id', requireGoogleConnection, async (req, res) => {
  try {
    const { pageSize = 100, pageToken = '' } = req.query;
    const result = await driveService.listFolderContents(req.params.id, parseInt(pageSize), pageToken);
    res.json(result);
  } catch (error) {
    console.error('Error listing folder:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOCS API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/drive/docs/:id
// Get Google Doc content (plain text)
router.get('/docs/:id', requireGoogleConnection, async (req, res) => {
  try {
    const doc = await driveService.getDocument(req.params.id);
    res.json(doc);
  } catch (error) {
    console.error('Error getting document:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHEETS API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/drive/sheets/:id
// Get spreadsheet metadata
router.get('/sheets/:id', requireGoogleConnection, async (req, res) => {
  try {
    const sheet = await driveService.getSpreadsheet(req.params.id);
    res.json(sheet);
  } catch (error) {
    console.error('Error getting spreadsheet:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drive/sheets/:id/values
// Get sheet cell values
router.get('/sheets/:id/values', requireGoogleConnection, async (req, res) => {
  try {
    const { range = '' } = req.query;
    const values = await driveService.getSheetValues(req.params.id, range);
    res.json(values);
  } catch (error) {
    console.error('Error getting sheet values:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
