/**
 * Process spawning for stack execution
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { PATHS, getPackagePath, isPackageInstalled } from '@learnrudi/env';
import { getSecrets, redactSecrets } from './secrets.js';

/**
 * @typedef {Object} RunOptions
 * @property {Object} [inputs] - Input parameters
 * @property {string} [cwd] - Working directory
 * @property {Object} [env] - Additional environment variables
 * @property {Function} [onStdout] - Stdout callback
 * @property {Function} [onStderr] - Stderr callback
 * @property {Function} [onExit] - Exit callback
 * @property {AbortSignal} [signal] - Abort signal
 */

/**
 * @typedef {Object} RunResult
 * @property {number} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} durationMs
 * @property {Object} [outputs] - Parsed outputs
 */

function existingDirectory(dirPath) {
  return typeof dirPath === 'string' && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function getRudiPathEntries() {
  const entries = [PATHS.bins];

  for (const runtimeBin of [
    path.join(PATHS.runtimes, 'node', 'bin'),
    path.join(PATHS.runtimes, 'python', 'bin'),
  ]) {
    if (existingDirectory(runtimeBin)) {
      entries.push(runtimeBin);
    }
  }

  if (existingDirectory(PATHS.binaries)) {
    for (const entry of fs.readdirSync(PATHS.binaries, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        entries.push(path.join(PATHS.binaries, entry.name));
      }
    }
  }

  return entries;
}

function mergePathEntries(preferredEntries, inheritedPath) {
  const merged = [];
  const seen = new Set();

  for (const entry of [...preferredEntries, ...(inheritedPath || '').split(path.delimiter)]) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    merged.push(entry);
  }

  return merged.join(path.delimiter);
}

export function buildStackRunEnv({
  baseEnv = process.env,
  env = {},
  secrets = {},
  inputs = {},
  id,
  packagePath,
} = {}) {
  const inheritedPath = env.PATH || baseEnv.PATH || '';
  return {
    ...baseEnv,
    ...env,
    ...secrets,
    PATH: mergePathEntries(getRudiPathEntries(), inheritedPath),
    RUDI_INPUTS: JSON.stringify(inputs),
    RUDI_PACKAGE_ID: id,
    RUDI_PACKAGE_PATH: packagePath,
  };
}

/**
 * Run a stack
 * @param {string} id - Stack ID
 * @param {RunOptions} options
 * @returns {Promise<RunResult>}
 */
export async function runStack(id, options = {}) {
  const { inputs = {}, cwd, env = {}, onStdout, onStderr, onExit, signal } = options;

  const startTime = Date.now();
  const packagePath = getPackagePath(id);

  // Read manifest
  const manifestPath = path.join(packagePath, 'manifest.json');
  const { default: fs } = await import('fs');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Stack manifest not found: ${id}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Determine command and args
  const { command, args } = resolveCommandFromManifest(manifest, packagePath);

  // Get secrets
  const secrets = await getSecrets(manifest.requires?.secrets || []);

  // Build environment
  const runEnv = buildStackRunEnv({
    env,
    secrets,
    inputs,
    id,
    packagePath,
  });

  // Spawn process
  const proc = spawn(command, args, {
    cwd: cwd || packagePath,
    env: runEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal
  });

  // Write inputs to stdin and close
  proc.stdin.write(JSON.stringify(inputs));
  proc.stdin.end();

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => {
    const text = data.toString();
    stdout += text;
    if (onStdout) {
      onStdout(redactSecrets(text, secrets));
    }
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    if (onStderr) {
      onStderr(redactSecrets(text, secrets));
    }
  });

  return new Promise((resolve, reject) => {
    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('exit', (code, signal) => {
      const result = {
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        signal
      };

      if (onExit) {
        onExit(result);
      }

      resolve(result);
    });
  });
}

/**
 * Get command for a runtime
 * Checks for installed runtime first, then falls back to system PATH
 */
function getCommand(runtime) {
  const runtimeName = runtime.replace('runtime:', '');

  // Check our installed runtime first
  const runtimePath = path.join(PATHS.runtimes, runtimeName);

  // Try common binary locations within our runtime
  const binaryPaths = [
    path.join(runtimePath, 'bin', runtimeName === 'python' ? 'python3' : runtimeName),
    path.join(runtimePath, 'bin', runtimeName),
    path.join(runtimePath, runtimeName === 'python' ? 'python3' : runtimeName),
    path.join(runtimePath, runtimeName)
  ];

  for (const binPath of binaryPaths) {
    if (fs.existsSync(binPath)) {
      return binPath;
    }
  }

  // Fallback to system PATH
  switch (runtimeName) {
    case 'node':
      return 'node';
    case 'python':
      return 'python3';
    case 'shell':
    case 'bash':
      return 'bash';
    default:
      return runtimeName;
  }
}

function resolveCommandFromManifest(manifest, packagePath) {
  if (manifest.command) {
    const cmdArray = Array.isArray(manifest.command) ? manifest.command : [manifest.command];
    const command = resolveRelativePath(cmdArray[0], packagePath);
    const args = cmdArray.slice(1).map(arg => resolveRelativePath(arg, packagePath));
    return { command, args };
  }

  const entry = manifest.entry || 'index.js';
  const entryPath = path.join(packagePath, entry);
  const runtime = manifest.runtime || 'runtime:node';
  const command = getCommand(runtime);
  return { command, args: [entryPath] };
}

function resolveRelativePath(value, basePath) {
  if (typeof value !== 'string' || value.startsWith('-')) {
    return value;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  if (value.includes('/') || value.startsWith('.')) {
    return path.join(basePath, value);
  }
  return value;
}

/**
 * Run a stack in the background
 * @param {string} id - Stack ID
 * @param {RunOptions} options
 * @returns {{ proc: ChildProcess, promise: Promise<RunResult> }}
 */
export function runStackBackground(id, options = {}) {
  const controller = new AbortController();

  const promise = runStack(id, {
    ...options,
    signal: controller.signal
  });

  return {
    abort: () => controller.abort(),
    promise
  };
}

/**
 * Execute a command with runtime
 * @param {string} command - Command to run
 * @param {string[]} args - Arguments
 * @param {Object} options
 * @returns {Promise<RunResult>}
 */
export async function execCommand(command, args = [], options = {}) {
  const { cwd, env = {}, onStdout, onStderr, timeout = 60000 } = options;

  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const proc = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: controller.signal
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => {
    const text = data.toString();
    stdout += text;
    onStdout?.(text);
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    onStderr?.(text);
  });

  return new Promise((resolve, reject) => {
    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    proc.on('exit', (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - startTime
      });
    });
  });
}

/**
 * Check if a runtime is available
 * @param {string} runtime - Runtime ID
 * @returns {Promise<boolean>}
 */
export async function isRuntimeAvailable(runtime) {
  const command = getCommand(runtime);

  try {
    const result = await execCommand('which', [command], { timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get runtime version
 * @param {string} runtime - Runtime ID
 * @returns {Promise<string|null>}
 */
export async function getRuntimeVersion(runtime) {
  const command = getCommand(runtime);

  try {
    const result = await execCommand(command, ['--version'], { timeout: 5000 });
    if (result.exitCode === 0) {
      const match = result.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
      return match ? match[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}
