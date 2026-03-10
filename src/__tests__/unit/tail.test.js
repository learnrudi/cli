import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSessionsTailModule } from '../../commands/sessions/tail.js';

test('concurrent follow for the same session creates a single watcher', async (t) => {
  let watchCalls = 0;
  t.mock.method(fs, 'watch', () => {
    watchCalls++;
    return {
      on() {},
      close() {},
    };
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-tail-'));
  const filePath = path.join(tempDir, 'session.jsonl');
  fs.writeFileSync(filePath, '', 'utf8');

  let findCalls = 0;
  let resolveFind;
  const findPromise = new Promise((resolve) => {
    resolveFind = resolve;
  });

  const tail = createSessionsTailModule({
    log() {},
    broadcast() {},
    findSessionFile: async () => {
      findCalls++;
      return await findPromise;
    },
  });

  const wsA = { send() {} };
  const wsB = { send() {} };

  assert.equal(tail.handleWsMessage(wsA, { type: 'session:follow', sessionId: 'session-1' }), true);
  assert.equal(tail.handleWsMessage(wsB, { type: 'session:follow', sessionId: 'session-1' }), true);

  await new Promise((resolve) => setTimeout(resolve, 10));
  resolveFind({ provider: 'claude', filePath });
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(findCalls, 1);
  assert.equal(watchCalls, 1);

  tail.cleanup();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
