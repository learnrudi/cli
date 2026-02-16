/**
 * Notes — file-based JSON CRUD in ~/.rudi/notes/
 */

import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { PATHS } from '@learnrudi/env';

const NOTES_DIR = path.join(PATHS.home, 'notes');

export function buildNotesRoutes(ctx) {
  const { json, error, readBody } = ctx;

  async function handle(req, res, url) {
    await fsp.mkdir(NOTES_DIR, { recursive: true });

    // GET /notes
    if (req.method === 'GET' && url.pathname === '/notes') {
      try {
        const files = await fsp.readdir(NOTES_DIR);
        const notes = await Promise.all(
          files.filter(f => f.endsWith('.json')).map(async (f) => {
            const content = await fsp.readFile(path.join(NOTES_DIR, f), 'utf-8');
            return JSON.parse(content);
          })
        );
        notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        json(res, { notes });
      } catch {
        json(res, { notes: [] });
      }
      return true;
    }

    // POST /notes {title, content}
    if (req.method === 'POST' && url.pathname === '/notes') {
      const body = await readBody(req);
      if (!body.title) return error(res, 'title required');
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const note = { id, title: body.title, content: body.content || '', createdAt: now, updatedAt: now };
      await fsp.writeFile(path.join(NOTES_DIR, `${id}.json`), JSON.stringify(note, null, 2));
      json(res, note, 201);
      return true;
    }

    // Match /notes/:id
    const match = url.pathname.match(/^\/notes\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const filePath = path.join(NOTES_DIR, `${id}.json`);

      // GET /notes/:id
      if (req.method === 'GET') {
        try {
          const content = await fsp.readFile(filePath, 'utf-8');
          json(res, JSON.parse(content));
        } catch {
          error(res, 'Note not found', 404);
        }
        return true;
      }

      // POST /notes/:id (update)
      if (req.method === 'POST') {
        try {
          const existing = JSON.parse(await fsp.readFile(filePath, 'utf-8'));
          const body = await readBody(req);
          const updated = {
            ...existing,
            ...body,
            id,
            updatedAt: new Date().toISOString(),
          };
          await fsp.writeFile(filePath, JSON.stringify(updated, null, 2));
          json(res, updated);
        } catch {
          error(res, 'Note not found', 404);
        }
        return true;
      }

      // DELETE /notes/:id
      if (req.method === 'DELETE') {
        try {
          await fsp.rm(filePath);
          json(res, { ok: true });
        } catch {
          error(res, 'Note not found', 404);
        }
        return true;
      }
    }

    return false;
  }

  return { handle };
}
