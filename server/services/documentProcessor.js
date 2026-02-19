// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL DOCUMENT PROCESSOR
// Extracts clean, structured text from any file type for training
// Supports: PDF, DOCX, XLSX/XLS, CSV, ZIP, Images (OCR), Code, Text
// ═══════════════════════════════════════════════════════════════════════════════

import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

// ─────────────────────────────────────────────────────────────────────────────────
// Lazy-loaded libraries (only imported when the specific extractor is first used)
// ─────────────────────────────────────────────────────────────────────────────────

let _pdfParse = null;
let _mammoth = null;
let _XLSX = null;
let _Tesseract = null;
let _extractZip = null;

async function getPdfParse() {
  if (!_pdfParse) { _pdfParse = (await import('pdf-parse')).default; }
  return _pdfParse;
}

async function getMammoth() {
  if (!_mammoth) { _mammoth = await import('mammoth'); }
  return _mammoth;
}

async function getXLSX() {
  if (!_XLSX) { _XLSX = (await import('xlsx')).default || (await import('xlsx')); }
  return _XLSX;
}

async function getTesseract() {
  if (!_Tesseract) { _Tesseract = await import('tesseract.js'); }
  return _Tesseract;
}

async function getExtractZip() {
  if (!_extractZip) {
    // extract-zip is available as a transitive dependency
    const mod = await import('extract-zip');
    _extractZip = mod.default || mod;
  }
  return _extractZip;
}

// ─────────────────────────────────────────────────────────────────────────────────
// File extension → extractor routing
// ─────────────────────────────────────────────────────────────────────────────────

const EXTENSION_MAP = {
  // Documents
  '.pdf': 'pdf',
  '.docx': 'docx',
  // Spreadsheets
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.csv': 'csv',
  // Archives
  '.zip': 'zip',
  // Images (OCR)
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  '.webp': 'image',
  // Code files
  '.lua': 'code', '.js': 'code', '.jsx': 'code', '.ts': 'code', '.tsx': 'code',
  '.py': 'code', '.rb': 'code', '.go': 'code', '.rs': 'code', '.java': 'code',
  '.c': 'code', '.cpp': 'code', '.h': 'code', '.hpp': 'code', '.cs': 'code',
  '.php': 'code', '.swift': 'code', '.kt': 'code',
  '.html': 'code', '.htm': 'code', '.xml': 'code', '.css': 'code', '.scss': 'code',
  '.sql': 'code', '.sh': 'code', '.bat': 'code', '.ps1': 'code',
  '.yaml': 'code', '.yml': 'code', '.toml': 'code', '.ini': 'code', '.cfg': 'code',
  '.env': 'code', '.gitignore': 'code', '.dockerfile': 'code',
  // Text / data
  '.txt': 'text', '.md': 'text', '.log': 'text', '.json': 'text',
  '.rst': 'text', '.rtf': 'text',
};

const LANGUAGE_MAP = {
  '.lua': 'Lua', '.js': 'JavaScript', '.jsx': 'JSX', '.ts': 'TypeScript', '.tsx': 'TSX',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.java': 'Java',
  '.c': 'C', '.cpp': 'C++', '.h': 'C Header', '.hpp': 'C++ Header', '.cs': 'C#',
  '.php': 'PHP', '.swift': 'Swift', '.kt': 'Kotlin',
  '.html': 'HTML', '.htm': 'HTML', '.xml': 'XML', '.css': 'CSS', '.scss': 'SCSS',
  '.sql': 'SQL', '.sh': 'Shell', '.bat': 'Batch', '.ps1': 'PowerShell',
  '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML', '.ini': 'INI', '.cfg': 'Config',
};

// File extensions to skip inside ZIPs (binary/non-textual)
const SKIP_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.o', '.obj', '.class',
  '.pyc', '.pyd', '.whl', '.egg',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.ogg', '.mkv', '.wmv',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.ico', '.cur', '.ani',
  '.db', '.sqlite', '.sqlite3', '.mdb',
  '.dds', '.psd', '.ai', '.eps', '.svg',
  '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz',
  '.lock', '.map',
]);

// ─────────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Process any file and return structured text ready for training.
 * @param {string} filePath - Absolute path to the file on disk
 * @param {string} originalName - Original filename (for extension detection & display)
 * @returns {Promise<{ title, description, content, fileType, metadata, subFiles }>}
 */
export async function processFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const extractorType = EXTENSION_MAP[ext] || 'unknown';

  try {
    switch (extractorType) {
      case 'pdf':
        return await extractFromPdf(filePath, originalName);
      case 'docx':
        return await extractFromDocx(filePath, originalName);
      case 'xlsx':
        return await extractFromXlsx(filePath, originalName);
      case 'csv':
        return await extractFromCsv(filePath, originalName);
      case 'zip':
        return await extractFromZip(filePath, originalName);
      case 'image':
        return await extractFromImage(filePath, originalName);
      case 'code':
        return await extractFromCode(filePath, originalName, ext);
      case 'text':
        return await extractFromText(filePath, originalName);
      default:
        return await extractFallback(filePath, originalName);
    }
  } catch (error) {
    return {
      title: originalName.replace(/\.[^/.]+$/, ''),
      description: `Failed to process: ${error.message}`,
      content: `[ERROR: Could not extract content from ${originalName}]\nReason: ${error.message}\n\nThis file could not be processed automatically. You may need to convert it to a supported format (TXT, PDF, DOCX) and re-upload.`,
      fileType: extractorType,
      metadata: { error: error.message },
      subFiles: []
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// EXTRACTORS
// ─────────────────────────────────────────────────────────────────────────────────

async function extractFromPdf(filePath, originalName) {
  const pdfParse = await getPdfParse();
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);

  const pageCount = data.numpages || 0;
  const pdfTitle = data.info?.Title || '';
  const author = data.info?.Author || '';

  // Build structured text with page awareness
  let structuredContent = `[DOCUMENT: ${originalName}]\n`;
  structuredContent += `Type: PDF Document (${pageCount} page${pageCount !== 1 ? 's' : ''})\n`;
  if (author) structuredContent += `Author: ${author}\n`;
  structuredContent += `Source: ${originalName}\n\n`;

  // pdf-parse returns all text concatenated; we include it as-is
  // (page boundary detection from pdf-parse is limited, but the text is clean)
  const text = (data.text || '').trim();
  structuredContent += text;

  const title = pdfTitle || originalName.replace(/\.pdf$/i, '');

  return {
    title: cleanTitle(title),
    description: `PDF document, ${pageCount} pages, ${countWords(text)} words` + (author ? ` by ${author}` : ''),
    content: structuredContent,
    fileType: 'pdf',
    metadata: { pageCount, author, pdfTitle },
    subFiles: []
  };
}

async function extractFromDocx(filePath, originalName) {
  const mammoth = await getMammoth();
  const buffer = await fs.readFile(filePath);

  // Get both raw text and HTML for structure detection
  const [rawResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer })
  ]);

  const rawText = rawResult.value || '';
  const html = htmlResult.value || '';

  // Convert HTML to markdown-like structured text
  let structuredText = htmlToStructuredText(html);
  // Fallback to raw text if HTML conversion produced very little
  if (structuredText.trim().length < rawText.trim().length * 0.3) {
    structuredText = rawText;
  }

  let content = `[DOCUMENT: ${originalName}]\n`;
  content += `Type: Word Document\n`;
  content += `Source: ${originalName}\n\n`;
  content += structuredText;

  return {
    title: cleanTitle(originalName.replace(/\.docx$/i, '')),
    description: `Word document, ${countWords(rawText)} words`,
    content,
    fileType: 'docx',
    metadata: { wordCount: countWords(rawText) },
    subFiles: []
  };
}

async function extractFromXlsx(filePath, originalName) {
  const XLSX = await getXLSX();
  const workbook = XLSX.readFile(filePath);

  const sheetNames = workbook.SheetNames;
  let content = `[SPREADSHEET: ${originalName}]\n`;
  content += `Type: Excel Spreadsheet (${sheetNames.length} sheet${sheetNames.length !== 1 ? 's' : ''})\n`;
  content += `Source: ${originalName}\n\n`;

  let totalRows = 0;

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (jsonData.length === 0) continue;

    const headers = jsonData[0].map(h => String(h).trim() || `Column${jsonData[0].indexOf(h) + 1}`);
    const dataRows = jsonData.slice(1).filter(row => row.some(cell => String(cell).trim() !== ''));
    const rowCount = dataRows.length;
    totalRows += rowCount;

    // Cap at 5000 rows per sheet to prevent massive content
    const maxRows = Math.min(dataRows.length, 5000);
    const truncated = dataRows.length > maxRows;

    content += `=== Sheet: ${sheetName} (${rowCount} rows, ${headers.length} columns) ===\n`;
    content += `Columns: ${headers.join(', ')}\n\n`;

    for (let i = 0; i < maxRows; i++) {
      const row = dataRows[i];
      const pairs = headers.map((h, idx) => {
        const val = idx < row.length ? String(row[idx]).trim() : '';
        return val ? `${h}=${val}` : null;
      }).filter(Boolean);
      content += `Row ${i + 1}: ${pairs.join(' | ')}\n`;
    }

    if (truncated) {
      content += `\n[... ${dataRows.length - maxRows} more rows truncated ...]\n`;
    }
    content += '\n';
  }

  return {
    title: cleanTitle(originalName.replace(/\.(xlsx|xls)$/i, '')),
    description: `Spreadsheet with ${sheetNames.length} sheet(s), ${totalRows} total rows`,
    content,
    fileType: 'xlsx',
    metadata: { sheetNames, totalRows },
    subFiles: []
  };
}

async function extractFromCsv(filePath, originalName) {
  const XLSX = await getXLSX();
  const csvText = await fs.readFile(filePath, 'utf-8');
  const workbook = XLSX.read(csvText, { type: 'string' });

  // Reuse XLSX extraction with the parsed workbook
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (jsonData.length === 0) {
    return {
      title: cleanTitle(originalName.replace(/\.csv$/i, '')),
      description: 'Empty CSV file',
      content: `[SPREADSHEET: ${originalName}]\nType: CSV File\nSource: ${originalName}\n\n[Empty file - no data rows found]`,
      fileType: 'csv',
      metadata: { rowCount: 0 },
      subFiles: []
    };
  }

  const headers = jsonData[0].map(h => String(h).trim() || `Column${jsonData[0].indexOf(h) + 1}`);
  const dataRows = jsonData.slice(1).filter(row => row.some(cell => String(cell).trim() !== ''));
  const maxRows = Math.min(dataRows.length, 5000);
  const truncated = dataRows.length > maxRows;

  let content = `[SPREADSHEET: ${originalName}]\n`;
  content += `Type: CSV File (${dataRows.length} rows, ${headers.length} columns)\n`;
  content += `Source: ${originalName}\n\n`;
  content += `Columns: ${headers.join(', ')}\n\n`;

  for (let i = 0; i < maxRows; i++) {
    const row = dataRows[i];
    const pairs = headers.map((h, idx) => {
      const val = idx < row.length ? String(row[idx]).trim() : '';
      return val ? `${h}=${val}` : null;
    }).filter(Boolean);
    content += `Row ${i + 1}: ${pairs.join(' | ')}\n`;
  }

  if (truncated) {
    content += `\n[... ${dataRows.length - maxRows} more rows truncated ...]\n`;
  }

  return {
    title: cleanTitle(originalName.replace(/\.csv$/i, '')),
    description: `CSV file, ${dataRows.length} rows, ${headers.length} columns`,
    content,
    fileType: 'csv',
    metadata: { rowCount: dataRows.length, columnCount: headers.length },
    subFiles: []
  };
}

async function extractFromZip(filePath, originalName) {
  const extractZip = await getExtractZip();
  const tempDir = path.join(path.dirname(filePath), '..', 'temp_uploads', uuidv4());

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await extractZip(filePath, { dir: tempDir });

    // Recursively collect all files
    const allFiles = await walkDirectory(tempDir);

    // Cap at 200 sub-files
    const maxFiles = 200;
    const filesToProcess = allFiles.slice(0, maxFiles);
    const skippedCount = Math.max(0, allFiles.length - maxFiles);

    const subFiles = [];
    let combinedContent = `[ZIP ARCHIVE: ${originalName}]\n`;
    combinedContent += `Type: ZIP Archive (${allFiles.length} file${allFiles.length !== 1 ? 's' : ''})\n`;
    combinedContent += `Source: ${originalName}\n\n`;

    let processedCount = 0;
    let errorCount = 0;

    for (const fileInfo of filesToProcess) {
      const ext = path.extname(fileInfo.relativePath).toLowerCase();

      // Skip known binary/non-processable files
      if (SKIP_EXTENSIONS.has(ext)) {
        combinedContent += `--- File: ${fileInfo.relativePath} [Skipped: binary format] ---\n\n`;
        continue;
      }

      try {
        const result = await processFile(fileInfo.absolutePath, fileInfo.relativePath);
        subFiles.push({
          title: result.title,
          description: result.description,
          content: result.content,
          fileType: result.fileType,
          sourceFile: fileInfo.relativePath,
          extractedFrom: originalName
        });
        processedCount++;
      } catch (err) {
        combinedContent += `--- File: ${fileInfo.relativePath} [Error: ${err.message}] ---\n\n`;
        errorCount++;
      }
    }

    if (skippedCount > 0) {
      combinedContent += `\n[... ${skippedCount} additional files not processed (200 file limit) ...]\n`;
    }

    // Summary
    combinedContent += `\nProcessed: ${processedCount} files`;
    if (errorCount > 0) combinedContent += `, ${errorCount} errors`;
    if (skippedCount > 0) combinedContent += `, ${skippedCount} skipped (limit)`;

    return {
      title: cleanTitle(originalName.replace(/\.zip$/i, '')),
      description: `ZIP archive containing ${allFiles.length} files, ${processedCount} processed`,
      content: combinedContent,
      fileType: 'zip',
      metadata: { fileCount: allFiles.length, processedCount, errorCount },
      subFiles
    };
  } finally {
    // Always clean up temp directory
    await cleanupTempDir(tempDir);
  }
}

async function extractFromImage(filePath, originalName) {
  let ocrText = '';

  try {
    const Tesseract = await getTesseract();
    const worker = await Tesseract.createWorker('eng');
    const result = await worker.recognize(filePath);
    ocrText = (result?.data?.text || '').trim();
    await worker.terminate();
  } catch (err) {
    // OCR failed — not critical, continue with metadata only
    ocrText = '';
  }

  const hasText = ocrText.length > 20;

  let content = `[IMAGE: ${originalName}]\n`;
  content += `Type: Image file\n`;
  content += `Source: ${originalName}\n\n`;

  if (hasText) {
    content += `OCR Extracted Text:\n\n${ocrText}`;
  } else {
    content += `[This image was uploaded for training but contains no machine-readable text.${ocrText ? ' OCR detected minimal content: "' + ocrText + '"' : ''}]`;
  }

  return {
    title: cleanTitle(originalName.replace(/\.[^/.]+$/, '')),
    description: hasText ? `Image with ${countWords(ocrText)} words of OCR text` : 'Image file (no extractable text)',
    content,
    fileType: 'image',
    metadata: { hasOcrText: hasText, ocrLength: ocrText.length },
    subFiles: []
  };
}

async function extractFromCode(filePath, originalName, ext) {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const language = LANGUAGE_MAP[ext] || 'Unknown';
  const lines = fileContent.split('\n').length;

  let content = `[CODE FILE: ${originalName}]\n`;
  content += `Language: ${language}\n`;
  content += `Lines: ${lines}\n`;
  content += `Source: ${originalName}\n\n`;
  content += fileContent;

  return {
    title: cleanTitle(originalName.replace(/\.[^/.]+$/, '')),
    description: `${language} source file, ${lines} lines, ${countWords(fileContent)} words`,
    content,
    fileType: 'code',
    metadata: { language, lineCount: lines },
    subFiles: []
  };
}

async function extractFromText(filePath, originalName) {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const lines = fileContent.split('\n').length;
  const ext = path.extname(originalName).toLowerCase();

  let typeName = 'Text';
  if (ext === '.md') typeName = 'Markdown';
  else if (ext === '.json') typeName = 'JSON';
  else if (ext === '.log') typeName = 'Log';

  // For JSON, try to extract metadata
  let jsonTitle = '';
  let jsonDesc = '';
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(fileContent);
      jsonTitle = parsed.metadata?.title || parsed.title || parsed.name || '';
      jsonDesc = parsed.metadata?.description || parsed.description || '';
    } catch { /* not valid JSON or no metadata */ }
  }

  let content = `[DOCUMENT: ${originalName}]\n`;
  content += `Type: ${typeName} File (${lines} lines)\n`;
  content += `Source: ${originalName}\n\n`;
  content += fileContent;

  return {
    title: jsonTitle || cleanTitle(originalName.replace(/\.[^/.]+$/, '')),
    description: jsonDesc || `${typeName} file, ${lines} lines, ${countWords(fileContent)} words`,
    content,
    fileType: 'text',
    metadata: { lineCount: lines, format: typeName.toLowerCase() },
    subFiles: []
  };
}

async function extractFallback(filePath, originalName) {
  // Try reading as UTF-8 text
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    // Check if content looks like valid text (no excessive null bytes or control chars)
    const controlCharRatio = (fileContent.match(/[\x00-\x08\x0E-\x1F]/g) || []).length / fileContent.length;
    if (controlCharRatio > 0.1) {
      throw new Error('Binary content detected');
    }

    let content = `[FILE: ${originalName}]\n`;
    content += `Type: Unrecognized format (read as text)\n`;
    content += `Source: ${originalName}\n\n`;
    content += fileContent;

    return {
      title: cleanTitle(originalName.replace(/\.[^/.]+$/, '')),
      description: `Unrecognized file read as text, ${countWords(fileContent)} words`,
      content,
      fileType: 'unknown',
      metadata: {},
      subFiles: []
    };
  } catch {
    return {
      title: cleanTitle(originalName.replace(/\.[^/.]+$/, '')),
      description: `Binary file that cannot be processed: ${originalName}`,
      content: `[FILE: ${originalName}]\nType: Unsupported binary format\nSource: ${originalName}\n\n[This file format is not supported for text extraction. Please convert to PDF, DOCX, TXT, or another supported format.]`,
      fileType: 'unsupported',
      metadata: {},
      subFiles: []
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Convert simple HTML (from mammoth) to markdown-like structured text
 */
function htmlToStructuredText(html) {
  let text = html;

  // Convert headings
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
  text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n');
  text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');

  // Convert list items
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

  // Convert tables to pipe format
  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const cells = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
      }
      rows.push(cells.join(' | '));
    }
    if (rows.length > 0) {
      // Add separator after header row
      const header = rows[0];
      const separator = header.split(' | ').map(() => '---').join(' | ');
      return '\n' + header + '\n' + separator + '\n' + rows.slice(1).join('\n') + '\n';
    }
    return match;
  });

  // Convert bold/italic
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // Convert line breaks and paragraphs
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<p[^>]*>/gi, '');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Decode entities
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

/**
 * Recursively walk a directory and return all file paths
 */
async function walkDirectory(dirPath, basePath = dirPath) {
  const files = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dirs and common junk
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__MACOSX') {
        continue;
      }
      const subFiles = await walkDirectory(fullPath, basePath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      // Skip hidden files and OS junk
      if (entry.name.startsWith('.') || entry.name === 'Thumbs.db' || entry.name === '.DS_Store') {
        continue;
      }
      files.push({
        absolutePath: fullPath,
        relativePath: path.relative(basePath, fullPath).replace(/\\/g, '/')
      });
    }
  }

  return files;
}

/**
 * Clean up a temporary directory
 */
export async function cleanupTempDir(tempPath) {
  try {
    if (tempPath && existsSync(tempPath)) {
      await fs.rm(tempPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('Failed to clean temp directory:', err.message);
  }
}

/**
 * Clean up stale temp directories older than 1 hour
 */
export async function cleanupStaleTempFiles(dataDir) {
  const tempBase = path.join(dataDir, 'temp_uploads');
  try {
    if (!existsSync(tempBase)) return;
    const entries = await fs.readdir(tempBase, { withFileTypes: true });
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(tempBase, entry.name);
        try {
          const stat = await fs.stat(dirPath);
          if (stat.mtimeMs < oneHourAgo) {
            await fs.rm(dirPath, { recursive: true, force: true });
            console.log(`Cleaned up stale temp dir: ${entry.name}`);
          }
        } catch { /* ignore individual cleanup errors */ }
      }
    }
  } catch { /* temp_uploads dir may not exist yet */ }
}

function cleanTitle(raw) {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || 'Untitled Document';
}

function countWords(text) {
  return (text || '').split(/\s+/).filter(w => w.length > 0).length;
}

export default { processFile, cleanupTempDir, cleanupStaleTempFiles };
