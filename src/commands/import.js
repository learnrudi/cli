/**
 * Import command - import sessions from AI agent providers
 *
 * Imports conversation history from Claude Code, Codex, and Gemini
 * into the RUDI database for unified session management.
 * Parses full turn-level data (tokens, costs, model, tools) from
 * each provider's native filesystem format.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, basename, dirname, extname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import {
  getDb,
  isDatabaseInitialized,
  initSchema,
  getDbPath
} from '@learnrudi/db';

// Provider configurations
const PROVIDERS = {
  claude: {
    name: 'Claude Code',
    baseDir: join(homedir(), '.claude', 'projects'),
    pattern: /\.jsonl$/,
  },
  codex: {
    name: 'Codex',
    baseDir: join(homedir(), '.codex', 'sessions'),
    pattern: /\.jsonl$/,
  },
  gemini: {
    name: 'Gemini',
    baseDir: join(homedir(), '.gemini', 'tmp'),
    pattern: /^session-.*\.json$/,
  }
};

export async function cmdImport(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'sessions':
      await importSessions(args.slice(1), flags);
      break;

    case 'status':
      showImportStatus(flags);
      break;

    default:
      console.log(`
rudi import - Import data from AI agent providers

COMMANDS
  sessions [provider]  Import sessions from provider (claude, codex, gemini, or all)
  status               Show import status for all providers

OPTIONS
  --dry-run            Show what would be imported without making changes
  --backfill-turns     Backfill turns for existing sessions with turn_count=0
  --max-age=DAYS       Only import sessions newer than N days
  --verbose            Show detailed progress

EXAMPLES
  rudi import sessions              # Import from all providers
  rudi import sessions claude       # Import only Claude sessions
  rudi import sessions --dry-run    # Preview without importing
  rudi import sessions --backfill-turns  # Backfill turns for existing sessions
  rudi import status                # Check what's available to import
`);
  }
}

// ─────────────────────────────────────────────────────────────
// Main import flow
// ─────────────────────────────────────────────────────────────

async function importSessions(args, flags) {
  const providerArg = args[0] || 'all';
  const dryRun = flags['dry-run'] || flags.dryRun;
  const backfillTurns = flags['backfill-turns'] || flags.backfillTurns;
  const verbose = flags.verbose;
  const maxAgeDays = flags['max-age'] ? parseInt(flags['max-age']) : null;

  // Ensure database is initialized
  if (!isDatabaseInitialized()) {
    console.log('Initializing database...');
    initSchema();
  }

  const db = getDb();
  const pricing = loadPricingMap(db);

  // Handle --backfill-turns mode
  if (backfillTurns) {
    await backfillSessionTurns(db, pricing, providerArg, dryRun, verbose);
    return;
  }

  const providers = providerArg === 'all'
    ? Object.keys(PROVIDERS)
    : [providerArg];

  // Validate providers
  for (const p of providers) {
    if (!PROVIDERS[p]) {
      console.error(`Unknown provider: ${p}`);
      console.error(`Available: ${Object.keys(PROVIDERS).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('═'.repeat(60));
  console.log('RUDI Session Import');
  console.log('═'.repeat(60));
  console.log(`Providers:  ${providers.join(', ')}`);
  console.log(`Database:   ${getDbPath()}`);
  console.log(`Max age:    ${maxAgeDays ? `${maxAgeDays} days` : 'all'}`);
  console.log(`Dry run:    ${dryRun ? 'yes' : 'no'}`);
  console.log('═'.repeat(60));

  let totalImported = 0;
  let totalSkipped = 0;
  let totalTurns = 0;

  for (const providerKey of providers) {
    const provider = PROVIDERS[providerKey];
    console.log(`\n▶ ${provider.name}`);
    console.log(`  Source: ${provider.baseDir}`);

    if (!existsSync(provider.baseDir)) {
      console.log(`  ⚠ Directory not found, skipping`);
      continue;
    }

    // Get existing session IDs for this provider
    const existingIds = new Set();
    try {
      const rows = db.prepare(
        'SELECT provider_session_id FROM sessions WHERE provider = ? AND provider_session_id IS NOT NULL'
      ).all(providerKey);
      for (const row of rows) {
        existingIds.add(row.provider_session_id);
      }
    } catch (e) {
      // Table might not exist yet
    }
    console.log(`  Existing: ${existingIds.size} sessions`);

    // Find all session files
    const files = findSessionFiles(provider.baseDir, provider.pattern);
    console.log(`  Found: ${files.length} session files`);

    // Prepare insert statements
    const insertSessionStmt = db.prepare(`
      INSERT INTO sessions (
        id, provider, provider_session_id, project_id,
        origin, origin_imported_at, origin_native_file,
        title, snippet, status, model,
        inherit_project_prompt,
        cwd, dir_scope, native_storage_path,
        created_at, last_active_at,
        turn_count, total_cost, total_input_tokens, total_output_tokens, total_duration_ms,
        is_warmup, parent_session_id, agent_id, is_sidechain, session_type, version, user_type
      ) VALUES (
        ?, ?, ?, NULL,
        'provider-import', ?, ?,
        ?, '', 'active', ?,
        1,
        ?, 'project', ?,
        ?, ?,
        0, 0, 0, 0, 0,
        0, ?, ?, ?, ?, '2.0.76', 'external'
      )
    `);

    const insertTurnStmt = db.prepare(`
      INSERT OR IGNORE INTO turns (
        id, session_id, provider, provider_session_id, provider_turn_id,
        turn_number, user_message, assistant_response, thinking,
        model, cost, duration_ms,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        finish_reason, tools_used, tool_results, kind, ts, ts_ms,
        service_tier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'message', ?, ?, ?)
    `);

    const updateSessionAggregatesStmt = db.prepare(`
      UPDATE sessions SET
        turn_count = (SELECT COUNT(*) FROM turns WHERE session_id = ?),
        total_cost = (SELECT COALESCE(SUM(cost), 0) FROM turns WHERE session_id = ?),
        total_input_tokens = (SELECT COALESCE(SUM(input_tokens), 0) FROM turns WHERE session_id = ?),
        total_output_tokens = (SELECT COALESCE(SUM(output_tokens), 0) FROM turns WHERE session_id = ?),
        total_duration_ms = (SELECT COALESCE(SUM(duration_ms), 0) FROM turns WHERE session_id = ?),
        model = COALESCE((SELECT model FROM turns WHERE session_id = ? ORDER BY turn_number DESC LIMIT 1), model),
        last_active_at = COALESCE((SELECT MAX(ts) FROM turns WHERE session_id = ?), last_active_at)
      WHERE id = ?
    `);

    let imported = 0;
    let skipped = { existing: 0, empty: 0, old: 0, error: 0 };
    let providerTurns = 0;
    const now = Date.now();
    const maxAgeMs = maxAgeDays ? maxAgeDays * 24 * 60 * 60 * 1000 : null;
    const ext = providerKey === 'gemini' ? '.json' : '.jsonl';

    for (const filepath of files) {
      const sessionFileId = basename(filepath, ext);

      // Skip existing
      if (existingIds.has(sessionFileId)) {
        skipped.existing++;
        continue;
      }

      // Check file
      let stat;
      try {
        stat = statSync(filepath);
      } catch (e) {
        skipped.error++;
        continue;
      }

      // Skip empty files
      if (stat.size === 0) {
        skipped.empty++;
        continue;
      }

      // Skip old files
      if (maxAgeMs && (now - stat.mtimeMs) > maxAgeMs) {
        skipped.old++;
        continue;
      }

      // Parse session metadata
      const session = parseSessionFile(filepath, providerKey);
      if (!session) {
        skipped.error++;
        continue;
      }

      // Parse turns
      let turns = [];
      try {
        turns = parseTurnsFromFile(filepath, providerKey);
      } catch (e) {
        // Non-fatal: we still import the session even if turn parsing fails
        if (verbose) {
          console.log(`  ⚠ Turn parse error for ${sessionFileId}: ${e.message}`);
        }
      }

      if (dryRun) {
        if (verbose || imported < 5) {
          console.log(`  [would import] ${sessionFileId}: ${session.title.slice(0, 40)} (${turns.length} turns)`);
        }
        imported++;
        providerTurns += turns.length;
        continue;
      }

      // Insert session + turns in a transaction
      try {
        const dbSessionId = randomUUID();
        const nowIso = new Date().toISOString();

        db.transaction(() => {
          insertSessionStmt.run(
            dbSessionId,
            providerKey,
            sessionFileId,
            nowIso,
            filepath,
            session.title,
            session.model || 'unknown',
            session.cwd,
            filepath,
            session.createdAt,
            session.lastActiveAt,
            session.parentSessionId,
            session.agentId,
            session.isAgent ? 1 : 0,
            session.sessionType
          );

          // Insert turns
          for (const turn of turns) {
            const cost = calculateCost(pricing, providerKey, turn.model, {
              input_tokens: turn.inputTokens,
              output_tokens: turn.outputTokens,
              cache_read_tokens: turn.cacheReadTokens,
              cache_creation_tokens: turn.cacheCreationTokens,
            });

            const tsMs = turn.ts ? new Date(turn.ts).getTime() || null : null;

            insertTurnStmt.run(
              randomUUID(),
              dbSessionId,
              providerKey,
              sessionFileId,
              turn.providerTurnId,
              turn.turnNumber,
              turn.userMessage,
              turn.assistantResponse,
              turn.thinking,
              turn.model,
              cost,
              turn.durationMs,
              turn.inputTokens,
              turn.outputTokens,
              turn.cacheReadTokens,
              turn.cacheCreationTokens,
              turn.finishReason,
              turn.toolsUsed ? JSON.stringify(turn.toolsUsed) : null,
              turn.toolResults || null,
              turn.ts || nowIso,
              tsMs,
              turn.serviceTier
            );
          }

          // Recompute session aggregates
          if (turns.length > 0) {
            updateSessionAggregatesStmt.run(
              dbSessionId, dbSessionId, dbSessionId, dbSessionId,
              dbSessionId, dbSessionId, dbSessionId, dbSessionId
            );
          }
        })();

        imported++;
        providerTurns += turns.length;

        if (verbose) {
          console.log(`  ✓ ${sessionFileId}: ${session.title.slice(0, 40)} (${turns.length} turns)`);
        } else if (imported % 100 === 0) {
          console.log(`  Imported ${imported}...`);
        }
      } catch (e) {
        skipped.error++;
        if (verbose) {
          console.log(`  ✗ ${sessionFileId}: ${e.message}`);
        }
      }
    }

    console.log(`  ─────────────────────────────`);
    console.log(`  Imported: ${imported} sessions, ${providerTurns} turns`);
    console.log(`  Skipped:  ${skipped.existing} existing, ${skipped.empty} empty, ${skipped.old} old, ${skipped.error} errors`);

    totalImported += imported;
    totalSkipped += skipped.existing + skipped.empty + skipped.old + skipped.error;
    totalTurns += providerTurns;
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`Total imported: ${totalImported} sessions, ${totalTurns} turns`);
  console.log(`Total skipped:  ${totalSkipped}`);
  console.log('═'.repeat(60));

  if (dryRun) {
    console.log('\n(Dry run - no changes made)');
  }

  // Show final count
  if (!dryRun && totalImported > 0) {
    const count = db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    const turnCount = db.prepare('SELECT COUNT(*) as count FROM turns').get();
    console.log(`\nTotal sessions in database: ${count.count}`);
    console.log(`Total turns in database: ${turnCount.count}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Backfill turns for existing sessions
// ─────────────────────────────────────────────────────────────

async function backfillSessionTurns(db, pricing, providerArg, dryRun, verbose) {
  const providerFilter = providerArg === 'all' ? null : providerArg;

  console.log('═'.repeat(60));
  console.log('RUDI Turn Backfill');
  console.log('═'.repeat(60));

  // Find sessions with 0 turns that have a native file on disk
  let query = `
    SELECT id, provider, provider_session_id, origin_native_file
    FROM sessions
    WHERE turn_count = 0
      AND origin_native_file IS NOT NULL
      AND status = 'active'
  `;
  const params = [];
  if (providerFilter) {
    query += ' AND provider = ?';
    params.push(providerFilter);
  }

  const sessions = db.prepare(query).all(...params);
  console.log(`Found ${sessions.length} sessions to backfill`);

  if (sessions.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  const insertTurnStmt = db.prepare(`
    INSERT OR IGNORE INTO turns (
      id, session_id, provider, provider_session_id, provider_turn_id,
      turn_number, user_message, assistant_response, thinking,
      model, cost, duration_ms,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      finish_reason, tools_used, kind, ts, ts_ms,
      service_tier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'message', ?, ?, ?)
  `);

  const updateSessionAggregatesStmt = db.prepare(`
    UPDATE sessions SET
      turn_count = (SELECT COUNT(*) FROM turns WHERE session_id = ?),
      total_cost = (SELECT COALESCE(SUM(cost), 0) FROM turns WHERE session_id = ?),
      total_input_tokens = (SELECT COALESCE(SUM(input_tokens), 0) FROM turns WHERE session_id = ?),
      total_output_tokens = (SELECT COALESCE(SUM(output_tokens), 0) FROM turns WHERE session_id = ?),
      total_duration_ms = (SELECT COALESCE(SUM(duration_ms), 0) FROM turns WHERE session_id = ?),
      model = COALESCE((SELECT model FROM turns WHERE session_id = ? ORDER BY turn_number DESC LIMIT 1), model),
      last_active_at = COALESCE((SELECT MAX(ts) FROM turns WHERE session_id = ?), last_active_at)
    WHERE id = ?
  `);

  let backfilled = 0;
  let totalTurns = 0;
  let errors = 0;

  for (const session of sessions) {
    const filepath = session.origin_native_file;
    if (!existsSync(filepath)) {
      if (verbose) console.log(`  ⚠ File missing: ${filepath}`);
      errors++;
      continue;
    }

    let turns = [];
    try {
      turns = parseTurnsFromFile(filepath, session.provider);
    } catch (e) {
      if (verbose) console.log(`  ✗ Parse error ${session.provider_session_id}: ${e.message}`);
      errors++;
      continue;
    }

    if (turns.length === 0) continue;

    if (dryRun) {
      console.log(`  [would backfill] ${session.provider_session_id}: ${turns.length} turns`);
      backfilled++;
      totalTurns += turns.length;
      continue;
    }

    try {
      db.transaction(() => {
        for (const turn of turns) {
          const cost = calculateCost(pricing, session.provider, turn.model, {
            input_tokens: turn.inputTokens,
            output_tokens: turn.outputTokens,
            cache_read_tokens: turn.cacheReadTokens,
            cache_creation_tokens: turn.cacheCreationTokens,
          });
          const tsMs = turn.ts ? new Date(turn.ts).getTime() || null : null;

          insertTurnStmt.run(
            randomUUID(),
            session.id,
            session.provider,
            session.provider_session_id,
            turn.providerTurnId,
            turn.turnNumber,
            turn.userMessage,
            turn.assistantResponse,
            turn.thinking,
            turn.model,
            cost,
            turn.durationMs,
            turn.inputTokens,
            turn.outputTokens,
            turn.cacheReadTokens,
            turn.cacheCreationTokens,
            turn.finishReason,
            turn.toolsUsed ? JSON.stringify(turn.toolsUsed) : null,
            turn.ts || new Date().toISOString(),
            tsMs,
            turn.serviceTier
          );
        }

        updateSessionAggregatesStmt.run(
          session.id, session.id, session.id, session.id,
          session.id, session.id, session.id, session.id
        );
      })();

      backfilled++;
      totalTurns += turns.length;

      if (verbose) {
        console.log(`  ✓ ${session.provider_session_id}: ${turns.length} turns`);
      } else if (backfilled % 50 === 0) {
        console.log(`  Backfilled ${backfilled}...`);
      }
    } catch (e) {
      errors++;
      if (verbose) console.log(`  ✗ ${session.provider_session_id}: ${e.message}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`Backfilled: ${backfilled} sessions, ${totalTurns} turns`);
  console.log(`Errors: ${errors}`);
  console.log('═'.repeat(60));

  if (dryRun) console.log('\n(Dry run - no changes made)');
}

// ─────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────

function showImportStatus(flags) {
  console.log('═'.repeat(60));
  console.log('Import Status');
  console.log('═'.repeat(60));

  // Check database
  if (!isDatabaseInitialized()) {
    console.log('\nDatabase: Not initialized');
    console.log('Run: rudi db init');
  } else {
    const db = getDb();
    const stats = db.prepare(`
      SELECT provider, COUNT(*) as count
      FROM sessions
      WHERE status = 'active'
      GROUP BY provider
    `).all();

    console.log('\nDatabase sessions:');
    for (const row of stats) {
      console.log(`  ${row.provider}: ${row.count}`);
    }

    // Show turn stats
    const turnStats = db.prepare(`
      SELECT s.provider, COUNT(t.id) as turn_count, printf('$%.2f', COALESCE(SUM(t.cost), 0)) as total_cost
      FROM sessions s
      LEFT JOIN turns t ON t.session_id = s.id
      WHERE s.status = 'active'
      GROUP BY s.provider
    `).all();

    console.log('\nTurn data:');
    for (const row of turnStats) {
      console.log(`  ${row.provider}: ${row.turn_count} turns, ${row.total_cost}`);
    }

    // Show sessions needing backfill
    const backfillCount = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE turn_count = 0 AND origin_native_file IS NOT NULL AND status = 'active'
    `).get();
    if (backfillCount.count > 0) {
      console.log(`\n  ${backfillCount.count} sessions need turn backfill (--backfill-turns)`);
    }
  }

  // Check providers
  console.log('\nProvider directories:');
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const exists = existsSync(provider.baseDir);
    let count = 0;
    if (exists) {
      const files = findSessionFiles(provider.baseDir, provider.pattern);
      count = files.length;
    }
    console.log(`  ${provider.name}:`);
    console.log(`    Path: ${provider.baseDir}`);
    console.log(`    Status: ${exists ? `${count} session files` : 'not found'}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('To import: rudi import sessions [provider]');
}

// ─────────────────────────────────────────────────────────────
// File discovery
// ─────────────────────────────────────────────────────────────

function findSessionFiles(dir, pattern, files = []) {
  if (!existsSync(dir)) return files;

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        findSessionFiles(fullPath, pattern, files);
      } else if (pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    // Skip unreadable directories
  }
  return files;
}

// ─────────────────────────────────────────────────────────────
// Session metadata parser (unchanged)
// ─────────────────────────────────────────────────────────────

function parseSessionFile(filepath, provider) {
  try {
    const stat = statSync(filepath);

    if (provider === 'gemini') {
      return parseGeminiSessionFile(filepath, stat);
    }

    const content = readFileSync(filepath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    if (lines.length === 0) return null;

    const ext = provider === 'gemini' ? '.json' : '.jsonl';
    const sessionId = basename(filepath, ext);
    const isAgent = sessionId.startsWith('agent-');

    let title = null;
    let cwd = null;
    let createdAt = null;
    let model = null;
    let parentSessionId = null;
    let agentId = isAgent ? sessionId.replace('agent-', '') : null;

    // Parse lines to extract metadata
    for (const line of lines.slice(0, 50)) { // Only check first 50 lines
      try {
        const data = JSON.parse(line);

        if (!cwd && data.cwd) cwd = data.cwd;
        if (!createdAt && data.timestamp) createdAt = data.timestamp;
        if (!model && data.model) model = data.model;
        if (!parentSessionId && (data.parentSessionId || data.parentUuid)) {
          parentSessionId = data.parentSessionId || data.parentUuid;
        }
        if (!agentId && data.agentId) agentId = data.agentId;

        // Extract model from nested structures
        if (!model && data.message?.model) model = data.message.model;
        if (!model && data.type === 'turn_context' && data.payload?.model) model = data.payload.model;

        // Extract title from user message
        if (!title) {
          let msg = null;
          if (provider === 'claude') {
            if (data.type === 'user' && typeof data.message?.content === 'string') {
              msg = data.message.content;
            }
          } else if (provider === 'codex') {
            if (data.type === 'event_msg' && data.payload?.type === 'user_message') {
              msg = data.payload.message;
            }
          }
          if (!msg) {
            msg = data.message?.content || data.userMessage;
          }
          if (msg && typeof msg === 'string' && msg.length > 2) {
            title = msg.split('\n')[0].slice(0, 50).trim();
          }
        }

        // Codex: extract cwd from session_meta
        if (!cwd && data.type === 'session_meta' && data.payload?.cwd) {
          cwd = data.payload.cwd;
        }
      } catch (e) {
        continue;
      }
    }

    // Fallbacks
    if (!title || title.length < 3) {
      title = isAgent ? 'Agent Session' : 'Imported Session';
    }
    if (!cwd) {
      const parentDir = basename(dirname(filepath));
      if (parentDir.startsWith('-')) {
        cwd = parentDir.replace(/-/g, '/').replace(/^\//, '/');
      } else {
        cwd = homedir();
      }
    }

    return {
      title,
      cwd,
      createdAt: createdAt || stat.birthtime.toISOString(),
      lastActiveAt: stat.mtime.toISOString(),
      model,
      isAgent,
      agentId,
      parentSessionId,
      sessionType: isAgent ? 'agent' : 'main',
    };
  } catch (e) {
    return null;
  }
}

function parseGeminiSessionFile(filepath, stat) {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content);
    if (!data.messages || data.messages.length === 0) return null;

    const firstUser = data.messages.find(m => m.type === 'user');
    const lastGemini = [...data.messages].reverse().find(m => m.type === 'gemini');
    const title = firstUser?.content?.split('\n')[0]?.slice(0, 50)?.trim() || 'Gemini Session';

    return {
      title,
      cwd: homedir(),
      createdAt: data.startTime || stat.birthtime.toISOString(),
      lastActiveAt: data.lastUpdated || stat.mtime.toISOString(),
      model: lastGemini?.model || null,
      isAgent: false,
      agentId: null,
      parentSessionId: null,
      sessionType: 'main',
    };
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Turn parsers
// ─────────────────────────────────────────────────────────────

/**
 * Dispatch to provider-specific turn parser
 * @returns {Array<Turn>} where Turn has: turnNumber, userMessage, assistantResponse,
 *   thinking, model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
 *   durationMs, finishReason, toolsUsed, providerTurnId, ts, serviceTier
 */
function parseTurnsFromFile(filepath, provider) {
  switch (provider) {
    case 'claude': return parseClaudeTurns(filepath);
    case 'codex': return parseCodexTurns(filepath);
    case 'gemini': return parseGeminiTurns(filepath);
    default: return [];
  }
}

/**
 * Parse Claude Code JSONL session file into turns.
 *
 * Claude events flow:
 *   user (text content) → assistant (streaming chunks) → system (turn_duration)
 *   user (tool_result)  → assistant (next chunk) → ...
 *
 * A "turn" starts on a user event with text content (not tool_result).
 * Multiple assistant events within one turn accumulate tokens.
 */
function parseClaudeTurns(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');
  const turns = [];
  let current = null;
  let turnNumber = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch (e) {
      continue;
    }

    if (data.type === 'user') {
      const msg = data.message;
      if (!msg) continue;

      // Check if this is a text user message (not a tool_result)
      const isToolResult = Array.isArray(msg.content) &&
        msg.content.length > 0 &&
        msg.content[0]?.type === 'tool_result';

      if (!isToolResult) {
        // Finalize previous turn
        if (current) {
          turns.push(current);
        }

        turnNumber++;
        const userText = typeof msg.content === 'string'
          ? msg.content
          : (Array.isArray(msg.content)
            ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
            : null);

        current = {
          turnNumber,
          userMessage: userText,
          assistantResponse: null,
          thinking: null,
          model: null,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          durationMs: null,
          finishReason: null,
          toolsUsed: null,
          toolResults: null,
          providerTurnId: data.uuid || null,
          ts: data.timestamp || null,
          serviceTier: null,
        };
      } else if (isToolResult && current && Array.isArray(msg.content)) {
        // Merge tool_result data into existing toolResults
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            if (!current.toolResults) current.toolResults = [];
            const existing = current.toolResults.find(tc => tc.id === block.tool_use_id);
            if (existing) {
              existing.status = block.is_error ? 'error' : 'success';
              existing.result = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content);
            } else {
              current.toolResults.push({
                id: block.tool_use_id,
                name: null,
                input: null,
                status: block.is_error ? 'error' : 'success',
                result: typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content),
              });
            }
          }
        }
      }
    } else if (data.type === 'assistant' && current) {
      const msg = data.message;
      if (!msg) continue;

      // Model
      if (msg.model) current.model = msg.model;

      // Tokens — accumulate across multiple assistant events in the same turn
      if (msg.usage) {
        current.inputTokens += msg.usage.input_tokens || 0;
        current.outputTokens += msg.usage.output_tokens || 0;
        current.cacheReadTokens += msg.usage.cache_read_input_tokens || 0;
        current.cacheCreationTokens += msg.usage.cache_creation_input_tokens || 0;
        if (msg.usage.service_tier) current.serviceTier = msg.usage.service_tier;
      }

      // Finish reason
      if (msg.stop_reason) current.finishReason = msg.stop_reason;

      // Content blocks
      if (Array.isArray(msg.content)) {
        const textBlocks = [];
        const thinkingBlocks = [];
        const tools = [];
        const toolCalls = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textBlocks.push(block.text);
          } else if (block.type === 'thinking') {
            thinkingBlocks.push(block.thinking);
          } else if (block.type === 'tool_use') {
            tools.push(block.name);
            if (block.id && block.name) {
              toolCalls.push({
                id: block.id,
                name: block.name,
                input: block.input || null,
                status: null,
                result: null,
              });
            }
          }
        }

        if (textBlocks.length > 0) {
          current.assistantResponse = current.assistantResponse
            ? current.assistantResponse + '\n' + textBlocks.join('\n')
            : textBlocks.join('\n');
        }
        if (thinkingBlocks.length > 0) {
          current.thinking = current.thinking
            ? current.thinking + '\n' + thinkingBlocks.join('\n')
            : thinkingBlocks.join('\n');
        }
        if (tools.length > 0) {
          current.toolsUsed = current.toolsUsed
            ? [...current.toolsUsed, ...tools]
            : tools;
        }
        if (toolCalls.length > 0) {
          if (!current.toolResults) current.toolResults = [];
          current.toolResults.push(...toolCalls);
        }
      }

      // Use assistant uuid as providerTurnId (more reliable for dedup)
      if (data.uuid) current.providerTurnId = data.uuid;

    } else if (data.type === 'system' && data.subtype === 'turn_duration' && current) {
      current.durationMs = data.durationMs || null;
    }
  }

  // Finalize last turn
  if (current) {
    turns.push(current);
  }

  // Deduplicate tools and serialize toolResults
  for (const turn of turns) {
    if (turn.toolsUsed) {
      turn.toolsUsed = [...new Set(turn.toolsUsed)];
    }
    if (turn.toolResults && turn.toolResults.length > 0) {
      turn.toolResults = JSON.stringify(turn.toolResults);
    } else {
      turn.toolResults = null;
    }
  }

  return turns;
}

/**
 * Parse Codex JSONL session file into turns.
 *
 * Codex events:
 *   session_meta → turn_context → event_msg (user_message) → event_msg (agent_reasoning)
 *   → response_item (function_call) → response_item (function_call_output)
 *   → event_msg (agent_message) → event_msg (token_count with info)
 */
function parseCodexTurns(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');
  const turns = [];
  let current = null;
  let turnNumber = 0;
  let sessionModel = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch (e) {
      continue;
    }

    // Extract model from turn_context or session_meta
    if (data.type === 'turn_context' && data.payload?.model) {
      sessionModel = data.payload.model;
    }
    if (data.type === 'session_meta' && data.payload?.model) {
      sessionModel = data.payload.model;
    }

    if (data.type === 'event_msg') {
      const p = data.payload;
      if (!p) continue;

      if (p.type === 'user_message') {
        // Finalize previous turn
        if (current) {
          turns.push(current);
        }

        turnNumber++;
        current = {
          turnNumber,
          userMessage: p.message || null,
          assistantResponse: null,
          thinking: null,
          model: sessionModel,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          durationMs: null,
          finishReason: null,
          toolsUsed: null,
          providerTurnId: `codex-${turnNumber}-${data.timestamp || ''}`,
          ts: data.timestamp || null,
          serviceTier: null,
        };

      } else if (p.type === 'agent_message' && current) {
        current.assistantResponse = current.assistantResponse
          ? current.assistantResponse + '\n' + p.message
          : p.message;

      } else if (p.type === 'agent_reasoning' && current) {
        current.thinking = current.thinking
          ? current.thinking + '\n' + p.text
          : p.text;

      } else if (p.type === 'token_count' && p.info && current) {
        // Use last_token_usage for per-turn tokens (total_token_usage is cumulative)
        const usage = p.info.last_token_usage || p.info.total_token_usage;
        if (usage) {
          current.inputTokens = usage.input_tokens || 0;
          current.outputTokens = (usage.output_tokens || 0) + (usage.reasoning_output_tokens || 0);
          current.cacheReadTokens = usage.cached_input_tokens || 0;
        }

      } else if (p.type === 'turn_aborted' && current) {
        current.finishReason = 'aborted';
      }
    }

    // Track tools from response_item function_call
    if (data.type === 'response_item' && current) {
      const p = data.payload;
      if (p?.type === 'function_call' || p?.type === 'custom_tool_call') {
        const toolName = p.name;
        if (toolName) {
          current.toolsUsed = current.toolsUsed
            ? [...current.toolsUsed, toolName]
            : [toolName];
        }
      }
    }

    // Update model from turn_context mid-session
    if (data.type === 'turn_context' && data.payload?.model && current) {
      current.model = data.payload.model;
    }
  }

  // Finalize last turn
  if (current) {
    turns.push(current);
  }

  // Deduplicate tools and serialize toolResults
  for (const turn of turns) {
    if (turn.toolsUsed) {
      turn.toolsUsed = [...new Set(turn.toolsUsed)];
    }
    if (turn.toolResults && turn.toolResults.length > 0) {
      turn.toolResults = JSON.stringify(turn.toolResults);
    } else {
      turn.toolResults = null;
    }
  }

  return turns;
}

/**
 * Parse Gemini session JSON file into turns.
 *
 * Gemini stores sessions as a single JSON file with a messages array.
 * Each user message followed by a gemini message forms one turn.
 */
function parseGeminiTurns(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return [];
  }

  if (!data.messages || !Array.isArray(data.messages)) return [];

  const turns = [];
  let turnNumber = 0;
  const messages = data.messages;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type !== 'user') continue;

    turnNumber++;
    const turn = {
      turnNumber,
      userMessage: msg.content || null,
      assistantResponse: null,
      thinking: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      durationMs: null,
      finishReason: null,
      toolsUsed: null,
      providerTurnId: msg.id || `gemini-${turnNumber}`,
      ts: msg.timestamp || null,
      serviceTier: null,
    };

    // Look for the next gemini message
    if (i + 1 < messages.length && messages[i + 1].type === 'gemini') {
      const gemini = messages[i + 1];
      turn.assistantResponse = gemini.content || null;
      turn.model = gemini.model || null;

      // Tokens
      if (gemini.tokens) {
        turn.inputTokens = gemini.tokens.input || 0;
        turn.outputTokens = gemini.tokens.output || 0;
        turn.cacheReadTokens = gemini.tokens.cached || 0;
      }

      // Thinking/thoughts
      if (gemini.thoughts && Array.isArray(gemini.thoughts)) {
        turn.thinking = gemini.thoughts
          .map(t => [t.subject, t.description].filter(Boolean).join(': '))
          .join('\n');
      }

      // Tool calls
      if (gemini.toolCalls && Array.isArray(gemini.toolCalls)) {
        turn.toolsUsed = gemini.toolCalls.map(t => t.name).filter(Boolean);
        if (turn.toolsUsed.length === 0) turn.toolsUsed = null;
      }

      // Use gemini message id for dedup if available
      if (gemini.id) turn.providerTurnId = gemini.id;
      // Use gemini timestamp for turn ts (more accurate — it's when the response came)
      if (gemini.timestamp) turn.ts = gemini.timestamp;

      i++; // Skip the gemini message in next iteration
    }

    turns.push(turn);
  }

  return turns;
}

// ─────────────────────────────────────────────────────────────
// Pricing helpers
// ─────────────────────────────────────────────────────────────

/**
 * Load pricing data from DB into a fast lookup structure.
 * Returns array sorted by specificity (exact match patterns first, then wildcards).
 */
function loadPricingMap(db) {
  try {
    const rows = db.prepare(`
      SELECT provider, model_pattern, input_cost_per_mtok, output_cost_per_mtok,
             cache_read_cost_per_mtok, cache_write_cost_per_mtok
      FROM model_pricing
      WHERE effective_until IS NULL OR effective_until > datetime('now')
      ORDER BY LENGTH(model_pattern) DESC, effective_from DESC
    `).all();
    return rows;
  } catch (e) {
    return [];
  }
}

/**
 * Calculate cost for a turn given pricing data.
 * Uses SQL LIKE pattern matching logic (% = wildcard).
 */
function calculateCost(pricingRows, provider, model, tokens) {
  if (!model || !tokens) return 0;

  // Find matching pricing row
  const match = pricingRows.find(row => {
    if (row.provider !== provider) return false;
    const pattern = row.model_pattern;
    if (pattern === model) return true;
    // Convert SQL LIKE pattern to regex
    const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$');
    return regex.test(model);
  });

  if (!match) {
    // Fallback pricing
    const inputCost = (tokens.input_tokens || 0) * 3 / 1_000_000;
    const outputCost = (tokens.output_tokens || 0) * 15 / 1_000_000;
    return inputCost + outputCost;
  }

  const inputCost = (tokens.input_tokens || 0) * match.input_cost_per_mtok / 1_000_000;
  const outputCost = (tokens.output_tokens || 0) * match.output_cost_per_mtok / 1_000_000;
  const cacheReadCost = (tokens.cache_read_tokens || 0) * (match.cache_read_cost_per_mtok || 0) / 1_000_000;
  const cacheWriteCost = (tokens.cache_creation_tokens || 0) * (match.cache_write_cost_per_mtok || 0) / 1_000_000;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
