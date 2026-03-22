/**
 * Projects — DB CRUD for projects table.
 */

import { getDb, isDatabaseInitialized } from '@learnrudi/db';
import { SIDECAR_ERROR_CODES } from '../error-codes.js';

function normalizeProjectName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
}

function projectSlugFromName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function buildProjectRoutes(ctx, deps = {}) {
  const { json, error, errorCode, readBody, requiredField, invalidField } = ctx;
  const getDbImpl = deps.getDb || getDb;
  const isDatabaseInitializedImpl = deps.isDatabaseInitialized || isDatabaseInitialized;

  function handle(req, res, url) {
    if (!isDatabaseInitializedImpl()) {
      return errorCode(res, SIDECAR_ERROR_CODES.DATABASE_NOT_INITIALIZED), true;
    }

    const db = getDbImpl();

    // GET /projects
    if (req.method === 'GET' && url.pathname === '/projects') {
      const rows = db.prepare(`
        SELECT p.id, p.provider, p.name, p.color, p.created_at,
          COUNT(s.id) as session_count
        FROM projects p
        LEFT JOIN sessions s ON s.project_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `).all();
      const projects = rows.map(r => ({
        id: r.id,
        name: r.name,
        provider: r.provider,
        color: r.color,
        path: '',
        sessionCount: r.session_count,
        createdAt: r.created_at,
      }));
      json(res, { projects });
      return true;
    }

    // POST /projects {name, path?}
    if (req.method === 'POST' && url.pathname === '/projects') {
      return (async () => {
        const body = await readBody(req);
        if (body.name == null) return requiredField(res, 'name');
        const normalizedName = normalizeProjectName(body.name);
        if (normalizedName === null) {
          return invalidField(res, 'name', 'name must be a string', {
            reason: 'invalid_type',
            details: { expectedType: 'string' },
          });
        }
        if (normalizedName === '') {
          return requiredField(res, 'name');
        }
        if (body.path !== undefined && body.path !== null && typeof body.path !== 'string') {
          return invalidField(res, 'path', 'path must be a string', {
            reason: 'invalid_type',
            details: { expectedType: 'string' },
          });
        }

        const slug = projectSlugFromName(normalizedName);
        if (!slug) {
          return invalidField(res, 'name', 'name must include letters or numbers', {
            reason: 'invalid_format',
          });
        }

        const id = `proj-${slug}`;
        try {
          db.prepare(`
            INSERT INTO projects (id, provider, name, created_at)
            VALUES (?, 'claude', ?, datetime('now'))
          `).run(id, normalizedName);
          json(res, {
            id,
            name: normalizedName,
            path: typeof body.path === 'string' ? body.path : '',
            createdAt: new Date().toISOString(),
          }, 201);
        } catch (err) {
          if (/constraint|unique/i.test(err?.message || '')) {
            return errorCode(res, SIDECAR_ERROR_CODES.PROJECT_ALREADY_EXISTS);
          }
          return error(res, err.message || 'Failed to create project', 500);
        }
      })(), true;
    }

    // Match /projects/:id
    const match = url.pathname.match(/^\/projects\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);

      // POST /projects/:id (update)
      if (req.method === 'POST') {
        return (async () => {
          const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
          if (!existing) return errorCode(res, SIDECAR_ERROR_CODES.PROJECT_NOT_FOUND);

          const body = await readBody(req);
          const sets = [];
          const params = [];

          if (body.name !== undefined) {
            const normalizedName = normalizeProjectName(body.name);
            if (normalizedName === null) {
              return invalidField(res, 'name', 'name must be a string', {
                reason: 'invalid_type',
                details: { expectedType: 'string' },
              });
            }
            if (normalizedName === '') {
              return invalidField(res, 'name', 'name must be a non-empty string', {
                reason: 'empty_string',
              });
            }
            sets.push('name = ?');
            params.push(normalizedName);
          }

          if (body.color !== undefined) {
            if (body.color !== null && typeof body.color !== 'string') {
              return invalidField(res, 'color', 'color must be a string', {
                reason: 'invalid_type',
                details: { expectedType: 'string' },
              });
            }
            sets.push('color = ?');
            params.push(body.color);
          }

          if (sets.length === 0) return json(res, { id, ...body });
          params.push(id);
          db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
          json(res, { id, ...body });
        })(), true;
      }

      // DELETE /projects/:id
      if (req.method === 'DELETE') {
        db.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(id);
        const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        if (!result.changes) return errorCode(res, SIDECAR_ERROR_CODES.PROJECT_NOT_FOUND);
        json(res, { ok: true });
        return true;
      }
    }

    return false;
  }

  return { handle };
}
