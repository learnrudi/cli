import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const qualified = process.platform === 'darwin'
  && os.release().startsWith('24.') && process.arch === 'x64';

for (const relativeCwd of ['', 'packages/mcp']) {
test(`test entrypoint compiles a missing native fixture helper from ${relativeCwd || 'root'}`,
  { skip: !qualified, timeout: 30000 }, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-fresh-native-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const name of ['scripts/run-tests.js', 'scripts/build-task-audit.mjs',
      'native/task-audit.c', 'src/agent-host/task-audit.js']) {
      const destination = path.join(root, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repo, name), destination);
    }
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    const workingDirectory = path.join(root, relativeCwd);
    fs.mkdirSync(workingDirectory, { recursive: true });
    fs.writeFileSync(path.join(workingDirectory, 'probe.test.js'), `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      const helper = ${JSON.stringify(path.join(root, 'dist/task-audit-darwin'))};
      assert.ok(fs.existsSync(helper), 'native helper missing before tests');
      fs.accessSync(helper, fs.constants.X_OK);
      fs.writeFileSync('probe-ran', 'yes');
    `);
    assert.equal(fs.existsSync(path.join(root, 'dist/task-audit-darwin')), false);
    const environment = { ...process.env, RUDI_CLI_TEST_WRAPPER_ACTIVE: '1' };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-tests.js'), 'probe.test.js'], {
      cwd: workingDirectory, encoding: 'utf8', timeout: 25000,
      env: environment,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(workingDirectory, 'probe-ran')), true);
  });
}

for (const host of [
  { platform: 'darwin', arch: 'arm64', release: '24.0.0' },
  { platform: 'darwin', arch: 'x64', release: '25.0.0' },
  { platform: 'linux', arch: 'x64', release: '24.0.0' },
]) {
  test(`native custody fixtures skip unqualified host ${JSON.stringify(host)}`, () => {
    const script = `
      import os from 'node:os';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      Object.defineProperty(process, 'platform', { value: ${JSON.stringify(host.platform)} });
      Object.defineProperty(process, 'arch', { value: ${JSON.stringify(host.arch)} });
      os.release = () => ${JSON.stringify(host.release)};
      childProcess.spawnSync = () => { throw new Error('unqualified native fixture executed'); };
      syncBuiltinESMExports();
      await import(${JSON.stringify(new URL('./agent-task-custody.test.js', import.meta.url).href)});
    `;
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repo, env: environment, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /(?:#|ℹ) skipped 8/u);
  });
}
