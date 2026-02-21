/**
 * Analytics routes — surfaces tool_calls data for session and cross-session insights.
 *
 * Endpoints:
 *   GET /analytics/tools                          — global tool usage summary
 *   GET /analytics/tools?session_id=X             — tool usage for one session
 *   GET /analytics/tools?canonical=file_read       — filter by canonical name
 *   GET /analytics/tools/files                    — most-touched files across sessions
 *   GET /analytics/tools/files?session_id=X       — files touched in one session
 *   GET /analytics/tools/timeline?session_id=X    — tool calls over time for a session
 *   GET /analytics/tools/errors?session_id=X      — failed tool calls for a session
 */

import { getDb, isDatabaseInitialized } from '@learnrudi/db';

export function buildAnalyticsRoutes(ctx) {
  const { json, error } = ctx;

  function handle(req, res, url) {
    if (req.method !== 'GET') return false;
    if (!isDatabaseInitialized()) {
      return error(res, 'Database not initialized', 503), true;
    }

    const db = getDb();
    const params = url.searchParams;

    // GET /analytics/tools — tool usage counts by canonical_name (optionally filtered by session)
    if (url.pathname === '/analytics/tools') {
      const sessionId = params.get('session_id');
      const canonical = params.get('canonical');
      const limit = Math.min(parseInt(params.get('limit') || '50', 10), 200);

      let sql = `
        SELECT
          canonical_name,
          tool_name,
          COUNT(*) as call_count,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_count,
          AVG(duration_ms) as avg_duration_ms
        FROM tool_calls
        WHERE 1=1
      `;
      const binds = [];

      if (sessionId) {
        sql += ` AND session_id = ?`;
        binds.push(sessionId);
      }
      if (canonical) {
        sql += ` AND canonical_name = ?`;
        binds.push(canonical);
      }

      sql += ` GROUP BY canonical_name, tool_name ORDER BY call_count DESC LIMIT ?`;
      binds.push(limit);

      const rows = db.prepare(sql).all(...binds);
      json(res, { tools: rows });
      return true;
    }

    // GET /analytics/tools/files — most-touched files
    if (url.pathname === '/analytics/tools/files') {
      const sessionId = params.get('session_id');
      const limit = Math.min(parseInt(params.get('limit') || '30', 10), 100);

      let sql = `
        SELECT
          file_path,
          COUNT(*) as touch_count,
          COUNT(DISTINCT canonical_name) as tool_types,
          GROUP_CONCAT(DISTINCT canonical_name) as tools_used,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_count
        FROM tool_calls
        WHERE file_path IS NOT NULL
      `;
      const binds = [];

      if (sessionId) {
        sql += ` AND session_id = ?`;
        binds.push(sessionId);
      }

      sql += ` GROUP BY file_path ORDER BY touch_count DESC LIMIT ?`;
      binds.push(limit);

      const rows = db.prepare(sql).all(...binds);
      json(res, { files: rows });
      return true;
    }

    // GET /analytics/tools/timeline — tool calls ordered by timestamp for a session
    if (url.pathname === '/analytics/tools/timeline') {
      const sessionId = params.get('session_id');
      if (!sessionId) {
        return error(res, 'session_id required'), true;
      }

      const limit = Math.min(parseInt(params.get('limit') || '200', 10), 500);

      const rows = db.prepare(`
        SELECT
          id, turn_id, tool_name, canonical_name, file_path,
          success, error_message, duration_ms,
          input_preview, output_preview, ts_ms
        FROM tool_calls
        WHERE session_id = ?
        ORDER BY ts_ms ASC
        LIMIT ?
      `).all(sessionId, limit);

      json(res, { timeline: rows });
      return true;
    }

    // GET /analytics/tools/errors — failed tool calls
    if (url.pathname === '/analytics/tools/errors') {
      const sessionId = params.get('session_id');
      const limit = Math.min(parseInt(params.get('limit') || '50', 10), 200);

      let sql = `
        SELECT
          id, session_id, turn_id, tool_name, canonical_name,
          file_path, error_message, input_preview, ts_ms
        FROM tool_calls
        WHERE success = 0
      `;
      const binds = [];

      if (sessionId) {
        sql += ` AND session_id = ?`;
        binds.push(sessionId);
      }

      sql += ` ORDER BY ts_ms DESC LIMIT ?`;
      binds.push(limit);

      const rows = db.prepare(sql).all(...binds);
      json(res, { errors: rows });
      return true;
    }

    return false;
  }

  return { handle };
}
