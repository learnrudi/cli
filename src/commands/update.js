/**
 * Update command - update installed packages from the registry.
 */

import { indexAllStacks, listInstalled, updatePackage as coreUpdatePackage } from '@learnrudi/core';
import { fetchIndex } from '@learnrudi/registry-client';

const KNOWN_PACKAGE_KINDS = new Set(['stack', 'skill', 'prompt', 'workflow', 'runtime', 'binary', 'agent', 'npm']);

function rebuildToolIndex(options = {}) {
  return indexAllStacks({
    stacks: options.stacks,
    log: options.log,
    timeout: options.timeout,
  });
}

const defaultDependencies = {
  fetchIndex,
  listInstalled,
  updatePackage: coreUpdatePackage,
  rebuildToolIndex,
  log: console.log,
  error: console.error,
};

function packageNameFromId(id) {
  return String(id || '').split(':').slice(1).join(':');
}

function packageKindFromId(id) {
  return String(id || '').split(':')[0];
}

function hasKnownPackagePrefix(id) {
  const value = String(id || '');
  if (!value.includes(':')) return false;
  return KNOWN_PACKAGE_KINDS.has(packageKindFromId(value));
}

function assertKnownPackagePrefix(id) {
  const value = String(id || '');
  if (!value.includes(':')) return;
  const kind = packageKindFromId(value);
  if (!KNOWN_PACKAGE_KINDS.has(kind)) {
    throw new Error(`Unknown package kind "${kind}" in ${value}`);
  }
}

function formatTargetList(packages) {
  return packages.map(pkg => pkg.id).sort().join(', ');
}

function isPackageNotFoundError(error) {
  return /Package not found/i.test(String(error?.message || error || ''));
}

function isTruthyFlag(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return normalized !== '' && !['0', 'false', 'no', 'off'].includes(normalized);
}

function shouldPreserveInstallState(flags = {}) {
  return isTruthyFlag(flags['preserve-state']) || isTruthyFlag(flags.preserveState);
}

async function getInstalledPackages(deps) {
  const installed = await deps.listInstalled();
  return Array.isArray(installed) ? installed.filter(pkg => typeof pkg?.id === 'string') : [];
}

export async function resolveUpdateTarget(rawTarget, deps = defaultDependencies) {
  const target = String(rawTarget || '').trim();
  if (!target) {
    throw new Error('Package id is required');
  }

  assertKnownPackagePrefix(target);
  const installed = await getInstalledPackages(deps);

  if (hasKnownPackagePrefix(target)) {
    const match = installed.find(pkg => pkg.id === target);
    if (!match) {
      throw new Error(`Package not installed: ${target}`);
    }
    return match;
  }

  const matches = installed.filter(pkg => pkg.name === target || packageNameFromId(pkg.id) === target);
  if (matches.length === 0) {
    throw new Error(`Package kind is required for "${target}" because no installed package with that name was found`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous package "${target}". Use one of: ${formatTargetList(matches)}`);
  }

  return matches[0];
}

async function rebuildUpdatedStackIndex(stackIds, flags, deps) {
  const uniqueStackIds = [...new Set(stackIds)].sort();
  if (uniqueStackIds.length === 0) return null;

  deps.log(`Rebuilding tool index for ${uniqueStackIds.length} stack(s)...`);
  return deps.rebuildToolIndex({
    stacks: uniqueStackIds,
    log: flags.verbose ? deps.log : () => {},
    timeout: 20000,
    validate: false,
  });
}

function getUpdatedSkillIds(updatedPackages) {
  return updatedPackages
    .filter(pkg => pkg.kind === 'skill')
    .map(pkg => pkg.id)
    .sort();
}

function logNativeSkillSyncHint(skillIds, deps) {
  if (skillIds.length === 0) return;

  deps.log('');
  deps.log(`Updated ${skillIds.length} skill package(s). Native Claude/Codex skill wrappers are not overwritten automatically.`);
  deps.log('To sync native wrappers for updated RUDI skills, run:');
  deps.log('  rudi skills sync codex --force');
  deps.log('  rudi skills sync claude --force');
  deps.log('These commands overwrite existing native wrappers; omit --force to create only missing wrappers.');
}

async function updateOnePackage(pkg, flags, deps) {
  deps.log(`Updating ${pkg.id}...`);
  const result = await deps.updatePackage(pkg.id, {
    preserveState: shouldPreserveInstallState(flags),
  });
  if (!result?.success) {
    throw new Error(result?.error || `Failed to update ${pkg.id}`);
  }
  return {
    id: pkg.id,
    kind: pkg.kind || packageKindFromId(pkg.id),
    result,
  };
}

export async function runUpdate(args = [], flags = {}, deps = defaultDependencies) {
  const pkgId = args[0];
  const updatedPackages = [];
  const failedPackages = [];
  const skippedPackages = [];
  let target = null;
  let installed = null;

  if (pkgId) {
    target = await resolveUpdateTarget(pkgId, deps);
  } else {
    installed = await getInstalledPackages(deps);
  }

  deps.log('Refreshing registry...');
  await deps.fetchIndex({ force: true });

  if (pkgId) {
    const updated = await updateOnePackage(target, flags, deps);
    updatedPackages.push(updated);
  } else {
    deps.log('Checking installed packages for updates...');

    for (const pkg of installed) {
      try {
        const updated = await updateOnePackage(pkg, flags, deps);
        updatedPackages.push(updated);
      } catch (error) {
        if (isPackageNotFoundError(error)) {
          skippedPackages.push({ id: pkg.id, error: error.message });
          deps.log(`  - ${pkg.id}: skipped, not found in registry`);
          continue;
        }
        failedPackages.push({ id: pkg.id, error: error.message });
        deps.error(`  x ${pkg.id}: ${error.message}`);
      }
    }
  }

  const updatedStackIds = updatedPackages
    .filter(pkg => pkg.kind === 'stack')
    .map(pkg => pkg.id);
  const updatedSkillIds = getUpdatedSkillIds(updatedPackages);
  const indexResult = await rebuildUpdatedStackIndex(updatedStackIds, flags, deps);

  if (pkgId) {
    deps.log(`Updated ${updatedPackages[0].id}`);
  } else {
    deps.log(`\nUpdated ${updatedPackages.length} package(s)${failedPackages.length > 0 ? `, ${failedPackages.length} failed` : ''}${skippedPackages.length > 0 ? `, ${skippedPackages.length} skipped` : ''}`);
  }
  logNativeSkillSyncHint(updatedSkillIds, deps);

  return {
    updated: updatedPackages.length,
    failed: failedPackages.length,
    skipped: skippedPackages.length,
    packages: updatedPackages,
    failures: failedPackages,
    skippedPackages,
    indexedStacks: updatedStackIds,
    updatedSkills: updatedSkillIds,
    indexResult,
  };
}

export async function cmdUpdate(args, flags) {
  try {
    const result = await runUpdate(args, flags);
    if (result.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Update failed: ${error.message}`);
    process.exit(1);
  }
}
