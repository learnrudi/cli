/**
 * Integrate command - Wire RUDI router into agent configs
 *
 * Each integration:
 * - Detects the agent's config format
 * - Creates backup before modifying
 * - Patches idempotently (won't duplicate entries)
 * - Registers the rudi-router (single entry, all stacks)
 * - Installs agent instruction blocks where the agent supports them
 *
 * Usage:
 *   rudi integrate claude      Wire up Claude Desktop/Code
 *   rudi integrate cursor      Wire up Cursor
 *   rudi integrate gemini      Wire up Gemini CLI
 *   rudi integrate all         Wire up all detected agents
 */

import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { PATHS } from '@learnrudi/env';
import { AGENT_CONFIGS, findAgentConfig, getInstalledAgents } from '@learnrudi/mcp';
import {
  buildRudiInstructionBlock,
  loadInstalledRudiInstructionReferences,
  patchManagedInstructionBlock,
  resolveInstructionTarget,
} from './instructions.js';

const HOME = os.homedir();
const ROUTER_SHIM_PATH = path.join(PATHS.bins, 'rudi-router');
const LEGACY_ROUTER_SHIM_PATH = path.join(PATHS.home, 'shims', 'rudi-router');

/**
 * Check if router shim exists
 */
function checkRouterShim() {
  if (fs.existsSync(ROUTER_SHIM_PATH)) return ROUTER_SHIM_PATH;
  if (fs.existsSync(LEGACY_ROUTER_SHIM_PATH)) return LEGACY_ROUTER_SHIM_PATH;
  throw new Error(
    `Router shim not found at ${ROUTER_SHIM_PATH}\n` +
    `Run: rudi shims rebuild`
  );
}

/**
 * Create backup of config file
 */
function backupConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;

  const backupPath = configPath + '.backup.' + Date.now();
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

export async function installCodexGlobalInstructions(flags = {}, env = {}) {
  const dryRun = flags['dry-run'] === true || flags.dryRun === true;
  const targetPath = resolveInstructionTarget('codex', { global: true }, env);
  const existing = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, 'utf-8')
    : '';
  const installed = await loadInstalledRudiInstructionReferences();
  const result = patchManagedInstructionBlock(
    existing,
    buildRudiInstructionBlock('codex', { installed })
  );

  let backupPath = null;
  if (result.changed && !dryRun) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    backupPath = backupConfig(targetPath);
    fs.writeFileSync(targetPath, result.content);
  }

  return {
    targetPath,
    action: dryRun && result.changed ? `would_${result.action}` : result.action,
    changed: result.changed,
    dryRun,
    backupPath,
  };
}

function logCodexInstructionResult(result, flags = {}) {
  if (result.backupPath && flags.verbose) {
    console.log(`  Instructions backup: ${result.backupPath}`);
  }

  if (!result.changed) {
    console.log(`  ✓ Instructions already current: ${result.targetPath}`);
    return;
  }

  if (result.dryRun) {
    console.log(`  Would ${result.action.replace(/^would_/, '')} RUDI instructions: ${result.targetPath}`);
    return;
  }

  console.log(`  ✓ ${result.action === 'added' ? 'Added' : 'Updated'} RUDI instructions: ${result.targetPath}`);
}

/**
 * Read JSON config safely
 */
function readJsonConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write JSON config
 */
function writeJsonConfig(configPath, config) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getAgentTargetPath(agentConfig) {
  const configPath = findAgentConfig(agentConfig);
  return configPath || path.join(HOME, agentConfig.paths[process.platform]?.[0] || agentConfig.paths.darwin[0]);
}

function tomlString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function splitTomlBlocks(content) {
  const blocks = [];
  let current = { table: null, lines: [] };

  for (const line of content.split('\n')) {
    const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (match) {
      if (current.lines.length > 0) {
        blocks.push(current);
      }
      current = { table: match[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }

  if (current.lines.length > 0) {
    blocks.push(current);
  }
  return blocks;
}

function getCodexMcpServerName(table) {
  if (!table?.startsWith('mcp_servers.')) return null;
  const rest = table.slice('mcp_servers.'.length);
  const name = rest.split('.')[0];
  return name.replace(/^"(.*)"$/, '$1');
}

function buildCodexRouterTomlBlock(routerPath) {
  return [
    '[mcp_servers.rudi]',
    `command = ${tomlString(routerPath)}`,
    'args = []',
    '',
  ].join('\n');
}

export function patchCodexTomlRouter(content, routerPath, options = {}) {
  const rudiMcpShimPath = options.rudiMcpShimPath || path.join(PATHS.bins, 'rudi-mcp');
  const legacyMcpShimPath = options.legacyMcpShimPath || path.join(PATHS.home, 'shims', 'rudi-mcp');
  const rudiStacksPath = options.rudiStacksPath || path.join(PATHS.home, 'stacks');
  const blocks = splitTomlBlocks(content || '');
  const removedEntries = [];
  const removedServers = new Set();

  for (const block of blocks) {
    const serverName = getCodexMcpServerName(block.table);
    if (!serverName || serverName === 'rudi') continue;

    const blockText = block.lines.join('\n');
    if (
      blockText.includes(rudiStacksPath)
      || blockText.includes(rudiMcpShimPath)
      || blockText.includes(legacyMcpShimPath)
    ) {
      removedServers.add(serverName);
    }
  }

  const keptBlocks = [];
  let existingRouter = false;

  for (const block of blocks) {
    const serverName = getCodexMcpServerName(block.table);
    if (serverName === 'rudi') {
      existingRouter = true;
      continue;
    }
    if (serverName && removedServers.has(serverName)) {
      continue;
    }
    keptBlocks.push(block);
  }

  removedEntries.push(...Array.from(removedServers).sort());

  let nextContent = keptBlocks.map((block) => block.lines.join('\n')).join('\n');
  nextContent = nextContent.replace(/\s*$/, '');
  if (nextContent) {
    nextContent += '\n\n';
  }
  nextContent += buildCodexRouterTomlBlock(routerPath);

  const changed = nextContent !== content;
  return {
    action: existingRouter ? (changed ? 'updated' : 'none') : 'added',
    content: nextContent,
    existingRouter,
    removed: removedEntries,
  };
}

/**
 * Build MCP server entry for the router
 * Format varies slightly by agent
 */
function buildRouterEntry(agentId, routerPath) {
  const base = {
    command: routerPath,
    args: [],
  };

  // Claude Desktop and Claude Code need "type": "stdio"
  if (agentId === 'claude-desktop' || agentId === 'claude-code') {
    return { type: 'stdio', ...base };
  }

  return base;
}

async function integrateCodexAgent(agentConfig, targetPath, flags) {
  console.log(`\n${agentConfig.name}:`);
  console.log(`  Config: ${targetPath}`);

  const routerPath = checkRouterShim();
  const existing = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, 'utf-8')
    : '';
  const result = patchCodexTomlRouter(existing, routerPath);

  if (result.removed.length > 0) {
    console.log(`  Removed old entries: ${result.removed.join(', ')}`);
  }

  if (result.action !== 'none' || result.removed.length > 0) {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(targetPath)) {
      const backup = backupConfig(targetPath);
      if (backup && flags.verbose) {
        console.log(`  Backup: ${backup}`);
      }
    }
    fs.writeFileSync(targetPath, result.content);
    if (result.action !== 'none') {
      console.log(`  ${result.action === 'added' ? '✓ Added' : '✓ Updated'} rudi router`);
    }
  } else {
    console.log(`  ✓ Already configured`);
  }

  const instructions = await installCodexGlobalInstructions(flags);
  logCodexInstructionResult(instructions, flags);

  return {
    success: true,
    action: result.action,
    removed: result.removed,
    instructionsAction: instructions.action,
  };
}

async function dryRunIntegrateAgent(agentId, flags = {}) {
  const agentConfig = AGENT_CONFIGS.find(a => a.id === agentId);
  if (!agentConfig) {
    console.log(`\n${agentId}:`);
    console.log('  Unknown agent');
    return { success: false, error: 'Unknown agent' };
  }

  const targetPath = getAgentTargetPath(agentConfig);
  console.log(`\n${agentConfig.name}:`);
  console.log(`  Config: ${targetPath}`);

  if (agentId === 'codex') {
    const routerPath = checkRouterShim();
    const existing = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, 'utf-8')
      : '';
    const result = patchCodexTomlRouter(existing, routerPath);

    if (result.removed.length > 0) {
      console.log(`  Would remove old entries: ${result.removed.join(', ')}`);
    }
    if (result.action === 'added') {
      console.log('  Would add rudi router');
    } else if (result.action === 'updated') {
      console.log('  Would update rudi router');
    } else {
      console.log('  ✓ Already configured');
    }

    const instructions = await installCodexGlobalInstructions({ ...flags, 'dry-run': true });
    logCodexInstructionResult(instructions, { ...flags, 'dry-run': true });

    return {
      success: true,
      action: result.action,
      removed: result.removed,
      instructionsAction: instructions.action,
    };
  }

  console.log('  Would add or update rudi router');
  return { success: true, action: 'unknown' };
}

/**
 * Integrate RUDI router into a specific agent
 * Also cleans up old individual stack entries that should go through the router
 */
async function integrateAgent(agentId, flags) {
  const agentConfig = AGENT_CONFIGS.find(a => a.id === agentId);
  if (!agentConfig) {
    console.error(`Unknown agent: ${agentId}`);
    return { success: false, error: 'Unknown agent' };
  }

  const targetPath = getAgentTargetPath(agentConfig);

  if (agentId === 'codex') {
    return integrateCodexAgent(agentConfig, targetPath, flags);
  }

  console.log(`\n${agentConfig.name}:`);
  console.log(`  Config: ${targetPath}`);

  // Read existing config
  const config = readJsonConfig(targetPath);

  // Ensure the MCP servers key exists
  const key = agentConfig.key;
  if (!config[key]) {
    config[key] = {};
  }

  // Clean up entries that should go through the router:
  // 1. Old rudi-mcp shim entries
  // 2. Direct stack entries (cwd or args pointing to ~/.rudi/stacks/)
  const rudiMcpShimPath = path.join(PATHS.bins, 'rudi-mcp');
  const legacyMcpShimPath = path.join(PATHS.home, 'shims', 'rudi-mcp');
  const rudiStacksPath = path.join(PATHS.home, 'stacks');
  const removedEntries = [];

  for (const [serverName, serverConfig] of Object.entries(config[key])) {
    // Skip the router entry itself
    if (serverName === 'rudi') continue;

    let shouldRemove = false;

    // Check for old rudi-mcp shim
    if (serverConfig.command === rudiMcpShimPath || serverConfig.command === legacyMcpShimPath) {
      shouldRemove = true;
    }

    // Check for direct stack entries (cwd points to ~/.rudi/stacks/)
    if (serverConfig.cwd && serverConfig.cwd.startsWith(rudiStacksPath)) {
      shouldRemove = true;
    }

    // Check for direct stack entries (args contain ~/.rudi/stacks/)
    if (serverConfig.args && Array.isArray(serverConfig.args)) {
      for (const arg of serverConfig.args) {
        if (typeof arg === 'string' && arg.startsWith(rudiStacksPath)) {
          shouldRemove = true;
          break;
        }
      }
    }

    if (shouldRemove) {
      delete config[key][serverName];
      removedEntries.push(serverName);
    }
  }
  if (removedEntries.length > 0) {
    console.log(`  Removed old entries: ${removedEntries.join(', ')}`);
  }

  // Add/update the RUDI router entry
  const routerPath = checkRouterShim();
  const routerEntry = buildRouterEntry(agentId, routerPath);
  const existing = config[key]['rudi'];

  let action = 'none';
  if (!existing) {
    config[key]['rudi'] = routerEntry;
    action = 'added';
  } else if (existing.command !== routerEntry.command || JSON.stringify(existing.args) !== JSON.stringify(routerEntry.args)) {
    config[key]['rudi'] = routerEntry;
    action = 'updated';
  }

  // Write config if anything changed
  if (action !== 'none' || removedEntries.length > 0) {
    if (fs.existsSync(targetPath)) {
      const backup = backupConfig(targetPath);
      if (backup && flags.verbose) {
        console.log(`  Backup: ${backup}`);
      }
    }
    writeJsonConfig(targetPath, config);
    if (action !== 'none') {
      console.log(`  ${action === 'added' ? '✓ Added' : '✓ Updated'} rudi router`);
    }
  } else {
    console.log(`  ✓ Already configured`);
  }

  return { success: true, action, removed: removedEntries };
}

/**
 * Main integrate command
 */
export async function cmdIntegrate(args, flags) {
  const target = args[0];

  // List detected agents
  if (flags.list || target === 'list') {
    const installed = getInstalledAgents();
    console.log('\nDetected agents:');
    for (const agent of installed) {
      console.log(`  ✓ ${agent.name}`);
      console.log(`    ${agent.configFile}`);
    }
    if (installed.length === 0) {
      console.log('  (none detected)');
    }
    return;
  }

  // Show help if no target
  if (!target) {
    console.log(`
rudi integrate - Wire RUDI router into agent configs

USAGE
  rudi integrate <agent>     Integrate with specific agent
  rudi integrate all         Integrate with all detected agents
  rudi integrate --list      Show detected agents

AGENTS
  claude       Claude Desktop + Claude Code
  cursor       Cursor IDE
  windsurf     Windsurf IDE
  vscode       VS Code / GitHub Copilot
  gemini       Gemini CLI
  codex        OpenAI Codex CLI
  zed          Zed Editor

OPTIONS
  --verbose    Show detailed output
  --dry-run    Show what would be done without making changes

WHAT IT DOES
  1. Adds RUDI router entry (single MCP server for all stacks)
  2. Cleans up old direct stack entries
  3. For Codex, creates or updates ~/.codex/AGENTS.md

EXAMPLES
  rudi integrate claude
  rudi integrate all
`);
    return;
  }

  // Check router shim exists
  try {
    checkRouterShim();
  } catch (err) {
    console.error(err.message);
    return;
  }

  console.log(`\nWiring up RUDI router...`);

  // Determine which agents to integrate
  let targetAgents = [];

  if (target === 'all') {
    targetAgents = getInstalledAgents().map(a => a.id);
    if (targetAgents.length === 0) {
      console.log('No agents detected.');
      return;
    }
  } else if (target === 'claude') {
    // Both Claude Desktop and Claude Code
    targetAgents = ['claude-desktop', 'claude-code'].filter(id => {
      const agent = AGENT_CONFIGS.find(a => a.id === id);
      return agent && findAgentConfig(agent);
    });
    // If neither exists, try to create claude-code
    if (targetAgents.length === 0) {
      targetAgents = ['claude-code'];
    }
  } else {
    // Map short names to IDs
    const idMap = {
      'cursor': 'cursor',
      'windsurf': 'windsurf',
      'vscode': 'vscode',
      'gemini': 'gemini',
      'codex': 'codex',
      'zed': 'zed',
      'cline': 'cline',
    };
    const agentId = idMap[target] || target;
    targetAgents = [agentId];
  }

  // Dry run
  if (flags['dry-run']) {
    console.log('\nDry run:');
    for (const agentId of targetAgents) {
      await dryRunIntegrateAgent(agentId, flags);
    }
    return;
  }

  // Integrate each agent
  const results = [];
  for (const agentId of targetAgents) {
    const result = await integrateAgent(agentId, flags);
    results.push({ agent: agentId, ...result });
  }

  // Summary
  const successful = results.filter(r => r.success);
  console.log(`\n✓ Integrated with ${successful.length} agent(s)`);
  console.log('\nRestart your agent(s) to access all installed stacks.');
  console.log('\nManage stacks:');
  console.log('  rudi install <stack>   # Install a new stack');
  console.log('  rudi index             # Rebuild tool cache');
}
