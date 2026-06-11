import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { withPreservedInstallState } from '../../installer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../..');
const installerUrl = pathToFileURL(path.join(repoRoot, 'packages/core/src/installer.js')).href;

test('withPreservedInstallState restores runs after a destructive stack reinstall', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-install-state-'));
  const installPath = path.join(root, 'video-editor');
  const runPath = path.join(installPath, 'runs', 'run-1');
  fs.mkdirSync(runPath, { recursive: true });
  fs.writeFileSync(path.join(runPath, 'project.json'), '{"state":"rendered"}');

  await withPreservedInstallState(installPath, ['runs'], async () => {
    fs.rmSync(installPath, { recursive: true, force: true });
    fs.mkdirSync(path.join(installPath, 'runs', 'registry-sample'), { recursive: true });
    fs.writeFileSync(path.join(installPath, 'manifest.json'), '{"id":"video-editor"}');
    fs.writeFileSync(path.join(installPath, 'runs', 'registry-sample', 'project.json'), '{}');
  });

  assert.equal(
    fs.readFileSync(path.join(runPath, 'project.json'), 'utf8'),
    '{"state":"rendered"}'
  );
  assert.equal(
    fs.existsSync(path.join(installPath, 'runs', 'registry-sample', 'project.json')),
    false
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('withPreservedInstallState restores runs when reinstall fails after removing install path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-install-state-fail-'));
  const installPath = path.join(root, 'video-editor');
  const runPath = path.join(installPath, 'runs', 'run-1');
  fs.mkdirSync(runPath, { recursive: true });
  fs.writeFileSync(path.join(runPath, 'project.json'), '{"state":"reviewed"}');

  await assert.rejects(
    () => withPreservedInstallState(installPath, ['runs'], async () => {
      fs.rmSync(installPath, { recursive: true, force: true });
      fs.mkdirSync(installPath, { recursive: true });
      throw new Error('download failed');
    }),
    /download failed/
  );

  assert.equal(
    fs.readFileSync(path.join(runPath, 'project.json'), 'utf8'),
    '{"state":"reviewed"}'
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test('updatePackage migrates install-local stack state unless preservation is explicit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-update-state-'));
  const rudiHome = path.join(root, '.rudi');
  const registryRoot = path.join(root, 'registry');
  const stackSource = path.join(registryRoot, 'catalog/stacks/state-demo');
  fs.mkdirSync(stackSource, { recursive: true });
  fs.writeFileSync(path.join(registryRoot, 'index.json'), JSON.stringify({
    packages: {
      stacks: {
        official: [
          {
            id: 'stack:state-demo',
            name: 'State Demo',
            version: '1.0.0',
            path: 'catalog/stacks/state-demo',
          },
        ],
      },
    },
  }, null, 2));
  fs.writeFileSync(path.join(stackSource, 'manifest.json'), JSON.stringify({
    id: 'stack:state-demo',
    name: 'State Demo',
    version: '1.0.0',
  }, null, 2));

  try {
    const script = `
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { installPackage, updatePackage } = await import(process.argv[1]);
      await installPackage('stack:state-demo', { force: true, preserveState: false });
      const sentinelPath = path.join(process.env.RUDI_HOME, 'stacks/state-demo/runs/sentinel/project.json');
      const migratedPath = path.join(process.env.RUDI_HOME, 'state/stacks/state-demo/runs/sentinel/project.json');
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
      fs.writeFileSync(sentinelPath, '{"state":"install-local"}');
      await updatePackage('stack:state-demo', { preserveState: false });
      const migratedWhenFalse = !fs.existsSync(sentinelPath) && fs.existsSync(migratedPath);
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
      fs.writeFileSync(sentinelPath, '{"state":"install-local"}');
      await updatePackage('stack:state-demo', { preserveState: true });
      console.log(JSON.stringify({
        migratedWhenFalse,
        migratedContent: fs.readFileSync(migratedPath, 'utf8'),
        preservedWhenTrue: fs.existsSync(sentinelPath)
      }));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, installerUrl], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RUDI_HOME: rudiHome,
        USE_LOCAL_REGISTRY: 'true',
        RUDI_REGISTRY_ROOT: registryRoot,
      },
      encoding: 'utf8',
    });

    assert.deepEqual(JSON.parse(output), {
      migratedWhenFalse: true,
      migratedContent: '{"state":"install-local"}',
      preservedWhenTrue: true,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installPackage fails missing binary downloads instead of creating placeholders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-no-placeholder-'));
  const rudiHome = path.join(root, '.rudi');
  const registryRoot = path.join(root, 'registry');
  fs.mkdirSync(registryRoot, { recursive: true });
  fs.writeFileSync(path.join(registryRoot, 'index.json'), JSON.stringify({
    packages: {
      binaries: {
        official: [
          {
            id: 'binary:ghost-tool',
            name: 'Ghost Tool',
            version: '1.0.0',
            kind: 'binary',
          },
        ],
      },
    },
  }, null, 2));

  try {
    const script = `
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { installPackage } = await import(process.argv[1]);
      const result = await installPackage('binary:ghost-tool', { force: true });
      const installPath = path.join(process.env.RUDI_HOME, 'binaries', 'ghost-tool');
      console.log(JSON.stringify({
        success: result.success,
        message: result.error,
        manifestExists: fs.existsSync(path.join(installPath, 'manifest.json')),
      }));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, installerUrl], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RUDI_HOME: rudiHome,
        USE_LOCAL_REGISTRY: 'true',
        RUDI_REGISTRY_ROOT: registryRoot,
      },
      encoding: 'utf8',
    });

    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(result.success, false);
    assert.match(result.message, /Failed to install binary:ghost-tool/);
    assert.equal(result.manifestExists, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installPackage registers system binaries instead of downloading them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-system-binary-'));
  const rudiHome = path.join(root, '.rudi');
  const registryRoot = path.join(root, 'registry');
  const binRoot = path.join(root, 'bin');
  const fakeTool = path.join(binRoot, 'system-tool');

  fs.mkdirSync(path.join(registryRoot, 'catalog', 'binaries'), { recursive: true });
  fs.mkdirSync(binRoot, { recursive: true });
  fs.writeFileSync(fakeTool, '#!/usr/bin/env bash\necho system-tool 1.0.0\n');
  fs.chmodSync(fakeTool, 0o755);
  fs.writeFileSync(path.join(registryRoot, 'index.json'), JSON.stringify({
    packages: {
      binaries: {
        official: [
          {
            id: 'binary:system-tool',
            name: 'System Tool',
            version: 'system',
            path: 'catalog/binaries/system-tool.json',
          },
        ],
      },
    },
  }, null, 2));
  fs.writeFileSync(path.join(registryRoot, 'catalog', 'binaries', 'system-tool.json'), JSON.stringify({
    id: 'binary:system-tool',
    name: 'System Tool',
    version: 'system',
    installType: 'system',
    managed: false,
    binary: 'system-tool',
    bins: ['system-tool'],
    checkCommand: 'system-tool --version',
  }, null, 2));

  try {
    const script = `
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { installPackage } = await import(process.argv[1]);
      const result = await installPackage('binary:system-tool', { force: true, withShims: true });
      const installPath = path.join(process.env.RUDI_HOME, 'binaries', 'system-tool');
      const manifest = JSON.parse(fs.readFileSync(path.join(installPath, 'manifest.json'), 'utf8'));
      console.log(JSON.stringify({
        success: result.success,
        installType: manifest.installType,
        sourcePath: manifest.source?.path,
        shimExists: fs.existsSync(path.join(process.env.RUDI_HOME, 'bins', 'system-tool')),
      }));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, installerUrl], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binRoot}${path.delimiter}${process.env.PATH || ''}`,
        RUDI_HOME: rudiHome,
        USE_LOCAL_REGISTRY: 'true',
        RUDI_REGISTRY_ROOT: registryRoot,
      },
      encoding: 'utf8',
    });

    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    assert.equal(result.success, true);
    assert.equal(result.installType, 'system');
    assert.equal(result.sourcePath, fakeTool);
    assert.equal(result.shimExists, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
