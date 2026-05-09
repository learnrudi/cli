/**
 * Unit tests for CLI routing logic
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { parseArgs } from '@learnrudi/utils/args';

// =============================================================================
// COMMAND ROUTING
// =============================================================================

test('routing: search command is parsed correctly', () => {
  const result = parseArgs(['search', 'pdf']);

  assert.strictEqual(result.command, 'search');
  assert.deepStrictEqual(result.args, ['pdf']);
});

test('routing: install with package ID', () => {
  const result = parseArgs(['install', 'stack:pdf-creator']);

  assert.strictEqual(result.command, 'install');
  assert.deepStrictEqual(result.args, ['stack:pdf-creator']);
});

test('routing: list with kind argument', () => {
  const result = parseArgs(['list', 'stacks']);

  assert.strictEqual(result.command, 'list');
  assert.deepStrictEqual(result.args, ['stacks']);
});

test('routing: db with subcommand', () => {
  const result = parseArgs(['db', 'stats']);

  assert.strictEqual(result.command, 'db');
  assert.deepStrictEqual(result.args, ['stats']);
});

test('routing: db search with query', () => {
  const result = parseArgs(['db', 'search', 'authentication', 'bug']);

  assert.strictEqual(result.command, 'db');
  assert.deepStrictEqual(result.args, ['search', 'authentication', 'bug']);
});

test('routing: secrets set with name', () => {
  const result = parseArgs(['secrets', 'set', 'OPENAI_API_KEY']);

  assert.strictEqual(result.command, 'secrets');
  assert.deepStrictEqual(result.args, ['set', 'OPENAI_API_KEY']);
});

test('routing: import sessions', () => {
  const result = parseArgs(['import', 'sessions']);

  assert.strictEqual(result.command, 'import');
  assert.deepStrictEqual(result.args, ['sessions']);
});

test('routing: import sessions with provider', () => {
  const result = parseArgs(['import', 'sessions', 'claude']);

  assert.strictEqual(result.command, 'import');
  assert.deepStrictEqual(result.args, ['sessions', 'claude']);
});

test('routing: run-group with subcommand', () => {
  const result = parseArgs(['run-group', 'list', '--status', 'running']);

  assert.strictEqual(result.command, 'run-group');
  assert.deepStrictEqual(result.args, ['list']);
  assert.strictEqual(result.flags.status, 'running');
});

test('routing: lanes with subcommand', () => {
  const result = parseArgs(['lanes', 'init', '--cwd', '/tmp/repo']);

  assert.strictEqual(result.command, 'lanes');
  assert.deepStrictEqual(result.args, ['init']);
  assert.strictEqual(result.flags.cwd, '/tmp/repo');
});

// =============================================================================
// FLAGS PARSING
// =============================================================================

test('flags: --json flag', () => {
  const result = parseArgs(['list', '--json']);

  assert.strictEqual(result.flags.json, true);
});

test('flags: --all flag', () => {
  const result = parseArgs(['search', '--all']);

  assert.strictEqual(result.flags.all, true);
});

test('flags: --force flag', () => {
  const result = parseArgs(['install', 'pkg', '--force']);

  assert.strictEqual(result.flags.force, true);
});

test('flags: --verbose flag', () => {
  const result = parseArgs(['run', 'stack', '--verbose']);

  assert.strictEqual(result.flags.verbose, true);
});

test('flags: short -v flag', () => {
  const result = parseArgs(['doctor', '-v']);

  assert.strictEqual(result.flags.v, true);
});

test('flags: --dry-run flag', () => {
  const result = parseArgs(['import', 'sessions', '--dry-run']);

  assert.strictEqual(result.flags['dry-run'], true);
});

test('flags: --limit with value', () => {
  const result = parseArgs(['db', 'search', 'query', '--limit', '50']);

  assert.strictEqual(result.flags.limit, '50');
});

test('flags: --format=value style', () => {
  const result = parseArgs(['logs', '--format=json']);

  assert.strictEqual(result.flags.format, 'json');
});

// =============================================================================
// HELP AND VERSION
// =============================================================================

test('help: --help flag is parsed', () => {
  const result = parseArgs(['--help']);

  assert.strictEqual(result.flags.help, true);
  assert.strictEqual(result.command, null);
});

test('help: -h flag is parsed', () => {
  const result = parseArgs(['-h']);

  assert.strictEqual(result.flags.h, true);
});

test('version: --version flag is parsed', () => {
  const result = parseArgs(['--version']);

  assert.strictEqual(result.flags.version, true);
});

test('version: -v flag is parsed', () => {
  const result = parseArgs(['-v']);

  assert.strictEqual(result.flags.v, true);
});

test('help: help command with topic', () => {
  const result = parseArgs(['help', 'install']);

  assert.strictEqual(result.command, 'help');
  assert.deepStrictEqual(result.args, ['install']);
});

// =============================================================================
// EDGE CASES
// =============================================================================

test('edge: empty arguments', () => {
  const result = parseArgs([]);

  assert.strictEqual(result.command, null);
  assert.deepStrictEqual(result.args, []);
  assert.deepStrictEqual(result.flags, {});
});

test('edge: only flags no command', () => {
  const result = parseArgs(['--json', '--verbose']);

  assert.strictEqual(result.command, null);
  assert.strictEqual(result.flags.json, true);
  assert.strictEqual(result.flags.verbose, true);
});

test('edge: multiple positional args', () => {
  const result = parseArgs(['install', 'pkg1', 'pkg2', 'pkg3']);

  assert.strictEqual(result.command, 'install');
  assert.deepStrictEqual(result.args, ['pkg1', 'pkg2', 'pkg3']);
});

test('edge: flags between args', () => {
  const result = parseArgs(['db', 'search', '--limit', '10', 'query']);

  assert.strictEqual(result.command, 'db');
  assert.strictEqual(result.flags.limit, '10');
  // Note: 'query' comes after --limit value, so it's an arg
  assert.ok(result.args.includes('search'));
  assert.ok(result.args.includes('query'));
});
