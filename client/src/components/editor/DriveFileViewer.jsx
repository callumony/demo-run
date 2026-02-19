// ═══════════════════════════════════════════════════════════════════════════════
// DRIVE FILE VIEWER
// Renders Google Drive files in-app with rich formatting (HTML from Google Docs,
// mammoth DOCX, tables for spreadsheets). Includes a "Learn" button for Omni.
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  FileText,
  Table,
  ExternalLink,
  Brain,
  CheckCircle,
  Loader,
  Copy,
  Check,
  FileSpreadsheet,
  File,
  AlertCircle
} from 'lucide-react';
import { addTrainingItem } from '../../services/localDatabase';
import './DriveFileViewer.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ═══════════════════════════════════════════════════════════════════════════════
// FILE TYPE BADGE
// ═══════════════════════════════════════════════════════════════════════════════

function FileTypeBadge({ type, fileType, mimeType }) {
  let label = 'File';
  let className = 'badge-file';

  if (type === 'document') {
    label = 'Google Doc';
    className = 'badge-doc';
  } else if (type === 'spreadsheet') {
    label = 'Google Sheet';
    className = 'badge-sheet';
  } else if (fileType === 'pdf') {
    label = 'PDF';
    className = 'badge-pdf';
  } else if (fileType === 'docx') {
    label = 'Word Doc';
    className = 'badge-docx';
  } else if (fileType === 'xlsx') {
    label = 'Spreadsheet';
    className = 'badge-xlsx';
  } else if (fileType === 'csv') {
    label = 'CSV';
    className = 'badge-csv';
  } else if (fileType === 'text') {
    label = 'Text';
    className = 'badge-text';
  } else if (fileType === 'code') {
    label = 'Code';
    className = 'badge-code';
  } else if (fileType === 'image') {
    label = 'Image';
    className = 'badge-image';
  } else if (mimeType?.includes('presentation')) {
    label = 'Slides';
    className = 'badge-slides';
  }

  return <span className={`drive-viewer-badge ${className}`}>{label}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RICH HTML DOCUMENT VIEW (Google Docs / DOCX with full formatting)
// Uses an iframe with srcdoc to safely render HTML with styling
// ═══════════════════════════════════════════════════════════════════════════════

function RichDocumentView({ html, fallbackText }) {
  const iframeRef = useRef(null);
  const [iframeHeight, setIframeHeight] = useState('100%');

  // Clean and enhance the HTML with document-like styling
  const styledHtml = useMemo(() => {
    if (!html) return '';

    // Strip the Google-exported HTML's <html>/<head>/<body> wrapper if present,
    // keep only the body content and inline styles
    let bodyContent = html;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      bodyContent = bodyMatch[1];
    }

    // Extract any <style> blocks from the original HTML
    const styleBlocks = [];
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let styleMatch;
    while ((styleMatch = styleRegex.exec(html)) !== null) {
      styleBlocks.push(styleMatch[1]);
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 32px;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Roboto', sans-serif;
    font-size: 14px;
    line-height: 1.7;
    color: #e2e8f0;
    background: #13161d;
    overflow-x: hidden;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  /* Headings */
  h1, h2, h3, h4, h5, h6 {
    color: #f1f5f9;
    margin-top: 1.2em;
    margin-bottom: 0.4em;
    line-height: 1.3;
  }
  h1 { font-size: 24px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; }
  h2 { font-size: 20px; }
  h3 { font-size: 17px; }
  h4 { font-size: 15px; }

  /* Paragraphs */
  p { margin: 0 0 8px 0; }

  /* Links */
  a { color: #818cf8; text-decoration: none; }
  a:hover { text-decoration: underline; color: #a5b4fc; }

  /* Bold / Italic */
  strong, b { font-weight: 700; color: #f1f5f9; }
  em, i { font-style: italic; }
  u { text-decoration: underline; }

  /* Lists */
  ul, ol { margin: 8px 0; padding-left: 28px; }
  li { margin-bottom: 4px; }

  /* Tables */
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    font-size: 13px;
  }
  table td, table th {
    border: 1px solid rgba(255,255,255,0.1);
    padding: 6px 10px;
    text-align: left;
  }
  table th {
    background: rgba(255,255,255,0.05);
    font-weight: 600;
    color: #f1f5f9;
  }
  table tr:hover { background: rgba(255,255,255,0.02); }

  /* Images */
  img {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 8px 0;
  }

  /* Code */
  code {
    background: rgba(99, 102, 241, 0.15);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 13px;
    color: #a78bfa;
  }
  pre {
    background: #0d0f14;
    padding: 14px;
    border-radius: 6px;
    overflow-x: auto;
    border: 1px solid rgba(255,255,255,0.06);
  }
  pre code { background: transparent; padding: 0; }

  /* Blockquote */
  blockquote {
    border-left: 3px solid #6366f1;
    margin: 12px 0;
    padding: 8px 16px;
    background: rgba(99, 102, 241, 0.05);
    color: #cbd5e1;
  }

  /* Horizontal rule */
  hr {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.08);
    margin: 16px 0;
  }

  /* Google Docs specific overrides — force dark theme */
  span { color: inherit !important; }
  p, li, td, th { color: #e2e8f0 !important; }
  [style*="background-color: #ffffff"],
  [style*="background-color: rgb(255, 255, 255)"],
  [style*="background:#ffffff"] {
    background-color: transparent !important;
  }

  ${styleBlocks.join('\n')}
</style>
</head>
<body>${bodyContent}</body>
</html>`;
  }, [html]);

  // If we have HTML, render in iframe; otherwise fall back to plain text
  if (html && html.trim().length > 0) {
    return (
      <div className="drive-doc-rich-view">
        <iframe
          ref={iframeRef}
          srcDoc={styledHtml}
          className="drive-doc-iframe"
          sandbox="allow-same-origin"
          title="Document preview"
        />
      </div>
    );
  }

  // Fallback to plain text
  if (!fallbackText || fallbackText.trim().length === 0) {
    return <p className="drive-viewer-empty">This document is empty.</p>;
  }

  return (
    <div className="drive-doc-plain-view">
      {fallbackText.split('\n').map((line, i) => (
        <p key={i} className={line.trim() === '' ? 'empty-line' : ''}>
          {line || '\u00A0'}
        </p>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPREADSHEET VIEW (Google Sheets / XLSX / CSV with multiple sheets)
// ═══════════════════════════════════════════════════════════════════════════════

function SpreadsheetView({ metadata }) {
  const [activeSheet, setActiveSheet] = useState(0);

  const sheetData = metadata.sheetData || [];
  const sheets = metadata.sheets || [];

  if (sheetData.length > 0) {
    const currentSheet = sheetData[activeSheet] || sheetData[0];
    const values = currentSheet?.values || [];

    return (
      <div className="drive-sheet-view">
        {sheetData.length > 1 && (
          <div className="drive-sheet-tabs">
            {sheetData.map((sheet, idx) => (
              <button
                key={idx}
                className={`drive-sheet-tab ${idx === activeSheet ? 'active' : ''}`}
                onClick={() => setActiveSheet(idx)}
              >
                <FileSpreadsheet size={12} />
                {sheet.sheetTitle || `Sheet ${idx + 1}`}
              </button>
            ))}
          </div>
        )}

        {values.length > 0 ? (
          <div className="drive-sheet-table-wrap">
            <table className="drive-sheet-table">
              <thead>
                <tr>
                  <th className="row-num">#</th>
                  {values[0].map((cell, i) => (
                    <th key={i}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {values.slice(1).map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    <td className="row-num">{rowIdx + 1}</td>
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="drive-viewer-empty">This sheet is empty.</p>
        )}
      </div>
    );
  }

  if (sheets.length > 0) {
    return (
      <div className="drive-sheet-view">
        <div className="drive-sheet-tabs">
          {sheets.map((sheet, idx) => (
            <span key={idx} className="drive-sheet-tab">{sheet.title}</span>
          ))}
        </div>
        <p className="drive-viewer-empty">No data available for preview.</p>
      </div>
    );
  }

  return <p className="drive-viewer-empty">No spreadsheet data available.</p>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESSED FILE VIEW (PDF, XLSX text, code files, etc.)
// For files that have HTML (DOCX), renders rich; otherwise plain text
// ═══════════════════════════════════════════════════════════════════════════════

function ProcessedFileView({ content, html, fileType }) {
  // If we have HTML (e.g. from DOCX via mammoth), render rich
  if (html && html.trim().length > 0) {
    return <RichDocumentView html={html} fallbackText={content} />;
  }

  if (!content || content.trim().length === 0) {
    return <p className="drive-viewer-empty">No content could be extracted from this file.</p>;
  }

  // Code files — monospace with line numbers
  if (fileType === 'code') {
    const lines = content.split('\n');
    return (
      <div className="drive-code-view">
        <pre>
          {lines.map((line, i) => (
            <div key={i} className="code-line">
              <span className="line-num">{i + 1}</span>
              <span className="line-content">{line}</span>
            </div>
          ))}
        </pre>
      </div>
    );
  }

  // Structured text (PDF, plain text) — render paragraphs
  return (
    <div className="drive-processed-view">
      {content.split('\n').map((line, i) => {
        if (line.match(/^(\[.+\]|===.+===|#{1,6}\s)/)) {
          return <p key={i} className="processed-header">{line}</p>;
        }
        if (line.trim() === '') {
          return <p key={i} className="empty-line">{'\u00A0'}</p>;
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DRIVE FILE VIEWER
// ═══════════════════════════════════════════════════════════════════════════════

export default function DriveFileViewer({ file }) {
  const [learnStatus, setLearnStatus] = useState(null);
  const [learnError, setLearnError] = useState('');
  const [copied, setCopied] = useState(false);

  const metadata = file.driveMetadata || {};
  const content = file.content || '';
  const html = metadata.html || '';

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [content]);

  const handleLearn = useCallback(async () => {
    if (learnStatus === 'loading' || learnStatus === 'success') return;

    const title = metadata.title || file.name;
    const fileType = metadata.fileType || metadata.type || 'file';
    const description = `Learned from Google Drive: ${file.name} (${fileType})`;

    if (!content || content.trim().length === 0) {
      setLearnStatus('error');
      setLearnError('No content to learn from this file.');
      return;
    }

    setLearnStatus('loading');
    setLearnError('');

    try {
      // 1) Add to server-side SQLite (for training pipeline)
      const response = await fetch(`${API_URL}/api/training/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, content })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Failed: ${response.status}`);
      }

      // 2) Add to client-side IndexedDB (so it appears in Library → Shelf)
      await addTrainingItem({
        title,
        description,
        content,
        fileName: file.name,
        source: 'drive-file'
      });

      setLearnStatus('success');
      console.log(`[Drive] File "${title}" added to Omni's training library and local shelf`);
      setTimeout(() => setLearnStatus(null), 5000);
    } catch (err) {
      console.error('[Drive] Learn error:', err);
      setLearnStatus('error');
      setLearnError(err.message);
    }
  }, [content, file.name, metadata, learnStatus]);

  return (
    <div className="drive-file-viewer">
      {/* Header */}
      <div className="drive-viewer-header">
        <div className="drive-viewer-info">
          {metadata.type === 'spreadsheet' ? (
            <Table size={16} className="drive-viewer-icon" />
          ) : metadata.type === 'document' ? (
            <FileText size={16} className="drive-viewer-icon" />
          ) : (
            <File size={16} className="drive-viewer-icon" />
          )}
          <span className="drive-viewer-title">{metadata.title || file.name}</span>
          <FileTypeBadge type={metadata.type} fileType={metadata.fileType} mimeType={metadata.mimeType} />
        </div>

        <div className="drive-viewer-actions">
          <button
            className={`drive-viewer-btn copy-btn ${copied ? 'copied' : ''}`}
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy content'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>

          {metadata.webViewLink && (
            <a
              href={metadata.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="drive-viewer-btn external-btn"
              title="Open in Google Drive"
            >
              <ExternalLink size={14} />
            </a>
          )}

          <button
            className={`drive-learn-btn ${learnStatus || ''}`}
            onClick={handleLearn}
            disabled={learnStatus === 'loading' || learnStatus === 'success'}
            title={
              learnStatus === 'success' ? 'Added to training library!' :
              learnStatus === 'loading' ? 'Teaching Omni...' :
              'Teach Omni this file'
            }
          >
            {learnStatus === 'loading' ? (
              <Loader size={14} className="spinning" />
            ) : learnStatus === 'success' ? (
              <CheckCircle size={14} />
            ) : (
              <Brain size={14} />
            )}
            <span>
              {learnStatus === 'loading' ? 'Learning...' :
               learnStatus === 'success' ? 'Learned!' :
               'Learn'}
            </span>
          </button>
        </div>
      </div>

      {/* Learn error */}
      {learnStatus === 'error' && learnError && (
        <div className="drive-viewer-learn-error">
          <AlertCircle size={12} />
          <span>{learnError}</span>
        </div>
      )}

      {/* Content area — fills full remaining space */}
      <div className="drive-viewer-content">
        {metadata.type === 'document' && (
          <RichDocumentView html={html} fallbackText={content} />
        )}

        {metadata.type === 'spreadsheet' && (
          <SpreadsheetView metadata={metadata} />
        )}

        {metadata.type === 'processed' && (
          <ProcessedFileView content={content} html={html} fileType={metadata.fileType} />
        )}

        {metadata.type === 'unsupported' && (
          <div className="drive-viewer-unsupported">
            <File size={48} />
            <p>{metadata.message || 'This file type cannot be viewed in-app.'}</p>
            {metadata.webViewLink && (
              <a href={metadata.webViewLink} target="_blank" rel="noopener noreferrer" className="drive-open-external">
                <ExternalLink size={14} />
                <span>Open in Google Drive</span>
              </a>
            )}
          </div>
        )}

        {!metadata.type && content && (
          <ProcessedFileView content={content} html="" fileType="text" />
        )}
      </div>
    </div>
  );
}
