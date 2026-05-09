import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';

import { buildProjectRoutes } from '../../commands/serve/routes/projects.js';
import {
  createMockCtx,
  createMockReq,
  createMockRes,
  parseResBody,
} from '../helpers/serve-mocks.js';

function assertErrorBody(res, expected) {
  assert.deepEqual(parseResBody(res), expected);
}

async function withProjectRoute(fn, options = {}) {
  const db = new Database(':memory:');
  initSchemaWithDb(db);
  const ctx = createMockCtx();
  const route = buildProjectRoutes(ctx, {
    getDb: () => db,
    isDatabaseInitialized: () => options.databaseInitialized ?? true,
  });

  try {
    await fn({ ctx, db, handle: route.handle });
  } finally {
    db.close();
  }
}

describe('buildProjectRoutes', () => {
  test('returns 503 with stable code when database is not initialized', async () => {
    await withProjectRoute(async ({ handle }) => {
      const { req, url } = createMockReq('GET', '/projects');
      const res = createMockRes();

      const handled = await handle(req, res, url);

      assert.equal(handled, true);
      assert.equal(res.state.statusCode, 503);
      assertErrorBody(res, {
        error: 'Database not initialized',
        code: 'DATABASE_NOT_INITIALIZED',
      });
    }, { databaseInitialized: false });
  });

  test('POST /projects validates required and typed fields', async () => {
    await withProjectRoute(async ({ handle }) => {
      const missingReq = createMockReq('POST', '/projects', { body: {} });
      const missingRes = createMockRes();
      await handle(missingReq.req, missingRes, missingReq.url);
      assert.equal(missingRes.state.statusCode, 400);
      assertErrorBody(missingRes, {
        error: 'name required',
        code: 'MISSING_REQUIRED_FIELD',
        details: { field: 'name', location: 'body' },
      });

      const invalidTypeReq = createMockReq('POST', '/projects', { body: { name: 123 } });
      const invalidTypeRes = createMockRes();
      await handle(invalidTypeReq.req, invalidTypeRes, invalidTypeReq.url);
      assert.equal(invalidTypeRes.state.statusCode, 400);
      assertErrorBody(invalidTypeRes, {
        error: 'name must be a string',
        code: 'INVALID_FIELD',
        details: { field: 'name', location: 'body', reason: 'invalid_type', expectedType: 'string' },
      });

      const invalidFormatReq = createMockReq('POST', '/projects', { body: { name: '!!!' } });
      const invalidFormatRes = createMockRes();
      await handle(invalidFormatReq.req, invalidFormatRes, invalidFormatReq.url);
      assert.equal(invalidFormatRes.state.statusCode, 400);
      assertErrorBody(invalidFormatRes, {
        error: 'name must include letters or numbers',
        code: 'INVALID_FIELD',
        details: { field: 'name', location: 'body', reason: 'invalid_format' },
      });
    });
  });

  test('POST /projects creates a project and GET /projects returns projected data', async () => {
    await withProjectRoute(async ({ db, handle }) => {
      const createReq = createMockReq('POST', '/projects', {
        body: { name: 'Alpha Project', path: '/tmp/alpha' },
      });
      const createRes = createMockRes();

      const handled = await handle(createReq.req, createRes, createReq.url);

      assert.equal(handled, true);
      assert.equal(createRes.state.statusCode, 201);
      const created = parseResBody(createRes);
      assert.equal(created.id, 'proj-alpha-project');
      assert.equal(created.name, 'Alpha Project');
      assert.equal(created.path, '/tmp/alpha');
      assert.equal(typeof created.createdAt, 'string');

      db.prepare(`
        INSERT INTO sessions (
          id, provider, origin, title, cwd, project_path, git_branch, created_at, last_active_at, project_id
        ) VALUES (?, 'claude', 'rudi', ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
      `).run('sess-1', 'Alpha session', '/tmp/alpha', '/tmp/alpha', 'main', created.id);

      const listReq = createMockReq('GET', '/projects');
      const listRes = createMockRes();
      await handle(listReq.req, listRes, listReq.url);

      const storedProject = db.prepare('SELECT color, created_at FROM projects WHERE id = ?').get(created.id);
      assert.equal(listRes.state.statusCode, 200);
      assert.deepEqual(parseResBody(listRes), {
        projects: [{
          id: 'proj-alpha-project',
          name: 'Alpha Project',
          provider: 'claude',
          color: storedProject.color,
          path: '',
          sessionCount: 1,
          createdAt: storedProject.created_at,
        }],
      });
    });
  });

  test('POST /projects returns a stable duplicate error', async () => {
    await withProjectRoute(async ({ handle }) => {
      const firstReq = createMockReq('POST', '/projects', { body: { name: 'Alpha Project' } });
      const firstRes = createMockRes();
      await handle(firstReq.req, firstRes, firstReq.url);
      assert.equal(firstRes.state.statusCode, 201);

      const secondReq = createMockReq('POST', '/projects', { body: { name: 'Alpha Project' } });
      const secondRes = createMockRes();
      await handle(secondReq.req, secondRes, secondReq.url);

      assert.equal(secondRes.state.statusCode, 409);
      assertErrorBody(secondRes, {
        error: 'Project already exists',
        code: 'PROJECT_ALREADY_EXISTS',
      });
    });
  });

  test('POST /projects/:id rejects missing resources and invalid updates', async () => {
    await withProjectRoute(async ({ db, handle }) => {
      const missingReq = createMockReq('POST', '/projects/proj-missing', { body: { name: 'Renamed' } });
      const missingRes = createMockRes();
      await handle(missingReq.req, missingRes, missingReq.url);
      assert.equal(missingRes.state.statusCode, 404);
      assertErrorBody(missingRes, {
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND',
      });

      db.prepare(`
        INSERT INTO projects (id, provider, name, created_at)
        VALUES (?, 'claude', ?, datetime('now'))
      `).run('proj-alpha-project', 'Alpha Project');

      const invalidReq = createMockReq('POST', '/projects/proj-alpha-project', {
        body: { color: 42 },
      });
      const invalidRes = createMockRes();
      await handle(invalidReq.req, invalidRes, invalidReq.url);
      assert.equal(invalidRes.state.statusCode, 400);
      assertErrorBody(invalidRes, {
        error: 'color must be a string',
        code: 'INVALID_FIELD',
        details: { field: 'color', location: 'body', reason: 'invalid_type', expectedType: 'string' },
      });

      const updateReq = createMockReq('POST', '/projects/proj-alpha-project', {
        body: { name: 'Renamed Project', color: '#123456' },
      });
      const updateRes = createMockRes();
      await handle(updateReq.req, updateRes, updateReq.url);

      assert.equal(updateRes.state.statusCode, 200);
      assert.deepEqual(parseResBody(updateRes), {
        id: 'proj-alpha-project',
        name: 'Renamed Project',
        color: '#123456',
      });
      assert.deepEqual(
        db.prepare('SELECT name, color FROM projects WHERE id = ?').get('proj-alpha-project'),
        { name: 'Renamed Project', color: '#123456' },
      );
    });
  });

  test('DELETE /projects/:id returns stable not-found and success contracts', async () => {
    await withProjectRoute(async ({ db, handle }) => {
      const missingReq = createMockReq('DELETE', '/projects/proj-missing');
      const missingRes = createMockRes();
      await handle(missingReq.req, missingRes, missingReq.url);
      assert.equal(missingRes.state.statusCode, 404);
      assertErrorBody(missingRes, {
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND',
      });

      db.prepare(`
        INSERT INTO projects (id, provider, name, created_at)
        VALUES (?, 'claude', ?, datetime('now'))
      `).run('proj-alpha-project', 'Alpha Project');

      const deleteReq = createMockReq('DELETE', '/projects/proj-alpha-project');
      const deleteRes = createMockRes();
      await handle(deleteReq.req, deleteRes, deleteReq.url);

      assert.equal(deleteRes.state.statusCode, 200);
      assert.deepEqual(parseResBody(deleteRes), { ok: true });
      assert.equal(
        db.prepare('SELECT COUNT(*) AS count FROM projects WHERE id = ?').get('proj-alpha-project').count,
        0,
      );
    });
  });
});
