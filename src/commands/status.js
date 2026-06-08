/**
 * Status command - system status for Studio integration
 *
 * Returns comprehensive status of all packages, runtimes, and credentials.
 * Designed for Studio to call at startup: `rudi status --json`
 *
 * Usage:
 *   rudi status           Human-readable status
 *   rudi status --json    JSON for Studio consumption
 *   rudi status agents    Status of agents only
 *   rudi status runtimes  Status of runtimes only
 *   rudi status daemon    Status of the local daemon only
 */

import { PATHS, getInstalledPackages, isPackageInstalled, resolveNodeRuntimeBin } from '@learnrudi/core';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getSidecarDaemonStatus } from './sidecar-client.js';

// Agent definitions with credential check info
const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    npmPackage: '@anthropic-ai/claude-code',
    credentialType: 'keychain',
    keychainService: 'Claude Code-credentials',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    npmPackage: '@openai/codex',
    credentialType: 'file',
    credentialPath: '~/.codex/auth.json',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    npmPackage: '@google/gemini-cli',
    credentialType: 'file',
    credentialPath: '~/.gemini/google_accounts.json',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    npmPackage: '@githubnext/github-copilot-cli',
    credentialType: 'file',
    credentialPath: '~/.config/github-copilot/hosts.json',
  },
];

// Runtime definitions
const RUNTIMES = [
  { id: 'node', name: 'Node.js', command: 'node', versionFlag: '--version' },
  { id: 'python', name: 'Python', command: 'python3', versionFlag: '--version' },
  { id: 'deno', name: 'Deno', command: 'deno', versionFlag: '--version' },
  { id: 'bun', name: 'Bun', command: 'bun', versionFlag: '--version' },
];

// Binary definitions
const BINARIES = [
  { id: 'ffmpeg', name: 'FFmpeg', command: 'ffmpeg', versionFlag: '-version' },
  { id: 'ripgrep', name: 'ripgrep', command: 'rg', versionFlag: '--version' },
  { id: 'git', name: 'Git', command: 'git', versionFlag: '--version' },
  { id: 'pandoc', name: 'Pandoc', command: 'pandoc', versionFlag: '--version' },
  { id: 'jq', name: 'jq', command: 'jq', versionFlag: '--version' },
];

/**
 * Check if a file exists
 */
function fileExists(filePath) {
  const resolved = filePath.replace('~', os.homedir());
  return fs.existsSync(resolved);
}

/**
 * Check macOS keychain for credential
 */
function checkKeychain(service) {
  if (process.platform !== 'darwin') return false;
  try {
    execSync(`security find-generic-password -s "${service}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get version of a command
 */
function getVersion(command, versionFlag) {
  try {
    const output = execSync(`${command} ${versionFlag} 2>&1`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Extract version number (first match of semver-like pattern)
    const match = output.match(/(\d+\.\d+\.?\d*)/);
    return match ? match[1] : output.trim().split('\n')[0].slice(0, 50);
  } catch {
    return null;
  }
}

function getAgentBins(agentId) {
  const manifestPath = path.join(PATHS.agents, agentId, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const bins = manifest.bins || manifest.binaries || [];
      if (bins.length > 0) return bins;
    } catch {
      // Fall through to default
    }
  }
  return [agentId];
}

function findRudiAgentBin(agentId) {
  const bins = getAgentBins(agentId);
  for (const bin of bins) {
    const binPath = resolveNodeRuntimeBin(bin);
    if (fs.existsSync(binPath)) return binPath;
  }
  return null;
}

/**
 * Check if binary exists in PATH or RUDI locations
 */
function findBinary(command, kind = 'binary') {
  // Check RUDI locations first
  const rudiPaths = [
    path.join(PATHS.agents, command, 'node_modules', '.bin', command),
    path.join(PATHS.runtimes, command, 'bin', command),
    resolveNodeRuntimeBin(command),
    path.join(PATHS.binaries, command, command),
    path.join(PATHS.binaries, command),
  ];

  for (const p of rudiPaths) {
    if (fs.existsSync(p)) {
      return { found: true, path: p, source: 'rudi' };
    }
  }

  // Check global PATH
  try {
    const output = execSync(`which ${command} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const globalPath = output.trim();
    if (globalPath) {
      return { found: true, path: globalPath, source: 'global' };
    }
  } catch {
    // Not found in PATH
  }

  return { found: false, path: null, source: null };
}

/**
 * Get agent status
 * Checks RUDI-managed global install (~/.rudi/runtimes/node/bin) and global PATH
 */
function getAgentStatus(agent) {
  // Check RUDI global location first (preferred)
  const rudiPath = findRudiAgentBin(agent.id);
  const rudiInstalled = !!rudiPath;

  // Check global PATH as fallback
  let globalPath = null;
  let globalInstalled = false;
  if (!rudiInstalled) {
    try {
      const which = execSync(`which ${agent.id} 2>/dev/null`, { encoding: 'utf-8' }).trim();
      // Make sure it's not a RUDI shim
      if (which && !which.includes('.rudi/bins') && !which.includes('.rudi/shims')) {
        globalPath = which;
        globalInstalled = true;
      }
    } catch {
      // Not in PATH
    }
  }

  const installed = rudiInstalled || globalInstalled;
  const activePath = rudiInstalled ? rudiPath : globalPath;
  const source = rudiInstalled ? 'rudi' : (globalInstalled ? 'global' : null);

  // Check credentials
  let authenticated = false;
  if (agent.credentialType === 'keychain') {
    authenticated = checkKeychain(agent.keychainService);
  } else if (agent.credentialType === 'file') {
    authenticated = fileExists(agent.credentialPath);
  }

  // Get version if installed
  let version = null;
  if (installed && activePath) {
    version = getVersion(activePath, '--version');
  }

  return {
    id: agent.id,
    name: agent.name,
    installed,
    source,  // 'rudi' | 'global' | null
    authenticated,
    version,
    path: activePath,
    ready: installed && authenticated,
  };
}

/**
 * Get runtime status
 */
function getRuntimeStatus(runtime) {
  const location = findBinary(runtime.command, 'runtime');
  const version = location.found ? getVersion(location.path, runtime.versionFlag) : null;

  return {
    id: runtime.id,
    name: runtime.name,
    installed: location.found,
    version,
    path: location.path,
    source: location.source,
  };
}

/**
 * Get binary status
 */
function getBinaryStatus(binary) {
  const location = findBinary(binary.command, 'binary');
  const version = location.found ? getVersion(location.path, binary.versionFlag) : null;

  return {
    id: binary.id,
    name: binary.name,
    installed: location.found,
    version,
    path: location.path,
    source: location.source,
  };
}

/**
 * Get full system status
 */
export async function getFullStatus(options = {}) {
  const agents = AGENTS.map(getAgentStatus);
  const runtimes = RUNTIMES.map(getRuntimeStatus);
  const binaries = BINARIES.map(getBinaryStatus);
  const daemonStatusProvider = options.daemonStatusProvider || getSidecarDaemonStatus;
  const daemon = await daemonStatusProvider();

  // Get installed stacks and skills
  let stacks = [];
  let skills = [];
  try {
    stacks = getInstalledPackages('stack').map(s => ({
      id: s.id,
      name: s.name,
      version: s.version,
    }));
    skills = getInstalledPackages('skill').map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
    }));
  } catch {
    // Database might not be initialized
  }

  // Check directories
  const directories = {
    home: { path: PATHS.home, exists: fs.existsSync(PATHS.home) },
    stacks: { path: PATHS.stacks, exists: fs.existsSync(PATHS.stacks) },
    agents: { path: PATHS.agents, exists: fs.existsSync(PATHS.agents) },
    runtimes: { path: PATHS.runtimes, exists: fs.existsSync(PATHS.runtimes) },
    binaries: { path: PATHS.binaries, exists: fs.existsSync(PATHS.binaries) },
    db: { path: PATHS.db, exists: fs.existsSync(PATHS.db) },
  };

  // Summary counts
  const summary = {
    agentsInstalled: agents.filter(a => a.installed).length,
    agentsReady: agents.filter(a => a.ready).length,
    agentsTotal: agents.length,
    runtimesInstalled: runtimes.filter(r => r.installed).length,
    runtimesTotal: runtimes.length,
    binariesInstalled: binaries.filter(b => b.installed).length,
    binariesTotal: binaries.length,
    stacksInstalled: stacks.length,
    skillsInstalled: skills.length,
    daemonRunning: daemon.running,
    daemonReady: daemon.ready,
  };

  return {
    timestamp: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    rudiHome: PATHS.home,
    summary,
    agents,
    runtimes,
    binaries,
    daemon,
    stacks,
    skills,
    directories,
  };
}

export async function getDaemonOnlyStatus(options = {}) {
  const daemonStatusProvider = options.daemonStatusProvider || getSidecarDaemonStatus;
  const daemon = await daemonStatusProvider();
  return {
    timestamp: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    rudiHome: PATHS.home,
    summary: {
      daemonRunning: daemon.running,
      daemonReady: daemon.ready,
    },
    daemon,
  };
}

function formatDaemonState(daemon) {
  if (daemon.ready) return 'ready';
  if (daemon.reachable) return 'not ready';
  if (daemon.reason === 'not_running') return 'not running';
  return 'unreachable';
}

function formatSubStatus(status) {
  if (!status) return 'unknown';
  if (status.status) return status.ready === false ? `${status.status} (not ready)` : status.status;
  if (status.ready === true) return 'ready';
  if (status.ready === false) return 'not ready';
  return 'unknown';
}

/**
 * Print human-readable status
 */
function printStatus(status, filter) {
  console.log('RUDI Status');
  console.log('=' .repeat(50));
  console.log(`Platform: ${status.platform}`);
  console.log(`RUDI Home: ${status.rudiHome}`);
  console.log('');

  // Daemon
  if (!filter || filter === 'daemon') {
    const daemon = status.daemon;
    const icon = daemon.ready ? '\x1b[32m✓\x1b[0m' : (daemon.reachable ? '\x1b[33m!\x1b[0m' : '\x1b[90m○\x1b[0m');
    console.log('DAEMON');
    console.log('-'.repeat(50));
    console.log(`  ${icon} State: ${formatDaemonState(daemon)}`);
    if (daemon.port) console.log(`    Port: ${daemon.port}`);
    if (daemon.version) console.log(`    Version: ${daemon.version}`);
    if (daemon.dbStatus) console.log(`    Database: ${formatSubStatus(daemon.dbStatus)}`);
    if (daemon.toolIndexStatus) {
      const toolIndex = daemon.toolIndexStatus;
      const counts = [
        Number.isInteger(toolIndex.stackCount) ? `${toolIndex.stackCount} stacks` : null,
        Number.isInteger(toolIndex.toolCount) ? `${toolIndex.toolCount} tools` : null,
        Number.isInteger(toolIndex.failureCount) ? `${toolIndex.failureCount} failures` : null,
      ].filter(Boolean).join(', ');
      console.log(`    Tool index: ${formatSubStatus(toolIndex)}${counts ? ` (${counts})` : ''}`);
    }
    console.log(`    Active sessions: ${daemon.activeSessionCount || 0}`);
    console.log(`    Active jobs: ${daemon.activeJobCount || 0}`);
    if (daemon.error) console.log(`    Detail: ${daemon.error}`);
    console.log('');
    if (filter === 'daemon') return;
  }

  // Agents
  if (!filter || filter === 'agents') {
    console.log(`AGENTS (${status.summary.agentsReady}/${status.summary.agentsTotal} ready)`);
    console.log('-'.repeat(50));
    for (const agent of status.agents) {
      const installIcon = agent.installed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const version = agent.version ? `v${agent.version}` : '';
      const source = agent.source ? `(${agent.source})` : '';
      console.log(`  ${installIcon} ${agent.name} ${version} ${source}`);
      console.log(`    Installed: ${agent.installed ? 'yes' : 'no'}, Auth: ${agent.authenticated ? 'yes' : 'no'}, Ready: ${agent.ready ? 'yes' : 'no'}`);
    }
    console.log('');
  }

  // Runtimes
  if (!filter || filter === 'runtimes') {
    console.log(`RUNTIMES (${status.summary.runtimesInstalled}/${status.summary.runtimesTotal})`);
    console.log('-'.repeat(50));
    for (const rt of status.runtimes) {
      const icon = rt.installed ? '\x1b[32m✓\x1b[0m' : '\x1b[90m○\x1b[0m';
      const version = rt.version ? `v${rt.version}` : '';
      const source = rt.source ? `(${rt.source})` : '';
      console.log(`  ${icon} ${rt.name} ${version} ${source}`);
    }
    console.log('');
  }

  // Binaries
  if (!filter || filter === 'binaries') {
    console.log(`BINARIES (${status.summary.binariesInstalled}/${status.summary.binariesTotal})`);
    console.log('-'.repeat(50));
    for (const bin of status.binaries) {
      const icon = bin.installed ? '\x1b[32m✓\x1b[0m' : '\x1b[90m○\x1b[0m';
      const version = bin.version ? `v${bin.version}` : '';
      const source = bin.source ? `(${bin.source})` : '';
      console.log(`  ${icon} ${bin.name} ${version} ${source}`);
    }
    console.log('');
  }

  // Stacks
  if (!filter || filter === 'stacks') {
    console.log(`STACKS (${status.summary.stacksInstalled})`);
    console.log('-'.repeat(50));
    if (status.stacks.length === 0) {
      console.log('  No stacks installed');
    } else {
      for (const stack of status.stacks) {
        console.log(`  ${stack.id} v${stack.version || '?'}`);
      }
    }
    console.log('');
  }

  // Summary
  console.log('SUMMARY');
  console.log('-'.repeat(50));
  console.log(`  Agents ready: ${status.summary.agentsReady}/${status.summary.agentsTotal}`);
  console.log(`  Runtimes: ${status.summary.runtimesInstalled}/${status.summary.runtimesTotal}`);
  console.log(`  Binaries: ${status.summary.binariesInstalled}/${status.summary.binariesTotal}`);
  console.log(`  Stacks: ${status.summary.stacksInstalled}`);
  console.log(`  Skills: ${status.summary.skillsInstalled}`);
  console.log(`  Daemon: ${formatDaemonState(status.daemon)}`);
}

export async function cmdStatus(args, flags) {
  const filter = args[0]; // Optional filter: agents, runtimes, binaries, stacks, daemon

  const status = filter === 'daemon'
    ? await getDaemonOnlyStatus()
    : await getFullStatus();

  if (flags.json) {
    // Filter output if requested
    if (filter) {
      const filtered = {
        timestamp: status.timestamp,
        platform: status.platform,
        [filter]: status[filter],
      };
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      console.log(JSON.stringify(status, null, 2));
    }
  } else {
    printStatus(status, filter);
  }
}
