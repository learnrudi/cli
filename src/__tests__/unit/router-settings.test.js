import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const router = fileURLToPath(new URL('../../router-mcp.js', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/router-settings-stack.mjs', import.meta.url));
const configModule = new URL('../../../packages/core/src/rudi-config.js', import.meta.url);

async function setup(t, stacks) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-router-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const settings = { schemaVersion: 1, stacks };
  await fs.writeFile(path.join(root, 'router-settings.json'), JSON.stringify(settings));
  // Use the same registration boundary as install/update, twice, with fresh launch metadata.
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { addStack } = await import(${JSON.stringify(configModule.href)});
    for (const version of ['1.0.0', '1.0.1']) {
      for (const id of ['stack:fixture', 'stack:other']) {
        addStack(id, { path: process.env.RUDI_HOME, runtime: 'node',
          command: [process.execPath, ${JSON.stringify(fixture)}],
          secrets: [{ name: 'FIXTURE_TOKEN' }], version });
      }
    }
  `], { env: { ...process.env, RUDI_HOME: root }, stdio: 'pipe' });
  return { root, settings };
}

function start(t, root, env = {}) {
  const child = spawn(process.execPath, [router], {
    env: { ...process.env, AUDIO_TOOLS_WHISPER_MODEL: 'inherited-model', RUDI_HOME: root, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const response = JSON.parse(line);
    pending.get(response.id)?.(response);
  });
  t.after(async () => {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  });
  let nextId = 0;
  return {
    child,
    stderr: () => stderr,
    async call(name, args = {}, waitMs = 5000) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Router did not answer ${name}: ${stderr}`));
        }, waitMs);
        pending.set(id, (value) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(value);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
      });
    },
  };
}

test('model settings survive stack re-registration and reach the launched process', async (t) => {
  const { root, settings } = await setup(t, {
    'stack:fixture': { env: { AUDIO_TOOLS_WHISPER_MODEL: '/models/installed.bin' } },
  });
  const client = start(t, root);
  const response = await client.call('stack:fixture.transcribe');
  assert.equal(response.error, undefined);
  assert.equal(JSON.parse(response.result.content[0].text).model, '/models/installed.bin');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'router-settings.json'))), settings);
});

test('tool deadlines are isolated and timed-out requests are not retried', async (t) => {
  const { root } = await setup(t, {
    'stack:fixture': { toolTimeoutMs: { 'short.name': 50, long: 2000 } },
  });
  const client = start(t, root);
  const expired = await client.call('stack:fixture.short.name', { delayMs: 200 });
  assert.equal(expired.error.code, -32603);
  assert.match(expired.error.message, /stack:fixture.short.name.*50 ms/);
  assert.match(expired.error.message, /may still be running/);
  const completed = await client.call('stack:fixture.long', { delayMs: 250 });
  assert.equal(completed.error, undefined);
  assert.equal(JSON.parse(completed.result.content[0].text).calls, 2);
  const ordinary = await client.call('stack:fixture.ordinary', { delayMs: 200 });
  assert.equal(ordinary.error, undefined);
  assert.equal(JSON.parse(ordinary.result.content[0].text).calls, 3);
});

test('settings are stack-scoped and declared secrets retain precedence', async (t) => {
  const { root } = await setup(t, {
    'stack:fixture': { env: { AUDIO_TOOLS_WHISPER_MODEL: 'configured-model', FIXTURE_TOKEN: 'not-a-secret' } },
  });
  await fs.writeFile(path.join(root, 'secrets.json'), JSON.stringify({ FIXTURE_TOKEN: 'fixture-secret' }));
  const client = start(t, root);
  const selected = await client.call('stack:fixture.echo');
  assert.equal(selected.error, undefined);
  assert.deepEqual(JSON.parse(selected.result.content[0].text), {
    model: 'configured-model', token: 'fixture-secret', calls: 1,
  });
  const other = await client.call('stack:other.echo');
  assert.equal(other.error, undefined);
  assert.equal(JSON.parse(other.result.content[0].text).model, 'inherited-model');
  assert.doesNotMatch(client.stderr(), /fixture-secret|not-a-secret|configured-model/);
});

test('malformed settings stop the router without disclosing file contents', async (t) => {
  const { root } = await setup(t, {});
  await fs.writeFile(path.join(root, 'router-settings.json'), '{ "misplaced-secret": "private-value"');
  const client = start(t, root);
  const [code] = await once(client.child, 'exit');
  assert.equal(code, 1);
  assert.match(client.stderr(), /Invalid router-settings.json: expected valid JSON/);
  assert.doesNotMatch(client.stderr(), /private-value|misplaced-secret/);
});
