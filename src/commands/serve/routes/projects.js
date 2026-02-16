/**
 * Projects — DB CRUD for projects table.
 */

import { getDb, isDatabaseInitialized } from '@learnrudi/db';

export function buildProjectRoutes(ctx) {
  const { json, error, readBody } = ctx;

  function handle(req, res, url) {
    if (!isDatabaseInitialized()) {
      return error(res, 'Database not initialized', 503), true;
    }

    const db = getDb();

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
        if (!body.name) return error(res, 'name required');
        const id = `proj-${body.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
        try {
          db.prepare(`
            INSERT INTO projects (id, provider, name, created_at)
            VALUES (?, 'claude', ?, datetime('now'))
          `).run(id, body.name);
          json(res, { id, name: body.name, path: body.path || '', createdAt: new Date().toISOString() }, 201);
        } catch (err) {
          error(res, err.message, 409);
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
          const body = await readBody(req);
          const sets = [];
          const params = [];
          if (body.name) { sets.push('name = ?'); params.push(body.name); }
          if (body.color) { sets.push('color = ?'); params.push(body.color); }
          if (sets.length === 0) return json(res, { id, ...body });
          params.push(id);
          db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
          json(res, { id, ...body });
        })(), true;
      }

      // DELETE /projects/:id
      if (req.method === 'DELETE') {
        db.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(id);
        db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        json(res, { ok: true });
        return true;
      }
    }

    return false;
  }

  return { handle };
}
