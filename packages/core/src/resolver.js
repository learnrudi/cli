/**
 * Dependency resolver for RUDI
 * Resolves package dependencies and version constraints
 */

import {
  assertGitHubDirectoryFile,
  getPackage,
  getManifest,
  isGitHubTreeUrl,
  normalizeRegistryPackage,
  readGitHubJsonFile,
  resolveGitHubTreeSource,
  resolveRegistryPackageForPlatform,
} from '@learnrudi/registry-client';
import { getPlatformArch, isPackageInstalled, parsePackageId } from '@learnrudi/env';
import { readLockfile } from './lockfile.js';
import { getNpmNodeRuntimeId } from './npm-runtime.js';

const SINGLE_FILE_KINDS = new Set(['skill', 'prompt', 'workflow']);
const EXTERNAL_STACK_ID_PATTERN = /^stack:[a-z0-9][a-z0-9-_]*$/;
const EXTERNAL_SKILL_ID_PATTERN = /^skill:[a-z0-9][a-z0-9-_]*$/;

async function getInstallableRegistryPackage(id) {
  const pkg = await getPackage(id);
  if (!pkg) return null;

  const isCanonicalV2Package = Boolean(pkg.delivery && pkg.install?.source);
  let manifest = null;
  if (pkg.path && !SINGLE_FILE_KINDS.has(pkg.kind) && !isCanonicalV2Package) {
    manifest = await getManifest(pkg);
  }

  const merged = manifest ? { ...pkg, ...manifest } : pkg;
  return isCanonicalV2Package
    ? resolveRegistryPackageForPlatform(merged, getPlatformArch())
    : merged;
}

/**
 * Resolve a package and all its dependencies
 * @param {string} id - Package ID (e.g., 'stack:pdf-creator' or just 'pdf-creator')
 * @returns {Promise<Object>} Resolved package with dependencies
 */
export async function resolvePackage(id) {
  // 1. Handle dynamic npm install (npm:<package>)
  if (id.startsWith('npm:')) {
    return resolveDynamicNpm(id);
  }

  // 2. Handle public GitHub tree sources before registry lookup.
  if (isGitHubTreeUrl(id) || /^https?:\/\//i.test(id)) {
    return resolveGitHubPackage(id);
  }

  // 3. Get package from registry (searches all kinds if no prefix)
  const mergedPkg = await getInstallableRegistryPackage(id);
  if (!mergedPkg) {
    throw new Error(`Package not found: ${id}`);
  }

  return buildResolvedPackage(mergedPkg, undefined, id);
}

async function buildResolvedPackage(mergedPkg, relatedSkillsOverride, requestedId = mergedPkg.id) {

  // Build full ID
  const fullId = mergedPkg.id?.includes(':')
    ? mergedPkg.id
    : `${mergedPkg.kind}:${mergedPkg.id || String(requestedId || '').split(':').pop()}`;

  // Check if installed
  const installed = typeof mergedPkg.installed === 'boolean'
    ? mergedPkg.installed
    : isPackageInstalled(fullId);

  // Resolve dependencies
  const dependencies = await resolveDependencies(mergedPkg);
  const relatedSkills = relatedSkillsOverride || await resolveRelatedSkills(mergedPkg);

  return {
    id: fullId,
    kind: mergedPkg.kind,
    name: mergedPkg.name,
    version: mergedPkg.version,
    path: mergedPkg.path,
    description: mergedPkg.description,
    runtime: mergedPkg.runtime,
    entry: mergedPkg.entry,
    installed,
    sourceMismatch: mergedPkg.sourceMismatch === true,
    source: mergedPkg.source,
    dependencies,
    requires: mergedPkg.requires,
    related: mergedPkg.related,
    relatedSkills,
    // Install-related properties (from canonical manifest)
    npmPackage: mergedPkg.npmPackage,
    pipPackage: mergedPkg.pipPackage,
    postInstall: mergedPkg.postInstall,
    command: mergedPkg.command,
    binary: mergedPkg.binary,
    bins: mergedPkg.bins,
    binaries: mergedPkg.binaries, // backward compat
    installDir: mergedPkg.installDir,
    installType: mergedPkg.installType,
    nativeInstaller: mergedPkg.nativeInstaller,
    nativeBinPath: mergedPkg.nativeBinPath,
    // Canonical registry fields. Installed-state aliases above remain populated
    // at the boundary so existing local manifests continue to work.
    delivery: mergedPkg.delivery,
    install: mergedPkg.install,
    detect: mergedPkg.detect,
    auth: mergedPkg.auth,
    installHints: mergedPkg.installHints,
    meta: mergedPkg.meta,
    mcp: mergedPkg.mcp,
    _resolved: mergedPkg._resolved
  };
}

export function isMatchingPinnedGitHubLock(lockfile, source) {
  return Boolean(
    lockfile?.source?.type === 'github' &&
    source?.type === 'github' &&
    lockfile.source.repository === source.repository &&
    lockfile.source.resolvedCommit === source.resolvedCommit &&
    lockfile.source.path === source.path
  );
}

function getPinnedGitHubInstallState(id, source) {
  if (!isPackageInstalled(id)) {
    return { installed: false, sourceMismatch: false };
  }
  const installed = isMatchingPinnedGitHubLock(readLockfile(id), source);
  return { installed, sourceMismatch: !installed };
}

function normalizeExternalSourcePath(value, label) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} is required for a GitHub stack`);
  }
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    normalized.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))
  ) {
    throw new Error(`${label} must be a repository-relative path without traversal`);
  }
  return segments.join('/');
}

async function resolveGitHubPackage(url) {
  const source = await resolveGitHubTreeSource(url);
  const manifestPath = `${source.path}/manifest.json`;
  const rawManifest = await readGitHubJsonFile(source, manifestPath);
  const manifest = normalizeRegistryPackage(rawManifest, 'stack');
  if (manifest.kind !== 'stack' || !EXTERNAL_STACK_ID_PATTERN.test(manifest.id)) {
    throw new Error('GitHub tree manifest must use a canonical stack package id');
  }

  const operatorSkillId = normalizeSkillPackageId(manifest.related?.operatorSkill);
  if (!operatorSkillId) {
    throw new Error(`${manifest.id} requires related.operatorSkill`);
  }
  if (!EXTERNAL_SKILL_ID_PATTERN.test(operatorSkillId)) {
    throw new Error(`${manifest.id} related.operatorSkill must use a canonical skill package id`);
  }
  const relatedSkillIds = Array.isArray(manifest.related?.skills)
    ? manifest.related.skills.map(normalizeSkillPackageId).filter(Boolean)
    : [];
  if (!relatedSkillIds.includes(operatorSkillId)) {
    throw new Error(`${manifest.id} related.operatorSkill must appear in related.skills`);
  }

  const operatorSkillPath = normalizeExternalSourcePath(
    manifest.related?.operatorSkillPath,
    'related.operatorSkillPath',
  );
  await assertGitHubDirectoryFile(source, operatorSkillPath, 'SKILL.md');
  const operatorSource = { ...source, path: operatorSkillPath };
  const operatorInstallState = getPinnedGitHubInstallState(operatorSkillId, operatorSource);

  const relatedSkills = [];
  for (const skillId of relatedSkillIds) {
    if (skillId === operatorSkillId) {
      relatedSkills.push({
        id: skillId,
        kind: 'skill',
        name: skillId.slice('skill:'.length),
        version: manifest.version,
        installed: operatorInstallState.installed,
        sourceMismatch: operatorInstallState.sourceMismatch,
        isOperator: true,
        dependencies: [],
        path: operatorSkillPath,
        source: operatorSource,
      });
      continue;
    }

    const skillPkg = await getPackage(skillId);
    if (!skillPkg) continue;
    relatedSkills.push({
      id: skillId,
      kind: 'skill',
      name: skillPkg.name,
      version: skillPkg.version,
      installed: isPackageInstalled(skillId),
      isOperator: false,
      dependencies: [],
    });
  }

  const stackInstallState = getPinnedGitHubInstallState(manifest.id, source);
  return buildResolvedPackage({
    ...manifest,
    path: source.path,
    source,
    installed: stackInstallState.installed,
    sourceMismatch: stackInstallState.sourceMismatch,
  }, relatedSkills);
}

function normalizeSkillPackageId(id) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('skill:')) return trimmed;
  if (trimmed.startsWith('prompt:')) return trimmed.replace(/^prompt:/, 'skill:');
  if (trimmed.includes(':')) return null;
  return `skill:${trimmed}`;
}

async function resolveRelatedSkills(pkg) {
  const relatedSkillIds = pkg.related?.skills || [];
  const operatorSkillId = normalizeSkillPackageId(pkg.related?.operatorSkill);
  if (pkg.kind === 'stack' && !operatorSkillId) {
    throw new Error(`${pkg.id || 'Stack package'} requires related.operatorSkill`);
  }
  const normalizedRelatedSkillIds = relatedSkillIds
    .map((id) => normalizeSkillPackageId(id))
    .filter(Boolean);
  if (operatorSkillId && !normalizedRelatedSkillIds.includes(operatorSkillId)) {
    throw new Error(
      `${pkg.id || 'Stack package'} related.operatorSkill must appear in related.skills`
    );
  }
  const relatedSkills = [];
  const seen = new Set();

  for (const id of relatedSkillIds) {
    const skillId = normalizeSkillPackageId(id);
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);

    const skillPkg = await getPackage(skillId);
    if (!skillPkg) {
      if (skillId === operatorSkillId) {
        throw new Error(`operator skill package not found: ${skillId}`);
      }
      continue;
    }

    relatedSkills.push({
      id: skillId,
      kind: 'skill',
      name: skillPkg.name,
      version: skillPkg.version,
      installed: isPackageInstalled(skillId),
      isOperator: skillId === operatorSkillId,
      dependencies: []
    });
  }

  return relatedSkills;
}

/**
 * Resolve dynamic npm package (npm:<spec>)
 * Creates a virtual manifest since no registry entry exists
 * @param {string} id - npm:<spec> (e.g., 'npm:cowsay', 'npm:@stripe/cli@2.0.0')
 * @returns {Promise<Object>} Virtual resolved package
 */
async function resolveDynamicNpm(id) {
  const spec = id.replace('npm:', '');

  // Parse package name and version
  // Handle scoped packages: @stripe/cli@1.2.3
  // Handle regular packages: cowsay@latest
  let name, version;

  if (spec.startsWith('@')) {
    // Scoped package: @scope/name@version
    const parts = spec.split('@');
    // parts[0] = '', parts[1] = 'scope/name', parts[2] = 'version' (optional)
    if (parts.length >= 3) {
      name = `@${parts[1]}`;
      version = parts[2];
    } else {
      name = `@${parts[1]}`;
      version = 'latest';
    }
  } else {
    // Regular package: name@version
    const lastAt = spec.lastIndexOf('@');
    if (lastAt > 0) {
      name = spec.substring(0, lastAt);
      version = spec.substring(lastAt + 1);
    } else {
      name = spec;
      version = 'latest';
    }
  }

  // Generate deterministic install directory
  // @stripe/cli -> npm/@stripe__cli
  // cowsay -> npm/cowsay
  const sanitizedName = name.replace(/\//g, '__').replace(/^@/, '');
  const installDir = `npm/${sanitizedName}`;

  const fullId = id;
  const installed = isPackageInstalled(fullId);

  return {
    id: fullId,
    kind: 'binary',
    name: name,
    version: version,
    description: `Dynamic npm package: ${name}`,
    installType: 'npm',
    npmPackage: name,
    installDir: installDir,
    installed,
    dependencies: [],
    source: {
      type: 'npm',
      spec: spec
    },
    // bins will be discovered after install by installer
    bins: null
  };
}

async function resolveRuntimeDependency(runtimeId, required = false) {
  const runtimePkg = await getInstallableRegistryPackage(runtimeId);
  if (!runtimePkg) {
    if (required) throw new Error(`Required npm Node runtime not found: ${runtimeId}`);
    return null;
  }
  return {
    ...runtimePkg,
    id: runtimeId,
    kind: 'runtime',
    installed: isPackageInstalled(runtimeId),
    dependencies: [],
  };
}

/**
 * Resolve dependencies for a package
 */
async function resolveDependencies(pkg) {
  const dependencies = [];

  // Resolve runtime dependencies (binary stacks have no runtime dependency)
  const runtimeVal = pkg.runtime === 'binary' ? null : pkg.runtime;
  const nodeRuntime = getNpmNodeRuntimeId(pkg);
  const runtimes = [...new Set([
    ...(pkg.requires?.runtimes || (runtimeVal ? [runtimeVal] : [])),
    ...(nodeRuntime ? [nodeRuntime] : []),
  ])];

  for (const runtime of runtimes) {
    const runtimeId = runtime.startsWith('runtime:') ? runtime : `runtime:${runtime}`;
    const dependency = await resolveRuntimeDependency(runtimeId, runtimeId === nodeRuntime);
    if (dependency) dependencies.push(dependency);
  }

  // Resolve binary dependencies
  const binaries = pkg.requires?.binaries || pkg.requires?.tools || [];
  for (const binary of binaries) {
    const binaryId = binary.startsWith('binary:')
      ? binary
      : binary.startsWith('tool:')
        ? binary.replace(/^tool:/, 'binary:')
        : `binary:${binary}`;
    const binaryPkg = await getInstallableRegistryPackage(binaryId);

    if (binaryPkg) {
      const nodeRuntime = getNpmNodeRuntimeId(binaryPkg);
      const binaryDependencies = nodeRuntime
        ? [await resolveRuntimeDependency(nodeRuntime, true)] : [];
      dependencies.push({
        ...binaryPkg,
        id: binaryId,
        kind: 'binary',
        installed: isPackageInstalled(binaryId),
        dependencies: binaryDependencies
      });
    }
  }

  // Resolve agent dependencies
  const agents = pkg.requires?.agents || [];
  for (const agent of agents) {
    const agentId = agent.startsWith('agent:') ? agent : `agent:${agent}`;
    const agentPkg = await getInstallableRegistryPackage(agentId);

    if (agentPkg) {
      dependencies.push({
        ...agentPkg,
        id: agentId,
        kind: 'agent',
        installed: isPackageInstalled(agentId),
        dependencies: []
      });
    }
  }

  // Resolve required stacks (for skills/workflows)
  const requiredStacks = pkg.requires?.stacks || [];
  for (const stackName of requiredStacks) {
    const stackId = stackName.startsWith('stack:') ? stackName : `stack:${stackName}`;
    const stackPkg = await getInstallableRegistryPackage(stackId);
    if (stackPkg) {
      const stackDependencies = await resolveDependencies(stackPkg);
      dependencies.push({
        ...stackPkg,
        id: stackId,
        kind: 'stack',
        installed: isPackageInstalled(stackId),
        dependencies: stackDependencies
      });
    }
  }

  // Resolve required skills (for workflows)
  const requiredSkills = pkg.requires?.skills || [];
  for (const skillName of requiredSkills) {
    const skillId = skillName.startsWith('skill:')
      ? skillName
      : skillName.startsWith('prompt:')
        ? skillName.replace(/^prompt:/, 'skill:')
        : `skill:${skillName}`;
    const skillPkg = await getInstallableRegistryPackage(skillId);
    if (skillPkg) {
      dependencies.push({
        ...skillPkg,
        id: skillId,
        kind: 'skill',
        installed: isPackageInstalled(skillId),
        dependencies: []
      });
    }
  }

  return dependencies;
}

/**
 * Check if all dependencies are satisfied
 * @param {Object} resolved - Resolved package
 * @returns {{ satisfied: boolean, missing: Array }}
 */
export function checkDependencies(resolved) {
  const missing = [];

  function check(pkg) {
    for (const dep of pkg.dependencies || []) {
      if (!dep.installed) {
        missing.push(dep);
      }
      check(dep);
    }
  }

  check(resolved);

  return {
    satisfied: missing.length === 0,
    missing
  };
}

/**
 * Get installation order (dependencies first)
 * @param {Object} resolved - Resolved package
 * @returns {Array} Packages in install order
 */
export function getInstallOrder(resolved) {
  const order = [];
  const visited = new Set();

  function visit(pkg) {
    if (visited.has(pkg.id)) return;
    visited.add(pkg.id);

    // Visit dependencies first
    for (const dep of pkg.dependencies || []) {
      visit(dep);
    }

    // Then add this package if not installed
    if (!pkg.installed) {
      order.push(pkg);
    }
  }

  visit(resolved);
  return order;
}

/**
 * Resolve multiple packages at once
 * @param {string[]} ids - Package IDs
 * @returns {Promise<Array>}
 */
export async function resolvePackages(ids) {
  return Promise.all(ids.map(id => resolvePackage(id)));
}

/**
 * Check if a version satisfies a constraint
 * @param {string} version - Actual version (e.g., '3.12.0')
 * @param {string} constraint - Version constraint (e.g., '>=3.10')
 * @returns {boolean}
 */
export function satisfiesVersion(version, constraint) {
  if (!constraint) return true;

  const [major, minor = 0, patch = 0] = version.split('.').map(Number);

  const match = constraint.match(/^(>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return true;

  const [, op = '=', cMajor, cMinor = '0', cPatch = '0'] = match;
  const constraintVersion = [Number(cMajor), Number(cMinor), Number(cPatch)];
  const actualVersion = [major, minor, patch];

  const cmp = compareVersions(actualVersion, constraintVersion);

  switch (op) {
    case '>=': return cmp >= 0;
    case '<=': return cmp <= 0;
    case '>': return cmp > 0;
    case '<': return cmp < 0;
    case '=': return cmp === 0;
    default: return cmp === 0;
  }
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}
