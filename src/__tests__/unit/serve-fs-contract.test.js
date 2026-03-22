import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { createMockCtx, createMockRes, createMockReq, parseResBody } from '../helpers/serve-mocks.js';
import { buildFsRoutes } from '../../commands/serve/routes/fs.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-fs-test-'));

after(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

function makeFsRoute() {
  const ctx = createMockCtx();
  const route = buildFsRoutes(ctx);
  return { ctx, ...route };
}

function assertErrorBody(res, expected) {
  assert.deepStrictEqual(parseResBody(res), expected);
}

describe('buildFsRoutes', () => {
  // --- write ---

  test('POST /fs/write creates file', async () => {
    const { handle } = makeFsRoute();
    const filePath = path.join(tmpDir, 'hello.txt');
    const { req, url } = createMockReq('POST', '/fs/write', {
      body: { path: filePath, content: 'hello world' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    assert.deepStrictEqual(parseResBody(res), { ok: true });
    const content = await fsp.readFile(filePath, 'utf-8');
    assert.strictEqual(content, 'hello world');
  });

  // --- read ---

  test('GET /fs/read returns file content', async () => {
    const { handle } = makeFsRoute();
    const filePath = path.join(tmpDir, 'read-me.txt');
    await fsp.writeFile(filePath, 'read this');
    const { req, url } = createMockReq('GET', '/fs/read', { query: `path=${encodeURIComponent(filePath)}` });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    const body = parseResBody(res);
    assert.strictEqual(body.content, 'read this');
  });

  // --- write + read roundtrip ---

  test('write + read roundtrip', async () => {
    const { handle } = makeFsRoute();
    const filePath = path.join(tmpDir, 'roundtrip.txt');
    const content = 'roundtrip content 🎉';

    // write
    const { req: wReq, url: wUrl } = createMockReq('POST', '/fs/write', {
      body: { path: filePath, content },
    });
    const wRes = createMockRes();
    await handle(wReq, wRes, wUrl);
    assert.strictEqual(wRes.state.statusCode, 200);

    // read
    const { req: rReq, url: rUrl } = createMockReq('GET', '/fs/read', {
      query: `path=${encodeURIComponent(filePath)}`,
    });
    const rRes = createMockRes();
    await handle(rReq, rRes, rUrl);
    assert.strictEqual(parseResBody(rRes).content, content);
  });

  // --- write-binary roundtrip ---

  test('write-binary + read roundtrip', async () => {
    const { handle } = makeFsRoute();
    const filePath = path.join(tmpDir, 'binary.bin');
    const original = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    const base64 = original.toString('base64');

    // write binary
    const { req: wReq, url: wUrl } = createMockReq('POST', '/fs/write-binary', {
      body: { path: filePath, base64 },
    });
    const wRes = createMockRes();
    await handle(wReq, wRes, wUrl);
    assert.strictEqual(wRes.state.statusCode, 200);

    // verify on disk
    const disk = await fsp.readFile(filePath);
    assert.ok(original.equals(disk));
  });

  // --- readdir ---

  test('GET /fs/readdir returns entries with shape', async () => {
    const { handle } = makeFsRoute();
    const subDir = path.join(tmpDir, 'readdir-test');
    await fsp.mkdir(subDir, { recursive: true });
    await fsp.writeFile(path.join(subDir, 'a.txt'), 'a');
    await fsp.mkdir(path.join(subDir, 'subdir'));

    const { req, url } = createMockReq('GET', '/fs/readdir', {
      query: `path=${encodeURIComponent(subDir)}`,
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    const body = parseResBody(res);
    assert.ok(Array.isArray(body.entries));
    assert.ok(body.entries.length >= 2);
    for (const entry of body.entries) {
      assert.strictEqual(typeof entry.name, 'string');
      assert.strictEqual(typeof entry.path, 'string');
      assert.strictEqual(typeof entry.isDirectory, 'boolean');
      assert.strictEqual(typeof entry.isFile, 'boolean');
      assert.strictEqual(typeof entry.size, 'number');
      assert.strictEqual(typeof entry.mtime, 'string');
    }
  });

  test('GET /fs/readdir hides dotfiles by default', async () => {
    const { handle } = makeFsRoute();
    const subDir = path.join(tmpDir, 'dotfile-test');
    await fsp.mkdir(subDir, { recursive: true });
    await fsp.writeFile(path.join(subDir, '.hidden'), 'x');
    await fsp.writeFile(path.join(subDir, 'visible.txt'), 'y');

    const { req, url } = createMockReq('GET', '/fs/readdir', {
      query: `path=${encodeURIComponent(subDir)}`,
    });
    const res = createMockRes();
    await handle(req, res, url);
    const body = parseResBody(res);
    const names = body.entries.map(e => e.name);
    assert.ok(!names.includes('.hidden'));
    assert.ok(names.includes('visible.txt'));
  });

  test('GET /fs/readdir?showHidden=1 includes dotfiles', async () => {
    const { handle } = makeFsRoute();
    const subDir = path.join(tmpDir, 'dotfile-test'); // reuse from above
    const { req, url } = createMockReq('GET', '/fs/readdir', {
      query: `path=${encodeURIComponent(subDir)}&showHidden=1`,
    });
    const res = createMockRes();
    await handle(req, res, url);
    const body = parseResBody(res);
    const names = body.entries.map(e => e.name);
    assert.ok(names.includes('.hidden'));
    assert.ok(names.includes('visible.txt'));
  });

  // --- stat ---

  test('GET /fs/stat returns correct shape', async () => {
    const { handle } = makeFsRoute();
    const filePath = path.join(tmpDir, 'stat-me.txt');
    await fsp.writeFile(filePath, 'stat content');

    const { req, url } = createMockReq('GET', '/fs/stat', {
      query: `path=${encodeURIComponent(filePath)}`,
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    const body = parseResBody(res);
    assert.strictEqual(body.name, 'stat-me.txt');
    assert.strictEqual(body.path, filePath);
    assert.strictEqual(body.isFile, true);
    assert.strictEqual(body.isDirectory, false);
    assert.strictEqual(typeof body.size, 'number');
    assert.strictEqual(typeof body.mtime, 'string');
  });

  // --- mkdir ---

  test('POST /fs/mkdir creates directory', async () => {
    const { handle } = makeFsRoute();
    const dirPath = path.join(tmpDir, 'new-dir', 'nested');
    const { req, url } = createMockReq('POST', '/fs/mkdir', {
      body: { path: dirPath },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    const stat = await fsp.stat(dirPath);
    assert.ok(stat.isDirectory());
  });

  // --- remove ---

  test('POST /fs/remove deletes file', async () => {
    const { handle } = makeFsRoute();
    const filePath = path.join(tmpDir, 'remove-me.txt');
    await fsp.writeFile(filePath, 'bye');
    const { req, url } = createMockReq('POST', '/fs/remove', {
      body: { path: filePath },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    await assert.rejects(() => fsp.access(filePath));
  });

  // --- rename ---

  test('POST /fs/rename moves file', async () => {
    const { handle } = makeFsRoute();
    const oldPath = path.join(tmpDir, 'old-name.txt');
    const newPath = path.join(tmpDir, 'new-name.txt');
    await fsp.writeFile(oldPath, 'rename me');
    const { req, url } = createMockReq('POST', '/fs/rename', {
      body: { oldPath, newPath },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    await assert.rejects(() => fsp.access(oldPath));
    const content = await fsp.readFile(newPath, 'utf-8');
    assert.strictEqual(content, 'rename me');
  });

  // --- error paths ---

  test('GET /fs/read missing path param returns 400', async () => {
    const { handle } = makeFsRoute();
    const { req, url } = createMockReq('GET', '/fs/read');
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'path required',
      code: 'MISSING_REQUIRED_FIELD',
      details: { field: 'path', location: 'query' },
    });
  });

  test('GET /fs/read nonexistent file returns 404', async () => {
    const { handle } = makeFsRoute();
    const { req, url } = createMockReq('GET', '/fs/read', {
      query: `path=${encodeURIComponent('/tmp/does-not-exist-xyz-123')}`,
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 404);
  });

  test('POST /fs/write missing content returns 400', async () => {
    const { handle } = makeFsRoute();
    const { req, url } = createMockReq('POST', '/fs/write', {
      body: { path: path.join(tmpDir, 'no-content.txt') },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'content required',
      code: 'MISSING_REQUIRED_FIELD',
      details: { fields: ['content'], location: 'body' },
    });
  });

  // --- cleanup ---

  test('cleanup closes watchers without error', () => {
    const { cleanup } = makeFsRoute();
    // no watchers active — should be a no-op
    assert.doesNotThrow(() => cleanup());
  });
});
