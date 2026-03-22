/**
 * Notes — file-based JSON CRUD in ~/.rudi/notes/
 */

import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { PATHS } from '@learnrudi/env';
import { SIDECAR_ERROR_CODES } from '../error-codes.js';

const NOTES_DIR = path.join(PATHS.home, 'notes');

function normalizeTitle(value) {
  if (typeof value !== 'string') return null;
  return value.trim();
}

export function buildNotesRoutes(ctx, deps = {}) {
  const { json, error, errorCode, readBody, requiredField, invalidField } = ctx;
  const fsImpl = deps.fsPromises || fsp;
  const notesDir = deps.notesDir || NOTES_DIR;
  const generateId = deps.generateId || (() => crypto.randomUUID());
  const now = deps.now || (() => new Date().toISOString());

  async function handle(req, res, url) {
    await fsImpl.mkdir(notesDir, { recursive: true });

    // GET /notes
    if (req.method === 'GET' && url.pathname === '/notes') {
      try {
        const files = await fsImpl.readdir(notesDir);
        const notes = await Promise.all(
          files.filter(f => f.endsWith('.json')).map(async (f) => {
            const content = await fsImpl.readFile(path.join(notesDir, f), 'utf-8');
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
      if (body.title == null) return requiredField(res, 'title');
      const title = normalizeTitle(body.title);
      if (title === null) {
        return invalidField(res, 'title', 'title must be a string', {
          reason: 'invalid_type',
          details: { expectedType: 'string' },
        });
      }
      if (title === '') return requiredField(res, 'title');
      if (body.content !== undefined && body.content !== null && typeof body.content !== 'string') {
        return invalidField(res, 'content', 'content must be a string', {
          reason: 'invalid_type',
          details: { expectedType: 'string' },
        });
      }

      const id = generateId();
      const timestamp = now();
      const note = { id, title, content: body.content || '', createdAt: timestamp, updatedAt: timestamp };
      await fsImpl.writeFile(path.join(notesDir, `${id}.json`), JSON.stringify(note, null, 2));
      json(res, note, 201);
      return true;
    }

    // Match /notes/:id
    const match = url.pathname.match(/^\/notes\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const filePath = path.join(notesDir, `${id}.json`);

      // GET /notes/:id
      if (req.method === 'GET') {
        try {
          const content = await fsImpl.readFile(filePath, 'utf-8');
          json(res, JSON.parse(content));
        } catch {
          errorCode(res, SIDECAR_ERROR_CODES.NOTE_NOT_FOUND);
        }
        return true;
      }

      // POST /notes/:id (update)
      if (req.method === 'POST') {
        try {
          const existing = JSON.parse(await fsImpl.readFile(filePath, 'utf-8'));
          const body = await readBody(req);

          if (body.title !== undefined) {
            const title = normalizeTitle(body.title);
            if (title === null) {
              return invalidField(res, 'title', 'title must be a string', {
                reason: 'invalid_type',
                details: { expectedType: 'string' },
              });
            }
            if (title === '') {
              return invalidField(res, 'title', 'title must be a non-empty string', {
                reason: 'empty_string',
              });
            }
            body.title = title;
          }

          if (body.content !== undefined && body.content !== null && typeof body.content !== 'string') {
            return invalidField(res, 'content', 'content must be a string', {
              reason: 'invalid_type',
              details: { expectedType: 'string' },
            });
          }

          const updated = {
            ...existing,
            ...body,
            id,
            updatedAt: now(),
          };
          await fsImpl.writeFile(filePath, JSON.stringify(updated, null, 2));
          json(res, updated);
        } catch {
          errorCode(res, SIDECAR_ERROR_CODES.NOTE_NOT_FOUND);
        }
        return true;
      }

      // DELETE /notes/:id
      if (req.method === 'DELETE') {
        try {
          await fsImpl.rm(filePath);
          json(res, { ok: true });
        } catch {
          errorCode(res, SIDECAR_ERROR_CODES.NOTE_NOT_FOUND);
        }
        return true;
      }
    }

    return false;
  }

  return { handle };
}
