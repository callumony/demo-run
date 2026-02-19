// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY CHATBOT SERVER
// RAG-Powered AI Assistant Backend
// ═══════════════════════════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import * as lancedb from '@lancedb/lancedb';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import filesystemRoutes from './routes/filesystem.js';
import sessionRoutes from './routes/session.js';
import trainingRoutes from './routes/training.js';
import chatSessionsRoutes from './routes/chatSessions.js';
import backupRoutes from './routes/backup.js';
import emailRoutes from './routes/email.js';
import driveRoutes from './routes/drive.js';
import { setupTerminalWebSocket } from './routes/terminal.js';
import processManager from './services/processManager.js';
import backupService from './services/backupService.js';
import emailService from './services/emailService.js';
import manualWatcher from './services/manualWatcher.js';
import chatLogger from './services/chatLogger.js';
import libraryBackup from './services/libraryBackup.js';
import { cleanupStaleTempFiles } from './services/documentProcessor.js';
import { validateOnStartup, maskApiKey } from './utils/apiKeyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
config({ path: path.join(__dirname, '..', '.env') });

// ─────────────────────────────────────────────────────────────────────────────────
// Logger Setup
// ─────────────────────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '10m',
      maxFiles: '7d'
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '7d'
    })
  ]
});

// ─────────────────────────────────────────────────────────────────────────────────
// Initialize Services
// ─────────────────────────────────────────────────────────────────────────────────
const app = express();
let openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let db;
let table;

async function initLanceDB() {
  try {
    const dbPath = process.env.LANCEDB_PATH || './data/lancedb';
    db = await lancedb.connect(dbPath);

    // Try to open existing table
    const tableName = process.env.COLLECTION_NAME || 'company_knowledge';
    const tables = await db.tableNames();

    if (tables.includes(tableName)) {
      table = await db.openTable(tableName);
      logger.info(`✓ LanceDB initialized with table: ${tableName}`);
    } else {
      logger.warn(`Table "${tableName}" not found. Run training first: npm run train`);
    }
  } catch (error) {
    logger.error('Failed to initialize LanceDB:', error);
    logger.warn('Vector database not available. Run training first: npm run train');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',')
    : true  // Allow all origins in development
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ─────────────────────────────────────────────────────────────────────────────────
// RAG Functions
// ─────────────────────────────────────────────────────────────────────────────────

async function getEmbedding(text) {
  const response = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    input: text.slice(0, 8000) // Limit input length
  });
  return response.data[0].embedding;
}

async function searchKnowledge(query, topK = 5) {
  if (!table) {
    logger.warn('No table available for search');
    return [];
  }

  try {
    const queryEmbedding = await getEmbedding(query);
    const results = await table.search(queryEmbedding).limit(topK).toArray();

    return results.map(row => ({
      content: row.text,
      metadata: {
        title: row.title,
        url: row.url,
        type: row.type,
        source: row.source
      },
      relevance: 1 - (row._distance || 0) // Convert distance to similarity
    })).filter(r => r.relevance > 0.3); // Filter low relevance results
  } catch (error) {
    logger.error('Search error:', error);
    return [];
  }
}

function buildSystemPrompt(companyContext, workspacePath) {
  const companyName = process.env.COMPANY_NAME || 'RedM Development Assistant';
  const companyDescription = process.env.COMPANY_DESCRIPTION || 'A specialized assistant for RedM/FiveM Lua development.';
  const additionalPrompt = process.env.SYSTEM_PROMPT_ADDITION || '';

  return `You are ${companyName}. ${companyDescription}

You are an AUTONOMOUS CODING AGENT. When the user asks you to build, create, or code something, you MUST:
1. PLAN - Briefly outline what you'll create (files, structure, approach)
2. CODE - Write complete, working code
3. CREATE - Use action blocks to create all necessary files in the workspace

DO NOT just explain or describe - ACTUALLY CREATE THE FILES. Be proactive and thorough.

Your capabilities:
- RedM/FiveM Lua scripting, natives, and game development
- Full-stack development (JavaScript, TypeScript, Python, etc.)
- Creating complete project structures with all necessary files
- Writing production-ready code with proper error handling
- Persistent memory from training and past conversations

${workspacePath ? `CURRENT WORKSPACE: ${workspacePath}` : 'WARNING: No workspace set. Ask user to open a workspace folder.'}

═══════════════════════════════════════════════════════════════════════════════
FILE OPERATIONS - You MUST use these action blocks:
═══════════════════════════════════════════════════════════════════════════════

CREATE A FILE:
\`\`\`action
{"action": "create_file", "path": "${workspacePath || '/path/to/workspace'}/filename.ext", "content": "file content here"}
\`\`\`

CREATE A FOLDER:
\`\`\`action
{"action": "create_folder", "path": "${workspacePath || '/path/to/workspace'}/foldername"}
\`\`\`

READ A FILE:
\`\`\`action
{"action": "read_file", "path": "${workspacePath || '/path/to/workspace'}/filename.ext"}
\`\`\`

DELETE A FILE:
\`\`\`action
{"action": "delete_file", "path": "${workspacePath || '/path/to/workspace'}/filename.ext"}
\`\`\`

LIST DIRECTORY CONTENTS:
\`\`\`action
{"action": "list_directory", "path": "${workspacePath || '/path/to/workspace'}/foldername"}
\`\`\`

ZIP A FOLDER:
\`\`\`action
{"action": "zip_folder", "path": "${workspacePath || '/path/to/workspace'}/foldername", "outputPath": "${workspacePath || '/path/to/workspace'}/output.zip"}
\`\`\`

COPY A FILE:
\`\`\`action
{"action": "copy_file", "path": "${workspacePath || '/path/to/workspace'}/source.ext", "destination": "${workspacePath || '/path/to/workspace'}/dest.ext"}
\`\`\`

MOVE/RENAME A FILE:
\`\`\`action
{"action": "move_file", "path": "${workspacePath || '/path/to/workspace'}/oldname.ext", "destination": "${workspacePath || '/path/to/workspace'}/newname.ext"}
\`\`\`

APPEND TO A FILE:
\`\`\`action
{"action": "append_file", "path": "${workspacePath || '/path/to/workspace'}/filename.ext", "content": "content to append"}
\`\`\`

CRITICAL RULES:
- ALWAYS use FULL ABSOLUTE PATHS starting with the workspace path
- Create folders BEFORE creating files inside them
- For RedM/FiveM resources: ALWAYS include fxmanifest.lua with proper fx_version, game, etc.
- Write COMPLETE code, not snippets or placeholders
- Include proper comments and documentation
- Handle errors appropriately
- Use multiple action blocks for multiple files
- When asked to zip/package a mod, use zip_folder action

═══════════════════════════════════════════════════════════════════════════════
WHEN USER ASKS YOU TO BUILD SOMETHING:
═══════════════════════════════════════════════════════════════════════════════

1. **PLAN** (brief):
   - List the files you'll create
   - Explain the structure briefly

2. **CREATE** (action blocks):
   - Create folders first
   - Then create all files with COMPLETE code

3. **EXPLAIN** (after):
   - Summarize what was created
   - Explain how to use it
   - Note any configuration needed

Example workflow for "Create a simple RedM script":
- Plan: I'll create a resource with client.lua, server.lua, and fxmanifest.lua
- Create: [action blocks for each file]
- Explain: Resource created at X, start it with "ensure resourcename"

═══════════════════════════════════════════════════════════════════════════════
LEARNING & MEMORY:
═══════════════════════════════════════════════════════════════════════════════
- You have persistent memory from training and conversations
- When taught something new, acknowledge you'll remember it
- Reference your training context when relevant
- Use workspace files context to understand existing code

${additionalPrompt}

CONTEXT (Training Data, Memories, Workspace Files, Recent Chat):
${companyContext}
`;
}

// ─────────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    company: process.env.COMPANY_NAME,
    timestamp: new Date().toISOString()
  });
});

// Get company config (for frontend)
app.get('/api/config', (req, res) => {
  res.json({
    companyName: process.env.COMPANY_NAME || 'Company',
    companyTagline: process.env.COMPANY_TAGLINE || '',
    botName: process.env.BOT_NAME || 'Callumony AI',
    botAvatarUrl: process.env.BOT_AVATAR_URL || null,
    welcomeMessage: process.env.WELCOME_MESSAGE || 'Hello! How can I help you today?',
    primaryColor: process.env.PRIMARY_COLOR || '#0A0A0A',
    accentColor: process.env.ACCENT_COLOR || '#6366F1'
  });
});

// Get integration API info (non-secret, public client IDs only)
app.get('/api/integrations-info', (req, res) => {
  res.json({
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || null,
      configured: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
    },
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
      keyPrefix: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.slice(0, 8) + '...' : null
    }
  });
});

// Get full .env setup info (all configuration details - raw values for editing)
app.get('/api/setup-info', (req, res) => {
  res.json({
    apiKeys: {
      OPENAI_API_KEY: { value: process.env.OPENAI_API_KEY || '', label: 'OpenAI API Key', secret: true, envKey: 'OPENAI_API_KEY', description: 'Required for AI chat, embeddings, and analysis features' }
    },
    companyIdentity: {
      COMPANY_NAME: { value: process.env.COMPANY_NAME || '', label: 'Company Name', envKey: 'COMPANY_NAME', description: 'Your company or organization name used in chatbot responses' },
      COMPANY_TAGLINE: { value: process.env.COMPANY_TAGLINE || '', label: 'Company Tagline', envKey: 'COMPANY_TAGLINE', description: 'Short tagline displayed in the chatbot header area' },
      COMPANY_DESCRIPTION: { value: process.env.COMPANY_DESCRIPTION || '', label: 'Company Description', envKey: 'COMPANY_DESCRIPTION', description: 'Brief company description used to train the chatbot context' }
    },
    chatbotAppearance: {
      PRIMARY_COLOR: { value: process.env.PRIMARY_COLOR || '#0A0A0A', label: 'Primary Color', type: 'color', envKey: 'PRIMARY_COLOR', description: 'Main background color for the chatbot widget' },
      ACCENT_COLOR: { value: process.env.ACCENT_COLOR || '#6366F1', label: 'Accent Color', type: 'color', envKey: 'ACCENT_COLOR', description: 'Highlight color for buttons, links, and interactive elements' },
      BOT_NAME: { value: process.env.BOT_NAME || '', label: 'Bot Name', envKey: 'BOT_NAME', description: 'Display name shown in the chatbot conversation header' },
      BOT_AVATAR_URL: { value: process.env.BOT_AVATAR_URL || '', label: 'Bot Avatar URL', envKey: 'BOT_AVATAR_URL', description: 'URL to an image used as the chatbot avatar in messages' },
      CHATBOT_LOGO_URL: { value: process.env.CHATBOT_LOGO_URL || '', label: 'Chatbot Logo URL', envKey: 'CHATBOT_LOGO_URL', description: 'URL to your logo displayed in the chatbot title bar (max 50px high)' }
    },
    chatbotBehavior: {
      TEMPERATURE: { value: process.env.TEMPERATURE || '0.7', label: 'Temperature', type: 'number', envKey: 'TEMPERATURE', description: 'Controls response randomness (0 = focused, 1 = creative)' },
      MAX_TOKENS: { value: process.env.MAX_TOKENS || '10000', label: 'Max Tokens', type: 'number', envKey: 'MAX_TOKENS', description: 'Maximum length of each AI response in tokens' },
      SYSTEM_PROMPT_ADDITION: { value: process.env.SYSTEM_PROMPT_ADDITION || '', label: 'System Prompt Addition', type: 'textarea', envKey: 'SYSTEM_PROMPT_ADDITION', description: 'Custom instructions appended to the system prompt for all conversations' }
    },
    serverConfig: {
      PORT: { value: process.env.PORT || '5176', label: 'Port', type: 'number', envKey: 'PORT', description: 'Server port number (restart required after change)' },
      NODE_ENV: { value: process.env.NODE_ENV || 'development', label: 'Node Environment', envKey: 'NODE_ENV', description: 'Set to "production" for live deployments' },
      APP_URL: { value: process.env.APP_URL || '', label: 'App URL', envKey: 'APP_URL', description: 'Full server URL used for OAuth callbacks (e.g. http://localhost:5176)' },
      CLIENT_URL: { value: process.env.CLIENT_URL || '', label: 'Client URL', envKey: 'CLIENT_URL', description: 'Frontend URL for redirects after OAuth (e.g. http://localhost:5174)' }
    },
    vectorDatabase: {
      LANCEDB_PATH: { value: process.env.LANCEDB_PATH || './data/lancedb', label: 'LanceDB Path', envKey: 'LANCEDB_PATH', description: 'File path to the vector database storage directory' },
      COLLECTION_NAME: { value: process.env.COLLECTION_NAME || 'knowledge_base', label: 'Collection Name', envKey: 'COLLECTION_NAME', description: 'Name of the vector collection for training data embeddings' },
      EMBEDDING_MODEL: { value: process.env.EMBEDDING_MODEL || 'text-embedding-3-small', label: 'Embedding Model', envKey: 'EMBEDDING_MODEL', description: 'OpenAI model used to generate text embeddings' }
    },
    oauthGoogle: {
      GOOGLE_CLIENT_ID: { value: process.env.GOOGLE_CLIENT_ID || '', label: 'Google Client ID', envKey: 'GOOGLE_CLIENT_ID', description: 'OAuth 2.0 Client ID from Google Cloud Console' },
      GOOGLE_CLIENT_SECRET: { value: process.env.GOOGLE_CLIENT_SECRET || '', label: 'Google Client Secret', secret: true, envKey: 'GOOGLE_CLIENT_SECRET', description: 'OAuth 2.0 Client Secret from Google Cloud Console' }
    }
  });
});

// POST /api/setup-info - Update .env configuration
app.post('/api/setup-info', async (req, res) => {
  try {
    const updates = req.body;

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Request body must be a JSON object with key-value pairs' });
    }

    const envPath = path.join(__dirname, '..', '.env');

    // Read the current .env file
    let envContent = '';
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // If .env doesn't exist, start with empty content
    }

    const lines = envContent.split('\n');
    const keysUpdated = new Set();

    // Update existing lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments and blank lines
      if (line.trim().startsWith('#') || line.trim() === '') continue;

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const key = line.substring(0, eqIndex).trim();
      if (key in updates) {
        lines[i] = `${key}=${updates[key]}`;
        keysUpdated.add(key);
      }
    }

    // Append any new keys that weren't found in the existing file
    for (const [key, value] of Object.entries(updates)) {
      if (!keysUpdated.has(key)) {
        lines.push(`${key}=${value}`);
        keysUpdated.add(key);
      }
    }

    // Write the updated .env file
    await fs.writeFile(envPath, lines.join('\n'), 'utf-8');

    // Reload affected process.env values
    for (const [key, value] of Object.entries(updates)) {
      process.env[key] = value;
    }

    // Re-initialize OpenAI client if the API key changed
    if ('OPENAI_API_KEY' in updates) {
      openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      logger.info('OpenAI client re-initialized with new API key');
    }

    logger.info(`Setup info updated: ${Object.keys(updates).join(', ')}`);
    res.json({ success: true, updatedKeys: Object.keys(updates) });
  } catch (error) {
    logger.error('Error updating setup info:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const startTime = Date.now();

  try {
    const { message, conversationHistory = [], trainingContext = '', workspacePath = '', files = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Security: Input validation
    if (message.length > 50000) {
      return res.status(400).json({ error: 'Message too long. Maximum 50,000 characters.' });
    }

    if (conversationHistory.length > 50) {
      return res.status(400).json({ error: 'Conversation history too long. Maximum 50 messages.' });
    }

    if (files.length > 20) {
      return res.status(400).json({ error: 'Too many files. Maximum 20 files.' });
    }

    logger.info(`Chat request: "${message.slice(0, 100)}..." with ${files.length} files`);

    // Log user message in real-time
    chatLogger.logUserMessage(message, files);

    // Use training context from client (local IndexedDB) if available
    // Otherwise fall back to LanceDB search
    let contextText = trainingContext;
    let relevantDocs = [];

    if (!contextText && table) {
      // Fallback to LanceDB if no training context provided
      relevantDocs = await searchKnowledge(message, 5);
      contextText = relevantDocs.map(d => d.content).join('\n\n---\n\n');
      logger.info(`Found ${relevantDocs.length} relevant documents from LanceDB`);
    } else if (contextText) {
      logger.info('Using training context from client');
    }

    // Check if we have images - use GPT-4o for vision
    const hasImages = files.some(f => f.isImage);
    const modelToUse = hasImages ? 'gpt-4o' : 'gpt-4o-mini';

    // Build user message content (with images if present)
    let userContent;
    if (hasImages) {
      // Build multimodal content array for vision
      userContent = [
        { type: 'text', text: message }
      ];

      for (const file of files) {
        if (file.isImage && file.content) {
          userContent.push({
            type: 'image_url',
            image_url: {
              url: file.content, // Base64 data URL
              detail: 'auto'
            }
          });
        }
      }
    } else {
      userContent = message;
    }

    // Build messages array
    const messages = [
      { role: 'system', content: buildSystemPrompt(contextText || 'No specific context available for this query.', workspacePath) },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: userContent }
    ];

    // Generate response
    const completion = await openai.chat.completions.create({
      model: modelToUse,
      messages,
      temperature: parseFloat(process.env.TEMPERATURE) || 0.7,
      max_tokens: parseInt(process.env.MAX_TOKENS) || 2000,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    });

    const response = completion.choices[0].message.content;
    const processingTime = Date.now() - startTime;

    // Log assistant response in real-time
    chatLogger.logAssistantMessage(response, processingTime);

    logger.info(`Response generated in ${processingTime}ms`);

    res.json({
      id: uuidv4(),
      message: response,
      sources: relevantDocs.map(d => ({
        title: d.metadata?.title || 'Company Knowledge',
        url: d.metadata?.url || null,
        type: d.metadata?.type || 'general',
        relevance: Math.round(d.relevance * 100)
      })),
      processingTime
    });

  } catch (error) {
    logger.error('Chat error:', error);
    chatLogger.logError(error, 'chat');
    res.status(500).json({
      error: 'Failed to process your request. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Feedback endpoint
app.post('/api/feedback', async (req, res) => {
  const { messageId, rating, comment } = req.body;
  logger.info(`Feedback received: ${messageId} - Rating: ${rating}`);
  // Store feedback in database or file for training improvement
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────────
// Error Analysis Endpoints
// ─────────────────────────────────────────────────────────────────────────────────

// Analyze code for errors
app.post('/api/analyze-errors', async (req, res) => {
  try {
    const { code, filename, language } = req.body;

    if (!code) {
      return res.json({ errors: [] });
    }

    const analysis = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a code analyzer for ${language || 'Lua'} code, specifically for RedM/FiveM/CFX development.
Analyze the code and identify errors, warnings, and potential issues.

Output ONLY a JSON array of issues found. Each issue should have:
- "line": the line number (1-indexed)
- "severity": "error", "warning", or "info"
- "message": brief description of the issue
- "suggestion": brief suggestion to fix it (optional)

Focus on:
- Syntax errors
- Undefined variables or functions
- Common CFX/RedM API misuse
- Missing Citizen.Wait() in loops
- Event handler issues
- Performance problems (e.g., expensive operations in tick loops)
- Missing nil checks
- Incorrect native usage

If no issues found, return an empty array [].
Be practical - don't flag minor style issues.`
        },
        {
          role: 'user',
          content: `Analyze this ${language || 'Lua'} code from file "${filename}":\n\n${code}`
        }
      ],
      temperature: 0.2,
      max_tokens: 1500
    });

    let errors = [];
    try {
      const content = analysis.choices[0].message.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        errors = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      logger.warn('Failed to parse error analysis:', parseError);
    }

    res.json({ errors });
  } catch (error) {
    logger.error('Error analysis failed:', error);
    res.json({ errors: [] });
  }
});

// Fix a single error
app.post('/api/fix-error', async (req, res) => {
  try {
    const { code, filename, error: errorInfo, language } = req.body;

    if (!code || !errorInfo) {
      return res.status(400).json({ error: 'Code and error info required' });
    }

    const fix = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a code fixer for ${language || 'Lua'} code in RedM/FiveM/CFX development.
Fix the specified error in the code. Return ONLY the complete fixed code, nothing else.
Do not add comments about what you fixed. Just output the corrected code.
Preserve the original formatting and style as much as possible.`
        },
        {
          role: 'user',
          content: `Fix this error in the code:

Error on line ${errorInfo.line}: ${errorInfo.message}
${errorInfo.suggestion ? `Suggestion: ${errorInfo.suggestion}` : ''}

Code from "${filename}":
${code}`
        }
      ],
      temperature: 0.1,
      max_tokens: 4000
    });

    let fixedCode = fix.choices[0].message.content.trim();

    // Remove markdown code blocks if present
    if (fixedCode.startsWith('```')) {
      fixedCode = fixedCode.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }

    res.json({ fixedCode });
  } catch (error) {
    logger.error('Error fix failed:', error);
    res.status(500).json({ error: 'Failed to fix error' });
  }
});

// Fix all errors
app.post('/api/fix-all-errors', async (req, res) => {
  try {
    const { code, filename, errors, language } = req.body;

    if (!code || !errors || errors.length === 0) {
      return res.status(400).json({ error: 'Code and errors required' });
    }

    const errorList = errors.map(e => `- Line ${e.line}: ${e.message}${e.suggestion ? ` (Suggestion: ${e.suggestion})` : ''}`).join('\n');

    const fix = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a code fixer for ${language || 'Lua'} code in RedM/FiveM/CFX development.
Fix ALL the specified errors in the code. Return ONLY the complete fixed code, nothing else.
Do not add comments about what you fixed. Just output the corrected code.
Preserve the original formatting and style as much as possible.`
        },
        {
          role: 'user',
          content: `Fix all these errors in the code:

${errorList}

Code from "${filename}":
${code}`
        }
      ],
      temperature: 0.1,
      max_tokens: 4000
    });

    let fixedCode = fix.choices[0].message.content.trim();

    // Remove markdown code blocks if present
    if (fixedCode.startsWith('```')) {
      fixedCode = fixedCode.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }

    res.json({ fixedCode });
  } catch (error) {
    logger.error('Fix all errors failed:', error);
    res.status(500).json({ error: 'Failed to fix errors' });
  }
});

// Learning endpoint - extract learnable facts from conversation
app.post('/api/extract-learning', async (req, res) => {
  try {
    const { userMessage, assistantResponse } = req.body;

    // Use GPT to extract learnable facts from the exchange
    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a knowledge extractor. Analyze the conversation and extract any facts, corrections, or preferences the user is explicitly teaching.

Output ONLY a JSON array of learnable items. Each item should have:
- "type": one of "fact", "preference", "correction", "context"
- "content": the complete information to remember (concise, 1-2 sentences)
- "summary": a very short 5-10 word summary of what was learned
- "context": a brief explanation of how/where/why this was learned (1 sentence)
- "importance": 1-10 (10 = critical, 1 = minor)
- "relatedTopics": array of 1-3 related topic keywords
- "examples": optional array of 1-2 example use cases (if applicable)

Rules:
- Only extract explicit information the user is teaching (e.g., "Remember that...", corrections, stated preferences, technical specifications)
- Do NOT extract general conversation, questions, or small talk
- If nothing is learnable, return an empty array []
- Keep content concise but complete
- Summary should be a quick-glance description
- Context should explain the learning source/situation

Example output:
[{
  "type": "fact",
  "content": "The player's inventory limit is 50 slots, but VIP players get 75 slots",
  "summary": "Player inventory limits (50 regular, 75 VIP)",
  "context": "User specified inventory configuration for their RedM server",
  "importance": 7,
  "relatedTopics": ["inventory", "player-limits", "VIP"],
  "examples": ["Check slots before adding items", "Display remaining space in UI"]
}]`
        },
        {
          role: 'user',
          content: `User said: "${userMessage}"\n\nAssistant responded: "${assistantResponse}"\n\nExtract any learnable knowledge:`
        }
      ],
      temperature: 0.3,
      max_tokens: 800
    });

    let learnings = [];
    try {
      const content = extraction.choices[0].message.content.trim();
      // Handle markdown code blocks
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        learnings = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      logger.warn('Failed to parse learning extraction:', parseError);
    }

    res.json({ learnings });
  } catch (error) {
    logger.error('Learning extraction error:', error);
    res.json({ learnings: [] });
  }
});

// Security: Path validation for execute-actions
const BLOCKED_PATHS = ['.env', '.git', 'node_modules', '.ssh', '.aws', '.config', 'credentials', 'secrets'];
const BLOCKED_EXTENSIONS = ['.pem', '.key', '.crt', '.p12', '.pfx', '.env', '.secrets'];

const isPathSafe = (filePath) => {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = path.normalize(filePath).toLowerCase();

  // Check for path traversal
  if (normalized.includes('..')) return false;

  // Check for blocked paths
  for (const blocked of BLOCKED_PATHS) {
    if (normalized.includes(blocked.toLowerCase())) return false;
  }

  // Check for blocked extensions
  const ext = path.extname(normalized).toLowerCase();
  if (BLOCKED_EXTENSIONS.includes(ext)) return false;

  return true;
};

// Execute file actions from AI responses
app.post('/api/execute-actions', async (req, res) => {
  try {
    const { actions } = req.body;

    if (!actions || !Array.isArray(actions)) {
      return res.json({ results: [], error: 'No actions provided' });
    }

    // Limit number of actions per request
    if (actions.length > 50) {
      return res.status(400).json({ error: 'Too many actions. Maximum 50 per request.' });
    }

    const results = [];

    for (const action of actions) {
      try {
        // Security: Validate path
        if (!isPathSafe(action.path)) {
          results.push({
            action: action.action,
            path: action.path,
            success: false,
            error: 'Access denied: Invalid or blocked path'
          });
          logger.warn(`Blocked action on unsafe path: ${action.path}`);
          continue;
        }

        if (action.action === 'create_file') {
          // Ensure parent directory exists
          const parentDir = path.dirname(action.path);
          await fs.mkdir(parentDir, { recursive: true });
          await fs.writeFile(action.path, action.content || '', 'utf-8');
          results.push({
            action: 'create_file',
            path: action.path,
            success: true,
            message: `Created file: ${action.path}`
          });
          logger.info(`Created file: ${action.path}`);
        } else if (action.action === 'create_folder') {
          await fs.mkdir(action.path, { recursive: true });
          results.push({
            action: 'create_folder',
            path: action.path,
            success: true,
            message: `Created folder: ${action.path}`
          });
          logger.info(`Created folder: ${action.path}`);
        } else if (action.action === 'read_file') {
          const content = await fs.readFile(action.path, 'utf-8');
          results.push({
            action: 'read_file',
            path: action.path,
            success: true,
            message: `Read file: ${action.path}`,
            content: content.slice(0, 10000) // Limit content size
          });
          logger.info(`Read file: ${action.path}`);
        } else if (action.action === 'delete_file') {
          await fs.unlink(action.path);
          results.push({
            action: 'delete_file',
            path: action.path,
            success: true,
            message: `Deleted file: ${action.path}`
          });
          logger.info(`Deleted file: ${action.path}`);
        } else if (action.action === 'list_directory') {
          const items = await fs.readdir(action.path, { withFileTypes: true });
          const listing = items.map(item => ({
            name: item.name,
            type: item.isDirectory() ? 'folder' : 'file'
          }));
          results.push({
            action: 'list_directory',
            path: action.path,
            success: true,
            message: `Listed ${items.length} items in: ${action.path}`,
            items: listing
          });
          logger.info(`Listed directory: ${action.path}`);
        } else if (action.action === 'zip_folder') {
          // Dynamic import for archiver
          const archiver = (await import('archiver')).default;
          const outputPath = action.outputPath || `${action.path}.zip`;
          const output = (await import('fs')).createWriteStream(outputPath);
          const archive = archiver('zip', { zlib: { level: 9 } });

          await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(action.path, false);
            archive.finalize();
          });

          results.push({
            action: 'zip_folder',
            path: action.path,
            outputPath: outputPath,
            success: true,
            message: `Zipped folder to: ${outputPath}`
          });
          logger.info(`Zipped folder: ${action.path} -> ${outputPath}`);
        } else if (action.action === 'copy_file') {
          const destDir = path.dirname(action.destination);
          await fs.mkdir(destDir, { recursive: true });
          await fs.copyFile(action.path, action.destination);
          results.push({
            action: 'copy_file',
            path: action.path,
            destination: action.destination,
            success: true,
            message: `Copied file to: ${action.destination}`
          });
          logger.info(`Copied file: ${action.path} -> ${action.destination}`);
        } else if (action.action === 'move_file') {
          const destDir = path.dirname(action.destination);
          await fs.mkdir(destDir, { recursive: true });
          await fs.rename(action.path, action.destination);
          results.push({
            action: 'move_file',
            path: action.path,
            destination: action.destination,
            success: true,
            message: `Moved file to: ${action.destination}`
          });
          logger.info(`Moved file: ${action.path} -> ${action.destination}`);
        } else if (action.action === 'append_file') {
          await fs.appendFile(action.path, action.content || '');
          results.push({
            action: 'append_file',
            path: action.path,
            success: true,
            message: `Appended to file: ${action.path}`
          });
          logger.info(`Appended to file: ${action.path}`);
        } else {
          results.push({
            action: action.action,
            success: false,
            error: `Unknown action: ${action.action}`
          });
        }
      } catch (error) {
        results.push({
          action: action.action,
          path: action.path,
          success: false,
          error: error.message
        });
        logger.error(`Action failed: ${action.action} - ${error.message}`);
      }
    }

    res.json({ results });
  } catch (error) {
    logger.error('Execute actions error:', error);
    res.status(500).json({ error: 'Failed to execute actions' });
  }
});

// Knowledge stats endpoint - Brain count is ONLY from chat learnings, NOT manual training
app.get('/api/stats', async (req, res) => {
  try {
    const totalDocuments = table ? await table.countRows() : 0;
    const manualFilesCount = manualWatcher.getProcessedFilesCount();

    // Get chat learnings count from training database
    let brainCount = 0;
    try {
      const trainingDbPath = path.join(__dirname, '..', 'data', 'training.db');
      if (existsSync(trainingDbPath)) {
        const Database = (await import('better-sqlite3')).default;
        const trainingDb = new Database(trainingDbPath, { readonly: true });
        // Check if table exists first
        const tableExists = trainingDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_learnings'").get();
        if (tableExists) {
          const result = trainingDb.prepare('SELECT SUM(chunks_created) as total FROM chat_learnings WHERE is_trained = 1').get();
          brainCount = result?.total || 0;
        }
        trainingDb.close();
      }
    } catch (e) {
      // Chat learnings table might not exist yet
      logger.debug('Chat learnings stats not available:', e.message);
    }

    res.json({
      documentCount: totalDocuments,
      brainCount: brainCount, // Only chat learnings count toward brain
      manualFilesLearned: manualFilesCount,
      manualTrainingChunks: totalDocuments - brainCount, // Everything else is manual training
      status: table ? 'ready' : 'not_initialized',
      company: process.env.COMPANY_NAME
    });
  } catch (error) {
    logger.error('Stats endpoint error:', error);
    res.json({ documentCount: 0, brainCount: 0, status: 'error' });
  }
});

// Manual watcher stats endpoint
app.get('/api/manual-learning/stats', (req, res) => {
  try {
    const processedFiles = manualWatcher.getAllProcessedFiles();
    res.json({
      totalFilesLearned: processedFiles.length,
      files: processedFiles.map(f => ({
        filename: f.filename,
        title: f.title,
        description: f.description,
        contentSummary: f.content_summary,
        chunksCreated: f.chunks_created,
        processedAt: f.processed_at
      }))
    });
  } catch (error) {
    logger.error('Manual learning stats error:', error);
    res.json({ totalFilesLearned: 0, files: [] });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
// IDE Routes
// ─────────────────────────────────────────────────────────────────────────────────
app.use('/api/files', filesystemRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/chat-sessions', chatSessionsRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/drive', driveRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// Global Error Handler Middleware
// Note: Process-level error handlers are managed by processManager
// ─────────────────────────────────────────────────────────────────────────────────

// Global error handler middleware
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────────────────────────────────────────
// Start Server with WebSocket Support
// ─────────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

async function start() {
  // Initialize process manager for graceful shutdown
  processManager.initialize();

  // Validate API key on startup
  const apiKeyStatus = await validateOnStartup(logger);
  if (!apiKeyStatus.valid && apiKeyStatus.fatal) {
    logger.error('═══════════════════════════════════════════════════════════════');
    logger.error('  FATAL: Cannot start server without valid OpenAI API key');
    logger.error('  Please configure OPENAI_API_KEY in your .env file');
    logger.error('  Get your key at: https://platform.openai.com/api-keys');
    logger.error('═══════════════════════════════════════════════════════════════');
    process.exit(1);
  }

  // Ensure upload directories exist
  const dataDir = path.join(__dirname, '..', 'data');
  await fs.mkdir(path.join(dataDir, 'uploads'), { recursive: true }).catch(() => {});
  await fs.mkdir(path.join(dataDir, 'temp_uploads'), { recursive: true }).catch(() => {});

  // Clean up any stale temp files from previous runs
  await cleanupStaleTempFiles(dataDir).catch(err => logger.warn('Temp cleanup warning:', err.message));

  // Initialize backup service
  await backupService.initialize().catch(err => logger.warn('Backup service init warning:', err.message));

  // Initialize email service
  await emailService.initialize().catch(err => logger.warn('Email service init warning:', err.message));

  await initLanceDB().catch(err => logger.warn('LanceDB init failed:', err.message));

  // Check library data integrity and auto-restore from backup if needed
  await libraryBackup.checkAndRestoreOnStartup().catch(err => logger.warn('Library backup check warning:', err.message));

  // Start manual folder watcher for auto-learning
  await manualWatcher.startWatcher().catch(err => logger.warn('Manual watcher init warning:', err.message));
  processManager.registerCleanupCallback('manualWatcher', () => manualWatcher.stopWatcher());

  // Register database with process manager
  if (db) {
    processManager.registerDatabase(db);
  }

  // Create HTTP server
  const server = http.createServer(app);
  processManager.registerServer(server);

  // Setup WebSocket for terminal (disabled in cloud/web deployments via DISABLE_TERMINAL=true)
  if (!process.env.DISABLE_TERMINAL) {
    try {
      const wss = setupTerminalWebSocket(server);
      if (wss) {
        processManager.registerWebSocketServer(wss);
      }
    } catch (err) {
      logger.warn('Terminal WebSocket unavailable (node-pty may not be installed):', err.message);
    }
  } else {
    logger.info('Terminal WebSocket disabled (DISABLE_TERMINAL=true)');
  }

  server.listen(PORT, () => {
    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info(`  🤖 ${process.env.COMPANY_NAME || 'Company'} Chatbot Server`);
    logger.info(`  📡 Running on http://localhost:${PORT}`);
    logger.info(`  🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`  💻 Terminal WebSocket: ${process.env.DISABLE_TERMINAL ? 'Disabled' : `ws://localhost:${PORT}/terminal`}`);
    logger.info(`  🛡️  Process manager: Active (graceful shutdown enabled)`);
    logger.info(`  💾 Backup service: Active (auto-restore enabled)`);
    logger.info(`  📝 Chat logger: Active (real-time logging to txt)`);
    logger.info(`  📂 Manual watcher: Active (auto-learning .txt files)`);
    logger.info(`  ✉️  Email service: ${emailService.isConnected() ? 'Connected (' + emailService.emailSettings.gmailEmail + ')' : 'Not connected'}`);
    logger.info('═══════════════════════════════════════════════════════════════');
  });
}

start().catch(console.error);
