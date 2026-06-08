/**
 * Install command - install packages from registry
 *
 * Checks manifest for all dependencies:
 * - Runtime (node, python, deno, bun)
 * - Binaries (ffmpeg, ripgrep, etc.)
 * - Secrets (API keys, tokens)
 *
 * Then installs and registers to all detected AI agents.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fetchIndex, installPackage, resolvePackage, checkAllDependencies, formatDependencyResults, addStack, removeStack, updateSecretStatus } from '@learnrudi/core';
import { hasSecret, listSecrets, setSecret, getSecret } from '@learnrudi/secrets';
import { getInstalledAgents } from '@learnrudi/mcp';

/**
 * Load manifest from installed stack path
 */
async function loadManifest(installPath) {
  const manifestPath = path.join(installPath, 'manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get path to bundled runtime binary
 */
function getBundledBinary(runtime, binary) {
  const platform = process.platform;
  const rudiHome = process.env.RUDI_HOME || path.join(process.env.HOME || process.env.USERPROFILE, '.rudi');

  if (runtime === 'node') {
    const npmPath = platform === 'win32'
      ? path.join(rudiHome, 'runtimes', 'node', 'npm.cmd')
      : path.join(rudiHome, 'runtimes', 'node', 'bin', 'npm');

    if (fsSync.existsSync(npmPath)) {
      return npmPath;
    }
  }

  if (runtime === 'python') {
    const pipPath = platform === 'win32'
      ? path.join(rudiHome, 'runtimes', 'python', 'Scripts', 'pip.exe')
      : path.join(rudiHome, 'runtimes', 'python', 'bin', 'pip3');

    if (fsSync.existsSync(pipPath)) {
      return pipPath;
    }
  }

  // Fall back to system command
  return binary;
}

function getStackRuntime(manifest) {
  return manifest?.runtime || manifest?.mcp?.runtime || 'node';
}

function getStackCommand(manifest) {
  let command = manifest?.command;

  if (!command || command.length === 0) {
    if (manifest?.mcp?.command) {
      const mcpCmd = manifest.mcp.command;
      const mcpArgs = manifest.mcp.args || [];
      command = [mcpCmd, ...mcpArgs];
    }
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

/**
 * Install dependencies for a stack based on its runtime
 * Uses bundled runtimes from ~/.rudi/runtimes/ when available
 */
async function installDependencies(stackPath, manifest, options = {}) {
  const { includeDevDeps = false, nodeProject } = options;
  const runtime = getStackRuntime(manifest);

  // Binary stacks have no dependencies to install
  if (runtime === 'binary') {
    return { installed: false, reason: 'Binary runtime — no dependencies' };
  }

  try {
    if (runtime === 'node') {
      const project = nodeProject || getNodeProjectInfo(stackPath);
      if (!project) {
        return { installed: false, reason: 'No package.json' };
      }

      if (project.error) {
        return { installed: false, error: `Failed to read package.json: ${project.error}` };
      }

      // Check if node_modules already exists
      const nodeModulesPath = path.join(project.root, 'node_modules');
      try {
        await fs.access(nodeModulesPath);
        return { installed: false, reason: 'Dependencies already installed' };
      } catch {
        // node_modules doesn't exist, install
      }

      // Use bundled npm if available
      const npmCmd = getBundledBinary('node', 'npm');
      console.log(`  Installing npm dependencies...`);
      const installArgs = includeDevDeps ? 'install' : 'install --production';
      execSync(`"${npmCmd}" ${installArgs}`, {
        cwd: project.root,
        stdio: 'pipe',
      });
      return { installed: true };

    } else if (runtime === 'python') {
      // Check for requirements.txt (try python/ subdir first, then root)
      let requirementsPath = path.join(stackPath, 'python', 'requirements.txt');
      let reqCwd = path.join(stackPath, 'python');

      try {
        await fs.access(requirementsPath);
      } catch {
        // Fall back to root level
        requirementsPath = path.join(stackPath, 'requirements.txt');
        reqCwd = stackPath;
        try {
          await fs.access(requirementsPath);
        } catch {
          return { installed: false, reason: 'No requirements.txt' };
        }
      }

      // Use bundled pip if available
      const pipCmd = getBundledBinary('python', 'pip');
      console.log(`  Installing pip dependencies...`);
      try {
        execSync(`"${pipCmd}" install -r requirements.txt`, {
          cwd: reqCwd,
          stdio: 'pipe',
        });
      } catch (pipError) {
        // Show actual pip error output
        const stderr = pipError.stderr?.toString() || '';
        const stdout = pipError.stdout?.toString() || '';
        const output = stderr || stdout || pipError.message;
        return { installed: false, error: `pip install failed:\n${output}` };
      }
      return { installed: true };
    }

    return { installed: false, reason: `Unknown runtime: ${runtime}` };
  } catch (error) {
    return { installed: false, error: error.message };
  }
}

function getManifestSecrets(manifest) {
  return manifest?.requires?.secrets || manifest?.secrets || [];
}

export function getSecretName(secret) {
  if (typeof secret === 'string') return secret;
  if (!secret || typeof secret !== 'object') return null;
  return secret.name || secret.key || null;
}

export function isSecretRequired(secret) {
  if (!secret || typeof secret !== 'object') return true;
  return secret.required !== false;
}

function getSecretDescription(secret) {
  if (typeof secret !== 'object' || !secret) return null;
  return secret.description || secret.label || null;
}

function getSecretLink(secret) {
  if (typeof secret !== 'object' || !secret) return null;
  return secret.link || secret.helpUrl || null;
}

function getSecretLabel(secret) {
  if (typeof secret !== 'object' || !secret) return null;
  return secret.label || secret.name || secret.key || null;
}

export function getRelatedSkillInstallMode(flags = {}) {
  if (flags['with-related-skills'] || flags.withRelatedSkills) return 'include';
  if (flags['no-related-skills'] || flags.noRelatedSkills) return 'skip';
  return 'offer';
}

export function buildRelatedSkillInstallPlan(resolved, flags = {}) {
  const mode = getRelatedSkillInstallMode(flags);
  const relatedSkills = Array.isArray(resolved?.relatedSkills)
    ? resolved.relatedSkills
    : [];
  const missing = relatedSkills.filter((skill) => !skill.installed);

  return {
    mode,
    relatedSkills,
    missing,
    toInstall: mode === 'include' ? missing : [],
  };
}

function printRelatedSkillSummary(plan) {
  if (!plan || plan.relatedSkills.length === 0) return;

  console.log(`\nRelated skills:`);
  for (const skill of plan.relatedSkills) {
    const status = skill.installed ? '(installed)' : '(available)';
    console.log(`  - ${skill.id} ${status}`);
  }

  if (plan.missing.length === 0) {
    console.log(`  All related skills are already installed.`);
  } else if (plan.mode === 'include') {
    console.log(`  Missing related skills will be installed after the stack.`);
  } else if (plan.mode === 'skip') {
    console.log(`  Skipping related skills because --no-related-skills was set.`);
  } else {
    console.log(`  Related skills are editable workflow playbooks installed into ~/.rudi/skills.`);
  }
}

async function promptForRelatedSkills(plan) {
  if (!plan || plan.missing.length === 0) return [];
  if (plan.mode === 'include') return plan.toInstall;
  if (plan.mode === 'skip') return [];
  if (!process.stdin.isTTY || !process.stdout.isTTY) return [];

  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const label = plan.missing.length === 1 ? plan.missing[0].id : `${plan.missing.length} related skills`;
    const answer = await readline.question(`\nInstall ${label} now? [y/N] `);
    return /^(y|yes)$/i.test(answer.trim()) ? plan.missing : [];
  } finally {
    readline.close();
  }
}

async function installRelatedSkills(skills, options = {}) {
  const { allowScripts = false, withShims = false } = options;
  const results = [];

  for (const skill of skills) {
    console.log(`  Installing related skill ${skill.id}...`);
    const result = await installPackage(skill.id, {
      force: false,
      allowScripts,
      withShims,
      onProgress: (progress) => {
        if (progress.phase === 'installing') {
          console.log(`    Installing ${progress.package}...`);
        }
      }
    });

    results.push({
      id: skill.id,
      success: result.success,
      path: result.path,
      alreadyInstalled: result.alreadyInstalled,
      error: result.error,
    });
  }

  return results;
}

/**
 * Find a stack entry point from its command
 * @returns {{ entryArg: string|null, entryPath: string|null, error?: string }}
 */
function getStackEntryPoint(stackPath, manifest) {
  const command = getStackCommand(manifest);
  if (!command || command.length === 0) {
    return { entryArg: null, entryPath: null, error: 'No command defined in manifest' };
  }

  // Skip these - they're runtime commands or npx runners, not files
  const skipCommands = [
    'node', 'python', 'python3', 'npx', 'deno', 'bun',
    'tsx', 'ts-node', 'tsm', 'esno', 'esbuild-register', // TypeScript runners
    '-y', '--yes', // npx flags
  ];

  // Find file entry points (paths with extensions or containing /)
  const fileExtensions = ['.js', '.ts', '.mjs', '.cjs', '.py', '.mts', '.cts'];

  for (const arg of command) {
    if (skipCommands.includes(arg)) continue;
    if (arg.startsWith('-')) continue; // skip flags

    // Check if this looks like a file path (has extension or contains /)
    const looksLikeFile = fileExtensions.some(ext => arg.endsWith(ext)) || arg.includes('/');
    if (!looksLikeFile) continue;

    // This should be the entry point file
    const entryPath = path.join(stackPath, arg);
    return { entryArg: arg, entryPath };
  }

  return { entryArg: null, entryPath: null }; // No file args found, assume command is valid
}

/**
 * Validate that a stack's entry point exists
 * @returns {{ valid: boolean, error?: string }}
 */
function validateStackEntryPoint(stackPath, manifest) {
  const runtime = getStackRuntime(manifest);

  // Binary stacks: validate binary exists and is executable
  if (runtime === 'binary') {
    const command = getStackCommand(manifest);
    if (!command || command.length === 0) {
      return { valid: false, error: 'Binary stack has no command' };
    }
    const binName = command[0].replace(/^\.\//, '');
    const binaryPath = path.join(stackPath, binName);
    if (!fsSync.existsSync(binaryPath)) {
      return { valid: false, error: `Binary not found: ${command[0]}` };
    }
    if (process.platform !== 'win32') {
      const stats = fsSync.statSync(binaryPath);
      if ((stats.mode & 0o111) === 0) {
        return { valid: false, error: `Binary not executable: ${command[0]}` };
      }
    }
    return { valid: true };
  }

  const entryPoint = getStackEntryPoint(stackPath, manifest);

  if (entryPoint.error) {
    return { valid: false, error: entryPoint.error };
  }

  if (!entryPoint.entryPath) {
    return { valid: true };
  }

  if (!fsSync.existsSync(entryPoint.entryPath)) {
    return { valid: false, error: `Entry point not found: ${entryPoint.entryArg}` };
  }

  return { valid: true };
}

async function buildStackIfNeeded(stackPath, manifest, options = {}) {
  const { nodeProject, verbose = false } = options;
  const runtime = getStackRuntime(manifest);

  if (runtime !== 'node') {
    return { built: false, reason: 'Non-node runtime' };
  }

  const entryPoint = getStackEntryPoint(stackPath, manifest);
  if (entryPoint.error) {
    return { built: false, reason: entryPoint.error };
  }

  if (!entryPoint.entryPath || fsSync.existsSync(entryPoint.entryPath)) {
    return { built: false, reason: 'Entry point already present' };
  }

  const project = nodeProject || getNodeProjectInfo(stackPath);
  if (!project) {
    return { built: false, reason: 'No package.json' };
  }

  if (project.error) {
    throw new Error(`Failed to read package.json: ${project.error}`);
  }

  if (!project.packageJson?.scripts?.build) {
    return { built: false, reason: 'No build script' };
  }

  const npmCmd = getBundledBinary('node', 'npm');
  console.log(`  Building stack...`);

  try {
    execSync(`"${npmCmd}" run build`, {
      cwd: project.root,
      stdio: verbose ? 'inherit' : 'pipe',
    });
  } catch (buildError) {
    const stderr = buildError.stderr?.toString() || '';
    const stdout = buildError.stdout?.toString() || '';
    const output = stderr || stdout || buildError.message;
    throw new Error(`Build failed:\n${output}`);
  }

  return { built: true };
}

/**
 * Check which secrets are available in RUDI's secrets store
 * @returns {Promise<{ found: string[], missing: string[] }>}
 */
async function checkSecrets(manifest) {
  const secrets = getManifestSecrets(manifest);

  const found = [];
  const missing = [];

  for (const secret of secrets) {
    const key = getSecretName(secret);
    const isRequired = isSecretRequired(secret);
    if (!key) continue;

    const exists = await hasSecret(key);
    if (exists) {
      found.push(key);
    } else if (isRequired) {
      missing.push(key);
    }
  }

  return { found, missing };
}

/**
 * Parse .env.example as schema - extract required/optional keys
 * This is used to show what secrets are needed
 */
async function parseEnvExample(installPath) {
  const examplePath = path.join(installPath, '.env.example');
  try {
    const content = await fs.readFile(examplePath, 'utf-8');
    const keys = [];

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=/);
      if (match) {
        keys.push(match[1]);
      }
    }

    return keys;
  } catch {
    return [];
  }
}

async function cleanupFailedStackInstall(stackId, stackPath, removeConfig) {
  if (stackPath) {
    try {
      await fs.rm(stackPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  if (removeConfig && stackId) {
    try {
      removeStack(stackId);
    } catch {
      // Ignore config cleanup errors
    }
  }
}

export async function cmdInstall(args, flags) {
  let pkgId = args[0];

  if (!pkgId) {
    console.error('Usage: rudi install <package>');
    console.error('Example: rudi install slack');
    console.error('');
    console.error('After installing, run:');
    console.error('  rudi secrets set <KEY>    # Configure required secrets');
    console.error('  rudi integrate all        # Wire up your agents');
    process.exit(1);
  }

  // Handle deprecated "prompt:" prefix
  if (pkgId.startsWith('prompt:')) {
    console.log('Note: "prompt:" has been renamed to "skill:". Converting automatically.\n');
    pkgId = 'skill:' + pkgId.slice('prompt:'.length);
  }

  const force = flags.force || false;
  const allowScripts = flags['allow-scripts'] || flags.allowScripts || false;
  const withShims = flags['with-shims'] || flags.withShims || false;

  console.log(`Resolving ${pkgId}...`);

  try {
    if (!pkgId.startsWith('npm:')) {
      await fetchIndex({ force: true });
    }

    // First resolve to show what will be installed
    const resolved = await resolvePackage(pkgId);
    const relatedSkillPlan = buildRelatedSkillInstallPlan(resolved, flags);

    console.log(`\nPackage: ${resolved.name} (${resolved.id})`);
    console.log(`Version: ${resolved.version}`);
    if (resolved.description) {
      console.log(`Description: ${resolved.description}`);
    }

    if (resolved.installed && !force) {
      console.log(`\nAlready installed. Use --force to reinstall.`);
      return;
    }

    // Show dependencies
    if (resolved.dependencies?.length > 0) {
      console.log(`\nDependencies:`);
      for (const dep of resolved.dependencies) {
        const status = dep.installed ? '(installed)' : '(will install)';
        console.log(`  - ${dep.id} ${status}`);
      }
    }

    if (resolved.kind === 'stack') {
      printRelatedSkillSummary(relatedSkillPlan);
    }

    // Check ALL dependencies: runtimes, binaries, and secrets
    console.log(`\nDependency check:`);

    // 1. Check system dependencies (runtimes, binaries)
    const depCheck = checkAllDependencies(resolved);
    if (depCheck.results.length > 0) {
      for (const line of formatDependencyResults(depCheck.results)) {
        console.log(line);
      }
    }

    // 2. Check secrets from RUDI's secrets store
    const secretsCheck = { found: [], missing: [] };
    if (resolved.requires?.secrets?.length > 0) {
      for (const secret of resolved.requires.secrets) {
        const name = getSecretName(secret);
        const isRequired = isSecretRequired(secret);
        if (!name) continue;

        const exists = await hasSecret(name);
        if (exists) {
          secretsCheck.found.push(name);
          console.log(`  ✓ ${name} (from secrets store)`);
        } else if (isRequired) {
          secretsCheck.missing.push(name);
          console.log(`  ○ ${name} - not configured`);
        } else {
          console.log(`  ○ ${name} (optional)`);
        }
      }
    }

    // Block on missing system deps (not secrets - those can be added after)
    if (!depCheck.satisfied && !force) {
      console.error(`\n✗ Missing required dependencies. Install them first:`);
      for (const r of depCheck.results.filter(r => !r.available)) {
        console.error(`    rudi install ${r.type}:${r.name}`);
      }
      console.error(`\nOr use --force to install anyway.`);
      process.exit(1);
    }

    console.log(`\nInstalling...`);

    const result = await installPackage(pkgId, {
      force,
      allowScripts,
      withShims,
      onProgress: (progress) => {
        if (progress.phase === 'installing') {
          console.log(`  Installing ${progress.package}...`);
        }
      }
    });

    if (!result.success) {
      console.error(`\n✗ Installation failed: ${result.error}`);
      process.exit(1);
    }

    if (resolved.kind !== 'stack') {
      console.log(`\n✓ Installed ${result.id}`);
      console.log(`  Path: ${result.path}`);

      if (result.installed?.length > 0) {
        console.log(`\n  Also installed:`);
        for (const id of result.installed) {
          console.log(`    - ${id}`);
        }
      }

      // For skills, show required stacks if any
      if (resolved.kind === 'skill' && resolved.requires?.stacks?.length > 0) {
        console.log(`  Required stacks: ${resolved.requires.stacks.join(', ')}`);
      }

      console.log(`\n✓ Installed successfully.`);
      return;
    }

    const manifest = await loadManifest(result.path);
    if (!manifest) {
      await cleanupFailedStackInstall(result.id, result.path, false);
      throw new Error('Stack manifest not found after install');
    }

    const nodeProject = getNodeProjectInfo(result.path);
    const includeDevDeps = Boolean(nodeProject?.packageJson?.scripts?.build);
    let stackRegistered = false;

    try {
      const depResult = await installDependencies(result.path, manifest, {
        includeDevDeps,
        nodeProject
      });

      if (depResult.installed) {
        console.log(`  ✓ Dependencies installed`);
      } else if (depResult.error) {
        throw new Error(`Failed to install dependencies:\n${depResult.error}`);
      }

      const buildResult = await buildStackIfNeeded(result.path, manifest, {
        nodeProject,
        verbose: flags.verbose
      });

      if (buildResult.built) {
        console.log(`  ✓ Build complete`);
      }

      const validation = validateStackEntryPoint(result.path, manifest);
      if (!validation.valid) {
        throw new Error(`Stack validation failed: ${validation.error}`);
      }

      addStack(result.id, {
        path: result.path,
        runtime: getStackRuntime(manifest),
        command: getStackCommand(manifest),
        secrets: getManifestSecrets(manifest),
        version: manifest.version
      });
      stackRegistered = true;
      console.log(`  ✓ Updated rudi.json`);
    } catch (stackError) {
      await cleanupFailedStackInstall(result.id, result.path, stackRegistered);
      throw stackError;
    }

    console.log(`\n✓ Installed ${result.id}`);
    console.log(`  Path: ${result.path}`);

    if (result.installed?.length > 0) {
      console.log(`\n  Also installed:`);
      for (const id of result.installed) {
        console.log(`    - ${id}`);
      }
    }

    const selectedRelatedSkills = await promptForRelatedSkills(relatedSkillPlan);
    const relatedSkillResults = selectedRelatedSkills.length > 0
      ? await installRelatedSkills(selectedRelatedSkills, { allowScripts, withShims })
      : [];

    if (relatedSkillResults.length > 0) {
      console.log(`\n  Related skills:`);
      for (const relatedResult of relatedSkillResults) {
        if (relatedResult.success) {
          console.log(`    - ${relatedResult.id} installed`);
        } else {
          console.log(`    - ${relatedResult.id} failed: ${relatedResult.error}`);
        }
      }
    }

    // Check secrets status
    const { found, missing } = await checkSecrets(manifest);

    // Also check .env.example for any keys not in manifest
    const envExampleKeys = await parseEnvExample(result.path);
    for (const key of envExampleKeys) {
      if (!found.includes(key) && !missing.includes(key)) {
        const exists = await hasSecret(key);
        if (!exists) {
          missing.push(key);
        } else {
          found.push(key);
        }
      }
    }

    // Add placeholder entries to secrets.json for missing secrets
    // This makes it visible what needs to be configured
    if (missing.length > 0) {
      for (const key of missing) {
        const existing = await getSecret(key);
        if (existing === null) {
          // Add empty placeholder - hasSecret() will return false for empty strings
          await setSecret(key, '');
        }
        // Update rudi.json secrets metadata
        try {
          updateSecretStatus(key, false);
        } catch {
          // Ignore errors updating secret status
        }
      }
    }

    // Update rudi.json for found secrets
    for (const key of found) {
      try {
        updateSecretStatus(key, true);
      } catch {
        // Ignore errors updating secret status
      }
    }

    // Show next steps
    console.log(`\nNext steps:`);

    // 1. Secrets
    if (missing.length > 0) {
      console.log(`\n  1. Configure secrets (${missing.length} pending):`);
      for (const key of missing) {
        const secret = getManifestSecrets(manifest).find(s =>
          getSecretName(s) === key
        );
        const helpUrl = getSecretLink(secret);
        console.log(`     rudi secrets set ${key} "<your-value>"`);
        if (helpUrl) {
          console.log(`     # Get yours: ${helpUrl}`);
        }
      }
      console.log(`\n     Check status: rudi secrets list`);
    } else if (found.length > 0) {
      console.log(`\n  1. Secrets: ✓ ${found.length} configured`);
    } else {
      console.log(`\n  1. Secrets: ✓ None required`);
    }

    // 2. Integrate
    const agents = getInstalledAgents();
    if (agents.length > 0) {
      console.log(`\n  2. Wire up your agents:`);
      console.log(`     rudi integrate all`);
      console.log(`     # Detected: ${agents.map(a => a.name).join(', ')}`);
    }

    // 3. Done
    console.log(`\n  3. Restart your agent to use the stack`);

    const installedRelatedSkillIds = new Set(
      relatedSkillResults.filter((relatedResult) => relatedResult.success).map((relatedResult) => relatedResult.id)
    );
    const remainingRelatedSkills = relatedSkillPlan.missing.filter(
      (skill) => !installedRelatedSkillIds.has(skill.id)
    );
    if (remainingRelatedSkills.length > 0) {
      console.log(`\n  Related skills available:`);
      for (const skill of remainingRelatedSkills) {
        console.log(`     - ${skill.id}`);
      }
      console.log(`     Install/edit them with: rudi install ${resolved.id} --with-related-skills`);
      console.log(`     Editable after install: ~/.rudi/skills`);
    }
    return;

  } catch (error) {
    console.error(`Installation failed: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
