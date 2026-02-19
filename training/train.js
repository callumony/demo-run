// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY CHATBOT TRAINING PIPELINE
// Process manual data, generate embeddings, and store in vector database
// ═══════════════════════════════════════════════════════════════════════════════

import { OpenAI } from 'openai';
import * as lancedb from '@lancedb/lancedb';
import { config } from 'dotenv';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '..', '.env') });

// ─────────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  companyName: process.env.COMPANY_NAME || 'Company',
  lanceDbPath: process.env.LANCEDB_PATH || './data/lancedb',
  tableName: process.env.COLLECTION_NAME || 'company_knowledge',
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  chunkSize: 1000,      // Characters per chunk
  chunkOverlap: 200,    // Overlap between chunks
  batchSize: 50         // Embeddings per API call
};

const DATA_DIR = path.join(__dirname, '..', 'data');
const MANUAL_DIR = path.join(DATA_DIR, 'manual');

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────────

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

function chunkText(text, maxChunkSize = CONFIG.chunkSize, overlap = CONFIG.chunkOverlap) {
  const chunks = [];
  
  if (!text || text.length === 0) return chunks;
  
  // Split by paragraphs first
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    // If adding this paragraph exceeds chunk size, save current and start new
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap from end of previous
      const overlapStart = Math.max(0, currentChunk.length - overlap);
      currentChunk = currentChunk.slice(overlapStart) + '\n\n' + paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.filter(c => c.length > 50); // Filter out tiny chunks
}

async function getEmbeddings(texts) {
  const response = await openai.embeddings.create({
    model: CONFIG.embeddingModel,
    input: texts.map(t => t.slice(0, 8000)) // Limit input length
  });
  
  return response.data.map(d => d.embedding);
}

// ─────────────────────────────────────────────────────────────────────────────────
// Data Loading
// ─────────────────────────────────────────────────────────────────────────────────

// Helper to read gzipped JSON files
async function readGzippedJson(filePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const gunzip = createGunzip();
    const stream = createReadStream(filePath).pipe(gunzip);

    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => {
      try {
        const content = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(content));
      } catch (e) {
        reject(e);
      }
    });
    stream.on('error', reject);
  });
}

async function loadManualData() {
  const manualDocs = [];

  try {
    const files = await fs.readdir(MANUAL_DIR);

    for (const file of files) {
      // Support .json, .json.gz, .txt, .md files
      const isJson = file.endsWith('.json');
      const isGzippedJson = file.endsWith('.json.gz');
      const isText = file.endsWith('.txt') || file.endsWith('.md');

      if (!isJson && !isGzippedJson && !isText) {
        continue;
      }

      const filePath = path.join(MANUAL_DIR, file);

      if (isGzippedJson) {
        // Handle gzipped JSON (optimized large datasets)
        try {
          log('📦', `Loading compressed: ${file}`);
          const data = await readGzippedJson(filePath);

          // Handle dataset format with 'examples' array
          if (data.examples && Array.isArray(data.examples)) {
            log('📊', `Found ${data.examples.length} examples in ${file}`);
            manualDocs.push(...data.examples);
          } else if (Array.isArray(data)) {
            manualDocs.push(...data);
          } else {
            manualDocs.push(data);
          }
        } catch (e) {
          log('⚠️', `Failed to parse ${file}: ${e.message}`);
        }
      } else if (isJson) {
        // Handle regular JSON
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);

          // Handle dataset format with 'examples' array
          if (data.examples && Array.isArray(data.examples)) {
            log('📊', `Found ${data.examples.length} examples in ${file}`);
            manualDocs.push(...data.examples);
          } else if (Array.isArray(data)) {
            manualDocs.push(...data);
          } else {
            manualDocs.push(data);
          }
        } catch (e) {
          log('⚠️', `Failed to parse ${file}: ${e.message}`);
        }
      } else {
        // Text or markdown file
        const content = await fs.readFile(filePath, 'utf-8');
        manualDocs.push({
          content,
          title: file.replace(/\.(txt|md)$/, ''),
          type: 'manual',
          source: file
        });
      }
    }
  } catch (error) {
    // Manual directory might not exist
  }

  return manualDocs;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Document Processing
// ─────────────────────────────────────────────────────────────────────────────────

function processDocuments(documents) {
  const processedChunks = [];
  
  for (const doc of documents) {
    const content = doc.content || doc.text || '';
    
    if (!content || content.length < 50) continue;
    
    // Create context header for each chunk
    const contextParts = [
      doc.title && `Title: ${doc.title}`,
      doc.type && `Type: ${doc.type}`,
      doc.url && `Source: ${doc.url}`
    ].filter(Boolean);
    
    const contextHeader = contextParts.length > 0 
      ? contextParts.join(' | ') + '\n\n' 
      : '';
    
    // Chunk the content
    const chunks = chunkText(content);
    
    for (let i = 0; i < chunks.length; i++) {
      processedChunks.push({
        id: uuidv4(),
        text: contextHeader + chunks[i],
        metadata: {
          title: doc.title || 'Untitled',
          url: doc.url || null,
          type: doc.type || 'general',
          source: doc.source || 'website',
          chunkIndex: i,
          totalChunks: chunks.length,
          crawledAt: doc.crawledAt || new Date().toISOString()
        }
      });
    }
  }
  
  return processedChunks;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Vector Database Operations
// ─────────────────────────────────────────────────────────────────────────────────

async function initializeVectorDB() {
  // Ensure the directory exists
  const dbPath = path.resolve(DATA_DIR, 'lancedb');
  await fs.mkdir(dbPath, { recursive: true });

  // Connect to LanceDB (creates if doesn't exist)
  const db = await lancedb.connect(dbPath);

  // Drop existing table to start fresh
  try {
    await db.dropTable(CONFIG.tableName);
    log('🗑️', 'Cleared existing table');
  } catch (e) {
    // Table might not exist
  }

  return db;
}

async function addToVectorDB(db, chunks) {
  const totalBatches = Math.ceil(chunks.length / CONFIG.batchSize);
  let table = null;

  for (let i = 0; i < chunks.length; i += CONFIG.batchSize) {
    const batch = chunks.slice(i, i + CONFIG.batchSize);
    const batchNum = Math.floor(i / CONFIG.batchSize) + 1;

    log('🔄', `Processing batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);

    try {
      // Generate embeddings
      const embeddings = await getEmbeddings(batch.map(c => c.text));

      // Prepare records for LanceDB
      const records = batch.map((chunk, idx) => ({
        id: chunk.id,
        text: chunk.text,
        vector: embeddings[idx],
        title: chunk.metadata.title,
        url: chunk.metadata.url || '',
        type: chunk.metadata.type,
        source: chunk.metadata.source,
        chunkIndex: chunk.metadata.chunkIndex,
        totalChunks: chunk.metadata.totalChunks,
        crawledAt: chunk.metadata.crawledAt
      }));

      // Create table on first batch, add to it on subsequent batches
      if (table === null) {
        table = await db.createTable(CONFIG.tableName, records);
      } else {
        await table.add(records);
      }

      log('✅', `Batch ${batchNum} complete`);

    } catch (error) {
      log('❌', `Error in batch ${batchNum}: ${error.message}`);
      // Continue with next batch
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  return table;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Main Training Function
// ─────────────────────────────────────────────────────────────────────────────────

async function train() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  🧠 TRAINING CHATBOT - ${CONFIG.companyName}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // Validate OpenAI API key
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('your_')) {
    log('❌', 'ERROR: Please set a valid OPENAI_API_KEY in your .env file');
    process.exit(1);
  }
  
  // Step 1: Load all data
  log('📂', 'Loading data...');

  const manualData = await loadManualData();
  log('📝', `Loaded ${manualData.length} manual documents`);

  if (manualData.length === 0) {
    log('⚠️', 'No data to process! Add training data via the Library (upload/paste files).');
    process.exit(1);
  }

  const allData = manualData;
  
  // Step 2: Process into chunks
  log('✂️', 'Processing and chunking documents...');
  const chunks = processDocuments(allData);
  log('📊', `Created ${chunks.length} chunks`);
  
  // Step 3: Initialize vector database
  log('🗄️', 'Initializing vector database (LanceDB)...');
  const db = await initializeVectorDB();

  // Step 4: Generate embeddings and store
  log('🔮', 'Generating embeddings and storing...');
  const table = await addToVectorDB(db, chunks);

  // Step 5: Verify
  const count = await table.countRows();
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅ TRAINING COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  📊 Total chunks in database: ${count}`);
  console.log(`  🏢 Company: ${CONFIG.companyName}`);
  console.log(`  📁 Table: ${CONFIG.tableName}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Next step: npm run dev');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Run if called directly
train().catch(console.error);

export { train, processDocuments, chunkText };
