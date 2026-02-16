/**
 * Agent route handler — barrel re-exporter.
 *
 * serve.js imports { createAgentHandler, createIdleReaper, resolveClaudeBinary, checkProviderAuth }
 * from this file. We re-export from the modular agent/ directory.
 */

export { createAgentHandler } from '../agent/index.js';
export { createIdleReaper } from '../agent/idle-reaper.js';
export { resolveClaudeBinary, checkProviderAuth } from '../agent/auth.js';
