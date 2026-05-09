import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildNotesRoutes } from '../../commands/serve/routes/notes.js';
import {
  createMockCtx,
  createMockReq,
  createMockRes,
  parseResBody,
} from '../helpers/serve-mocks.js';

const tempDirs = new Set();

after(async () => {
  await Promise.all(
    [...tempDirs].map((dir) => fsp.rm(dir, { recursive: true, force: true })),
  );
});

function assertErrorBody(res, expected) {
  assert.deepEqual(parseResBody(res), expected);
}

async function withNotesRoute(fn) {
  const notesDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'serve-notes-test-'));
  tempDirs.add(notesDir);
  const ctx = createMockCtx();
  const route = buildNotesRoutes(ctx, {
    notesDir,
    generateId: () => 'note-fixed-id',
    now: () => '2026-03-22T12:00:00.000Z',
  });

  try {
    await fn({ ctx, notesDir, handle: route.handle });
  } finally {
    await fsp.rm(notesDir, { recursive: true, force: true });
    tempDirs.delete(notesDir);
  }
}

describe('buildNotesRoutes', () => {
  test('POST /notes creates a note with normalized title and stable timestamps', async () => {
    await withNotesRoute(async ({ notesDir, handle }) => {
      const { req, url } = createMockReq('POST', '/notes', {
        body: { title: '  Draft Plan  ', content: 'First version' },
      });
      const res = createMockRes();

      const handled = await handle(req, res, url);

      assert.equal(handled, true);
      assert.equal(res.state.statusCode, 201);
      assert.deepEqual(parseResBody(res), {
        id: 'note-fixed-id',
        title: 'Draft Plan',
        content: 'First version',
        createdAt: '2026-03-22T12:00:00.000Z',
        updatedAt: '2026-03-22T12:00:00.000Z',
      });

      const persisted = JSON.parse(
        await fsp.readFile(path.join(notesDir, 'note-fixed-id.json'), 'utf-8'),
      );
      assert.deepEqual(persisted, {
        id: 'note-fixed-id',
        title: 'Draft Plan',
        content: 'First version',
        createdAt: '2026-03-22T12:00:00.000Z',
        updatedAt: '2026-03-22T12:00:00.000Z',
      });
    });
  });

  test('POST /notes validates required and typed fields', async () => {
    await withNotesRoute(async ({ handle }) => {
      const missingReq = createMockReq('POST', '/notes', { body: {} });
      const missingRes = createMockRes();
      await handle(missingReq.req, missingRes, missingReq.url);
      assert.equal(missingRes.state.statusCode, 400);
      assertErrorBody(missingRes, {
        error: 'title required',
        code: 'MISSING_REQUIRED_FIELD',
        details: { field: 'title', location: 'body' },
      });

      const invalidTitleReq = createMockReq('POST', '/notes', { body: { title: 42 } });
      const invalidTitleRes = createMockRes();
      await handle(invalidTitleReq.req, invalidTitleRes, invalidTitleReq.url);
      assert.equal(invalidTitleRes.state.statusCode, 400);
      assertErrorBody(invalidTitleRes, {
        error: 'title must be a string',
        code: 'INVALID_FIELD',
        details: { field: 'title', location: 'body', reason: 'invalid_type', expectedType: 'string' },
      });

      const invalidContentReq = createMockReq('POST', '/notes', {
        body: { title: 'Draft', content: ['nope'] },
      });
      const invalidContentRes = createMockRes();
      await handle(invalidContentReq.req, invalidContentRes, invalidContentReq.url);
      assert.equal(invalidContentRes.state.statusCode, 400);
      assertErrorBody(invalidContentRes, {
        error: 'content must be a string',
        code: 'INVALID_FIELD',
        details: { field: 'content', location: 'body', reason: 'invalid_type', expectedType: 'string' },
      });
    });
  });

  test('GET /notes returns persisted notes ordered by updatedAt descending', async () => {
    await withNotesRoute(async ({ notesDir, handle }) => {
      await fsp.writeFile(
        path.join(notesDir, 'older.json'),
        JSON.stringify({
          id: 'older',
          title: 'Older',
          content: '',
          createdAt: '2026-03-20T12:00:00.000Z',
          updatedAt: '2026-03-20T12:00:00.000Z',
        }),
      );
      await fsp.writeFile(
        path.join(notesDir, 'newer.json'),
        JSON.stringify({
          id: 'newer',
          title: 'Newer',
          content: '',
          createdAt: '2026-03-21T12:00:00.000Z',
          updatedAt: '2026-03-21T12:00:00.000Z',
        }),
      );

      const { req, url } = createMockReq('GET', '/notes');
      const res = createMockRes();
      await handle(req, res, url);

      assert.equal(res.state.statusCode, 200);
      assert.deepEqual(parseResBody(res), {
        notes: [
          {
            id: 'newer',
            title: 'Newer',
            content: '',
            createdAt: '2026-03-21T12:00:00.000Z',
            updatedAt: '2026-03-21T12:00:00.000Z',
          },
          {
            id: 'older',
            title: 'Older',
            content: '',
            createdAt: '2026-03-20T12:00:00.000Z',
            updatedAt: '2026-03-20T12:00:00.000Z',
          },
        ],
      });
    });
  });

  test('GET /notes/:id returns a stable not-found contract', async () => {
    await withNotesRoute(async ({ handle }) => {
      const { req, url } = createMockReq('GET', '/notes/missing-note');
      const res = createMockRes();

      await handle(req, res, url);

      assert.equal(res.state.statusCode, 404);
      assertErrorBody(res, {
        error: 'Note not found',
        code: 'NOTE_NOT_FOUND',
      });
    });
  });

  test('POST /notes/:id validates updates and persists changes', async () => {
    await withNotesRoute(async ({ notesDir, handle }) => {
      await fsp.writeFile(
        path.join(notesDir, 'note-fixed-id.json'),
        JSON.stringify({
          id: 'note-fixed-id',
          title: 'Draft Plan',
          content: 'First version',
          createdAt: '2026-03-21T12:00:00.000Z',
          updatedAt: '2026-03-21T12:00:00.000Z',
        }),
      );

      const invalidReq = createMockReq('POST', '/notes/note-fixed-id', {
        body: { title: '   ' },
      });
      const invalidRes = createMockRes();
      await handle(invalidReq.req, invalidRes, invalidReq.url);
      assert.equal(invalidRes.state.statusCode, 400);
      assertErrorBody(invalidRes, {
        error: 'title must be a non-empty string',
        code: 'INVALID_FIELD',
        details: { field: 'title', location: 'body', reason: 'empty_string' },
      });

      const updateReq = createMockReq('POST', '/notes/note-fixed-id', {
        body: { title: 'Revised Plan', content: 'Updated version' },
      });
      const updateRes = createMockRes();
      await handle(updateReq.req, updateRes, updateReq.url);

      assert.equal(updateRes.state.statusCode, 200);
      assert.deepEqual(parseResBody(updateRes), {
        id: 'note-fixed-id',
        title: 'Revised Plan',
        content: 'Updated version',
        createdAt: '2026-03-21T12:00:00.000Z',
        updatedAt: '2026-03-22T12:00:00.000Z',
      });
    });
  });

  test('POST and DELETE missing notes return stable not-found contracts', async () => {
    await withNotesRoute(async ({ handle }) => {
      const updateReq = createMockReq('POST', '/notes/missing-note', {
        body: { title: 'Revised' },
      });
      const updateRes = createMockRes();
      await handle(updateReq.req, updateRes, updateReq.url);
      assert.equal(updateRes.state.statusCode, 404);
      assertErrorBody(updateRes, {
        error: 'Note not found',
        code: 'NOTE_NOT_FOUND',
      });

      const deleteReq = createMockReq('DELETE', '/notes/missing-note');
      const deleteRes = createMockRes();
      await handle(deleteReq.req, deleteRes, deleteReq.url);
      assert.equal(deleteRes.state.statusCode, 404);
      assertErrorBody(deleteRes, {
        error: 'Note not found',
        code: 'NOTE_NOT_FOUND',
      });
    });
  });

  test('DELETE /notes/:id removes the file and returns ok', async () => {
    await withNotesRoute(async ({ notesDir, handle }) => {
      const filePath = path.join(notesDir, 'note-fixed-id.json');
      await fsp.writeFile(
        filePath,
        JSON.stringify({
          id: 'note-fixed-id',
          title: 'Draft Plan',
          content: '',
          createdAt: '2026-03-21T12:00:00.000Z',
          updatedAt: '2026-03-21T12:00:00.000Z',
        }),
      );

      const { req, url } = createMockReq('DELETE', '/notes/note-fixed-id');
      const res = createMockRes();
      await handle(req, res, url);

      assert.equal(res.state.statusCode, 200);
      assert.deepEqual(parseResBody(res), { ok: true });
      assert.equal(fs.existsSync(filePath), false);
    });
  });
});
