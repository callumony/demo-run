// ═══════════════════════════════════════════════════════════════════════════════
// API KEY MANAGER
// Utilities for validating and managing API keys securely
// ═══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────────
// Key Validation
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate OpenAI API key format
 * Does NOT make an API call - just checks format
 */
export function isValidKeyFormat(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return false;

  // OpenAI keys start with 'sk-' and are typically 51+ characters
  // Project keys start with 'sk-proj-'
  const patterns = [
    /^sk-[a-zA-Z0-9]{48,}$/,           // Standard key format
    /^sk-proj-[a-zA-Z0-9-_]{80,}$/     // Project key format (newer)
  ];

  return patterns.some(pattern => pattern.test(apiKey));
}

/**
 * Check if the API key appears to be a placeholder
 */
export function isPlaceholderKey(apiKey) {
  if (!apiKey) return true;

  const placeholders = [
    'sk-your-api-key-here',
    'sk-xxx',
    'sk-test',
    'your_openai_api_key',
    'OPENAI_API_KEY',
    'sk-proj-xxx'
  ];

  const lowerKey = apiKey.toLowerCase();
  return placeholders.some(p => lowerKey.includes(p.toLowerCase()));
}

/**
 * Test if an OpenAI API key is valid by making a minimal API call
 */
export async function testApiKey(apiKey) {
  if (!apiKey || isPlaceholderKey(apiKey)) {
    return { valid: false, error: 'API key is missing or is a placeholder' };
  }

  if (!isValidKeyFormat(apiKey)) {
    return { valid: false, error: 'API key format is invalid' };
  }

  try {
    // Make a minimal API call to test the key
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return { valid: true };
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      return { valid: false, error: 'API key is invalid or revoked' };
    }

    if (response.status === 429) {
      return { valid: true, warning: 'Rate limited - key is valid but quota may be exceeded' };
    }

    return { valid: false, error: data.error?.message || `API returned status ${response.status}` };
  } catch (error) {
    return { valid: false, error: `Connection error: ${error.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Key Obfuscation (for logging/display)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Mask an API key for safe logging/display
 * Shows first 7 and last 4 characters only
 */
export function maskApiKey(apiKey) {
  if (!apiKey || apiKey.length < 15) return '***invalid***';
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}

/**
 * Generate a hash of the API key for comparison
 * Useful for checking if key changed without storing the actual key
 */
export function hashApiKey(apiKey) {
  if (!apiKey) return null;
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────────
// Startup Validation
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Validate API key on server startup
 * Returns detailed status for logging
 */
export async function validateOnStartup(logger) {
  const apiKey = process.env.OPENAI_API_KEY;

  logger.info('🔑 Validating OpenAI API key...');

  if (!apiKey) {
    logger.error('❌ OPENAI_API_KEY is not set in .env file');
    return { valid: false, fatal: true };
  }

  if (isPlaceholderKey(apiKey)) {
    logger.error('❌ OPENAI_API_KEY appears to be a placeholder. Please set a real API key.');
    return { valid: false, fatal: true };
  }

  if (!isValidKeyFormat(apiKey)) {
    logger.warn('⚠️  OPENAI_API_KEY format looks unusual. Attempting to validate...');
  }

  const result = await testApiKey(apiKey);

  if (result.valid) {
    logger.info(`✓ OpenAI API key validated (${maskApiKey(apiKey)})`);
    if (result.warning) {
      logger.warn(`⚠️  ${result.warning}`);
    }
    return { valid: true, keyHash: hashApiKey(apiKey) };
  } else {
    logger.error(`❌ OpenAI API key validation failed: ${result.error}`);
    logger.error('   Please check your API key at: https://platform.openai.com/api-keys');
    return { valid: false, fatal: false, error: result.error };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Security Recommendations
// ─────────────────────────────────────────────────────────────────────────────────

export const SECURITY_RECOMMENDATIONS = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                        API KEY SECURITY RECOMMENDATIONS                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  1. NEVER commit .env files to version control                               ║
║     - Use .env.example as a template                                         ║
║     - Add .env to .gitignore                                                 ║
║                                                                              ║
║  2. ROTATE your API key if it may have been exposed                          ║
║     - Go to: https://platform.openai.com/api-keys                            ║
║     - Create a new key                                                       ║
║     - Update .env with the new key                                           ║
║     - Delete/revoke the old key                                              ║
║                                                                              ║
║  3. USE environment-specific keys                                            ║
║     - Development: Use a separate key with lower limits                      ║
║     - Production: Use a dedicated key with monitoring                        ║
║                                                                              ║
║  4. SET UP usage limits in OpenAI dashboard                                  ║
║     - Set monthly spending limits                                            ║
║     - Enable usage alerts                                                    ║
║                                                                              ║
║  5. MONITOR your API usage regularly                                         ║
║     - Check for unexpected usage spikes                                      ║
║     - Review request patterns                                                ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

export default {
  isValidKeyFormat,
  isPlaceholderKey,
  testApiKey,
  maskApiKey,
  hashApiKey,
  validateOnStartup,
  SECURITY_RECOMMENDATIONS
};
