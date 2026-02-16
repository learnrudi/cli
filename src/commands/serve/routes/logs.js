/**
 * Logs — ring buffer query + SSE stream.
 *
 * Reads from ctx.getLogs() and ctx.getSseClients(). Stateless itself.
 */

export function buildLogsRoutes(ctx) {
  const { json, error, readBody, log, getLogs, getSseClients, SSE_CLIENT_CAP } = ctx;

  async function handle(req, res, url) {
    // GET /logs
    if (req.method === 'GET' && url.pathname === '/logs') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const source = url.searchParams.get('source');
      const level = url.searchParams.get('level');
      const logs = getLogs();
      let filtered = logs;
      if (source) filtered = filtered.filter(e => e.source === source);
      if (level) filtered = filtered.filter(e => e.level === level);
      json(res, { logs: filtered.slice(-limit) });
      return true;
    }

    // POST /logs
    if (req.method === 'POST' && url.pathname === '/logs') {
      const body = await readBody(req);
      log(body.source || 'frontend', body.level || 'info', body.message || '', body.data);
      json(res, { ok: true });
      return true;
    }

    // GET /logs/stream — SSE
    if (req.method === 'GET' && url.pathname === '/logs/stream') {
      const logs = getLogs();
      const sseClients = getSseClients();

      // Cap SSE clients
      if (sseClients.length >= SSE_CLIENT_CAP) {
        return error(res, 'Too many SSE clients', 429);
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', buffered: logs.length })}\n\n`);
      sseClients.push(res);

      const removeClient = () => {
        const idx = sseClients.indexOf(res);
        if (idx >= 0) sseClients.splice(idx, 1);
      };
      req.on('close', removeClient);
      req.on('error', removeClient);
      return true;
    }

    return false;
  }

  return { handle };
}
