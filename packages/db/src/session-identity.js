/**
 * Session identity helpers.
 *
 * RUDI stores a stable internal row key in `sessions.id` and the native
 * provider identifier in `sessions.provider_session_id`. Any code that links
 * turns or looks up a session by native id must resolve through the canonical
 * row id so legacy imports do not break FK relationships.
 */

export function findSessionIdentityRow(db, {
  provider = null,
  sessionId,
  includeDeleted = false,
  requireNativeFile = false,
} = {}) {
  if (!db || !sessionId) return null;

  const clauses = [];
  const params = [];

  if (provider) {
    clauses.push('provider = ?');
    params.push(provider);
  }

  if (!includeDeleted) {
    clauses.push("status != 'deleted'");
  }

  if (requireNativeFile) {
    clauses.push('origin_native_file IS NOT NULL');
  }

  clauses.push('(id = ? OR provider_session_id = ?)');
  params.push(sessionId, sessionId, sessionId);

  return db.prepare(`
    SELECT id, provider, provider_session_id, origin_native_file, status, last_active_at
    FROM sessions
    WHERE ${clauses.join('\n      AND ')}
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END,
             datetime(last_active_at) DESC
    LIMIT 1
  `).get(...params) || null;
}

export function resolveSessionRowIdentity(db, provider, providerSessionId, options = {}) {
  const row = findSessionIdentityRow(db, {
    provider,
    sessionId: providerSessionId,
    includeDeleted: options.includeDeleted === true,
  });

  return {
    rowId: row?.id || providerSessionId,
    existed: Boolean(row),
    row,
  };
}
