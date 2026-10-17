import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../..');
const toolIndexUrl = pathToFileURL(path.join(repoRoot, 'packages/core/src/tool-index.js')).href;

test('removeStackFromToolIndex prunes one cached stack entry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-tool-index-'));
  const rudiHome = path.join(root, '.rudi');

  try {
    const script = `
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { readToolIndex, removeStackFromToolIndex, writeToolIndex } = await import(process.argv[1]);
      writeToolIndex({
        version: 1,
        updatedAt: 'old',
        byStack: {
          'stack:slack': { indexedAt: 'old', tools: [], error: null },
          'stack:notion': { indexedAt: 'old', tools: [{ name: 'notion_search' }], error: null }
        }
      });
      const removed = removeStackFromToolIndex('stack:slack');
      const missing = removeStackFromToolIndex('stack:missing');
      console.log(JSON.stringify({ removed, missing, index: readToolIndex() }));
    `;

    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, toolIndexUrl], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RUDI_HOME: rudiHome,
      },
      encoding: 'utf8',
    });

    const result = JSON.parse(output);
    assert.equal(result.removed, true);
    assert.equal(result.missing, false);
    assert.deepEqual(Object.keys(result.index.byStack), ['stack:notion']);
    assert.equal(result.index.byStack['stack:notion'].tools[0].name, 'notion_search');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverStackTools terminates descendants when the launcher exits on timeout SIGTERM', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-tool-index-timeout-'));
  const rudiHome = path.join(root, '.rudi');
  const fakeStack = path.join(root, 'fake-stack.cjs');
  const pidFile = path.join(root, 'fake-stack-pids.json');

  try {
    fs.writeFileSync(fakeStack, `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const descendant = spawn(process.execPath, ['-e', \`
        process.on('SIGTERM', () => {});
        setTimeout(() => {}, 5000);
      \`], { stdio: 'inherit' });
      fs.writeFileSync(process.argv[2], JSON.stringify({
        parentPid: process.pid,
        descendantPid: descendant.pid,
      }));
      setTimeout(() => {}, 5000);
    `);

    const script = `
      const fs = await import('node:fs');
      const { discoverStackTools } = await import(process.argv[1]);
      const result = await discoverStackTools('stack:timeout-fixture', {
        installed: true,
        path: process.argv[2],
        launch: { bin: process.execPath, args: [process.argv[3], process.argv[4]] },
      }, { timeout: 500 });
      await new Promise(resolve => setTimeout(resolve, 400));
      const pids = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
      const alive = {};
      for (const [name, pid] of Object.entries(pids)) {
        alive[name] = false;
        try {
          process.kill(pid, 0);
          alive[name] = true;
        } catch {}
        if (alive[name]) process.kill(pid, 'SIGKILL');
      }
      console.log(JSON.stringify({ alive, result }));
    `;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, toolIndexUrl, root, fakeStack, pidFile],
      {
        cwd: repoRoot,
        env: { ...process.env, RUDI_HOME: rudiHome },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    const result = JSON.parse(output);

    assert.equal(result.result.error, 'Timeout after 500ms');
    assert.deepEqual(result.alive, {
      parentPid: false,
      descendantPid: false,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverStackTools terminates descendants after a nonzero launcher exit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-tool-index-exit-'));
  const rudiHome = path.join(root, '.rudi');
  const fakeStack = path.join(root, 'fake-stack.cjs');
  const pidFile = path.join(root, 'fake-stack-pids.json');

  try {
    fs.writeFileSync(fakeStack, `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const descendant = spawn(process.execPath, ['-e', \`
        process.on('SIGTERM', () => {});
        setTimeout(() => {}, 5000);
      \`], { stdio: 'inherit' });
      fs.writeFileSync(process.argv[2], JSON.stringify({
        parentPid: process.pid,
        descendantPid: descendant.pid,
      }));
      setTimeout(() => process.exit(23), 100);
    `);

    const script = `
      const fs = await import('node:fs');
      const { discoverStackTools } = await import(process.argv[1]);
      const result = await discoverStackTools('stack:exit-fixture', {
        installed: true,
        path: process.argv[2],
        launch: { bin: process.execPath, args: [process.argv[3], process.argv[4]] },
      }, { timeout: 2000 });
      await new Promise(resolve => setTimeout(resolve, 400));
      const { descendantPid } = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
      let descendantAlive = false;
      try {
        process.kill(descendantPid, 0);
        descendantAlive = true;
      } catch {}
      if (descendantAlive) process.kill(descendantPid, 'SIGKILL');
      console.log(JSON.stringify({ descendantAlive, result }));
    `;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, toolIndexUrl, root, fakeStack, pidFile],
      {
        cwd: repoRoot,
        env: { ...process.env, RUDI_HOME: rudiHome },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    const result = JSON.parse(output);

    assert.equal(result.result.error, 'Process exited with code 23');
    assert.equal(result.descendantAlive, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverStackTools falls back when Windows taskkill exits nonzero', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-tool-index-taskkill-'));
  const rudiHome = path.join(root, '.rudi');
  const fakeStack = path.join(root, 'fake-stack.cjs');
  const fakeTaskkill = path.join(root, 'taskkill');
  const pidFile = path.join(root, 'fake-stack.pid');

  try {
    fs.writeFileSync(fakeStack, `
      const fs = require('node:fs');
      fs.writeFileSync(process.argv[2], String(process.pid));
      process.on('SIGTERM', () => {});
      setTimeout(() => {}, 5000);
    `);
    fs.writeFileSync(fakeTaskkill, '#!/bin/sh\nexit 7\n', { mode: 0o755 });

    const script = `
      const fs = await import('node:fs');
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const { discoverStackTools } = await import(process.argv[1]);
      const result = await discoverStackTools('stack:taskkill-fixture', {
        installed: true,
        path: process.argv[2],
        launch: { bin: process.execPath, args: [process.argv[3], process.argv[4]] },
      }, { timeout: 500 });
      const childPid = Number(fs.readFileSync(process.argv[4], 'utf8'));
      // Observe asynchronous fallback completion before the fixture's natural
      // five-second exit, without racing taskkill close and escalation events.
      const deadline = Date.now() + 3000;
      let childAlive = true;
      while (childAlive && Date.now() < deadline) {
        try { process.kill(childPid, 0); } catch { childAlive = false; }
        if (childAlive) await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (childAlive) process.kill(childPid, 'SIGKILL');
      console.log(JSON.stringify({ childAlive, result }));
    `;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, toolIndexUrl, root, fakeStack, pidFile],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${root}${path.delimiter}${process.env.PATH || ''}`,
          RUDI_HOME: rudiHome,
        },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    const result = JSON.parse(output);

    assert.equal(result.result.error, 'Timeout after 500ms');
    assert.equal(result.childAlive, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverStackTools sweeps Windows descendants after the launcher exits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-tool-index-win-exit-'));
  const rudiHome = path.join(root, '.rudi');
  const fakeStack = path.join(root, 'fake-stack.cjs');
  const fakeTaskkill = path.join(root, 'taskkill');
  const fakePowerShell = path.join(root, 'powershell.exe');
  const pidFile = path.join(root, 'fake-stack-pids.json');
  const sweepMarker = path.join(root, 'sweep-marker.json');

  try {
    fs.writeFileSync(fakeStack, `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const descendant = spawn(process.execPath, ['-e', \`
        process.on('SIGTERM', () => {});
        setTimeout(() => {}, 5000);
      \`], { stdio: 'inherit' });
      fs.writeFileSync(process.argv[2], JSON.stringify({
        parentPid: process.pid,
        descendantPid: descendant.pid,
      }));
      setTimeout(() => process.exit(23), 100);
    `);
    fs.writeFileSync(fakeTaskkill, '#!/bin/sh\nexit 7\n', { mode: 0o755 });
    fs.writeFileSync(fakePowerShell, `#!/bin/sh
if [ "$#" -ne 5 ] || [ "$1" != "-NoLogo" ] || [ "$2" != "-NoProfile" ] || [ "$3" != "-NonInteractive" ] || [ "$4" != "-Command" ]; then
  exit 9
fi
node -e "const fs = require('node:fs'); const pids = JSON.parse(fs.readFileSync(process.env.FAKE_DESCENDANT_PID_FILE, 'utf8')); const rootPid = Number(process.env.RUDI_TOOL_INDEX_SWEEP_ROOT_PID); const notBeforeMs = Number(process.env.RUDI_TOOL_INDEX_SWEEP_NOT_BEFORE_MS); const mode = process.env.RUDI_TOOL_INDEX_SWEEP_MODE; if (rootPid !== pids.parentPid || !Number.isFinite(notBeforeMs) || !['graceful', 'force'].includes(mode)) process.exit(10); process.kill(pids.descendantPid, 'SIGKILL'); fs.writeFileSync(process.env.FAKE_SWEEP_MARKER, JSON.stringify({ descendantPid: pids.descendantPid, mode, notBeforeMs, rootPid }));"
`, { mode: 0o755 });

    const script = `
      const fs = await import('node:fs');
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const { discoverStackTools } = await import(process.argv[1]);
      const logs = [];
      const result = await discoverStackTools('stack:win-exit-fixture', {
        installed: true,
        path: process.argv[2],
        launch: { bin: process.execPath, args: [process.argv[3], process.argv[4]] },
      }, { timeout: 2000, log: message => logs.push(message) });
      // Wait for observable sweep completion instead of racing shell/Node startup.
      // The bound stays below the fixture descendant's five-second lifetime.
      const sweepDeadline = Date.now() + 3000;
      while (!fs.existsSync(process.env.FAKE_SWEEP_MARKER) && Date.now() < sweepDeadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      const { descendantPid } = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
      let descendantAlive = false;
      try {
        process.kill(descendantPid, 0);
        descendantAlive = true;
      } catch {}
      if (descendantAlive) process.kill(descendantPid, 'SIGKILL');
      const sweepInvoked = fs.existsSync(process.env.FAKE_SWEEP_MARKER);
      console.log(JSON.stringify({ descendantAlive, logs, result, sweepInvoked }));
    `;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script, toolIndexUrl, root, fakeStack, pidFile],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          FAKE_DESCENDANT_PID_FILE: pidFile,
          FAKE_SWEEP_MARKER: sweepMarker,
          PATH: `${root}${path.delimiter}${process.env.PATH || ''}`,
          RUDI_HOME: rudiHome,
        },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    const result = JSON.parse(output);

    assert.equal(result.result.error, 'Process exited with code 23');
    assert.equal(result.sweepInvoked, true, JSON.stringify(result));
    assert.equal(result.descendantAlive, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
