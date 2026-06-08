export function buildAdminRoutes(ctx, deps) {
  const { json, log } = ctx;

  return {
    handle(req, res, url) {
      if (url.pathname === '/admin/ingester' && req.method === 'GET') {
        const stats = deps.getTurnIngestStats();
        json(res, { status: stats.errors.length > 0 ? 'degraded' : 'healthy', ...stats });
        return true;
      }

      if (url.pathname === '/admin/backfill' && req.method === 'POST') {
        const stats = deps.getTurnIngestStats();
        if (!stats.backfillRunning) {
          deps.backfillSessionTurnsToDb()
            .then((result) => log('sessions', 'info', 'Manual backfill complete', result))
            .catch((err) => log('sessions', 'warn', `Manual backfill failed: ${err.message}`));
          const next = deps.getTurnIngestStats();
          json(res, {
            status: 'started',
            backfillRunning: next.backfillRunning,
            progress: {
              filesDone: next.backfillFilesDone || 0,
              filesTotal: next.backfillFilesTotal || 0,
            },
          });
        } else {
          json(res, {
            status: 'running',
            backfillRunning: true,
            progress: {
              filesDone: stats.backfillFilesDone || 0,
              filesTotal: stats.backfillFilesTotal || 0,
            },
          });
        }
        return true;
      }

      if (url.pathname === '/admin/repair-no-text' && req.method === 'POST') {
        const stats = deps.getTurnIngestStats();
        if (!stats.repairRunning) {
          const limitRaw = url.searchParams.get('limit');
          const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 0;
          deps.repairNoTextSessionTurnsToDb({ limit: Number.isFinite(limit) ? limit : 0 })
            .then((result) => log('sessions', 'info', 'Manual no-text repair complete', result))
            .catch((err) => log('sessions', 'warn', `Manual no-text repair failed: ${err.message}`));
          const next = deps.getTurnIngestStats();
          json(res, {
            status: 'started',
            repairRunning: next.repairRunning,
            progress: {
              sessionsDone: next.repairSessionsDone || 0,
              sessionsTotal: next.repairSessionsTotal || 0,
            },
          });
        } else {
          json(res, {
            status: 'running',
            repairRunning: true,
            progress: {
              sessionsDone: stats.repairSessionsDone || 0,
              sessionsTotal: stats.repairSessionsTotal || 0,
            },
          });
        }
        return true;
      }

      if (url.pathname === '/admin/title-backfill' && req.method === 'GET') {
        json(res, deps.getTitleBackfillStats());
        return true;
      }

      if (url.pathname === '/admin/title-backfill' && req.method === 'POST') {
        const stats = deps.getTitleBackfillStats();
        if (!stats.running) {
          const useLlm = url.searchParams.get('llm') !== 'false';
          const minTurnsRaw = url.searchParams.get('minTurns');
          const parsedMinTurns = minTurnsRaw == null ? 1 : Number.parseInt(minTurnsRaw, 10);
          const minTurns = Number.isFinite(parsedMinTurns) && parsedMinTurns >= 0 ? parsedMinTurns : 1;
          deps.backfillSessionTitles({ llm: useLlm, minTurns })
            .then((result) => log('sessions', 'info', 'Manual title backfill complete', result))
            .catch((err) => log('sessions', 'warn', `Manual title backfill failed: ${err.message}`));
          json(res, { status: 'started', ...deps.getTitleBackfillStats() });
        } else {
          json(res, { status: 'running', ...stats });
        }
        return true;
      }

      if (url.pathname === '/admin/metadata-backfill' && req.method === 'GET') {
        json(res, deps.getMetadataBackfillStats());
        return true;
      }

      if (url.pathname === '/admin/metadata-backfill' && req.method === 'POST') {
        const stats = deps.getMetadataBackfillStats();
        if (!stats.running) {
          deps.backfillSessionMetadata()
            .then((result) => log('sessions', 'info', 'Manual metadata backfill complete', result))
            .catch((err) => log('sessions', 'warn', `Manual metadata backfill failed: ${err.message}`));
          json(res, { status: 'started', ...deps.getMetadataBackfillStats() });
        } else {
          json(res, { status: 'running', ...stats });
        }
        return true;
      }

      return false;
    },
  };
}
