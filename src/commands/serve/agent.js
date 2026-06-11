/**
 * Agent route handler bridge.
 *
 * keep explicit imports so ownership scanners can follow the modular agent
 * tree from serve.js.
 */

import { createAgentHandler } from '../agent/index.js';
import { createIdleReaper } from '../agent/idle-reaper.js';
import { resolveClaudeBinary, checkProviderAuth } from '../agent/auth.js';

export {
  createAgentHandler,
  createIdleReaper,
  resolveClaudeBinary,
  checkProviderAuth,
};
