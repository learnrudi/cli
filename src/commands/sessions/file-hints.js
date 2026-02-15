/**
 * Session file hint cache — maps sessionId to { provider, filePath }.
 * Leaf module imported by both provider discovery modules and discovery.js.
 */

// sessionId -> { provider, filePath }
export const SESSION_FILE_HINTS = new Map();

export function cacheSessionFileHint(sessionId, provider, filePath) {
  if (!sessionId || !provider || !filePath) return;
  SESSION_FILE_HINTS.set(sessionId, { provider, filePath });
}
