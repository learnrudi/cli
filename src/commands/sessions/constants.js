/**
 * Shared constants for sessions subsystem.
 */

import path from 'path';
import os from 'os';

export const CLAUDE_ROOT_DIR = path.join(os.homedir(), '.claude');
export const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_ROOT_DIR, 'projects');
export const CODEX_ROOT_DIR = path.join(os.homedir(), '.codex');
export const CODEX_SESSIONS_DIR = path.join(CODEX_ROOT_DIR, 'sessions');
export const SESSION_CWD_SCAN_BYTES = 2 * 1024 * 1024;
export const SESSION_CWD_SCAN_LINES = 400;
export const MAX_SESSION_INDEX_SCAN_BYTES = 65536;
export const CODEX_META_SCAN_LINES = 250;
export const UUID_SUFFIX_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
