/**
 * Check command - check if a specific package is installed and ready
 *
 * Usage:
 *   rudi check agent:claude     Check if Claude is installed + authenticated
 *   rudi check runtime:python   Check if Python is installed
 *   rudi check binary:ffmpeg    Check if ffmpeg is installed
 *   rudi check stack:slack      Check if Slack stack is installed
 *
 * Exit codes:
 *   0 = ready (installed and authenticated if applicable)
 *   1 = not installed
 *   2 = installed but not authenticated (agents only)
 */

import { PATHS, isPackageInstalled, getPackagePath, resolveNodeRuntimeBin, checkStackLifecycle, readRudiConfig } from '@learnrudi/core';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createWhichCommand, runCommand, runCommandPlan } from '../utils/subprocess.js';

// Agent credential checks
const AGENT_CREDENTIALS = {
  claude: { type: 'keychain', service: 'Claude Code-credentials' },
  codex: { type: 'file', path: '~/.codex/auth.json' },
  gemini: { type: 'file', path: '~/.gemini/google_accounts.json' },
  copilot: { type: 'file', path: '~/.config/github-copilot/hosts.json' },
};

function fileExists(filePath) {
  const resolved = filePath.replace('~', os.homedir());
  return fs.existsSync(resolved);
}

function checkKeychain(service) {
  if (process.platform !== 'darwin') return false;
  try {
    runCommand('security', ['find-generic-password', '-s', service], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function getVersion(binaryPath, versionFlag = '--version') {
  try {
    const output = runCommand(binaryPath, [versionFlag], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const match = output.match(/(\d+\.\d+\.?\d*)/);
    return match ? match[1] : null;
  } catch (error) {
    const output = `${error.stdout?.toString() || ''}\n${error.stderr?.toString() || ''}`.trim();
    if (output) {
      const match = output.match(/(\d+\.\d+\.?\d*)/);
      return match ? match[1] : null;
    }
    return null;
  }
}

function findGlobalBinary(name) {
  try {
    return runCommandPlan(createWhichCommand(name), {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

function getAgentBins(name) {
  const manifestPath = path.join(PATHS.agents, name, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const bins = manifest.bins || manifest.binaries || [];
      if (bins.length > 0) return bins;
    } catch {
      // Fall through to default
    }
  }
  return [name];
}

function findRudiAgentBin(name) {
  const bins = getAgentBins(name);
  for (const bin of bins) {
    const binPath = resolveNodeRuntimeBin(bin);
    if (fs.existsSync(binPath)) return binPath;
  }
  return null;
}

/**
 * Auto-detect package kind by checking filesystem locations
 * Priority: agent > runtime > binary > stack (checks where it exists)
 */
function detectKindFromFilesystem(name) {
  // Check RUDI agent location
  const agentManifestPath = path.join(PATHS.agents, name, 'manifest.json');
  if (fs.existsSync(agentManifestPath)) return 'agent';
  if (findRudiAgentBin(name)) return 'agent';

  // Check RUDI runtime location
  const runtimePath = path.join(PATHS.runtimes, name, 'bin', name);
  if (fs.existsSync(runtimePath)) return 'runtime';

  // Check RUDI binary location
  const binaryPath = path.join(PATHS.binaries, name, name);
  const binaryPath2 = path.join(PATHS.binaries, name);
  if (fs.existsSync(binaryPath) || fs.existsSync(binaryPath2)) return 'binary';

  // Check RUDI stack location
  const stackPath = path.join(PATHS.stacks, name);
  if (fs.existsSync(stackPath)) return 'stack';

  // Not found in RUDI - check global PATH and guess based on what it is
  const globalPath = findGlobalBinary(name);
  if (globalPath) {
    // If it's in a typical runtime location, it's probably a runtime
    if (globalPath.includes('/node') || globalPath.includes('/python') ||
        globalPath.includes('/deno') || globalPath.includes('/bun')) {
      return 'runtime';
    }
    // Otherwise assume binary (most common case for global tools)
    return 'binary';
  }

  // Default to stack for unknown (user can be explicit with stack:name)
  return 'stack';
}

export async function cmdCheck(args, flags) {
  const packageId = args[0];

  if (!packageId) {
    console.error('Usage: rudi check <package-id>');
    console.error('Examples:');
    console.error('  rudi check agent:claude');
    console.error('  rudi check runtime:python');
    console.error('  rudi check binary:ffmpeg');
    console.error('  rudi check stack:slack');
    process.exit(1);
  }

  // Parse package ID
  let kind, name;
  if (packageId.includes(':')) {
    [kind, name] = packageId.split(':');
  } else {
    // Auto-detect kind by checking where it exists in ~/.rudi/
    name = packageId;
    kind = detectKindFromFilesystem(name);
  }

  const result = {
    id: `${kind}:${name}`,
    kind,
    name,
    installed: false,
    source: null, // 'rudi' | 'global' | null
    authenticated: null, // Only for agents
    ready: false,
    path: null,
    version: null,
  };

  // Check installation based on kind
  switch (kind) {
    case 'agent': {
      // Check RUDI global location first (preferred)
      const rudiPath = findRudiAgentBin(name);
      const rudiInstalled = !!rudiPath;

      // Check global PATH as fallback
      let globalPath = null;
      let globalInstalled = false;
      if (!rudiInstalled) {
        const which = findGlobalBinary(name);
        // Make sure it's not a RUDI shim
        if (which && !which.includes('.rudi/bins') && !which.includes('.rudi/shims')) {
          globalPath = which;
          globalInstalled = true;
        }
      }

      result.installed = rudiInstalled || globalInstalled;
      result.path = rudiInstalled ? rudiPath : globalPath;
      result.source = rudiInstalled ? 'rudi' : (globalInstalled ? 'global' : null);

      if (result.installed && result.path) {
        result.version = getVersion(result.path);
      }

      // Check credentials
      const cred = AGENT_CREDENTIALS[name];
      if (cred) {
        if (cred.type === 'keychain') {
          result.authenticated = checkKeychain(cred.service);
        } else if (cred.type === 'file') {
          result.authenticated = fileExists(cred.path);
        }
      }

      result.ready = result.installed && result.authenticated;
      break;
    }

    case 'runtime': {
      // Check RUDI location first
      const rudiPath = path.join(PATHS.runtimes, name, 'bin', name);
      if (fs.existsSync(rudiPath)) {
        result.installed = true;
        result.path = rudiPath;
        result.version = getVersion(rudiPath);
      } else {
        // Check global
        const globalPath = findGlobalBinary(name);
        if (globalPath) {
          result.installed = true;
          result.path = globalPath;
          result.version = getVersion(globalPath);
        }
      }
      result.ready = result.installed;
      break;
    }

    case 'binary': {
      // Check RUDI location first
      const rudiPath = path.join(PATHS.binaries, name, name);
      if (fs.existsSync(rudiPath)) {
        result.installed = true;
        result.path = rudiPath;
      } else {
        // Check global
        const globalPath = findGlobalBinary(name);
        if (globalPath) {
          result.installed = true;
          result.path = globalPath;
        }
      }
      result.ready = result.installed;
      break;
    }

    case 'stack': {
      result.installed = isPackageInstalled(`stack:${name}`);
      if (result.installed) {
        result.path = getPackagePath(`stack:${name}`);

        // Run full lifecycle certification
        const rudiConfig = readRudiConfig();
        const stackConfig = rudiConfig.stacks?.[`stack:${name}`];
        if (stackConfig) {
          const lifecycle = await checkStackLifecycle(name, stackConfig, { log: () => {} });
          result.lifecycle = {
            finalState: lifecycle.finalState,
            healthy: lifecycle.healthy,
            failedAt: lifecycle.failedAt,
            fixCommand: lifecycle.fixCommand,
            checks: lifecycle.checks.map(c => ({
              state: c.state,
              passed: c.passed,
              error: c.error,
            })),
          };
          result.ready = lifecycle.healthy;
        } else {
          result.ready = false;
        }
      } else {
        result.ready = false;
      }
      break;
    }

    default:
      console.error(`Unknown package kind: ${kind}`);
      process.exit(1);
  }

  // Output
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const installIcon = result.installed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const source = result.source ? `(${result.source})` : '';
    console.log(`${installIcon} ${result.id} ${source}`);
    console.log(`  Installed: ${result.installed}`);
    if (result.source) console.log(`  Source: ${result.source}`);
    if (result.path) console.log(`  Path: ${result.path}`);
    if (result.version) console.log(`  Version: ${result.version}`);
    if (result.authenticated !== null) {
      console.log(`  Authenticated: ${result.authenticated}`);
    }
    console.log(`  Ready: ${result.ready}`);
    if (result.lifecycle) {
      const states = ['installed', 'launchable', 'secrets_ready', 'mcp_ready', 'indexed'];
      for (const state of states) {
        const check = result.lifecycle.checks.find(c => c.state === state);
        if (check) {
          const icon = check.passed ? '✓' : '✗';
          const detail = check.error ? `  ${check.error}` : '';
          console.log(`  ${icon} ${state}${detail}`);
        } else {
          console.log(`  - ${state} (skipped)`);
        }
      }
      if (result.lifecycle.fixCommand) {
        console.log(`\nFix: ${result.lifecycle.fixCommand}`);
      }
    }
  }

  // Exit code
  if (!result.installed) {
    process.exit(1);
  } else if (result.authenticated === false) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}
