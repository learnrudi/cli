/**
 * Which command - show detailed information about an installed stack
 *
 * Usage:
 *   rudi which <stack-id>
 *   rudi which google-workspace
 *   rudi which stack:google-workspace
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { listInstalled } from '@learnrudi/core';
import { PATHS } from '@learnrudi/env';
import { formatRelatedSkillsLine, getRelatedSkillIds } from './related-skills.js';

export async function cmdWhich(args, flags) {
  const stackId = args[0];

  if (!stackId) {
    console.error('Usage: rudi which <stack-id>');
    console.error('Example: rudi which google-workspace');
    process.exit(1);
  }

  try {
    // Get all installed stacks
    const packages = await listInstalled('stack');

    // Find stack by ID or name (handle both "google-workspace" and "stack:google-workspace")
    const stack = packages.find(p => {
      const pId = p.id || '';
      const pName = p.name || '';
      // Match exact ID
      if (pId === stackId || pId === `stack:${stackId}`) return true;
      // Match name
      if (pName === stackId || pName === `stack:${stackId}`) return true;
      // Match ID without "stack:" prefix
      if (pId.replace('stack:', '') === stackId) return true;
      return false;
    });

    if (!stack) {
      console.error(`Stack not found: ${stackId}`);
      console.error(`\nInstalled stacks:`);
      packages.forEach(p => console.error(`  - ${p.id}`));
      process.exit(1);
    }

    // Detect runtime and entry point
    const stackPath = stack.path;
    const runtimeInfo = await detectRuntime(stackPath);

    // Check auth status
    const authStatus = await checkAuth(stackPath, runtimeInfo.runtime);

    // Check if MCP server is running
    const isRunning = checkIfRunning(stack.name || stack.id.replace('stack:', ''));

    // Display information
    console.log('');
    console.log('═'.repeat(60));
    console.log(`  ${stack.name || stack.id}`);
    console.log('═'.repeat(60));
    console.log('');

    console.log(`Stack:      ${stack.id}`);
    console.log(`Version:    ${stack.version || 'unknown'}`);
    if (stack.description) {
      console.log(`About:      ${stack.description}`);
    }
    const relatedSkillsLine = formatRelatedSkillsLine(stack);
    if (relatedSkillsLine) {
      console.log(relatedSkillsLine);
    }
    console.log('');

    console.log(`Runtime:    ${runtimeInfo.runtime || 'unknown'}`);
    console.log(`Path:       ${stackPath}`);
    if (runtimeInfo.entry) {
      console.log(`Entry:      ${runtimeInfo.entry}`);
    }
    console.log('');

    // Auth status
    const authIcon = authStatus.configured ? '✓' : '✗';
    const authColor = authStatus.configured ? '\x1b[32m' : '\x1b[31m';
    const resetColor = '\x1b[0m';
    console.log(`Auth:       ${authColor}${authIcon}${resetColor} ${authStatus.message}`);
    if (authStatus.files.length > 0) {
      authStatus.files.forEach(file => {
        console.log(`            - ${file}`);
      });
    }
    console.log('');

    // Running status
    const runIcon = isRunning ? '✓' : '○';
    const runColor = isRunning ? '\x1b[32m' : '\x1b[90m';
    const runStatus = isRunning ? 'Running' : 'Not running';
    console.log(`Status:     ${runColor}${runIcon}${resetColor} ${runStatus}`);
    console.log('');

    // Usage tips
    console.log('Commands:');
    console.log(`  rudi run ${stack.id}          Test the stack`);
    console.log(`  rudi secrets ${stack.id}      Configure secrets`);
    if (getRelatedSkillIds(stack).length > 0) {
      console.log(`  rudi install ${stack.id} --with-related-skills`);
      console.log(`                         Install editable related skills`);
    }
    if (runtimeInfo.entry) {
      console.log('');
      console.log('Run MCP server directly:');
      const entryPath = path.join(stackPath, runtimeInfo.entry);
      if (runtimeInfo.runtime === 'node') {
        console.log(`  echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node ${entryPath}`);
      } else if (runtimeInfo.runtime === 'python') {
        console.log(`  echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | python3 ${entryPath}`);
      }
    }
    console.log('');

  } catch (error) {
    console.error(`Failed to get stack info: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Detect which runtime (node/python) and entry point the stack uses
 */
export async function detectRuntime(stackPath) {
  const layouts = [
    { runtime: 'node', runtimePath: path.join(stackPath, 'node'), entryPrefix: 'node/', explicit: true },
    { runtime: 'python', runtimePath: path.join(stackPath, 'python'), entryPrefix: 'python/', explicit: true },
    { runtime: 'node', runtimePath: stackPath, entryPrefix: '', explicit: false },
    { runtime: 'python', runtimePath: stackPath, entryPrefix: '', explicit: false },
  ];

  for (const { runtime, runtimePath, entryPrefix, explicit } of layouts) {
    try {
      await fs.access(runtimePath);

      // Check for entry points
      if (runtime === 'node') {
        // Prefer compiled dist/index.js, fallback to src/index.ts
        const distEntry = path.join(runtimePath, 'dist', 'index.js');
        const srcEntry = path.join(runtimePath, 'src', 'index.ts');

        try {
          await fs.access(distEntry);
          return { runtime: 'node', entry: `${entryPrefix}dist/index.js` };
        } catch {
          try {
            await fs.access(srcEntry);
            return { runtime: 'node', entry: `${entryPrefix}src/index.ts` };
          } catch {
            if (explicit) return { runtime: 'node', entry: null };
          }
        }
      } else if (runtime === 'python') {
        const entry = path.join(runtimePath, 'src', 'index.py');
        try {
          await fs.access(entry);
          return { runtime: 'python', entry: `${entryPrefix}src/index.py` };
        } catch {
          if (explicit) return { runtime: 'python', entry: null };
        }
      }
    } catch {
      // Runtime directory doesn't exist, try next
      continue;
    }
  }

  return { runtime: null, entry: null };
}

/**
 * Check authentication status
 */
export async function checkAuth(stackPath, runtime, options = {}) {
  const authFiles = [];
  let configured = false;
  const checkedRoots = new Set();

  async function scanAuthRoot(rootPath, labelPrefix) {
    if (!rootPath || checkedRoots.has(rootPath)) return;
    checkedRoots.add(rootPath);

    try {
      await fs.access(path.join(rootPath, 'token.json'));
      authFiles.push(labelPrefix ? `${labelPrefix}/token.json` : 'token.json');
      configured = true;
    } catch {
      // No direct token.json, check for accounts-based structure
      const accountsPath = path.join(rootPath, 'accounts');
      try {
        const accounts = await fs.readdir(accountsPath);
        // Check if any account has a token.json
        for (const account of accounts) {
          if (account.startsWith('.')) continue;
          const accountTokenPath = path.join(accountsPath, account, 'token.json');
          try {
            await fs.access(accountTokenPath);
            const label = labelPrefix
              ? `${labelPrefix}/accounts/${account}/token.json`
              : `accounts/${account}/token.json`;
            authFiles.push(label);
            configured = true;
          } catch {
            // No token for this account
          }
        }
      } catch {
        // No accounts directory
      }
    }
  }

  if (runtime === 'node' || runtime === 'python') {
    await scanAuthRoot(path.join(stackPath, runtime), runtime);
    await scanAuthRoot(stackPath, '');
  }

  const stackName = options.stackName || path.basename(stackPath);
  const rudiHome = options.rudiHome || PATHS.home;
  await scanAuthRoot(
    path.join(rudiHome, 'state', 'stacks', stackName),
    `state/stacks/${stackName}`,
  );

  // Check for .env file (API key stacks)
  const envPath = path.join(stackPath, '.env');
  try {
    const envContent = await fs.readFile(envPath, 'utf-8');
    // Check if .env has actual values (not just placeholders)
    const hasValues = envContent.split('\n').some(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return false;
      const [key, value] = trimmed.split('=');
      return value && value.trim() && !value.includes('YOUR_') && !value.includes('your_');
    });

    if (hasValues) {
      authFiles.push('.env');
      configured = true;
    }
  } catch {
    // No .env file
  }

  if (configured) {
    return {
      configured: true,
      message: 'Configured',
      files: authFiles
    };
  } else {
    return {
      configured: false,
      message: 'Not configured',
      files: []
    };
  }
}

/**
 * Check if MCP server process is running
 */
function checkIfRunning(stackName) {
  try {
    // Use ps to find processes matching the stack name
    const result = execSync(`ps aux | grep "${stackName}" | grep -v grep || true`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
    });

    // Filter out the current grep process and check if any actual MCP server is running
    const lines = result.trim().split('\n').filter(line => {
      return line &&
             line.includes('index.ts') || line.includes('index.js') || line.includes('index.py');
    });

    return lines.length > 0;
  } catch {
    return false;
  }
}
