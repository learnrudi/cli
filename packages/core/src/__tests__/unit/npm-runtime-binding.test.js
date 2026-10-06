import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('npm tools resolve their explicit Node runtime before installation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-npm-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previousEnv = { ...process.env };
  t.after(() => { process.env = previousEnv; });
  process.env.RUDI_HOME = path.join(root, 'home');
  process.env.USE_LOCAL_REGISTRY = 'true';
  process.env.RUDI_REGISTRY_ROOT = path.join(root, 'registry');
  fs.mkdirSync(process.env.RUDI_REGISTRY_ROOT);
  const runtime = {
    id: 'runtime:node-22-23-2', kind: 'runtime', name: 'Node', version: '22.23.2',
    delivery: 'remote', bins: { node: { path: 'bin/node' } },
    install: { source: 'download', platforms: {
      [process.platform + '-' + process.arch]: {
        url: 'https://example.com/node.tar.gz', checksum: { algo: 'sha256', value: 'a'.repeat(64) },
        extract: { type: 'tar.gz', strip: 1 },
      },
    } },
  };
  const tool = {
    id: 'binary:demo', kind: 'binary', name: 'Demo', version: '1.2.3',
    delivery: 'remote', bins: ['demo'], postInstall: { bin: 'demo', args: ['--postinstall'] },
    install: { source: 'npm', package: 'demo', nodeRuntime: runtime.id },
  };
  fs.writeFileSync(path.join(process.env.RUDI_REGISTRY_ROOT, 'index.json'), JSON.stringify({
    schemaVersion: '2', packages: {
      [tool.id]: tool, [runtime.id]: runtime,
      'binary:missing': { ...tool, id: 'binary:missing', install: { ...tool.install, nodeRuntime: 'runtime:node-999' } },
      'binary:parent': { ...tool, id: 'binary:parent', install: { source: 'npm', package: 'parent' }, requires: { binaries: [tool.id] } },
      'binary:missing-parent': { ...tool, id: 'binary:missing-parent', install: { source: 'npm', package: 'parent' }, requires: { binaries: ['binary:missing'] } },
    },
  }));
  const { resolvePackage, getInstallOrder } = await import('../../resolver.js');
  const resolved = await resolvePackage(tool.id);
  assert.deepEqual(getInstallOrder(resolved).map(pkg => pkg.id), [runtime.id, tool.id]);
  const parent = await resolvePackage('binary:parent');
  assert.deepEqual(getInstallOrder(parent).map(pkg => pkg.id), [runtime.id, tool.id, 'binary:parent']);
  await assert.rejects(resolvePackage('binary:missing'), /Required npm Node runtime not found/);
  await assert.rejects(resolvePackage('binary:missing-parent'), /Required npm Node runtime not found/);
  const { getNpmNodeRuntimeId, resolveNpmRuntimeBin } = await import('../../npm-runtime.js');
  assert.equal(getNpmNodeRuntimeId({ install: { source: 'npm' } }), undefined);
  for (const id of ['../../escape', 'runtime:python', '', null]) {
    assert.throws(() => resolveNpmRuntimeBin(id, 'node'), /Invalid npm Node runtime binding/);
  }
  assert.throws(() => getNpmNodeRuntimeId({ install: { source: 'pip', nodeRuntime: runtime.id } }), /only supported for npm/);

  // Exercise the actual installer and emitted wrapper with a local npm fixture.
  const binDir = path.join(process.env.RUDI_HOME, 'runtimes', 'node-22-23-2', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const sharedBin = path.join(process.env.RUDI_HOME, 'runtimes', 'node', 'bin');
  fs.mkdirSync(sharedBin, { recursive: true });
  fs.writeFileSync(path.join(sharedBin, 'npm'), '#!/bin/sh\nexit 91\n', { mode: 0o755 });
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.writeFileSync(path.join(binDir, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === 'init') fs.writeFileSync('package.json', '{}');
else {
  fs.mkdirSync('node_modules/.bin', { recursive: true });
  fs.mkdirSync('node_modules/demo', { recursive: true });
  fs.writeFileSync('node_modules/demo/package.json', JSON.stringify({ version: '1.2.3', bin: { demo: 'cli.js' } }));
  fs.writeFileSync('npm-argv.json', JSON.stringify(process.argv.slice(2)));
  fs.writeFileSync('node_modules/.bin/demo', '#!/usr/bin/env node\\nconst paths = process.env.PATH.split(require("node:path").delimiter);\\nif (process.argv.includes("--postinstall")) require("node:fs").writeFileSync("postinstall-path.json", JSON.stringify(paths));\\nelse console.log(paths[0]);\\n', { mode: 0o755 });
}
`, { mode: 0o755 });
  const ambientBin = path.join(root, 'ambient');
  fs.mkdirSync(ambientBin);
  fs.writeFileSync(path.join(ambientBin, 'node'), '#!/bin/sh\necho UNBOUND_POSTINSTALL_NODE >&2\nexit 93\n', { mode: 0o755 });
  process.env.PATH = `${ambientBin}${path.delimiter}${process.env.PATH}`;
  resolved.dependencies[0].installed = true;
  const { installPackage } = await import('../../installer.js');
  const result = await installPackage(tool.id, { resolvedPackage: resolved, withShims: true });
  assert.equal(result.success, true, result.error);
  const installDir = path.join(process.env.RUDI_HOME, 'binaries', 'demo');
  const manifest = JSON.parse(fs.readFileSync(path.join(installDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.nodeRuntime, runtime.id);
  const argv = JSON.parse(fs.readFileSync(path.join(installDir, 'npm-argv.json'), 'utf8'));
  assert.equal(argv[1], 'demo@1.2.3');
  const postInstallPath = JSON.parse(fs.readFileSync(path.join(installDir, 'postinstall-path.json'), 'utf8'));
  assert.equal(postInstallPath[0], binDir);
  assert.equal(postInstallPath[1], path.join(installDir, 'node_modules', '.bin'));
  const shim = path.join(process.env.RUDI_HOME, 'bins', 'demo');
  assert.equal(execFileSync(shim, { encoding: 'utf8' }).trim(), binDir);

  // Rebuilding from installed metadata must preserve the same runtime.
  fs.unlinkSync(shim);
  const cli = fileURLToPath(new URL('../../../../../src/index.js', import.meta.url));
  execFileSync(process.execPath, [cli, 'shims', 'rebuild'], { env: process.env, stdio: 'pipe' });
  assert.equal(execFileSync(shim, { encoding: 'utf8' }).trim(), binDir);

  // A missing binding fails at launch and reinstall, never through PATH fallback.
  fs.unlinkSync(path.join(binDir, 'node'));
  assert.throws(() => execFileSync(shim, { stdio: 'pipe' }), /Required managed Node runtime is missing/);
  const failed = await installPackage(tool.id, { resolvedPackage: resolved, force: true, withShims: true });
  assert.equal(failed.success, false);
  assert.match(failed.error, /missing node\/npm/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, 'manifest.json'), 'utf8')).nodeRuntime, runtime.id);

  // An unusable executable must not let env's PATH search select ambient Node.
  fs.unlinkSync(path.join(ambientBin, 'node'));
  fs.symlinkSync(process.execPath, path.join(ambientBin, 'node'));
  fs.writeFileSync(path.join(binDir, 'node'), '#!/bin/sh\nexit 92\n', { mode: 0o644 });
  const unusable = await installPackage(tool.id, { resolvedPackage: resolved, force: true, withShims: true });
  assert.equal(unusable.success, false);
  assert.match(unusable.error, /missing node\/npm/);

  fs.unlinkSync(path.join(binDir, 'node'));
  fs.mkdirSync(path.join(binDir, 'node'));
  assert.throws(() => execFileSync(shim, { stdio: 'pipe' }), /Required managed Node runtime is missing/);
});
