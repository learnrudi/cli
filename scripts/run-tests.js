#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKDIR = process.cwd();

const DEFAULT_TEST_ARGS = [
  '--test',
  'src/__tests__/unit/*.test.js',
  'src/__tests__/e2e/*.test.js',
  'packages/*/src/__tests__/unit/*.test.js',
];

const BUNDLED_NODE_PATH = process.env.RUDI_CLI_TEST_NODE
  || path.join(os.homedir(), '.rudi', 'runtimes', 'node', 'bin', 'node');

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|\\]/g, '\\$&');
  const regexBody = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexBody}$`);
}

function expandTestArg(arg) {
  if (!/[*?]/.test(arg)) return [arg];

  const segments = arg.split(/[\\/]+/).filter(Boolean);
  let candidates = [''];

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    const nextCandidates = [];
    const hasGlob = /[*?]/.test(segment);

    for (const candidate of candidates) {
      if (!hasGlob) {
        nextCandidates.push(path.join(candidate, segment));
        continue;
      }

      const dir = path.resolve(WORKDIR, candidate || '.');
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      const matcher = globToRegExp(segment);
      for (const entry of entries) {
        if (!matcher.test(entry.name)) continue;
        if (!isLast && !entry.isDirectory()) continue;
        if (isLast && !entry.isFile()) continue;
        nextCandidates.push(path.join(candidate, entry.name));
      }
    }

    candidates = nextCandidates;
    if (candidates.length === 0) return [arg];
  }

  const matches = candidates
    .filter((candidate) => {
      try {
        return fs.statSync(path.resolve(WORKDIR, candidate)).isFile();
      } catch {
        return false;
      }
    })
    .sort();

  return matches.length > 0 ? matches : [arg];
}

function resolveTestArgs(argv) {
  const forwarded = argv[0] === '--' ? argv.slice(1) : argv;
  const baseArgs = forwarded.length === 0 ? DEFAULT_TEST_ARGS : forwarded;
  const includesTestFlag = forwarded.some(
    (arg) => arg === '--test' || arg.startsWith('--test='),
  );
  const normalized = forwarded.length === 0
    ? baseArgs
    : (includesTestFlag ? baseArgs : ['--test', ...baseArgs]);
  const expanded = [];
  for (const arg of normalized) {
    if (arg.startsWith('-')) {
      expanded.push(arg);
      continue;
    }
    expanded.push(...expandTestArg(arg));
  }
  return expanded;
}

function canLoadBetterSqlite3() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function isAbiMismatch(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('NODE_MODULE_VERSION') || message.includes('ERR_DLOPEN_FAILED');
}

function runNode(nodePath, args) {
  const result = spawnSync(nodePath, args, {
    cwd: WORKDIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      RUDI_CLI_TEST_WRAPPER_ACTIVE: '1',
    },
  });

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }
  if (result.error) {
    console.error(`[cli:test] failed to launch ${nodePath}: ${result.error.message}`);
  }
  process.exit(1);
}

const testArgs = resolveTestArgs(process.argv.slice(2));
const compatibility = canLoadBetterSqlite3();

if (compatibility.ok) {
  runNode(process.execPath, testArgs);
}

if (
  process.env.RUDI_CLI_TEST_WRAPPER_ACTIVE === '1'
  || !isAbiMismatch(compatibility.error)
  || process.execPath === BUNDLED_NODE_PATH
  || !fs.existsSync(BUNDLED_NODE_PATH)
) {
  console.error('[cli:test] unable to load better-sqlite3 with the current Node runtime.');
  if (compatibility.error instanceof Error) {
    console.error(compatibility.error.message);
  }
  if (!fs.existsSync(BUNDLED_NODE_PATH)) {
    console.error(`[cli:test] bundled runtime not found at ${BUNDLED_NODE_PATH}`);
  }
  process.exit(1);
}

const currentMajor = Number(process.versions.node.split('.')[0] || 0);
console.error(
  `[cli:test] Node ${currentMajor} cannot load better-sqlite3 here; ` +
  `re-running tests with bundled runtime at ${BUNDLED_NODE_PATH}. ` +
  `Use this wrapper or npm test for native-module test runs.`,
);
runNode(BUNDLED_NODE_PATH, testArgs);
