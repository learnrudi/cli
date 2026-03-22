/**
 * Package control plane routes — discovery, install jobs, and secrets.
 */

import crypto from 'crypto';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  addStack,
  installPackage,
  listPackages,
  readRudiConfig,
  removeStack,
  resolvePackage,
  searchPackages,
  updateSecretStatus,
} from '@learnrudi/core';
import {
  getMaskedSecrets,
  getSecret,
  hasSecret,
  removeSecret,
  setSecret,
} from '@learnrudi/secrets';

const VALID_KINDS = new Set(['stack', 'prompt', 'runtime', 'binary', 'agent']);
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_QUERY_LENGTH = 200;

const defaultDeps = {
  addStack,
  getMaskedSecrets,
  getSecret,
  hasSecret,
  installPackage,
  listPackages,
  readRudiConfig,
  removeSecret,
  removeStack,
  resolvePackage,
  searchPackages,
  setSecret,
  updateSecretStatus,
};

function normalizeKind(rawKind) {
  const kind = typeof rawKind === 'string' ? rawKind.trim() : '';
  if (!kind) return null;
  return VALID_KINDS.has(kind) ? kind : null;
}

function projectPackage(pkg, fallbackKind = null) {
  const kind = pkg.kind || fallbackKind || null;
  return {
    id: pkg.id || (kind && pkg.name ? `${kind}:${pkg.name}` : null),
    kind,
    name: pkg.name || null,
    description: pkg.description || '',
    version: pkg.version || null,
    category: pkg.category || null,
    tags: Array.isArray(pkg.tags) ? pkg.tags : [],
    requires: pkg.requires || null,
  };
}

function projectInstalledStacks(config) {
  const stacks = {};
  for (const [stackId, stackConfig] of Object.entries(config?.stacks || {})) {
    stacks[stackId] = {
      version: stackConfig.version || null,
      installedAt: stackConfig.installedAt || null,
      secrets: Array.isArray(stackConfig.secrets) ? stackConfig.secrets : [],
    };
  }
  return stacks;
}

async function loadManifest(installPath) {
  const manifestPath = path.join(installPath, 'manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function getBundledBinary(runtime, binary) {
  const platform = process.platform;
  const rudiHome = process.env.RUDI_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.rudi');

  if (runtime === 'node') {
    const npmPath = platform === 'win32'
      ? path.join(rudiHome, 'runtimes', 'node', 'npm.cmd')
      : path.join(rudiHome, 'runtimes', 'node', 'bin', 'npm');
    if (fsSync.existsSync(npmPath)) return npmPath;
  }

  if (runtime === 'python') {
    const pipPath = platform === 'win32'
      ? path.join(rudiHome, 'runtimes', 'python', 'Scripts', 'pip.exe')
      : path.join(rudiHome, 'runtimes', 'python', 'bin', 'pip3');
    if (fsSync.existsSync(pipPath)) return pipPath;
  }

  return binary;
}

function getStackRuntime(manifest) {
  return manifest?.runtime || manifest?.mcp?.runtime || 'node';
}

function getStackCommand(manifest) {
  let command = manifest?.command;
  if ((!command || command.length === 0) && manifest?.mcp?.command) {
    const mcpArgs = manifest.mcp.args || [];
    command = [manifest.mcp.command, ...mcpArgs];
  }
  return command;
}

function getNodeProjectInfo(stackPath) {
  const candidates = [stackPath, path.join(stackPath, 'node')];

  for (const root of candidates) {
    const packageJsonPath = path.join(root, 'package.json');
    if (!fsSync.existsSync(packageJsonPath)) continue;
    try {
      const content = fsSync.readFileSync(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      return { root, packageJsonPath, packageJson };
    } catch (error) {
      return { root, packageJsonPath, error: error.message };
    }
  }

  return null;
}

function getManifestSecrets(manifest) {
  return manifest?.requires?.secrets || manifest?.secrets || [];
}

function getSecretName(secret) {
  if (typeof secret === 'string') return secret;
  return secret?.name || secret?.key;
}

function getStackEntryPoint(stackPath, manifest) {
  const command = getStackCommand(manifest);
  if (!command || command.length === 0) {
    return { entryArg: null, entryPath: null, error: 'No command defined in manifest' };
  }

  const skipCommands = [
    'node', 'python', 'python3', 'npx', 'deno', 'bun',
    'tsx', 'ts-node', 'tsm', 'esno', 'esbuild-register',
    '-y', '--yes',
  ];
  const fileExtensions = ['.js', '.ts', '.mjs', '.cjs', '.py', '.mts', '.cts'];

  for (const arg of command) {
    if (skipCommands.includes(arg) || arg.startsWith('-')) continue;
    const looksLikeFile = fileExtensions.some((ext) => arg.endsWith(ext)) || arg.includes('/');
    if (!looksLikeFile) continue;
    return {
      entryArg: arg,
      entryPath: path.join(stackPath, arg),
    };
  }

  return { entryArg: null, entryPath: null };
}

function validateStackEntryPoint(stackPath, manifest) {
  const entryPoint = getStackEntryPoint(stackPath, manifest);
  if (entryPoint.error) return { valid: false, error: entryPoint.error };
  if (!entryPoint.entryPath) return { valid: true };
  if (!fsSync.existsSync(entryPoint.entryPath)) {
    return { valid: false, error: `Entry point not found: ${entryPoint.entryArg}` };
  }
  return { valid: true };
}

async function buildStackIfNeeded(stackPath, manifest, onProgress) {
  if (getStackRuntime(manifest) !== 'node') {
    return { built: false, reason: 'Non-node runtime' };
  }

  const entryPoint = getStackEntryPoint(stackPath, manifest);
  if (entryPoint.error) {
    return { built: false, reason: entryPoint.error };
  }
  if (!entryPoint.entryPath || fsSync.existsSync(entryPoint.entryPath)) {
    return { built: false, reason: 'Entry point already present' };
  }

  const project = getNodeProjectInfo(stackPath);
  if (!project) return { built: false, reason: 'No package.json' };
  if (project.error) throw new Error(`Failed to read package.json: ${project.error}`);
  if (!project.packageJson?.scripts?.build) {
    return { built: false, reason: 'No build script' };
  }

  onProgress?.({ phase: 'building' });
  const npmCmd = getBundledBinary('node', 'npm');
  try {
    execSync(`"${npmCmd}" run build`, {
      cwd: project.root,
      stdio: 'pipe',
    });
  } catch (buildError) {
    const stderr = buildError.stderr?.toString() || '';
    const stdout = buildError.stdout?.toString() || '';
    const output = stderr || stdout || buildError.message;
    throw new Error(`Build failed:\n${output}`);
  }

  return { built: true };
}

async function checkSecrets(manifest, deps) {
  const found = [];
  const missing = [];

  for (const secret of getManifestSecrets(manifest)) {
    const name = getSecretName(secret);
    if (!name) continue;
    const isRequired = typeof secret === 'object' ? secret.required !== false : true;
    const exists = await deps.hasSecret(name);
    if (exists) {
      found.push(name);
    } else if (isRequired) {
      missing.push(name);
    }
  }

  return { found, missing };
}

async function parseEnvExample(installPath) {
  const examplePath = path.join(installPath, '.env.example');
  try {
    const content = await fs.readFile(examplePath, 'utf-8');
    const keys = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=/);
      if (match) keys.push(match[1]);
    }
    return keys;
  } catch {
    return [];
  }
}

async function cleanupFailedStackInstall(stackId, stackPath, removeConfig, deps) {
  if (stackPath) {
    try {
      await fs.rm(stackPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }

  if (removeConfig && stackId) {
    try {
      deps.removeStack(stackId);
    } catch {
      // Ignore config cleanup errors.
    }
  }
}

async function defaultInstallAndRegisterPackage({ id, force, onProgress }, deps) {
  const resolved = await deps.resolvePackage(id);
  const installResult = await deps.installPackage(id, {
    force,
    onProgress,
  });

  if (!installResult?.success) {
    throw new Error(installResult?.error || `Installation failed for ${id}`);
  }

  if (resolved.kind !== 'stack') {
    return {
      id: installResult.id,
      kind: resolved.kind,
      path: installResult.path,
      version: resolved.version || null,
      installed: installResult.installed || [],
      alreadyInstalled: !!installResult.alreadyInstalled,
    };
  }

  let stackRegistered = false;
  try {
    onProgress?.({ phase: 'loading_manifest' });
    const manifest = await loadManifest(installResult.path);
    if (!manifest) {
      throw new Error('Stack manifest not found after install');
    }

    const buildResult = await buildStackIfNeeded(installResult.path, manifest, onProgress);
    const validation = validateStackEntryPoint(installResult.path, manifest);
    if (!validation.valid) {
      throw new Error(`Stack validation failed: ${validation.error}`);
    }

    onProgress?.({ phase: 'registering' });
    deps.addStack(installResult.id, {
      path: installResult.path,
      runtime: getStackRuntime(manifest),
      command: getStackCommand(manifest),
      secrets: getManifestSecrets(manifest),
      version: manifest.version,
    });
    stackRegistered = true;

    onProgress?.({ phase: 'configuring_secrets' });
    const { found, missing } = await checkSecrets(manifest, deps);
    const envExampleKeys = await parseEnvExample(installResult.path);
    for (const key of envExampleKeys) {
      if (found.includes(key) || missing.includes(key)) continue;
      const exists = await deps.hasSecret(key);
      if (exists) found.push(key);
      else missing.push(key);
    }

    for (const key of missing) {
      const existing = await deps.getSecret(key);
      if (existing === null) {
        await deps.setSecret(key, '');
      }
      try {
        deps.updateSecretStatus(key, false, 'secrets.json');
      } catch {
        // Ignore metadata sync errors.
      }
    }

    for (const key of found) {
      try {
        deps.updateSecretStatus(key, true, 'secrets.json');
      } catch {
        // Ignore metadata sync errors.
      }
    }

    return {
      id: installResult.id,
      kind: 'stack',
      path: installResult.path,
      version: manifest.version || resolved.version || null,
      installed: installResult.installed || [],
      alreadyInstalled: !!installResult.alreadyInstalled,
      built: !!buildResult.built,
      secrets: { found, missing },
    };
  } catch (error) {
    if (!installResult.alreadyInstalled) {
      await cleanupFailedStackInstall(installResult.id, installResult.path, stackRegistered, deps);
    }
    throw error;
  }
}

export function buildPackageRoutes(ctx, overrides = {}) {
  const { json, error, readBody, log, broadcast, requiredField, invalidField } = ctx;

  const deps = { ...defaultDeps, ...overrides };
  if (!overrides.installAndRegisterPackage) {
    deps.installAndRegisterPackage = (options) => defaultInstallAndRegisterPackage(options, deps);
  }

  const jobs = new Map();
  const expiryTimers = new Map();
  const activeInstallJobs = new Map(); // packageId -> jobId
  let activeInstallJobId = null;

  function clearJobExpiry(jobId) {
    const timer = expiryTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      expiryTimers.delete(jobId);
    }
  }

  function expireJob(jobId) {
    clearJobExpiry(jobId);
    jobs.delete(jobId);
  }

  function scheduleJobExpiry(jobId) {
    clearJobExpiry(jobId);
    const timer = setTimeout(() => expireJob(jobId), JOB_TTL_MS);
    timer.unref?.();
    expiryTimers.set(jobId, timer);
  }

  function updateJobProgress(job, progress = {}) {
    const next = {
      phase: typeof progress.phase === 'string' ? progress.phase : 'working',
      detail: progress.detail || progress.message || null,
    };
    if (Number.isFinite(progress.current)) next.current = progress.current;
    if (Number.isFinite(progress.total)) next.total = progress.total;

    job.progress = next;
    job.updatedAt = new Date().toISOString();
    broadcast('package:progress', {
      jobId: job.jobId,
      id: job.id,
      ...next,
    });
  }

  async function handle(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/packages/search') {
      const query = (url.searchParams.get('q') || '').trim().slice(0, MAX_QUERY_LENGTH);
      if (!query) return requiredField(res, 'q', { location: 'query' });

      const rawKind = url.searchParams.get('kind');
      const kind = rawKind == null ? null : normalizeKind(rawKind);
      if (rawKind != null && !kind) {
        return invalidField(res, 'kind', 'invalid kind', {
          location: 'query',
          reason: 'unsupported_value',
          details: { value: rawKind },
        });
      }

      try {
        const packages = await deps.searchPackages(query, kind ? { kind } : {});
        json(res, { packages: packages.map((pkg) => projectPackage(pkg)) });
      } catch (err) {
        log('packages', 'error', `package search failed: ${err.message}`);
        error(res, `Package search failed: ${err.message}`, 500);
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/packages/list') {
      const kind = normalizeKind(url.searchParams.get('kind'));
      if (!kind) {
        return invalidField(res, 'kind', 'valid kind required', {
          location: 'query',
          reason: 'required_supported_value',
        });
      }

      try {
        const packages = await deps.listPackages(kind);
        json(res, { packages: packages.map((pkg) => projectPackage(pkg, kind)) });
      } catch (err) {
        log('packages', 'error', `package list failed: ${err.message}`);
        error(res, `Package list failed: ${err.message}`, 500);
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/packages/installed') {
      try {
        const config = deps.readRudiConfig() || { stacks: {} };
        json(res, { stacks: projectInstalledStacks(config) });
      } catch (err) {
        log('packages', 'error', `installed package read failed: ${err.message}`);
        error(res, `Failed to read installed packages: ${err.message}`, 500);
      }
      return true;
    }

    const jobMatch = url.pathname.match(/^\/packages\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      const job = jobs.get(jobId);
      if (!job) return error(res, 'job not found', 404);
      json(res, {
        jobId: job.jobId,
        id: job.id,
        status: job.status,
        progress: job.progress,
        result: job.result || null,
        error: job.error || null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt || null,
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/packages/install') {
      const body = await readBody(req);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const force = body.force === true;
      if (!id) return requiredField(res, 'id');

      const existingJobId = activeInstallJobs.get(id);
      if (existingJobId) {
        const existingJob = jobs.get(existingJobId);
        return json(res, {
          jobId: existingJobId,
          status: existingJob?.status || 'running',
          id,
          reused: true,
        });
      }

      if (activeInstallJobId) {
        const activeJob = jobs.get(activeInstallJobId);
        return json(res, {
          error: 'another package install is already in progress',
          activeJobId: activeInstallJobId,
          activePackageId: activeJob?.id || null,
        }, 409);
      }

      const jobId = `job-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const job = {
        jobId,
        id,
        status: 'running',
        progress: { phase: 'queued', detail: null },
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        result: null,
        error: null,
      };

      jobs.set(jobId, job);
      activeInstallJobs.set(id, jobId);
      activeInstallJobId = jobId;
      updateJobProgress(job, { phase: 'starting' });

      void (async () => {
        try {
          const result = await deps.installAndRegisterPackage({
            id,
            force,
            onProgress: (progress) => updateJobProgress(job, progress),
          });
          job.status = 'completed';
          job.result = result;
          job.completedAt = new Date().toISOString();
          job.updatedAt = job.completedAt;
          broadcast('package:complete', {
            jobId,
            id,
            success: true,
            result,
          });
          log('packages', 'info', 'package install completed', { jobId, id });
        } catch (err) {
          job.status = 'failed';
          job.error = err.message;
          job.completedAt = new Date().toISOString();
          job.updatedAt = job.completedAt;
          broadcast('package:complete', {
            jobId,
            id,
            success: false,
            error: err.message,
          });
          log('packages', 'warn', `package install failed: ${err.message}`, { jobId, id });
        } finally {
          activeInstallJobs.delete(id);
          if (activeInstallJobId === jobId) activeInstallJobId = null;
          scheduleJobExpiry(jobId);
        }
      })();

      json(res, { jobId, status: 'started', id });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/packages/secrets') {
      try {
        const secrets = await deps.getMaskedSecrets();
        json(res, { secrets });
      } catch (err) {
        log('packages', 'error', `secret list failed: ${err.message}`);
        error(res, `Failed to read secrets: ${err.message}`, 500);
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/packages/secrets') {
      const body = await readBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const value = typeof body.value === 'string' ? body.value : null;
      if (!SECRET_NAME_RE.test(name)) {
        return invalidField(res, 'name', 'secret name must be UPPER_SNAKE_CASE', {
          reason: 'pattern_mismatch',
        });
      }
      if (value === null) return requiredField(res, 'value');

      try {
        await deps.setSecret(name, value);
        try {
          deps.updateSecretStatus(name, value !== '', 'secrets.json');
        } catch {
          // Ignore metadata sync errors.
        }
        json(res, { ok: true });
      } catch (err) {
        log('packages', 'error', `secret set failed: ${err.message}`);
        error(res, `Failed to save secret: ${err.message}`, 500);
      }
      return true;
    }

    const secretDeleteMatch = url.pathname.match(/^\/packages\/secrets\/([^/]+)$/);
    if (req.method === 'DELETE' && secretDeleteMatch) {
      const name = decodeURIComponent(secretDeleteMatch[1]).trim();
      if (!SECRET_NAME_RE.test(name)) {
        return invalidField(res, 'name', 'secret name must be UPPER_SNAKE_CASE', {
          location: 'path',
          reason: 'pattern_mismatch',
        });
      }

      try {
        await deps.removeSecret(name);
        try {
          deps.updateSecretStatus(name, false, 'secrets.json');
        } catch {
          // Ignore metadata sync errors.
        }
        json(res, { ok: true });
      } catch (err) {
        log('packages', 'error', `secret delete failed: ${err.message}`);
        error(res, `Failed to delete secret: ${err.message}`, 500);
      }
      return true;
    }

    return false;
  }

  function cleanup() {
    for (const timer of expiryTimers.values()) {
      clearTimeout(timer);
    }
    expiryTimers.clear();
    jobs.clear();
    activeInstallJobs.clear();
    activeInstallJobId = null;
  }

  return { handle, cleanup };
}
