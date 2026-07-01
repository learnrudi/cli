/**
 * Session command - manage RUDI sessions
 */

import { getDb, isDatabaseInitialized } from '@learnrudi/db';
import { formatDuration } from '@learnrudi/utils/args';
import { createInterface } from 'readline';
import { runCommand } from '../utils/subprocess.js';

// Lazy load embeddings to avoid startup cost
let embeddingsModule = null;
async function getEmbeddings() {
  if (!embeddingsModule) {
    embeddingsModule = await import('@learnrudi/embeddings');
  }
  return embeddingsModule;
}

/**
 * Prompt user for confirmation
 */
async function confirm(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [Y/n] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

/**
 * Ensure an embedding provider is ready (auto-install Ollama if needed)
 * @param {string} preferredProvider - 'auto', 'ollama', or 'openai'
 * @param {Object} options
 * @returns {Promise<{provider, model} | null>}
 */
async function ensureEmbeddingProvider(preferredProvider = 'auto', options = {}) {
  const { checkProviderStatus, getProvider } = await getEmbeddings();
  const status = await checkProviderStatus();

  // If OpenAI explicitly requested and configured, use it
  if (preferredProvider === 'openai') {
    if (status.openai.configured) {
      return await getProvider('openai');
    }
    console.log('OpenAI not configured. Set OPENAI_API_KEY environment variable.');
    return null;
  }

  // Try auto-detection first
  try {
    return await getProvider('auto');
  } catch {
    // No provider available, need to set one up
  }

  // Check if OpenAI is available as alternative
  if (status.openai.configured) {
    console.log('\nOllama not available. OpenAI is configured.');
    const useOpenAI = await confirm('Use OpenAI for embeddings? (costs ~$0.02/1M tokens)');
    if (useOpenAI) {
      return await getProvider('openai');
    }
  }

  // Need to install/setup Ollama
  console.log('\nNo embedding provider available.\n');
  console.log('Options:');
  console.log('  [1] Install Ollama (recommended - free, local, works offline)');
  console.log('  [2] Use OpenAI (requires OPENAI_API_KEY)');
  console.log('  [3] Cancel\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const choice = await new Promise((resolve) => {
    rl.question('Choice [1]: ', (answer) => {
      rl.close();
      resolve(answer || '1');
    });
  });

  if (choice === '3' || choice.toLowerCase() === 'cancel') {
    return null;
  }

  if (choice === '2') {
    if (!status.openai.configured) {
      console.log('\nOpenAI not configured.');
      console.log('Set: export OPENAI_API_KEY=your-key');
      return null;
    }
    return await getProvider('openai');
  }

  // Install Ollama
  console.log('\nInstalling Ollama...');

  try {
    const { installPackage } = await import('@learnrudi/core');
    await installPackage('runtime:ollama', {
      onProgress: (p) => {
        if (p.phase === 'downloading') process.stdout.write('\r  Downloading...');
        if (p.phase === 'extracting') process.stdout.write('\r  Installing...  ');
      }
    });
    console.log('\r  ✓ Ollama installed     ');

    // Start server
    console.log('  Starting ollama serve...');
    const { spawn } = await import('child_process');
    const server = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, HOME: process.env.HOME }
    });
    server.unref();

    // Wait for server to be ready
    await new Promise(r => setTimeout(r, 2000));

    // Pull embedding model
    console.log('  Pulling nomic-embed-text model (274MB)...');
    runCommand('ollama', ['pull', 'nomic-embed-text'], { stdio: 'inherit' });
    console.log('  ✓ Model ready\n');

    return await getProvider('ollama');
  } catch (err) {
    console.error('\nSetup failed:', err.message);
    console.log('\nManual setup:');
    console.log('  rudi install ollama');
    console.log('  ollama serve');
    console.log('  ollama pull nomic-embed-text');
    return null;
  }
}

export async function cmdSession(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
      sessionList(flags);
      break;

    case 'show':
      sessionShow(args.slice(1), flags);
      break;

    case 'rename':
      sessionRename(args.slice(1), flags);
      break;

    case 'delete':
      sessionDelete(args.slice(1), flags);
      break;

    case 'tag':
      sessionTag(args.slice(1), flags);
      break;

    case 'move':
      sessionMove(args.slice(1), flags);
      break;

    case 'export':
      sessionExport(args.slice(1), flags);
      break;

    case 'search':
      await sessionSearch(args.slice(1), flags);
      break;

    case 'index':
      await sessionIndex(flags);
      break;

    case 'similar':
      await sessionSimilar(args.slice(1), flags);
      break;

    case 'setup':
      await sessionSetup(flags);
      break;

    case 'organize':
      await sessionOrganize(flags);
      break;

    default:
      console.log(`
rudi session - Legacy session history operations

LEGACY COMPATIBILITY
  Core RUDI no longer owns normal agent execution or session history.
  These commands are retained for existing imported-session workflows.

COMMANDS
  list [options]                             List sessions with filters
  show <id>                                  Show session details
  rename <id> <title>                        Rename a session
  delete <id> [--force]                      Delete a session
  tag <id> <tags>                            Add tags (comma-separated)
  tag <id> --list                            List tags on a session
  tag <id> --remove <tag>                    Remove a tag
  move <id> --project <name>                 Move session to project
  export <id> [-o file]                      Export session to JSON

SEARCH
  search <query> [--scope titles]           Search turns (default) or titles
  search <query> --semantic                  Semantic search (requires embeddings)
  setup                                      Check/setup embedding providers
  index [--embeddings] [--provider X]        Index sessions for semantic search
  similar <id> [--limit]                     Find similar sessions

ORGANIZATION
  organize [--dry-run] [--out plan.json]     Auto-organize sessions into projects

LIST OPTIONS
  --provider <name>     Filter by provider (claude, codex, gemini)
  --project <name>      Filter by project name
  --tag <name>          Filter by tag
  --since <date>        Sessions active since date (ISO or YYYY-MM-DD)
  --until <date>        Sessions active until date
  --days <n>            Sessions active in last N days
  --limit <n>           Limit results (default: 20)
  --format <fmt>        Output format (table, json, jsonl)

SEARCH OPTIONS
  --scope <s>           Search scope: turns (default) or titles
  --semantic            Use semantic search (requires embeddings)
  --limit <n>           Limit results (default: 10)

EXAMPLES
  rudi session list --days 7
  rudi session list --since 2026-02-01 --until 2026-02-15
  rudi session list --provider claude --tag auth
  rudi session search "authentication bugs"
  rudi session search "auth refactor" --scope titles
  rudi session tag 7bfa7be7... "bug,auth,urgent"
  rudi session tag 7bfa7be7... --remove bug
  rudi session search "auth" --semantic
`);
  }
}

function sessionList(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    console.log('Run: rudi db init');
    return;
  }

  const db = getDb();
  const limit = flags.limit || 20;
  const provider = flags.provider;
  const projectName = flags.project;
  const tag = flags.tag;
  const format = flags.format || 'table';

  // Date filtering
  const since = flags.since;
  const until = flags.until;
  const days = flags.days;

  let query = `
    SELECT
      s.id,
      s.provider_session_id,
      s.provider,
      s.title,
      s.project_id,
      p.name as project_name,
      s.turn_count,
      s.total_cost,
      s.created_at,
      s.last_active_at
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.deleted_at IS NULL
  `;

  const params = [];

  if (provider) {
    query += ` AND s.provider = ?`;
    params.push(provider);
  }

  if (projectName) {
    query += ` AND p.name LIKE ?`;
    params.push(`%${projectName}%`);
  }

  if (tag) {
    query += ` AND s.id IN (SELECT st.session_id FROM session_tags st JOIN tags t ON st.tag_id = t.id WHERE t.name = ?)`;
    params.push(tag);
  }

  if (days) {
    query += ` AND s.last_active_at >= datetime('now', ?)`;
    params.push(`-${parseInt(days, 10)} days`);
  } else {
    if (since) {
      query += ` AND s.last_active_at >= ?`;
      params.push(since);
    }
    if (until) {
      query += ` AND s.last_active_at <= ?`;
      params.push(until);
    }
  }

  query += ` ORDER BY s.last_active_at DESC LIMIT ?`;
  params.push(limit);

  const sessions = db.prepare(query).all(...params);

  if (format === 'json') {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (format === 'jsonl') {
    sessions.forEach(s => console.log(JSON.stringify(s)));
    return;
  }

  // Table format
  if (sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  console.log(`\nFound ${sessions.length} session(s):\n`);
  sessions.forEach(s => {
    console.log(`${s.provider_session_id || s.id.substring(0, 8)}`);
    console.log(`  Title: ${s.title || '(untitled)'}`);
    console.log(`  Provider: ${s.provider}`);
    if (s.project_name) {
      console.log(`  Project: ${s.project_name}`);
    }
    console.log(`  Turns: ${s.turn_count}, Cost: $${(s.total_cost || 0).toFixed(4)}`);
    console.log(`  Last active: ${new Date(s.last_active_at).toLocaleString()}`);
    console.log('');
  });
}

function sessionShow(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  if (!sessionId) {
    console.log('Error: Session ID required');
    console.log('Usage: rudi session show <id>');
    return;
  }

  const db = getDb();
  const session = db.prepare(`
    SELECT
      s.*,
      p.name as project_name
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ? OR s.provider_session_id = ?
  `).get(sessionId, sessionId);

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  if (flags.format === 'json') {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  console.log(`\nSession: ${session.provider_session_id || session.id}`);
  console.log(`  Title: ${session.title || '(untitled)'}`);
  console.log(`  Provider: ${session.provider}`);
  if (session.project_name) {
    console.log(`  Project: ${session.project_name} (${session.project_id})`);
  }
  console.log(`  Model: ${session.model || 'N/A'}`);
  console.log(`  Turns: ${session.turn_count}`);
  console.log(`  Cost: $${(session.total_cost || 0).toFixed(4)}`);
  console.log(`  Tokens: ${session.total_input_tokens || 0} in, ${session.total_output_tokens || 0} out`);
  console.log(`  Created: ${new Date(session.created_at).toLocaleString()}`);
  console.log(`  Last active: ${new Date(session.last_active_at).toLocaleString()}`);
  if (session.cwd) {
    console.log(`  Working directory: ${session.cwd}`);
  }
  console.log('');
}

function sessionRename(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  const newTitle = args.slice(1).join(' ');

  if (!sessionId || !newTitle) {
    console.log('Error: Session ID and title required');
    console.log('Usage: rudi session rename <id> <new title>');
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE sessions
    SET title = ?, title_override = ?, title_source = 'user', title_generated_at = ?
    WHERE id = ? OR provider_session_id = ?
  `).run(newTitle, newTitle, now, sessionId, sessionId);

  if (result.changes === 0) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  console.log(`✓ Renamed session to: "${newTitle}"`);
}

function sessionDelete(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  if (!sessionId) {
    console.log('Error: Session ID required');
    console.log('Usage: rudi session delete <id> [--force]');
    return;
  }

  const db = getDb();

  // Get session info for confirmation
  const session = db.prepare(`
    SELECT id, title, turn_count
    FROM sessions
    WHERE id = ? OR provider_session_id = ?
  `).get(sessionId, sessionId);

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  if (!flags.force) {
    console.log(`\nThis will delete session: ${session.title || '(untitled)'}`);
    console.log(`  ${session.turn_count} turns will be deleted`);
    console.log(`\nUse --force to confirm deletion`);
    return;
  }

  // Soft delete (set deleted_at)
  db.prepare(`
    UPDATE sessions
    SET deleted_at = datetime('now')
    WHERE id = ?
  `).run(session.id);

  console.log(`✓ Deleted session: ${session.title || session.id}`);
}

function sessionTag(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  if (!sessionId) {
    console.log('Error: Session ID required');
    console.log('Usage: rudi session tag <id> <tags>         Add tags (comma-separated)');
    console.log('       rudi session tag <id> --remove <tag>  Remove a tag');
    console.log('       rudi session tag <id> --list          List tags');
    return;
  }

  const db = getDb();

  // Resolve session
  const session = db.prepare(`
    SELECT id, title FROM sessions
    WHERE id = ? OR provider_session_id = ?
  `).get(sessionId, sessionId);

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  // List tags
  if (flags.list || (!args[1] && !flags.remove)) {
    const tags = db.prepare(`
      SELECT t.name FROM tags t
      JOIN session_tags st ON st.tag_id = t.id
      WHERE st.session_id = ?
      ORDER BY t.name
    `).all(session.id);

    if (tags.length === 0) {
      console.log(`No tags on session: ${session.title || session.id.substring(0, 8)}`);
    } else {
      console.log(`Tags for "${session.title || session.id.substring(0, 8)}":`);
      console.log(`  ${tags.map(t => t.name).join(', ')}`);
    }
    return;
  }

  // Remove tag
  if (flags.remove) {
    const tagName = flags.remove;
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
    if (!tag) {
      console.log(`Tag not found: ${tagName}`);
      return;
    }
    const result = db.prepare('DELETE FROM session_tags WHERE session_id = ? AND tag_id = ?').run(session.id, tag.id);
    if (result.changes > 0) {
      console.log(`Removed tag "${tagName}" from session`);
    } else {
      console.log(`Session didn't have tag "${tagName}"`);
    }
    return;
  }

  // Add tags
  const tagNames = args.slice(1).join(' ').split(',').map(t => t.trim()).filter(Boolean);
  if (tagNames.length === 0) {
    console.log('Error: Tag name(s) required');
    console.log('Usage: rudi session tag <id> "bug,auth,urgent"');
    return;
  }

  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const linkTag = db.prepare('INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)');

  const added = [];
  for (const name of tagNames) {
    insertTag.run(name);
    const tag = getTag.get(name);
    const result = linkTag.run(session.id, tag.id);
    if (result.changes > 0) added.push(name);
  }

  if (added.length > 0) {
    console.log(`Added tag(s): ${added.join(', ')}`);
  } else {
    console.log(`Session already has all specified tags`);
  }
}

function sessionMove(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  const projectName = flags.project;

  if (!sessionId || !projectName) {
    console.log('Error: Session ID and project name required');
    console.log('Usage: rudi session move <id> --project <name>');
    return;
  }

  const db = getDb();

  // Find project
  const project = db.prepare(`
    SELECT id, name FROM projects
    WHERE name LIKE ? AND provider = 'claude'
    LIMIT 1
  `).get(`%${projectName}%`);

  if (!project && projectName !== 'null') {
    console.log(`Project not found: ${projectName}`);
    console.log('\nAvailable projects:');
    const projects = db.prepare('SELECT name FROM projects WHERE provider = "claude"').all();
    projects.forEach(p => console.log(`  - ${p.name}`));
    return;
  }

  const projectId = projectName === 'null' ? null : project.id;

  const result = db.prepare(`
    UPDATE sessions
    SET project_id = ?
    WHERE id = ? OR provider_session_id = ?
  `).run(projectId, sessionId, sessionId);

  if (result.changes === 0) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  if (projectId) {
    console.log(`✓ Moved session to project: ${project.name}`);
  } else {
    console.log(`✓ Removed session from project`);
  }
}

async function sessionExport(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  if (!sessionId) {
    console.log('Error: Session ID required');
    console.log('Usage: rudi session export <id> [-o file]');
    return;
  }

  const db = getDb();

  // Get session with turns
  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE id = ? OR provider_session_id = ?
  `).get(sessionId, sessionId);

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  const turns = db.prepare(`
    SELECT * FROM turns
    WHERE session_id = ?
    ORDER BY turn_number
  `).all(session.id);

  const exportData = {
    session,
    turns,
    exported_at: new Date().toISOString()
  };

  const json = JSON.stringify(exportData, null, 2);

  if (flags.output || flags.o) {
    const fs = await import('fs');
    const outputFile = flags.output || flags.o;
    fs.writeFileSync(outputFile, json);
    console.log(`✓ Exported session to: ${outputFile}`);
  } else {
    console.log(json);
  }
}

// =============================================================================
// SEMANTIC SEARCH COMMANDS
// =============================================================================

/**
 * Search sessions - FTS (default) or semantic (--semantic flag)
 */
async function sessionSearch(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const query = args.join(' ');
  if (!query) {
    console.log('Error: Search query required');
    console.log('Usage: rudi session search <query> [--semantic]');
    return;
  }

  const limit = flags.limit || 10;
  const format = flags.format || 'table';
  const scope = flags.scope || 'turns';

  // Semantic search with embeddings
  if (flags.semantic) {
    await semanticSearch(query, { limit, format });
    return;
  }

  // Title/session-level search
  if (scope === 'titles' || scope === 'sessions') {
    ftsSessionSearch(query, { limit, format });
    return;
  }

  // Default: FTS search on turns
  ftsSearch(query, { limit, format });
}

/**
 * Full-text search using SQLite FTS5
 */
function ftsSearch(query, options) {
  const { limit, format } = options;
  const db = getDb();

  const results = db.prepare(`
    SELECT
      t.id,
      t.session_id,
      t.user_message,
      t.assistant_response,
      t.ts,
      s.title as session_title,
      s.provider,
      highlight(turns_fts, 0, '>>>', '<<<') as user_highlight,
      highlight(turns_fts, 1, '>>>', '<<<') as assistant_highlight
    FROM turns_fts
    JOIN turns t ON turns_fts.rowid = t.rowid
    JOIN sessions s ON t.session_id = s.id
    WHERE turns_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);

  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`No results found for: "${query}"`);
    return;
  }

  console.log(`\nFound ${results.length} result(s) for "${query}":\n`);
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.session_title || '(untitled)'}`);
    console.log(`   Session: ${r.session_id.substring(0, 8)}... | ${r.provider}`);
    console.log(`   Date: ${new Date(r.ts).toLocaleString()}`);

    // Show snippet with highlights
    const snippet = (r.user_highlight || r.assistant_highlight || '').substring(0, 200);
    if (snippet) {
      console.log(`   "${snippet.replace(/\n/g, ' ')}..."`);
    }
    console.log('');
  });
}

/**
 * Full-text search on session titles/snippets using sessions_fts
 */
function ftsSessionSearch(query, options) {
  const { limit, format } = options;
  const db = getDb();

  let results;
  try {
    results = db.prepare(`
      SELECT
        sf.session_id,
        s.title,
        s.provider,
        s.turn_count,
        s.total_cost,
        s.created_at,
        s.last_active_at,
        p.name as project_name,
        highlight(sessions_fts, 1, '>>>', '<<<') as title_highlight,
        highlight(sessions_fts, 2, '>>>', '<<<') as snippet_highlight
      FROM sessions_fts sf
      JOIN sessions s ON sf.session_id = s.id
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE sessions_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);
  } catch {
    // FTS match syntax failed, fall back to LIKE
    results = db.prepare(`
      SELECT
        s.id as session_id,
        s.title,
        s.provider,
        s.turn_count,
        s.total_cost,
        s.created_at,
        s.last_active_at,
        p.name as project_name,
        s.title as title_highlight,
        s.snippet as snippet_highlight
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      WHERE s.deleted_at IS NULL AND (s.title LIKE ? OR s.snippet LIKE ?)
      ORDER BY s.last_active_at DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit);
  }

  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`No sessions found matching: "${query}"`);
    return;
  }

  console.log(`\nFound ${results.length} session(s) matching "${query}":\n`);
  results.forEach((r, i) => {
    const title = r.title_highlight || r.title || '(untitled)';
    console.log(`${i + 1}. ${title}`);
    console.log(`   Provider: ${r.provider} | Turns: ${r.turn_count} | Cost: $${(r.total_cost || 0).toFixed(4)}`);
    if (r.project_name) console.log(`   Project: ${r.project_name}`);
    console.log(`   Last active: ${new Date(r.last_active_at).toLocaleString()}`);
    if (r.snippet_highlight) {
      const snippet = r.snippet_highlight.substring(0, 150).replace(/\n/g, ' ');
      console.log(`   "${snippet}..."`);
    }
    console.log('');
  });
}

/**
 * Semantic search using embeddings
 */
async function semanticSearch(query, options) {
  const { limit, format } = options;

  try {
    const { createClient } = await getEmbeddings();

    // Ensure provider is ready (auto-install Ollama if needed)
    const result = await ensureEmbeddingProvider('auto');
    if (!result) {
      return; // User cancelled or setup failed
    }
    const { provider, model } = result;
    console.log(`Using ${provider.id} with ${model.name}`);

    const client = createClient({ provider, model });

    // Check if we have embeddings
    const stats = client.getStats();
    if (stats.done === 0) {
      console.log('No embeddings found. Run first:');
      console.log('  rudi session index --embeddings');
      return;
    }

    console.log(`Searching ${stats.done} indexed turns...`);
    const results = await client.search(query, { limit });

    if (format === 'json') {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(`No similar results found for: "${query}"`);
      return;
    }

    console.log(`\nTop ${results.length} results for "${query}":\n`);
    results.forEach((r, i) => {
      const similarity = (r.score * 100).toFixed(1);
      console.log(`${i + 1}. [${similarity}%] ${r.turn.session_title || '(untitled)'}`);
      console.log(`   Session: ${r.turn.session_id.substring(0, 8)}... | ${r.turn.provider}`);
      console.log(`   Date: ${new Date(r.turn.ts).toLocaleString()}`);

      // Show snippet
      const content = r.turn.user_message || r.turn.assistant_response || '';
      const snippet = content.substring(0, 200).replace(/\n/g, ' ');
      if (snippet) {
        console.log(`   "${snippet}..."`);
      }
      console.log('');
    });
  } catch (err) {
    console.error('Semantic search error:', err.message);
    if (err.message.includes('not yet implemented')) {
      console.log('\nFor now, use FTS search (without --semantic flag)');
    }
  }
}

/**
 * Index sessions for semantic search
 */
async function sessionIndex(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const providerName = flags.provider || 'auto';

  if (!flags.embeddings) {
    // Show status
    try {
      const { store } = await getEmbeddings();

      // Get stats for all models (model-agnostic)
      const stats = store.getAllEmbeddingStats();
      const pct = stats.total > 0 ? ((stats.done / stats.total) * 100).toFixed(1) : 0;

      console.log('\nEmbedding Index Status:');
      console.log(`  Total turns: ${stats.total}`);
      console.log(`  Indexed: ${stats.done} (${pct}%)`);
      console.log(`  Queued: ${stats.queued}`);
      console.log(`  Errors: ${stats.error}`);

      // Show which models have embeddings
      if (Object.keys(stats.models).length > 0) {
        console.log('\nIndexed by model:');
        for (const [model, info] of Object.entries(stats.models)) {
          console.log(`  ${model} (${info.dimensions}d): ${info.count} turns`);
        }
      }

      if (stats.done < stats.total) {
        console.log('\nTo index missing turns:');
        console.log('  rudi session index --embeddings');
        console.log('  rudi session index --embeddings --provider ollama');
      }
    } catch (err) {
      console.log('Embedding status unavailable:', err.message);
    }
    return;
  }

  console.log('Indexing sessions for semantic search...\n');

  try {
    const { createClient } = await getEmbeddings();

    // Ensure provider is ready (auto-install Ollama if needed)
    const providerResult = await ensureEmbeddingProvider(providerName);
    if (!providerResult) {
      return; // User cancelled or setup failed
    }
    const { provider, model } = providerResult;
    console.log(`Provider: ${provider.id}`);
    console.log(`Model: ${model.name} (${model.dimensions}d)\n`);

    const client = createClient({ provider, model });

    const stats = client.getStats();
    const missing = stats.total - stats.done - stats.error;

    if (missing === 0) {
      console.log('All turns already indexed!');
      console.log(`  Total: ${stats.total}, Indexed: ${stats.done}, Errors: ${stats.error}`);
      return;
    }

    console.log(`Turns to index: ${missing}`);
    if (provider.id === 'openai') {
      console.log(`Estimated cost: $${((missing * 500 * 0.02) / 1_000_000).toFixed(4)}`);
    } else {
      console.log(`Cost: Free (local)`);
    }
    console.log('');

    let lastProgress = 0;
    const result = await client.indexMissing({
      batchSize: 64,
      onProgress: ({ indexed, errors }) => {
        const now = Date.now();
        if (now - lastProgress > 500) { // Update every 500ms
          process.stdout.write(`\rIndexed: ${indexed} | Errors: ${errors}`);
          lastProgress = now;
        }
      },
    });

    console.log(`\n\n✓ Indexed ${result.indexed} turns`);
    if (result.errors > 0) {
      console.log(`  ${result.errors} errors (retry with: rudi session index --retry-errors)`);
    }

    const newStats = client.getStats();
    console.log(`\nIndex status: ${newStats.done}/${newStats.total} (${((newStats.done / newStats.total) * 100).toFixed(1)}%)`);
  } catch (err) {
    console.error('\nIndexing error:', err.message);
    if (err.code === 'insufficient_quota') {
      console.log('OpenAI quota exceeded. Check your billing at: https://platform.openai.com/usage');
    }
  }
}

/**
 * Find sessions similar to a given session/turn
 */
async function sessionSimilar(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const turnId = args[0];
  if (!turnId) {
    console.log('Error: Turn or session ID required');
    console.log('Usage: rudi session similar <id> [--limit 10]');
    return;
  }

  const limit = flags.limit || 10;
  const format = flags.format || 'table';
  const providerName = flags.provider || 'auto';

  try {
    const { createClient } = await getEmbeddings();

    // Ensure provider is ready (auto-install Ollama if needed)
    const result = await ensureEmbeddingProvider(providerName);
    if (!result) {
      return; // User cancelled or setup failed
    }
    const { provider, model } = result;
    const client = createClient({ provider, model });

    const results = await client.findSimilar(turnId, { limit });

    if (format === 'json') {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No similar turns found.');
      console.log('Make sure the turn exists and has been indexed.');
      return;
    }

    console.log(`\nTurns similar to ${turnId.substring(0, 8)}...:\n`);
    results.forEach((r, i) => {
      const similarity = (r.score * 100).toFixed(1);
      console.log(`${i + 1}. [${similarity}%] ${r.turn.session_title || '(untitled)'}`);
      console.log(`   Session: ${r.turn.session_id.substring(0, 8)}...`);
      console.log(`   Date: ${new Date(r.turn.ts).toLocaleString()}`);

      const content = r.turn.user_message || r.turn.assistant_response || '';
      const snippet = content.substring(0, 150).replace(/\n/g, ' ');
      if (snippet) {
        console.log(`   "${snippet}..."`);
      }
      console.log('');
    });
  } catch (err) {
    console.error('Similarity search error:', err.message);
  }
}

/**
 * Setup embedding providers
 */
async function sessionSetup(flags) {
  try {
    const { getSetupInstructions, autoSetupOllama } = await getEmbeddings();

    if (flags.auto) {
      // Try to auto-setup Ollama
      console.log('Auto-configuring embedding provider...\n');
      const result = await autoSetupOllama();
      console.log(result.message);
      if (!result.success) {
        console.log('\nManual setup:');
        console.log(await getSetupInstructions());
      }
      return;
    }

    // Show status and instructions
    console.log(await getSetupInstructions());
  } catch (err) {
    console.error('Setup error:', err.message);
  }
}

/**
 * Auto-organize sessions into projects using semantic analysis
 */
async function sessionOrganize(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const dryRun = flags['dry-run'] || flags.dryRun || true; // Default to dry-run for safety
  const outputFile = flags.out || flags.output || 'organize-plan.json';
  const threshold = parseFloat(flags.threshold) || 0.65;

  const db = getDb();

  console.log('═'.repeat(60));
  console.log('Session Organization');
  console.log('═'.repeat(60));
  console.log(`Mode: ${dryRun ? 'Dry run (preview only)' : 'LIVE - will apply changes'}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Similarity threshold: ${(threshold * 100).toFixed(0)}%`);
  console.log('═'.repeat(60));

  // Step 1: Get all sessions
  const sessions = db.prepare(`
    SELECT
      s.id, s.provider, s.title, s.title_override, s.project_id, s.cwd,
      s.turn_count, s.total_cost, s.created_at, s.last_active_at,
      p.name as project_name
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.status = 'active'
    ORDER BY s.total_cost DESC
  `).all();

  console.log(`\nAnalyzing ${sessions.length} sessions...\n`);

  // Step 2: Get existing projects
  const projects = db.prepare('SELECT id, name FROM projects').all();
  const projectMap = new Map(projects.map(p => [p.name.toLowerCase(), p]));

  console.log(`Existing projects: ${projects.map(p => p.name).join(', ') || '(none)'}\n`);

  // Step 3: Analyze sessions by working directory patterns
  const cwdGroups = new Map();
  for (const s of sessions) {
    if (!s.cwd) continue;
    // Extract project name from cwd
    const match = s.cwd.match(/\/([^/]+)$/);
    const projectKey = match ? match[1] : 'other';
    if (!cwdGroups.has(projectKey)) {
      cwdGroups.set(projectKey, []);
    }
    cwdGroups.get(projectKey).push(s);
  }

  // Step 4: Get first user message for sessions with generic titles
  // Only rename if title matches STRICT generic patterns (conservative)
  const genericTitlePatterns = [
    /^(Imported|Agent|New|Untitled|Chat) Session$/i,
    /^Session \d+$/i,
    /^Untitled$/i,
    /^[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+$/,  // "Adjective Verb Noun" (Claude auto-generated)
  ];

  const sessionsNeedingTitles = sessions.filter(s => {
    // Skip if user already set a title_override (they renamed it manually)
    if (s.title_override && s.title_override !== s.title) {
      return false;
    }
    const title = s.title || '';
    // Only include if title is empty OR matches generic patterns
    return !title || genericTitlePatterns.some(p => p.test(title));
  });

  console.log(`Sessions with generic titles: ${sessionsNeedingTitles.length}`);

  // Get first user message for title suggestions (conservative)
  const titleSuggestions = [];
  for (const s of sessionsNeedingTitles.slice(0, 100)) { // Limit to 100 for performance
    const firstTurn = db.prepare(`
      SELECT user_message
      FROM turns
      WHERE session_id = ? AND user_message IS NOT NULL AND length(trim(user_message)) > 10
      ORDER BY turn_number
      LIMIT 1
    `).get(s.id);

    if (firstTurn && firstTurn.user_message) {
      // Create title from first message
      const msg = firstTurn.user_message.trim();
      let suggestedTitle = msg.split('\n')[0].slice(0, 60).trim();

      // Skip if it looks like noise (very conservative)
      const skipPatterns = [
        /^\/[A-Za-z]/,                    // Unix paths
        /^<[a-z-]+>/,                     // XML tags
        /^[A-Z]:\\[A-Za-z]/,              // Windows paths
        /^(cd|ls|cat|npm|node|git|rudi|pnpm|yarn)\s/i,  // Commands
        /^[a-f0-9-]{8,}/i,                // UUIDs or hashes
        /^https?:\/\//i,                  // URLs
        /^[>\*\-#\d\.]\s/,                // Markdown list/quote starts
        /^(yes|no|ok|sure|y|n)$/i,        // Single word responses
        /^[^a-zA-Z]*$/,                   // No letters at all
        /^\s*\[/,                          // JSON/array starts
        /^\s*\{/,                          // Object starts
      ];

      if (skipPatterns.some(p => p.test(suggestedTitle))) {
        continue;
      }

      // Must have at least 3 words to be meaningful
      const wordCount = suggestedTitle.split(/\s+/).length;
      if (wordCount < 3) {
        continue;
      }

      // Clean up the title
      if (suggestedTitle.length > 50) {
        suggestedTitle = suggestedTitle.slice(0, 47) + '...';
      }

      if (suggestedTitle && suggestedTitle.length > 10) {
        titleSuggestions.push({
          sessionId: s.id,
          currentTitle: s.title || '(none)',
          suggestedTitle,
          cost: s.total_cost,
          confidence: 'medium' // Could add scoring later
        });
      }
    }
  }

  // Step 5: Generate project suggestions based on cwd patterns
  const projectSuggestions = [];
  const moveSuggestions = [];

  // Known project mappings
  const knownProjects = {
    'studio': 'RUDI Studio',
    'RUDI': 'RUDI',
    'rudi': 'RUDI',
    'cli': 'RUDI',
    'registry': 'RUDI',
    'resonance': 'Resonance',
    'cloud': 'Cloud',
  };

  for (const [cwdKey, cwdSessions] of cwdGroups) {
    const projectName = knownProjects[cwdKey];
    if (projectName && cwdSessions.length >= 2) {
      const existingProject = projectMap.get(projectName.toLowerCase());

      // Suggest moves for sessions not already in this project
      for (const s of cwdSessions) {
        if (!s.project_id || (existingProject && s.project_id !== existingProject.id)) {
          moveSuggestions.push({
            sessionId: s.id,
            sessionTitle: s.title_override || s.title,
            currentProject: s.project_name || null,
            suggestedProject: projectName,
            reason: `Working directory: ${cwdKey}`,
            cost: s.total_cost
          });
        }
      }

      // Suggest creating project if it doesn't exist
      if (!existingProject && cwdSessions.length >= 3) {
        projectSuggestions.push({
          name: projectName,
          sessionCount: cwdSessions.length,
          totalCost: cwdSessions.reduce((sum, s) => sum + (s.total_cost || 0), 0)
        });
      }
    }
  }

  // Step 6: Build the plan
  const plan = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    dryRun,
    threshold,
    summary: {
      totalSessions: sessions.length,
      sessionsWithProjects: sessions.filter(s => s.project_id).length,
      sessionsNeedingTitles: sessionsNeedingTitles.length,
      projectsToCreate: projectSuggestions.length,
      movesToApply: moveSuggestions.length,
      titlesToUpdate: titleSuggestions.length
    },
    actions: {
      createProjects: projectSuggestions,
      moveSessions: moveSuggestions.slice(0, 200), // Limit batch size
      updateTitles: titleSuggestions.slice(0, 100)  // Limit batch size
    }
  };

  // Step 7: Output summary
  console.log('\n' + '─'.repeat(60));
  console.log('PLAN SUMMARY');
  console.log('─'.repeat(60));
  console.log(`Sessions analyzed: ${plan.summary.totalSessions}`);
  console.log(`Already in projects: ${plan.summary.sessionsWithProjects}`);
  console.log(`\nProposed actions:`);
  console.log(`  Create projects: ${plan.summary.projectsToCreate}`);
  console.log(`  Move sessions: ${plan.summary.movesToApply}`);
  console.log(`  Update titles: ${plan.summary.titlesToUpdate}`);

  if (projectSuggestions.length > 0) {
    console.log('\nProjects to create:');
    for (const p of projectSuggestions) {
      console.log(`  • ${p.name} (${p.sessionCount} sessions, $${p.totalCost.toFixed(2)})`);
    }
  }

  if (moveSuggestions.length > 0) {
    console.log('\nTop session moves:');
    for (const m of moveSuggestions.slice(0, 10)) {
      console.log(`  • "${m.sessionTitle?.slice(0, 30) || m.sessionId.slice(0, 8)}..." → ${m.suggestedProject}`);
    }
    if (moveSuggestions.length > 10) {
      console.log(`  ... and ${moveSuggestions.length - 10} more`);
    }
  }

  if (titleSuggestions.length > 0) {
    console.log('\nTop title updates:');
    for (const t of titleSuggestions.slice(0, 5)) {
      console.log(`  • "${t.currentTitle?.slice(0, 20) || '(none)'}..." → "${t.suggestedTitle.slice(0, 30)}..."`);
    }
    if (titleSuggestions.length > 5) {
      console.log(`  ... and ${titleSuggestions.length - 5} more`);
    }
  }

  // Step 8: Write plan to file
  const { writeFileSync } = await import('fs');
  writeFileSync(outputFile, JSON.stringify(plan, null, 2));
  console.log(`\n✓ Plan saved to: ${outputFile}`);

  console.log('\nTo apply this plan:');
  console.log(`  rudi apply ${outputFile}`);
  console.log('\nTo review the full plan:');
  console.log(`  cat ${outputFile} | jq .`);
}
