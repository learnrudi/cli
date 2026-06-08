/**
 * Remove command - uninstall packages
 *
 * Usage:
 *   rudi remove <package>         Remove a specific package
 *   rudi remove --all             Remove all packages
 *   rudi remove stacks --all      Remove all stacks
 *   rudi remove binaries --all    Remove all binaries
 */

import {
  uninstallPackage,
  isPackageInstalled,
  listInstalled,
  readRudiConfig,
  removeStack,
  removeStackFromToolIndex,
} from '@learnrudi/core';
import { unregisterMcpAll } from '@learnrudi/mcp';
import { removeSecret } from '@learnrudi/secrets';

const defaultStackCleanupDeps = {
  readRudiConfig,
  removeStack,
  removeSecret,
  removeStackFromToolIndex,
};

function pluralizeKind(kind) {
  if (!kind) return 'packages';
  if (kind === 'binary') return 'binaries';
  if (kind === 'skill') return 'skills';
  if (kind === 'workflow') return 'workflows';
  return `${kind}s`;
}

function isStackPackage(id, kind) {
  return kind === 'stack' || (typeof id === 'string' && id.startsWith('stack:'));
}

function normalizeStackPackageId(stackId) {
  const normalized = typeof stackId === 'string' ? stackId.trim() : '';
  if (!normalized) {
    throw new Error('stack id is required');
  }
  return normalized.startsWith('stack:') ? normalized : `stack:${normalized}`;
}

function getSecretName(secret) {
  if (typeof secret === 'string') return secret;
  return secret?.name || secret?.key || null;
}

function getStackSecretNames(config, stackId) {
  const stack = config?.stacks?.[stackId];
  const secrets = Array.isArray(stack?.secrets) ? stack.secrets : [];
  return [...new Set(secrets.map(getSecretName).filter(Boolean))];
}

function configReferencesSecret(config, secretName) {
  return Object.values(config?.stacks || {}).some(stack => {
    const secrets = Array.isArray(stack?.secrets) ? stack.secrets : [];
    return secrets.some(secret => getSecretName(secret) === secretName);
  });
}

export async function cleanupRemovedStack(stackId, deps = defaultStackCleanupDeps) {
  const normalizedStackId = normalizeStackPackageId(stackId);
  const beforeConfig = deps.readRudiConfig();
  const secretNames = getStackSecretNames(beforeConfig, normalizedStackId);

  deps.removeStack(normalizedStackId);

  const afterConfig = deps.readRudiConfig();
  const removedSecrets = [];
  for (const secretName of secretNames) {
    if (configReferencesSecret(afterConfig, secretName)) continue;
    await deps.removeSecret(secretName);
    removedSecrets.push(secretName);
  }

  const prunedToolIndex = deps.removeStackFromToolIndex(normalizedStackId);
  return { removedSecrets, prunedToolIndex };
}

async function finalizeRemovedStack(stackId, targetAgents) {
  const mcpStackId = normalizeStackPackageId(stackId).replace(/^stack:/, '');
  let cleanupError = null;

  try {
    await cleanupRemovedStack(stackId);
  } catch (error) {
    cleanupError = error;
  }

  await unregisterMcpAll(mcpStackId, targetAgents);

  if (cleanupError) {
    throw cleanupError;
  }
}

export async function cmdRemove(args, flags) {
  // Handle bulk removal (--all flag)
  if (flags.all) {
    return await removeBulk(args[0], flags);
  }

  // Single package removal
  const pkgId = args[0];

  if (!pkgId) {
    console.error('Usage: rudi remove <package>');
    console.error('       rudi remove --all                           (remove all packages)');
    console.error('       rudi remove stacks --all                    (remove all stacks)');
    console.error('       rudi remove <package> --agent=claude        (unregister from Claude only)');
    console.error('       rudi remove <package> --agent=claude,codex  (unregister from specific agents)');
    console.error('Example: rudi remove pdf-creator');
    process.exit(1);
  }

  // Parse --agent flag
  let targetAgents = null;
  if (flags.agent) {
    const validAgents = ['claude', 'codex', 'gemini'];
    targetAgents = flags.agent.split(',').map(a => a.trim()).filter(a => validAgents.includes(a));

    if (targetAgents.length === 0) {
      console.error(`Invalid --agent value. Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  // Normalize ID
  const fullId = pkgId.includes(':') ? pkgId : `stack:${pkgId}`;

  // Check if installed
  if (!isPackageInstalled(fullId)) {
    console.error(`Package not installed: ${pkgId}`);
    process.exit(1);
  }

  // Confirm unless --force
  if (!flags.force && !flags.y) {
    console.log(`This will remove: ${fullId}`);
    console.log(`Run with --force to confirm.`);
    process.exit(0);
  }

  console.log(`Removing ${fullId}...`);

  try {
    const result = await uninstallPackage(fullId);

    if (result.success) {
      if (isStackPackage(fullId)) {
        await finalizeRemovedStack(fullId, targetAgents);
      }

      console.log(`✓ Removed ${fullId}`);
    } else {
      console.error(`✗ Failed to remove: ${result.error}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`Remove failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Bulk removal - remove all packages of a certain kind or all packages
 */
async function removeBulk(kind, flags) {
  // Parse --agent flag
  let targetAgents = null;
  if (flags.agent) {
    const validAgents = ['claude', 'codex', 'gemini'];
    targetAgents = flags.agent.split(',').map(a => a.trim()).filter(a => validAgents.includes(a));

    if (targetAgents.length === 0) {
      console.error(`Invalid --agent value. Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  // Normalize kind
  if (kind) {
    if (kind === 'stacks') kind = 'stack';
    if (kind === 'skills') kind = 'skill';
    if (kind === 'prompts') kind = 'prompt';
    if (kind === 'workflows') kind = 'workflow';
    if (kind === 'runtimes') kind = 'runtime';
    if (kind === 'binaries') kind = 'binary';
    if (kind === 'tools') kind = 'binary';
    if (kind === 'agents') kind = 'agent';

    // Handle deprecated 'prompt' → 'skill' rename
    if (kind === 'prompt') {
      console.error('Note: "prompt" has been renamed to "skill". Use "rudi remove skills" instead.');
      kind = 'skill';
    }

    if (!['stack', 'skill', 'workflow', 'runtime', 'binary', 'agent'].includes(kind)) {
      console.error(`Invalid kind: ${kind}`);
      console.error(`Valid kinds: stack, skill, workflow, runtime, binary, agent`);
      process.exit(1);
    }
  }

  try {
    // Get list of packages to remove
    const packages = await listInstalled(kind);

    if (packages.length === 0) {
      console.log(kind ? `No ${pluralizeKind(kind)} installed.` : 'No packages installed.');
      return;
    }

    // Show what will be removed
    console.log(kind ? `\nFound ${packages.length} ${pluralizeKind(kind)} to remove:` : `\nFound ${packages.length} package(s) to remove:`);
    for (const pkg of packages) {
      console.log(`  - ${pkg.id}`);
    }

    // Confirm unless --force
    if (!flags.force && !flags.y) {
      console.log(`\nRun with --force to confirm removal.`);
      process.exit(0);
    }

    console.log(`\nRemoving packages...`);

    let succeeded = 0;
    let failed = 0;

    for (const pkg of packages) {
      try {
        const result = await uninstallPackage(pkg.id);

        if (result.success) {
          if (isStackPackage(pkg.id, pkg.kind)) {
            await finalizeRemovedStack(pkg.id, targetAgents);
          }

          console.log(`  ✓ Removed ${pkg.id}`);
          succeeded++;
        } else {
          console.error(`  ✗ Failed to remove ${pkg.id}: ${result.error}`);
          failed++;
        }
      } catch (error) {
        console.error(`  ✗ Failed to remove ${pkg.id}: ${error.message}`);
        failed++;
      }
    }

    console.log(`\nRemoval complete: ${succeeded} succeeded, ${failed} failed`);

    if (failed > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error(`Bulk removal failed: ${error.message}`);
    process.exit(1);
  }
}
