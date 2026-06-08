/**
 * Dependency resolver for RUDI
 * Resolves package dependencies and version constraints
 */

import { getPackage, getManifest } from '@learnrudi/registry-client';
import { isPackageInstalled, parsePackageId } from '@learnrudi/env';

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

  // 2. Get package from registry (searches all kinds if no prefix)
  const pkg = await getPackage(id);
  if (!pkg) {
    throw new Error(`Package not found: ${id}`);
  }

  // For curated tools (with path field), fetch canonical manifest
  // This ensures install-critical fields (npmPackage, bins, etc.) are available
  let manifest = null;
  if (pkg.path) {
    manifest = await getManifest(pkg);
  }

  // Merge: index metadata + canonical manifest (manifest takes precedence)
  const mergedPkg = manifest ? { ...pkg, ...manifest } : pkg;

  // Build full ID
  const fullId = mergedPkg.id?.includes(':') ? mergedPkg.id : `${mergedPkg.kind}:${mergedPkg.id || id.split(':').pop()}`;

  // Check if installed
  const installed = isPackageInstalled(fullId);

  // Resolve dependencies
  const dependencies = await resolveDependencies(mergedPkg);
  const relatedSkills = await resolveRelatedSkills(mergedPkg);

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
    nativeBinPath: mergedPkg.nativeBinPath
  };
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
  const relatedSkills = [];
  const seen = new Set();

  for (const id of relatedSkillIds) {
    const skillId = normalizeSkillPackageId(id);
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);

    const skillPkg = await getPackage(skillId);
    if (!skillPkg) continue;

    relatedSkills.push({
      id: skillId,
      kind: 'skill',
      name: skillPkg.name,
      version: skillPkg.version,
      installed: isPackageInstalled(skillId),
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

/**
 * Resolve dependencies for a package
 */
async function resolveDependencies(pkg) {
  const dependencies = [];

  // Resolve runtime dependencies (binary stacks have no runtime dependency)
  const runtimeVal = pkg.runtime === 'binary' ? null : pkg.runtime;
  const runtimes = pkg.requires?.runtimes || (runtimeVal ? [runtimeVal] : []);

  for (const runtime of runtimes) {
    const runtimeId = runtime.startsWith('runtime:') ? runtime : `runtime:${runtime}`;
    const runtimePkg = await getPackage(runtimeId);

    if (runtimePkg) {
      dependencies.push({
        id: runtimeId,
        kind: 'runtime',
        name: runtimePkg.name,
        version: runtimePkg.version,
        installed: isPackageInstalled(runtimeId),
        dependencies: []
      });
    }
  }

  // Resolve binary dependencies
  const binaries = pkg.requires?.binaries || pkg.requires?.tools || [];
  for (const binary of binaries) {
    const binaryId = binary.startsWith('binary:')
      ? binary
      : binary.startsWith('tool:')
        ? binary.replace(/^tool:/, 'binary:')
        : `binary:${binary}`;
    const binaryPkg = await getPackage(binaryId);

    if (binaryPkg) {
      dependencies.push({
        id: binaryId,
        kind: 'binary',
        name: binaryPkg.name,
        version: binaryPkg.version,
        installed: isPackageInstalled(binaryId),
        dependencies: []
      });
    }
  }

  // Resolve agent dependencies
  const agents = pkg.requires?.agents || [];
  for (const agent of agents) {
    const agentId = agent.startsWith('agent:') ? agent : `agent:${agent}`;
    const agentPkg = await getPackage(agentId);

    if (agentPkg) {
      dependencies.push({
        id: agentId,
        kind: 'agent',
        name: agentPkg.name,
        version: agentPkg.version,
        installed: isPackageInstalled(agentId),
        dependencies: []
      });
    }
  }

  // Resolve required stacks (for skills)
  const requiredStacks = pkg.requires?.stacks || [];
  for (const stackName of requiredStacks) {
    const stackId = stackName.startsWith('stack:') ? stackName : `stack:${stackName}`;
    const stackPkg = await getPackage(stackId);
    if (stackPkg) {
      dependencies.push({
        id: stackId,
        kind: 'stack',
        name: stackPkg.name,
        version: stackPkg.version,
        installed: isPackageInstalled(stackId),
        dependencies: []
      });
      // Recursively resolve the stack's own dependencies
      const stackDeps = await resolveDependencies(stackPkg);
      dependencies.push(...stackDeps);
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
