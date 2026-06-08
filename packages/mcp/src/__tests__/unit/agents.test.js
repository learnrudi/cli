/**
 * Unit tests for agent detection and configuration
 */

import { test } from 'node:test';
import assert from 'node:assert';
import os from 'os';
import path from 'path';
import { AGENT_CONFIGS, getAgentConfigPaths, readCodexTomlMcpServers } from '../../agents.js';

// =============================================================================
// AGENT CONFIGURATION
// =============================================================================

test('agents: AGENT_CONFIGS is array with known agents', () => {
  assert.ok(Array.isArray(AGENT_CONFIGS));
  assert.ok(AGENT_CONFIGS.length >= 5, 'Should have at least 5 agent configs');
});

test('agents: each config has required fields', () => {
  for (const config of AGENT_CONFIGS) {
    assert.ok(config.id, `Config should have id: ${JSON.stringify(config)}`);
    assert.ok(config.name, `Config should have name: ${config.id}`);
    assert.ok(config.key, `Config should have key: ${config.id}`);
    assert.ok(config.paths, `Config should have paths: ${config.id}`);
  }
});

test('agents: Claude Desktop config exists', () => {
  const claude = AGENT_CONFIGS.find(a => a.id === 'claude-desktop');

  assert.ok(claude);
  assert.strictEqual(claude.name, 'Claude Desktop');
  assert.strictEqual(claude.key, 'mcpServers');
  assert.ok(claude.paths.darwin);
  assert.ok(claude.paths.win32);
});

test('agents: Cursor config exists', () => {
  const cursor = AGENT_CONFIGS.find(a => a.id === 'cursor');

  assert.ok(cursor);
  assert.strictEqual(cursor.name, 'Cursor');
  assert.strictEqual(cursor.key, 'mcpServers');
});

test('agents: Zed uses context_servers key', () => {
  const zed = AGENT_CONFIGS.find(a => a.id === 'zed');

  assert.ok(zed);
  assert.strictEqual(zed.key, 'context_servers');
});

test('agents: VS Code uses servers key', () => {
  const vscode = AGENT_CONFIGS.find(a => a.id === 'vscode');

  assert.ok(vscode);
  assert.strictEqual(vscode.key, 'servers');
});

// =============================================================================
// PATH RESOLUTION
// =============================================================================

test('paths: getAgentConfigPaths returns array', () => {
  const claude = AGENT_CONFIGS.find(a => a.id === 'claude-desktop');
  const paths = getAgentConfigPaths(claude);

  assert.ok(Array.isArray(paths));
  assert.ok(paths.length > 0);
});

test('paths: paths are absolute', () => {
  const claude = AGENT_CONFIGS.find(a => a.id === 'claude-desktop');
  const paths = getAgentConfigPaths(claude);

  for (const p of paths) {
    assert.ok(path.isAbsolute(p), `Path should be absolute: ${p}`);
  }
});

test('paths: paths start with home directory', () => {
  const home = os.homedir();
  const claude = AGENT_CONFIGS.find(a => a.id === 'claude-desktop');
  const paths = getAgentConfigPaths(claude);

  for (const p of paths) {
    assert.ok(p.startsWith(home), `Path should start with home: ${p}`);
  }
});

test('paths: darwin paths for Claude Desktop', () => {
  // Test darwin paths specifically
  const claude = AGENT_CONFIGS.find(a => a.id === 'claude-desktop');
  const darwinPaths = claude.paths.darwin;

  assert.ok(darwinPaths.some(p => p.includes('Library/Application Support/Claude')));
});

test('paths: win32 paths for Claude Desktop', () => {
  const claude = AGENT_CONFIGS.find(a => a.id === 'claude-desktop');
  const win32Paths = claude.paths.win32;

  assert.ok(win32Paths.some(p => p.includes('AppData/Roaming/Claude')));
});

// =============================================================================
// CONFIG FILE NAMES
// =============================================================================

test('config: Claude uses claude_desktop_config.json', () => {
  const claude = AGENT_CONFIGS.find(a => a.id === 'claude-desktop');

  assert.ok(claude.paths.darwin.some(p => p.endsWith('claude_desktop_config.json')));
});

test('config: Cursor uses mcp.json', () => {
  const cursor = AGENT_CONFIGS.find(a => a.id === 'cursor');

  assert.ok(cursor.paths.darwin.some(p => p.endsWith('mcp.json')));
});

test('config: Windsurf uses mcp_config.json', () => {
  const windsurf = AGENT_CONFIGS.find(a => a.id === 'windsurf');

  assert.ok(windsurf.paths.darwin.some(p => p.endsWith('mcp_config.json')));
});

test('config: Cline uses cline_mcp_settings.json', () => {
  const cline = AGENT_CONFIGS.find(a => a.id === 'cline');

  assert.ok(cline.paths.darwin.some(p => p.endsWith('cline_mcp_settings.json')));
});

test('config: Codex prefers config.toml', () => {
  const codex = AGENT_CONFIGS.find(a => a.id === 'codex');

  assert.strictEqual(codex.key, 'mcp_servers');
  assert.ok(codex.paths.darwin[0].endsWith('config.toml'));
});

test('config: parses Codex TOML MCP servers', () => {
  const servers = readCodexTomlMcpServers(`
[mcp_servers.rudi]
command = "/Users/test/.rudi/bins/rudi-router"
args = []

[mcp_servers.docs]
url = "https://developers.openai.com/mcp"
`, '/Users/test/.codex/config.toml');

  assert.deepStrictEqual(servers.map((server) => server.name), ['rudi', 'docs']);
  assert.strictEqual(servers[0].command, '/Users/test/.rudi/bins/rudi-router');
  assert.strictEqual(servers[1].command, 'https://developers.openai.com/mcp');
});

// =============================================================================
// AGENT IDS
// =============================================================================

test('ids: all agent ids are unique', () => {
  const ids = AGENT_CONFIGS.map(a => a.id);
  const uniqueIds = new Set(ids);

  assert.strictEqual(ids.length, uniqueIds.size, 'All agent IDs should be unique');
});

test('ids: known agent ids exist', () => {
  const expectedIds = ['claude-desktop', 'cursor', 'windsurf', 'cline', 'zed', 'vscode', 'gemini', 'codex'];

  for (const id of expectedIds) {
    assert.ok(AGENT_CONFIGS.some(a => a.id === id), `Agent ${id} should exist`);
  }
});

// =============================================================================
// MCP KEY VARIATIONS
// =============================================================================

test('key: most agents use mcpServers', () => {
  const mcpServersAgents = AGENT_CONFIGS.filter(a => a.key === 'mcpServers');

  assert.ok(mcpServersAgents.length >= 5, 'Most agents should use mcpServers key');
});

test('key: variations are handled', () => {
  const keys = new Set(AGENT_CONFIGS.map(a => a.key));

  // Should have mcpServers, context_servers, servers
  assert.ok(keys.has('mcpServers'));
  assert.ok(keys.has('context_servers'));
  assert.ok(keys.has('servers'));
});
