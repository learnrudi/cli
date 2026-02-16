/**
 * File system operations — read, write, readdir, stat, serve, watch/unwatch.
 *
 * Owns: fsWatchers Map, fsReaddirCache Map, fsReaddirInFlight Map, generation counter.
 */

import fsSync from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const FS_READDIR_CACHE_TTL_MS = 1200;

export function buildFsRoutes(ctx) {
  const { json, error, readBody, log, broadcast } = ctx;

  const fsWatchers = new Map(); // path -> { watcher, debounceTimer }
  const fsReaddirCache = new Map(); // key -> { entries, fetchedAt }
  const fsReaddirInFlight = new Map(); // key -> Promise<entries>
  let fsReaddirCacheGeneration = 0;

  function invalidateFsReaddirCache() {
    fsReaddirCacheGeneration += 1;
    fsReaddirCache.clear();
  }

  function getFsReaddirCacheKey(dirPath, showHidden) {
    return `${showHidden ? '1' : '0'}:${dirPath}`;
  }

  async function readDirectoryEntries(dirPath, showHidden) {
    const cacheKey = getFsReaddirCacheKey(dirPath, showHidden);
    const now = Date.now();
    const cached = fsReaddirCache.get(cacheKey);
    if (cached && (now - cached.fetchedAt) <= FS_READDIR_CACHE_TTL_MS) {
      return cached.entries;
    }

    const inFlight = fsReaddirInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const generationAtStart = fsReaddirCacheGeneration;
    const request = (async () => {
      const names = await fsp.readdir(dirPath);
      const entries = await Promise.all(
        names
          .filter(n => showHidden || !n.startsWith('.'))
          .map(async (name) => {
            const fullPath = path.join(dirPath, name);
            try {
              const stat = await fsp.stat(fullPath);
              return {
                name,
                path: fullPath,
                isDirectory: stat.isDirectory(),
                isFile: stat.isFile(),
                size: stat.size,
                mtime: stat.mtime.toISOString(),
              };
            } catch {
              return null;
            }
          }),
      );
      return entries.filter(Boolean);
    })();

    fsReaddirInFlight.set(cacheKey, request);
    try {
      const entries = await request;
      if (generationAtStart === fsReaddirCacheGeneration) {
        fsReaddirCache.set(cacheKey, { entries, fetchedAt: Date.now() });
      }
      return entries;
    } finally {
      fsReaddirInFlight.delete(cacheKey);
    }
  }

  async function handle(req, res, url) {
    const pathname = url.pathname;

    // GET /fs/read?path=
    if (req.method === 'GET' && pathname === '/fs/read') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return error(res, 'path required');
      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        json(res, { content });
      } catch (err) {
        error(res, err.message, 404);
      }
      return true;
    }

    // POST /fs/write {path, content}
    if (req.method === 'POST' && pathname === '/fs/write') {
      const body = await readBody(req);
      if (!body.path || body.content === undefined) return error(res, 'path and content required');
      try {
        await fsp.mkdir(path.dirname(body.path), { recursive: true });
        await fsp.writeFile(body.path, body.content, 'utf-8');
        invalidateFsReaddirCache();
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message, 500);
      }
      return true;
    }

    // POST /fs/write-binary {path, base64}
    if (req.method === 'POST' && pathname === '/fs/write-binary') {
      const body = await readBody(req);
      if (!body.path || body.base64 === undefined) return error(res, 'path and base64 required');
      try {
        await fsp.mkdir(path.dirname(body.path), { recursive: true });
        const buffer = Buffer.from(body.base64, 'base64');
        await fsp.writeFile(body.path, buffer);
        invalidateFsReaddirCache();
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message, 500);
      }
      return true;
    }

    // GET /fs/readdir?path=&showHidden=1
    if (req.method === 'GET' && pathname === '/fs/readdir') {
      const dirPath = url.searchParams.get('path');
      if (!dirPath) return error(res, 'path required');
      const showHidden = url.searchParams.get('showHidden') === '1';
      try {
        const entries = await readDirectoryEntries(dirPath, showHidden);
        json(res, { entries });
      } catch (err) {
        error(res, err.message, 404);
      }
      return true;
    }

    // GET /fs/stat?path=
    if (req.method === 'GET' && pathname === '/fs/stat') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return error(res, 'path required');
      try {
        const stat = await fsp.stat(filePath);
        json(res, {
          name: path.basename(filePath),
          path: filePath,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      } catch (err) {
        error(res, err.message, 404);
      }
      return true;
    }

    // GET /fs/serve?path= (binary file serving)
    if (req.method === 'GET' && pathname === '/fs/serve') {
      const filePath = url.searchParams.get('path');
      if (!filePath) return error(res, 'path required');
      try {
        const stat = await fsp.stat(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
          '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
          '.json': 'application/json', '.csv': 'text/csv',
          '.html': 'text/html', '.txt': 'text/plain',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return true;
        }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=5',
          'ETag': etag,
        });
        fsSync.createReadStream(filePath).pipe(res);
      } catch (err) {
        error(res, err.message, 404);
      }
      return true;
    }

    // POST /fs/mkdir {path}
    if (req.method === 'POST' && pathname === '/fs/mkdir') {
      const body = await readBody(req);
      if (!body.path) return error(res, 'path required');
      try {
        await fsp.mkdir(body.path, { recursive: true });
        invalidateFsReaddirCache();
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message, 500);
      }
      return true;
    }

    // POST /fs/remove {path}
    if (req.method === 'POST' && pathname === '/fs/remove') {
      const body = await readBody(req);
      if (!body.path) return error(res, 'path required');
      try {
        await fsp.rm(body.path, { recursive: true });
        invalidateFsReaddirCache();
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message, 500);
      }
      return true;
    }

    // POST /fs/rename {oldPath, newPath}
    if (req.method === 'POST' && pathname === '/fs/rename') {
      const body = await readBody(req);
      if (!body.oldPath || !body.newPath) return error(res, 'oldPath and newPath required');
      try {
        await fsp.rename(body.oldPath, body.newPath);
        invalidateFsReaddirCache();
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message, 500);
      }
      return true;
    }

    // POST /fs/watch {path}
    if (req.method === 'POST' && pathname === '/fs/watch') {
      const body = await readBody(req);
      if (!body.path) return error(res, 'path required');
      const watchPath = body.path;

      if (fsWatchers.has(watchPath)) {
        json(res, { ok: true, already: true });
        return true;
      }

      try {
        const watcher = fsSync.watch(watchPath, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          const entry = fsWatchers.get(watchPath);
          if (!entry) return;

          clearTimeout(entry.debounceTimer);
          entry.debounceTimer = setTimeout(() => {
            const fullPath = path.join(watchPath, filename);
            const dirPath = path.dirname(fullPath);
            invalidateFsReaddirCache();
            broadcast('fs:change', { event: eventType, path: fullPath, dir: dirPath });
          }, 100);
        });

        fsWatchers.set(watchPath, { watcher, debounceTimer: null });
        log('fs', 'info', `watching ${watchPath}`);
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message, 500);
      }
      return true;
    }

    // POST /fs/unwatch {path}
    if (req.method === 'POST' && pathname === '/fs/unwatch') {
      const body = await readBody(req);
      if (!body.path) return error(res, 'path required');
      const entry = fsWatchers.get(body.path);
      if (entry) {
        clearTimeout(entry.debounceTimer);
        entry.watcher.close();
        fsWatchers.delete(body.path);
        log('fs', 'info', `unwatched ${body.path}`);
      }
      json(res, { ok: true });
      return true;
    }

    return false;
  }

  function cleanup() {
    for (const [, entry] of fsWatchers) {
      try {
        clearTimeout(entry.debounceTimer);
        entry.watcher.close();
      } catch {}
    }
    fsWatchers.clear();
  }

  return { handle, cleanup };
}
