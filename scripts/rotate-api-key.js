#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════════════════
// API KEY ROTATION HELPER
// Assists with safely rotating the OpenAI API key
// ═══════════════════════════════════════════════════════════════════════════════

import { config } from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load current env
const envPath = path.join(__dirname, '..', '.env');
config({ path: envPath });

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

async function testApiKey(apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    return response.ok;
  } catch {
    return false;
  }
}

function maskKey(key) {
  if (!key || key.length < 15) return '(not set)';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║              OpenAI API Key Rotation Helper                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const currentKey = process.env.OPENAI_API_KEY;
  console.log(`Current API Key: ${maskKey(currentKey)}`);

  if (currentKey) {
    console.log('Testing current key...');
    const isValid = await testApiKey(currentKey);
    console.log(`Current key status: ${isValid ? '✓ Valid' : '✗ Invalid/Revoked'}\n`);
  }

  console.log('To rotate your API key:');
  console.log('1. Go to: https://platform.openai.com/api-keys');
  console.log('2. Click "Create new secret key"');
  console.log('3. Copy the new key\n');

  const newKey = await question('Paste your NEW API key (or press Enter to cancel): ');

  if (!newKey.trim()) {
    console.log('\nCancelled. No changes made.');
    rl.close();
    return;
  }

  // Validate format
  if (!newKey.startsWith('sk-')) {
    console.log('\n✗ Invalid key format. OpenAI keys start with "sk-"');
    rl.close();
    return;
  }

  // Test new key
  console.log('\nTesting new key...');
  const isNewKeyValid = await testApiKey(newKey.trim());

  if (!isNewKeyValid) {
    console.log('✗ New key validation failed. Please check the key and try again.');
    rl.close();
    return;
  }

  console.log('✓ New key is valid!\n');

  // Update .env file
  try {
    let envContent = await readFile(envPath, 'utf-8');

    // Replace the API key line
    envContent = envContent.replace(
      /^OPENAI_API_KEY=.*/m,
      `OPENAI_API_KEY=${newKey.trim()}`
    );

    await writeFile(envPath, envContent, 'utf-8');
    console.log('✓ .env file updated successfully!\n');

    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║                    IMPORTANT NEXT STEPS                          ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log('║                                                                  ║');
    console.log('║  1. RESTART the server to use the new key                        ║');
    console.log('║                                                                  ║');
    console.log('║  2. REVOKE the old key in OpenAI dashboard:                      ║');
    console.log('║     https://platform.openai.com/api-keys                         ║');
    console.log('║     Look for: ' + maskKey(currentKey).padEnd(38) + '║');
    console.log('║                                                                  ║');
    console.log('║  3. VERIFY the server starts correctly with new key              ║');
    console.log('║                                                                  ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.log(`✗ Failed to update .env file: ${error.message}`);
  }

  rl.close();
}

main().catch(console.error);
