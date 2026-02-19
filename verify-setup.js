// ═══════════════════════════════════════════════════════════════════════════════
// SETUP VERIFICATION
// Run this to check if everything is configured correctly
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from 'dotenv';
import { OpenAI } from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '.env') });

async function verify() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🔍 SETUP VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let allGood = true;
  
  // Check .env exists
  try {
    await fs.access(path.join(__dirname, '.env'));
    console.log('✅ .env file exists');
  } catch {
    console.log('❌ .env file not found - copy .env.example to .env');
    allGood = false;
  }
  
  // Check OpenAI API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes('your_') || apiKey.length < 20) {
    console.log('❌ OPENAI_API_KEY not set or invalid');
    allGood = false;
  } else {
    // Test API key
    try {
      const openai = new OpenAI({ apiKey });
      await openai.models.list();
      console.log('✅ OpenAI API key is valid');
    } catch (error) {
      console.log('❌ OpenAI API key is invalid:', error.message);
      allGood = false;
    }
  }
  
  // Check company config
  if (process.env.COMPANY_NAME && !process.env.COMPANY_NAME.includes('Acme')) {
    console.log(`✅ Company name: ${process.env.COMPANY_NAME}`);
  } else {
    console.log('⚠️ COMPANY_NAME not customized (using default)');
  }
  
  if (process.env.COMPANY_WEBSITE && !process.env.COMPANY_WEBSITE.includes('example.com')) {
    console.log(`✅ Company website: ${process.env.COMPANY_WEBSITE}`);
  } else {
    console.log('⚠️ COMPANY_WEBSITE not set - scraping will fail');
    allGood = false;
  }
  
  // Check data directories
  const dataDir = path.join(__dirname, 'data');
  try {
    await fs.access(dataDir);
    console.log('✅ Data directory exists');
  } catch {
    console.log('⚠️ Data directory not initialized - run: npm run init-db');
  }
  
  // Check for scraped data
  try {
    const scraped = await fs.readFile(path.join(dataDir, 'scraped', 'scraped_data.json'), 'utf-8');
    const data = JSON.parse(scraped);
    console.log(`✅ Scraped data: ${data.length} documents`);
  } catch {
    console.log('ℹ️ No scraped data yet - run: npm run scrape');
  }
  
  // Check node_modules
  try {
    await fs.access(path.join(__dirname, 'node_modules'));
    console.log('✅ Dependencies installed');
  } catch {
    console.log('❌ Dependencies not installed - run: npm run setup');
    allGood = false;
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  if (allGood) {
    console.log('  ✅ ALL CHECKS PASSED - Ready to go!');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Next steps:');
    console.log('  1. npm run scrape  (collect company data)');
    console.log('  2. npm run train   (train the AI)');
    console.log('  3. npm run dev     (start chatbot)');
  } else {
    console.log('  ❌ SOME CHECKS FAILED - Fix the issues above');
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

verify().catch(console.error);
