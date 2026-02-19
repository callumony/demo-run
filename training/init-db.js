// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE INITIALIZATION
// Initialize LanceDB for the chatbot
// ═══════════════════════════════════════════════════════════════════════════════

import * as lancedb from '@lancedb/lancedb';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '..', '.env') });

async function initDB() {
  console.log('🗄️ Initializing database...\n');

  const dataDir = path.join(__dirname, '..', 'data');
  const lanceDir = path.join(dataDir, 'lancedb');
  const manualDir = path.join(dataDir, 'manual');
  const logsDir = path.join(__dirname, '..', 'logs');

  // Create directories
  await fs.mkdir(lanceDir, { recursive: true });
  await fs.mkdir(manualDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  console.log('✅ Created data directories');

  // Create sample manual data file
  const sampleData = {
    "instructions": "Add your company information here as JSON objects or create .txt/.md files",
    "example": {
      "title": "Company Overview",
      "content": "Your company description here...",
      "type": "manual"
    }
  };

  await fs.writeFile(
    path.join(manualDir, '_README.json'),
    JSON.stringify(sampleData, null, 2)
  );

  console.log('✅ Created sample manual data template');

  // Test LanceDB connection
  try {
    const db = await lancedb.connect(lanceDir);
    console.log('✅ LanceDB connection successful');
  } catch (error) {
    console.log('⚠️ LanceDB will be initialized on first use');
  }

  console.log('\n✅ Database initialization complete!');
  console.log('\nNext steps:');
  console.log('1. Copy .env.example to .env and configure');
  console.log('2. Add training data via the Library (upload/paste files)');
  console.log('3. Run: npm run dev (to start the chatbot)\n');
}

initDB().catch(console.error);
