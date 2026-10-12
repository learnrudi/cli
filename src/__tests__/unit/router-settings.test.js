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
      for (const id of ['stack:fixture', 'stack:other', 'stack:speech-generator']) {
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
    await fs.rm(root, { recursive: true, force: true });
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

test('timed-out calls retain a private result file and survive idle cleanup', async (t) => {
  const { root } = await setup(t, {
    'stack:fixture': { toolTimeoutMs: { slow: 30 } },
  });
  const client = start(t, root, {
    RUDI_ROUTER_IDLE_TTL_MS: '50', RUDI_ROUTER_CLEANUP_INTERVAL_MS: '10',
  });
  const expired = await client.call('stack:fixture.slow', { delayMs: 250, privateInput: 'never-record-input' });
  assert.equal(expired.error.code, -32603);
  const match = expired.error.message.match(/Result file: (.+\.json)/);
  assert.ok(match, 'timeout must identify the recoverable result file');
  const file = match[1];
  assert.equal(path.dirname(file), path.join(root, 'outputs', 'router-results'));
  const waiting = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(waiting.status, 'pending');
  assert.equal(waiting.tool, 'slow');
  assert.equal(waiting.stackId, 'stack:fixture');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  // A separate call keeps the client connected until the late response arrives.
  await client.call('stack:other.wait', { delayMs: 350 });
  const raw = await fs.readFile(file, 'utf8');
  const completed = JSON.parse(raw);
  assert.equal(completed.status, 'completed');
  assert.equal(JSON.parse(completed.response.result.content[0].text).calls, 1);
  assert.doesNotMatch(raw, /never-record-input/);
  assert.doesNotMatch(client.stderr(), /never-record-input/);
});

test('speech generation can finish after the former 30 second deadline', async (t) => {
  const { root } = await setup(t, {});
  const client = start(t, root);
  const response = await client.call('stack:speech-generator.generate_speech', { delayMs: 30500 }, 35000);
  assert.equal(response.error, undefined);
  assert.equal(JSON.parse(response.result.content[0].text).calls, 1);
});

test('stack exit after a timeout records an interrupted unknown outcome', async (t) => {
  const { root } = await setup(t, { 'stack:fixture': { toolTimeoutMs: { slow: 30 } } });
  const client = start(t, root);
  const expired = await client.call('stack:fixture.slow', { delayMs: 150, exitCode: 7 });
  const file = expired.error.message.match(/Result file: (.+\.json)/)[1];
  await client.call('stack:other.wait', { delayMs: 250 });
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(record.status, 'interrupted');
  assert.match(record.reason, /code=7/);
  assert.equal(record.response, undefined);
});

test('late responses are retried locally when receipt storage recovers', async (t) => {
  const { root } = await setup(t, { 'stack:fixture': { toolTimeoutMs: { slow: 30 } } });
  const client = start(t, root, { RUDI_ROUTER_CLEANUP_INTERVAL_MS: '10' });
  const expired = await client.call('stack:fixture.slow', { delayMs: 200 });
  const file = expired.error.message.match(/Result file: (.+\.json)/)[1];
  const directory = path.dirname(file);
  await fs.rename(directory, `${directory}-held`);
  await fs.writeFile(directory, 'temporary storage obstruction');
  await client.call('stack:other.wait', { delayMs: 300 });
  assert.match(client.stderr(), /result persistence failed/i);
  await fs.unlink(directory);
  await fs.rename(`${directory}-held`, directory);
  await client.call('stack:other.wait', { delayMs: 100 });
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(record.status, 'completed');
  assert.equal(JSON.parse(record.response.result.content[0].text).calls, 1);
});

test('retained calls apply backpressure without replaying or evicting work', async (t) => {
  const { root } = await setup(t, { 'stack:fixture': { toolTimeoutMs: { slow: 20 } } });
  const client = start(t, root);
  await client.call('stack:fixture.warm');
  const expired = await Promise.all(Array.from({ length: 128 }, () =>
    client.call('stack:fixture.slow', { delayMs: 2000 })));
  assert.ok(expired.every((response) => /timed out/.test(response.error?.message)));
  const overload = await client.call('stack:fixture.extra');
  assert.match(overload.error?.message ?? '', /capacity.*128.*not dispatched/i);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const recovered = await client.call('stack:fixture.extra');
  assert.equal(recovered.error, undefined);
  assert.equal(JSON.parse(recovered.result.content[0].text).calls, 130);
});

test('router shutdown marks pending receipts interrupted before exiting', async (t) => {
  const { root } = await setup(t, { 'stack:fixture': { toolTimeoutMs: { slow: 30 } } });
  const client = start(t, root);
  const expired = await client.call('stack:fixture.slow', { delayMs: 2000 });
  const file = expired.error.message.match(/Result file: (.+\.json)/)[1];
  const exited = once(client.child, 'exit');
  client.child.stdin.end();
  await exited;
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(record.status, 'interrupted');
  assert.match(record.reason, /stdin-closed/);
});

test('late protocol and tool failures preserve the original error response', async (t) => {
  const { root } = await setup(t, { 'stack:fixture': { toolTimeoutMs: { slow: 30 } } });
  const client = start(t, root);
  const records = [];
  for (const fail of ['protocol', 'tool']) {
    const expired = await client.call('stack:fixture.slow', { delayMs: 150, fail });
    records.push(expired.error.message.match(/Result file: (.+\.json)/)[1]);
  }
  await client.call('stack:other.wait', { delayMs: 250 });
  const [protocol, tool] = await Promise.all(records.map(async (file) =>
    JSON.parse(await fs.readFile(file, 'utf8'))));
  assert.equal(protocol.status, 'completed');
  assert.deepEqual(protocol.response.error, { code: -32042, message: 'fixture provider failed' });
  assert.equal(tool.status, 'completed');
  assert.equal(tool.response.result.isError, true);
  assert.equal(tool.response.result.content[0].text, 'fixture tool failed');
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
