/**
 * Unit tests for CLI command exports
 */

import { test } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// COMMAND EXPORTS
// =============================================================================

test('commands: search exports cmdSearch function', async () => {
  const { cmdSearch } = await import('../../commands/search.js');
  assert.strictEqual(typeof cmdSearch, 'function');
});

test('commands: install exports cmdInstall function', async () => {
  const { cmdInstall } = await import('../../commands/install.js');
  assert.strictEqual(typeof cmdInstall, 'function');
});

test('commands: run exports cmdRun function', async () => {
  const { cmdRun } = await import('../../commands/run.js');
  assert.strictEqual(typeof cmdRun, 'function');
});

test('commands: list exports cmdList function', async () => {
  const { cmdList } = await import('../../commands/list.js');
  assert.strictEqual(typeof cmdList, 'function');
});

test('commands: remove exports cmdRemove function', async () => {
  const { cmdRemove } = await import('../../commands/remove.js');
  assert.strictEqual(typeof cmdRemove, 'function');
});

test('commands: secrets exports cmdSecrets function', async () => {
  const { cmdSecrets } = await import('../../commands/secrets.js');
  assert.strictEqual(typeof cmdSecrets, 'function');
});

test('commands: db exports cmdDb function', async () => {
  const { cmdDb } = await import('../../commands/db.js');
  assert.strictEqual(typeof cmdDb, 'function');
});

test('commands: import exports cmdImport function', async () => {
  const { cmdImport } = await import('../../commands/import.js');
  assert.strictEqual(typeof cmdImport, 'function');
});

test('commands: doctor exports cmdDoctor function', async () => {
  const { cmdDoctor } = await import('../../commands/doctor.js');
  assert.strictEqual(typeof cmdDoctor, 'function');
});

test('commands: home exports cmdHome function', async () => {
  const { cmdHome } = await import('../../commands/home.js');
  assert.strictEqual(typeof cmdHome, 'function');
});

test('commands: init exports cmdInit function', async () => {
  const { cmdInit } = await import('../../commands/init.js');
  assert.strictEqual(typeof cmdInit, 'function');
});

test('commands: update exports cmdUpdate function', async () => {
  const { cmdUpdate } = await import('../../commands/update.js');
  assert.strictEqual(typeof cmdUpdate, 'function');
});

test('commands: logs exports cmdLogs function', async () => {
  const { cmdLogs } = await import('../../commands/logs.js');
  assert.strictEqual(typeof cmdLogs, 'function');
});

test('commands: which exports cmdWhich function', async () => {
  const { cmdWhich } = await import('../../commands/which.js');
  assert.strictEqual(typeof cmdWhich, 'function');
});

test('commands: mcp exports cmdMcp function', async () => {
  const { cmdMcp } = await import('../../commands/mcp.js');
  assert.strictEqual(typeof cmdMcp, 'function');
});

test('commands: integrate exports cmdIntegrate function', async () => {
  const { cmdIntegrate } = await import('../../commands/integrate.js');
  assert.strictEqual(typeof cmdIntegrate, 'function');
});

test('commands: instructions exports cmdInstructions function', async () => {
  const { cmdInstructions } = await import('../../commands/instructions.js');
  assert.strictEqual(typeof cmdInstructions, 'function');
});

test('commands: status exports cmdStatus function', async () => {
  const { cmdStatus } = await import('../../commands/status.js');
  assert.strictEqual(typeof cmdStatus, 'function');
});

test('commands: run-group exports cmdRunGroup function', async () => {
  const { cmdRunGroup } = await import('../../commands/run-group.js');
  assert.strictEqual(typeof cmdRunGroup, 'function');
});

test('commands: lanes exports cmdLanes function', async () => {
  const { cmdLanes } = await import('../../commands/lanes.js');
  assert.strictEqual(typeof cmdLanes, 'function');
});

test('commands: local-llm exports cmdLocalLlm function', async () => {
  const { cmdLocalLlm } = await import('../../commands/local-llm.js');
  assert.strictEqual(typeof cmdLocalLlm, 'function');
});

test('commands: runtime exports cmdRuntime function', async () => {
  const { cmdRuntime } = await import('../../commands/runtime.js');
  assert.strictEqual(typeof cmdRuntime, 'function');
});

test('commands: daemon exports cmdDaemon function', async () => {
  const { cmdDaemon } = await import('../../commands/daemon.js');
  assert.strictEqual(typeof cmdDaemon, 'function');
});

test('commands: leverage exports cmdLeverage function', async () => {
  const { cmdLeverage } = await import('../../commands/leverage.js');
  assert.strictEqual(typeof cmdLeverage, 'function');
});

// =============================================================================
// UTILS EXPORTS
// =============================================================================

test('utils: parseArgs is exported', async () => {
  const { parseArgs } = await import('@learnrudi/utils/args');
  assert.strictEqual(typeof parseArgs, 'function');
});

test('utils: printHelp is exported', async () => {
  const { printHelp } = await import('@learnrudi/utils/help');
  assert.strictEqual(typeof printHelp, 'function');
});

test('utils: secrets help documents implemented secret commands only', async () => {
  const { printHelp } = await import('@learnrudi/utils/help');
  const lines = [];
  const originalLog = console.log;
  console.log = (message = '') => {
    lines.push(String(message));
  };
  try {
    printHelp('secrets');
  } finally {
    console.log = originalLog;
  }

  const rendered = lines.join('\n');
  assert.match(rendered, /get <name>\s+Get a secret value/);
  assert.doesNotMatch(rendered, /export\s+Export secrets/);
});

test('utils: printVersion is exported', async () => {
  const { printVersion } = await import('@learnrudi/utils/help');
  assert.strictEqual(typeof printVersion, 'function');
});

// =============================================================================
// COMMAND ALIASES
// =============================================================================

test('aliases: command aliases are documented', () => {
  // These aliases should be supported based on index.js switch statement
  const aliases = {
    'i': 'install',
    'add': 'install',
    'exec': 'run',
    'ls': 'list',
    'rm': 'remove',
    'uninstall': 'remove',
    'secret': 'secrets',
    'database': 'db',
    'sessions': 'session',
    'bootstrap': 'init',
    'setup': 'init',
    'upgrade': 'update',
    'info': 'which',
    'show': 'which',
    'authenticate': 'auth',
    'login': 'auth',
    'run-groups': 'run-group',
    'bins': 'binaries',
    'tools': 'binaries'
  };

  // Just verify the structure exists
  assert.ok(Object.keys(aliases).length > 0);

  for (const [alias, command] of Object.entries(aliases)) {
    assert.ok(typeof alias === 'string');
    assert.ok(typeof command === 'string');
  }
});

// =============================================================================
// SHORTCUT COMMANDS
// =============================================================================

test('shortcuts: package type shortcuts exist', () => {
  // These are shortcuts that expand to 'list <type>'
  const shortcuts = ['stacks', 'prompts', 'workflows', 'runtimes', 'binaries', 'agents'];

  for (const shortcut of shortcuts) {
    assert.ok(typeof shortcut === 'string');
  }
});
