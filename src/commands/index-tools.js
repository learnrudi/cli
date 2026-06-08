/**
 * Index command - build tool cache for installed stacks
 *
 * Usage:
 *   rudi index                    Index all installed stacks
 *   rudi index slack data-analysis  Index specific stacks
 *   rudi index --force            Force re-index even if cached
 *   rudi index --json             Output results as JSON
 *
 * This populates ~/.rudi/cache/tool-index.json which the router
 * uses for fast tools/list without spawning all stacks.
 */

import fs from 'fs';
import path from 'path';
import { TOOL_INDEX_PATH, PATHS } from '@learnrudi/core';
import { readRudiConfig } from '@learnrudi/core';
import {
  readToolIndexCache,
  rebuildToolIndex,
} from '../daemon/operations/tool-index.js';

export async function cmdIndex(args, flags) {
  const stackFilter = args.length > 0 ? args : null;
  const forceReindex = flags.force || false;
  const jsonOutput = flags.json || false;

  // Check rudi.json exists
  const config = readRudiConfig();
  if (!config) {
    console.error('Error: rudi.json not found. Run `rudi doctor` to check setup.');
    process.exit(1);
  }

  const installedStacks = Object.keys(config.stacks || {}).filter(
    id => config.stacks[id].installed
  );

  const stackRoot = PATHS.stacks;
  const filesystemStacks = fs.existsSync(stackRoot)
    ? fs.readdirSync(stackRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name)
    : [];

  const registeredNames = new Set(
    installedStacks.map(id => id.replace(/^stack:/, ''))
  );

  const orphanedStacks = filesystemStacks.filter(
    name => !registeredNames.has(name)
  );

  const missingStacks = installedStacks.filter(id => {
    const expectedPath = config.stacks[id]?.path || path.join(stackRoot, id.replace(/^stack:/, ''));
    return !fs.existsSync(expectedPath);
  });

  if (!jsonOutput) {
    if (orphanedStacks.length > 0) {
      console.log(`⚠ Found unregistered stack(s) on disk:`);
      for (const name of orphanedStacks) {
        console.log(`  - ${name}`);
        console.log(`    Path: ${path.join(stackRoot, name)}`);
      }
      console.log(`\n  Register with: rudi install stack:<name> --force`);
      console.log('');
    }

    if (missingStacks.length > 0) {
      console.log(`⚠ Found registered stack(s) missing on disk:`);
      for (const id of missingStacks) {
        const expectedPath = config.stacks[id]?.path || path.join(stackRoot, id.replace(/^stack:/, ''));
        console.log(`  - ${id}`);
        console.log(`    Expected: ${expectedPath}`);
      }
      console.log(`\n  Fix with: rudi remove <stack> or reinstall`);
      console.log('');
    }
  }

  if (installedStacks.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        indexed: 0,
        failed: 0,
        stacks: [],
        orphaned: orphanedStacks,
        missing: missingStacks
      }));
    } else {
      console.log('No installed stacks to index.');
      console.log('\nInstall stacks with: rudi install <stack>');
    }
    return;
  }

  // Check which stacks to index
  const missingSet = new Set(missingStacks);
  const stacksToIndex = (stackFilter
    ? stackFilter.filter(id => {
        if (!installedStacks.includes(id)) {
          if (!jsonOutput) {
            console.log(`⚠ Stack not installed: ${id}`);
          }
          return false;
        }
        return true;
      })
    : installedStacks).filter(id => !missingSet.has(id));

  if (stacksToIndex.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        indexed: 0,
        failed: 0,
        stacks: [],
        orphaned: orphanedStacks,
        missing: missingStacks
      }));
    } else {
      console.log('No valid stacks to index.');
    }
    return;
  }

  // Check existing index
  const existingIndex = readToolIndexCache({ validate: false });
  if (existingIndex && !forceReindex && !stackFilter) {
    const allCached = stacksToIndex.every(id => {
      const entry = existingIndex.byStack?.[id];
      return entry && entry.tools && entry.tools.length > 0 && !entry.error;
    });

    if (allCached) {
      const totalTools = stacksToIndex.reduce((sum, id) => {
        return sum + (existingIndex.byStack[id]?.tools?.length || 0);
      }, 0);

      if (jsonOutput) {
        console.log(JSON.stringify({
          indexed: stacksToIndex.length,
          failed: 0,
          cached: true,
          totalTools,
          orphaned: orphanedStacks,
          missing: missingStacks,
          stacks: stacksToIndex.map(id => ({
            id,
            tools: existingIndex.byStack[id]?.tools?.length || 0,
            indexedAt: existingIndex.byStack[id]?.indexedAt
          }))
        }));
      } else {
        console.log(`Tool index is up to date (${totalTools} tools from ${stacksToIndex.length} stacks)`);
        console.log(`Last updated: ${existingIndex.updatedAt}`);
        console.log(`\nUse --force to re-index.`);
      }
      return;
    }
  }

  if (!jsonOutput) {
    console.log(`Indexing ${stacksToIndex.length} stack(s)...\n`);
  }

  const log = jsonOutput ? () => {} : console.log;

  try {
    const result = await rebuildToolIndex({
      stacks: stacksToIndex,
      log,
      timeout: 20000, // 20s per stack
      validate: false,
    });

    // Calculate total tools
    const totalTools = Object.values(result.index.byStack).reduce(
      (sum, entry) => sum + (entry.tools?.length || 0),
      0
    );

    if (jsonOutput) {
      console.log(JSON.stringify({
        indexed: result.indexed,
        failed: result.failed,
        totalTools,
        orphaned: orphanedStacks,
        missing: missingStacks,
        stacks: stacksToIndex.map(id => ({
          id,
          tools: result.index.byStack[id]?.tools?.length || 0,
          error: result.index.byStack[id]?.error || null,
          missingSecrets: result.index.byStack[id]?.missingSecrets || null
        }))
      }, null, 2));
    } else {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`Indexed: ${result.indexed}/${stacksToIndex.length} stacks`);
      console.log(`Tools discovered: ${totalTools}`);
      console.log(`Cache: ${TOOL_INDEX_PATH}`);

      if (result.failed > 0) {
        console.log(`\n⚠ ${result.failed} stack(s) failed to index.`);

        // Show hints for missing secrets
        const missingSecretStacks = Object.entries(result.index.byStack)
          .filter(([_, entry]) => entry.missingSecrets?.length > 0);

        if (missingSecretStacks.length > 0) {
          console.log(`\nMissing secrets:`);
          for (const [stackId, entry] of missingSecretStacks) {
            for (const secret of entry.missingSecrets) {
              console.log(`  rudi secrets set ${secret}`);
            }
          }
          console.log(`\nAfter configuring secrets, run: rudi index`);
        }
      }
    }

  } catch (error) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: error.message }));
    } else {
      console.error(`Index failed: ${error.message}`);
    }
    process.exit(1);
  }
}
