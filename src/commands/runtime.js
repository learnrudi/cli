/**
 * Runtime command - inspect runtime registry entries and runtime status.
 */

import { listPackages } from '@learnrudi/core';
import { cmdLocalLlm } from './local-llm.js';

function runtimeName(id) {
  return String(id || '').replace(/^runtime:/, '');
}

function printRuntimeList(runtimes) {
  console.log(`\nRUNTIMES (${runtimes.length}):`);
  console.log('─'.repeat(50));
  for (const runtime of runtimes) {
    const id = runtime.id || `runtime:${runtime.name}`;
    console.log(`  ${id}`);
    if (runtime.description) {
      console.log(`    ${runtime.description}`);
    }
    if (runtime.category) {
      console.log(`    Category: ${runtime.category}`);
    }
    if (runtime.tags?.length) {
      console.log(`    Tags: ${runtime.tags.join(', ')}`);
    }
  }
}

export async function cmdRuntime(args, flags) {
  const subcommand = args[0] || 'list';

  if (subcommand === 'list') {
    const runtimes = await listPackages('runtime');
    if (flags.json) {
      console.log(JSON.stringify(runtimes, null, 2));
      return;
    }
    printRuntimeList(runtimes);
    return;
  }

  if (subcommand === 'status') {
    const runtime = runtimeName(args[1] || flags.runtime || 'ollama');
    if (runtime !== 'ollama') {
      throw new Error(`Runtime status is only implemented for local LLM runtimes right now: ${runtime}`);
    }
    await cmdLocalLlm(['status', runtime], flags);
    return;
  }

  console.error('Usage: rudi runtime <list|status> [runtime]');
  process.exit(1);
}
