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
 *   GET /analytics/session-summary?session_id=X   — compact summary for one session
 *   GET /analytics/overview                       — cross-session dashboard data
 */

import { getDb, isDatabaseInitialized } from '@learnrudi/db';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

    // GET /analytics/session-summary — compact summary for one session
    if (url.pathname === '/analytics/session-summary') {
      const sessionId = params.get('session_id');
      if (!sessionId) {
        return error(res, 'session_id required'), true;
      }

      // Session metadata
      const session = db.prepare(`
        SELECT
          id, provider, title, status, model,
          turn_count, total_cost, total_input_tokens, total_output_tokens, total_duration_ms,
          created_at, last_active_at
        FROM sessions
        WHERE id = ?
      `).get(sessionId);

      if (!session) {
        return error(res, 'Session not found', 404), true;
      }

      // Tool breakdown
      const toolBreakdown = db.prepare(`
        SELECT
          canonical_name,
          COUNT(*) as count,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as error_count
        FROM tool_calls
        WHERE session_id = ?
        GROUP BY canonical_name
        ORDER BY count DESC
      `).all(sessionId);

      // File breakdown
      const fileBreakdown = db.prepare(`
        SELECT
          file_path,
          SUM(CASE WHEN canonical_name = 'file_read' THEN 1 ELSE 0 END) as read_count,
          SUM(CASE WHEN canonical_name = 'file_edit' THEN 1 ELSE 0 END) as edit_count,
          SUM(CASE WHEN canonical_name = 'file_write' THEN 1 ELSE 0 END) as write_count
        FROM tool_calls
        WHERE session_id = ? AND file_path IS NOT NULL
        GROUP BY file_path
        ORDER BY (read_count + edit_count + write_count) DESC
      `).all(sessionId);

      // Top errors
      const topErrors = db.prepare(`
        SELECT
          tool_name,
          error_message,
          COUNT(*) as count
        FROM tool_calls
        WHERE session_id = ? AND success = 0
        GROUP BY tool_name, error_message
        ORDER BY count DESC
        LIMIT 10
      `).all(sessionId);

      json(res, {
        session: {
          id: session.id,
          provider: session.provider,
          title: session.title,
          status: session.status,
          model: session.model,
          total_turns: session.turn_count,
          total_cost: session.total_cost,
          total_input_tokens: session.total_input_tokens,
          total_output_tokens: session.total_output_tokens,
          total_duration_ms: session.total_duration_ms,
          created_at: session.created_at,
          last_active_at: session.last_active_at
        },
        tool_breakdown: toolBreakdown,
        file_breakdown: fileBreakdown,
        top_errors: topErrors
      });
      return true;
    }

    // GET /analytics/overview — cross-session dashboard data
    if (url.pathname === '/analytics/overview') {
      // Total sessions
      const totalSessions = db.prepare(`SELECT COUNT(*) as count FROM sessions`).get().count;

      // Total cost
      const totalCost = db.prepare(`SELECT SUM(total_cost) as sum FROM sessions`).get().sum || 0;

      // Total tool calls
      const totalToolCalls = db.prepare(`SELECT COUNT(*) as count FROM tool_calls`).get().count;

      // Sessions by provider
      const sessionsByProvider = db.prepare(`
        SELECT
          provider,
          COUNT(*) as count,
          SUM(total_cost) as total_cost
        FROM sessions
        GROUP BY provider
        ORDER BY count DESC
      `).all();

      // Tool usage by canonical name (top 15)
      const toolUsage = db.prepare(`
        SELECT
          canonical_name,
          COUNT(*) as count,
          CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as success_rate
        FROM tool_calls
        GROUP BY canonical_name
        ORDER BY count DESC
        LIMIT 15
      `).all();

      // Recent sessions (last 10)
      const recentSessions = db.prepare(`
        SELECT
          id, title, provider, total_cost, turn_count, created_at
        FROM sessions
        ORDER BY created_at DESC
        LIMIT 10
      `).all();

      json(res, {
        total_sessions: totalSessions,
        total_cost: totalCost,
        total_tool_calls: totalToolCalls,
        sessions_by_provider: sessionsByProvider,
        tool_usage_by_canonical: toolUsage,
        recent_sessions: recentSessions
      });
      return true;
    }

    // GET /analytics/daily-activity — daily activity breakdown by provider
    if (url.pathname === '/analytics/daily-activity') {
      const days = parseInt(params.get('days') || '30', 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return error(res, 'days must be integer 1-365', 400), true;
      }

      const rows = db.prepare(`
        SELECT
          DATE(last_active_at) as date,
          provider,
          COUNT(*) as sessions,
          SUM(turn_count) as turns,
          SUM(total_cost) as cost
        FROM sessions
        WHERE last_active_at > datetime('now', ?)
          AND status != 'deleted'
        GROUP BY DATE(last_active_at), provider
        ORDER BY date DESC, provider
      `).all(`-${days} days`);

      json(res, { activity: rows });
      return true;
    }

    // GET /analytics/cost-breakdown — cost breakdown by provider and month
    if (url.pathname === '/analytics/cost-breakdown') {
      const byProvider = db.prepare(`
        SELECT provider, SUM(total_cost) as cost, COUNT(*) as sessions
        FROM sessions WHERE status != 'deleted'
        GROUP BY provider ORDER BY cost DESC
      `).all();

      const byMonth = db.prepare(`
        SELECT strftime('%Y-%m', last_active_at) as month,
               SUM(total_cost) as cost, SUM(turn_count) as turns
        FROM sessions WHERE status != 'deleted'
        GROUP BY strftime('%Y-%m', last_active_at)
        ORDER BY month DESC LIMIT 12
      `).all();

      const totalRow = db.prepare(`
        SELECT SUM(total_cost) as total FROM sessions WHERE status != 'deleted'
      `).get();

      json(res, {
        total: totalRow?.total || 0,
        byProvider: byProvider.reduce((acc, r) => {
          acc[r.provider] = { cost: r.cost || 0, sessions: r.sessions };
          return acc;
        }, {}),
        byMonth
      });
      return true;
    }

    // GET /analytics/stats — aggregate stats for period
    if (url.pathname === '/analytics/stats') {
      const period = params.get('period') || 'month';
      const validPeriods = { day: '-1 day', week: '-7 days', month: '-30 days', year: '-365 days' };
      if (!validPeriods[period]) {
        return error(res, 'period must be day|week|month|year', 400), true;
      }
      const offset = validPeriods[period];
      const stats = db.prepare(`
        SELECT COUNT(*) as sessions, SUM(turn_count) as turns,
               SUM(total_cost) as cost, SUM(total_input_tokens) as input_tokens,
               SUM(total_output_tokens) as output_tokens
        FROM sessions WHERE last_active_at > datetime('now', ?) AND status != 'deleted'
      `).get(offset);

      json(res, {
        period,
        sessions: stats?.sessions || 0,
        turns: stats?.turns || 0,
        cost: stats?.cost || 0,
        inputTokens: stats?.input_tokens || 0,
        outputTokens: stats?.output_tokens || 0
      });
      return true;
    }

    // GET /analytics/cost-timeline — per-turn cost timeline with cache efficiency
    if (url.pathname === '/analytics/cost-timeline') {
      const sessionId = params.get('session_id');
      if (!sessionId) {
        return error(res, 'session_id required', 400), true;
      }

      const turns = db.prepare(`
        SELECT turn_number, model, cost, input_tokens, output_tokens,
               cache_read_tokens, cache_creation_tokens, ts_ms
        FROM turns WHERE session_id = ? ORDER BY turn_number ASC
      `).all(sessionId);

      let totalInput = 0, totalCacheRead = 0;
      for (const t of turns) {
        totalInput += t.input_tokens || 0;
        totalCacheRead += t.cache_read_tokens || 0;
      }
      const cacheEfficiency = (totalInput + totalCacheRead) > 0
        ? totalCacheRead / (totalInput + totalCacheRead)
        : 0;

      json(res, { turns, cacheEfficiency });
      return true;
    }

    // GET /analytics/stats-cache — cached stats from ~/.claude/stats-cache.json
    if (url.pathname === '/analytics/stats-cache') {
      const cachePath = join(homedir(), '.claude', 'stats-cache.json');
      if (!existsSync(cachePath)) {
        return error(res, 'Stats cache not found', 404), true;
      }
      try {
        const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
        json(res, data);
      } catch (e) {
        return error(res, 'Failed to read stats cache', 500), true;
      }
      return true;
    }

    return false;
  }

  return { handle };
}
