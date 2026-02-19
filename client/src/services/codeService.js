const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ═══════════════════════════════════════════════════════════════════════════════
// CODE ANALYSIS SERVICES
// AI-powered code review, debugging, and analysis for RedM/FiveM development
// ═══════════════════════════════════════════════════════════════════════════════

// Helper function for AI chat requests
async function aiRequest(message) {
  const response = await fetch(`${API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationHistory: [] })
  });
  if (!response.ok) throw new Error('Server unavailable');
  const data = await response.json();
  return data.message;
}

// Wrapper for AI requests with error handling
async function safeAiRequest(message) {
  try {
    const result = await aiRequest(message);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Syntax check using the AI
export async function checkSyntax(code, language = 'lua') {
  return safeAiRequest(
    `Please check the following ${language} code for syntax errors. List any errors found with line numbers, or confirm if the code is syntactically correct:\n\n\`\`\`${language}\n${code}\n\`\`\``
  );
}

// Security check using the AI
export async function checkSecurity(code, language = 'lua') {
  return safeAiRequest(
    `Please analyze the following ${language} code for security vulnerabilities, especially for RedM/FiveM server scripts. Check for:\n- SQL injection risks\n- Insecure event handlers\n- Client-side exploits\n- Data validation issues\n- Permission bypasses\n\n\`\`\`${language}\n${code}\n\`\`\``
  );
}

// Code review using the AI
export async function reviewCode(code, language = 'lua') {
  return safeAiRequest(
    `Please review the following ${language} code and provide suggestions for:\n- Code quality improvements\n- Best practices\n- Performance optimizations\n- Readability enhancements\n- RedM/FiveM specific recommendations\n\n\`\`\`${language}\n${code}\n\`\`\``
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED DEBUGGING CAPABILITIES
// ═══════════════════════════════════════════════════════════════════════════════

// Debug analysis - identify bugs and issues
export async function debugCode(code, language = 'lua', errorMessage = null) {
  let prompt = `Please analyze the following ${language} code for bugs and issues.`;
  if (errorMessage) {
    prompt += `\n\nThe user is experiencing this error:\n${errorMessage}`;
  }
  prompt += `\n\nProvide:\n1. Identified bugs with line numbers\n2. Potential causes of issues\n3. Suggested fixes with code examples\n4. Common pitfalls in this code pattern\n\n\`\`\`${language}\n${code}\n\`\`\``;
  return safeAiRequest(prompt);
}

// Performance analysis
export async function analyzePerformance(code, language = 'lua') {
  return safeAiRequest(`Analyze the performance of this ${language} code for RedM/FiveM:

\`\`\`${language}
${code}
\`\`\`

Check for:
1. **Expensive operations in loops** - natives called too frequently
2. **Memory leaks** - entities not deleted, tables growing unbounded
3. **Thread blocking** - missing Wait() or Citizen.Wait() calls
4. **Inefficient patterns** - unnecessary table iterations, string concatenations
5. **Network overhead** - excessive events, large payloads
6. **Optimization suggestions** - caching, pooling, debouncing

Rate the performance impact: LOW / MEDIUM / HIGH
Provide specific line numbers and optimized alternatives.`);
}

// Full code audit
export async function fullCodeAudit(code, language = 'lua', fileName = '') {
  return safeAiRequest(`Perform a comprehensive code audit on this ${language} file${fileName ? ` (${fileName})` : ''}:

\`\`\`${language}
${code}
\`\`\`

Provide a detailed report with:

## 📋 Summary
- Overall code quality rating (1-10)
- Main strengths and weaknesses

## 🐛 Bugs & Errors
- Syntax errors
- Logic errors
- Runtime issues

## 🔒 Security Analysis
- Vulnerability assessment
- Risk level for each issue

## ⚡ Performance Review
- Bottlenecks identified
- Optimization opportunities

## 📝 Code Quality
- Naming conventions
- Code organization
- Documentation/comments

## ✅ Recommendations
- Priority fixes (HIGH/MEDIUM/LOW)
- Suggested improvements with code examples`);
}

// Workspace-wide analysis
export async function analyzeWorkspace(files) {
  const fileSummaries = files.map(f => {
    const preview = f.content?.slice(0, 1000) || '';
    return `### ${f.name}\n${preview}${preview.length >= 1000 ? '...' : ''}`;
  }).join('\n\n---\n\n');

  return safeAiRequest(`Analyze this RedM/FiveM resource workspace:

${fileSummaries}

Provide:
1. **Resource Overview** - What does this resource do?
2. **Architecture Assessment** - Is the structure good?
3. **Cross-file Issues** - Dependencies, circular references
4. **Missing Components** - What might be needed?
5. **Overall Health Score** (1-10)

Focus on the big picture, not line-by-line analysis.`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOD STRUCTURE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

// Validate RedM mod structure
export async function validateModStructure(fileTree) {
  const requiredFiles = ['fxmanifest.lua', '__resource.lua'];
  const issues = [];
  const suggestions = [];

  // Check for manifest file
  const hasManifest = fileTree.some(f =>
    requiredFiles.includes(f.name?.toLowerCase())
  );

  if (!hasManifest) {
    issues.push('Missing fxmanifest.lua or __resource.lua - required for RedM resources');
  }

  // Check for common structure
  const hasClientFolder = fileTree.some(f => f.name?.toLowerCase() === 'client' && f.type === 'directory');
  const hasServerFolder = fileTree.some(f => f.name?.toLowerCase() === 'server' && f.type === 'directory');
  const hasSharedFolder = fileTree.some(f => f.name?.toLowerCase() === 'shared' && f.type === 'directory');

  if (!hasClientFolder && !hasServerFolder) {
    suggestions.push('Consider organizing code into client/ and server/ folders');
  }

  if (!hasSharedFolder) {
    suggestions.push('Consider adding a shared/ folder for common utilities');
  }

  // Check for NUI
  const hasHtmlFolder = fileTree.some(f =>
    ['html', 'nui', 'ui', 'web'].includes(f.name?.toLowerCase()) && f.type === 'directory'
  );

  // Check for common files
  const hasConfig = fileTree.some(f =>
    ['config.lua', 'config.json', 'settings.lua'].includes(f.name?.toLowerCase())
  );

  if (!hasConfig) {
    suggestions.push('Consider adding a config.lua for customizable settings');
  }

  // Check for README
  const hasReadme = fileTree.some(f =>
    f.name?.toLowerCase().includes('readme')
  );

  if (!hasReadme) {
    suggestions.push('Consider adding a README.md for documentation');
  }

  return {
    valid: issues.length === 0,
    issues,
    suggestions,
    hasNUI: hasHtmlFolder,
    structure: {
      hasManifest,
      hasClientFolder,
      hasServerFolder,
      hasSharedFolder,
      hasConfig,
      hasReadme
    }
  };
}

// Generate fxmanifest.lua content
export function generateManifest(resourceName, options = {}) {
  const {
    author = 'Unknown',
    description = '',
    version = '1.0.0',
    clientScripts = [],
    serverScripts = [],
    sharedScripts = [],
    dependencies = [],
    uiPage = null,
    files = []
  } = options;

  let manifest = `fx_version 'cerulean'
game 'rdr3'

author '${author}'
description '${description}'
version '${version}'

`;

  if (dependencies.length > 0) {
    manifest += `dependencies {\n${dependencies.map(d => `    '${d}'`).join(',\n')}\n}\n\n`;
  }

  if (sharedScripts.length > 0) {
    manifest += `shared_scripts {\n${sharedScripts.map(s => `    '${s}'`).join(',\n')}\n}\n\n`;
  }

  if (clientScripts.length > 0) {
    manifest += `client_scripts {\n${clientScripts.map(s => `    '${s}'`).join(',\n')}\n}\n\n`;
  }

  if (serverScripts.length > 0) {
    manifest += `server_scripts {\n${serverScripts.map(s => `    '${s}'`).join(',\n')}\n}\n\n`;
  }

  if (uiPage) {
    manifest += `ui_page '${uiPage}'\n\n`;
  }

  if (files.length > 0) {
    manifest += `files {\n${files.map(f => `    '${f}'`).join(',\n')}\n}\n`;
  }

  return manifest;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUICK CHECKS (LOCAL, NO API)
// ═══════════════════════════════════════════════════════════════════════════════

// Local Lua syntax quick check (basic patterns)
export function quickLuaCheck(code) {
  const issues = [];
  const lines = code.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // Check for common Lua issues
    if (trimmed.match(/\belse\s+if\b/) && !trimmed.includes('elseif')) {
      issues.push({ line: lineNum, type: 'warning', message: 'Consider using "elseif" instead of "else if"' });
    }

    if (trimmed.match(/==\s*nil\b/)) {
      issues.push({ line: lineNum, type: 'info', message: 'Consider using "not variable" instead of "== nil"' });
    }

    if (trimmed.match(/\+\+/) || trimmed.match(/--(?![\[\-])/)) {
      // Exclude comments (--) and long comments (--[[)
      if (trimmed.match(/\+\+/)) {
        issues.push({ line: lineNum, type: 'error', message: 'Lua does not support ++ operator, use x = x + 1' });
      }
    }

    if (trimmed.includes('!=')) {
      issues.push({ line: lineNum, type: 'error', message: 'Use ~= for not-equal in Lua, not !=' });
    }

    if (trimmed.includes('&&')) {
      issues.push({ line: lineNum, type: 'error', message: 'Use "and" for logical AND in Lua, not &&' });
    }

    if (trimmed.includes('||')) {
      issues.push({ line: lineNum, type: 'error', message: 'Use "or" for logical OR in Lua, not ||' });
    }

    // RedM/FiveM specific
    if (trimmed.match(/while\s+true\s+do/) && !code.includes('Wait') && !code.includes('Citizen.Wait')) {
      issues.push({ line: lineNum, type: 'warning', message: 'Infinite loop without Wait() may freeze the game' });
    }

    if (trimmed.match(/TriggerServerEvent|TriggerClientEvent/) && trimmed.includes('source')) {
      if (trimmed.includes('TriggerServerEvent') && trimmed.includes('source')) {
        issues.push({ line: lineNum, type: 'warning', message: 'source is server-only, do not use in client scripts' });
      }
    }
  });

  return issues;
}

// Quick JavaScript check
export function quickJsCheck(code) {
  const issues = [];
  const lines = code.split('\n');

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // Check for var usage
    if (trimmed.match(/\bvar\s+/)) {
      issues.push({ line: lineNum, type: 'info', message: 'Consider using "let" or "const" instead of "var"' });
    }

    // Check for == vs ===
    if (trimmed.match(/[^=!]==[^=]/)) {
      issues.push({ line: lineNum, type: 'warning', message: 'Consider using === for strict equality' });
    }

    // Check for console.log in production
    if (trimmed.includes('console.log')) {
      issues.push({ line: lineNum, type: 'info', message: 'Remember to remove console.log before production' });
    }
  });

  return issues;
}

export default {
  checkSyntax,
  checkSecurity,
  reviewCode,
  debugCode,
  analyzePerformance,
  fullCodeAudit,
  analyzeWorkspace,
  validateModStructure,
  generateManifest,
  quickLuaCheck,
  quickJsCheck
};
