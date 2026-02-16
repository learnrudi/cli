import { test } from 'node:test';
import assert from 'node:assert';
import { createSessionsModule } from '../../commands/serve/sessions.js';

function createMockDb(rows) {
  return {
    prepare(sql) {
      if (
        sql.includes('FROM sessions')
        && sql.includes('ORDER BY last_active_at DESC')
      ) {
        return {
          all() {
            return rows;
          },
        };
      }
      throw new Error(`Unexpected SQL in test mock: ${sql}`);
    },
  };
}

function createMockRes() {
  const state = {
    statusCode: 0,
    headers: {},
    body: '',
  };
  return {
    state,
    writeHead(code, headers) {
      state.statusCode = code;
      state.headers = headers || {};
    },
    end(chunk = '') {
      state.body += String(chunk || '');
    },
  };
}

test('sessions/projects DB contract maps Codex provider_session_id to sessionId for sidebar', async () => {
  const codexProviderSid = '019b5250-f493-7dd2-adb8-686ade141937';
  const dbRows = [
    {
      id: 'claude-session-abc',
      provider: 'claude',
      provider_session_id: 'claude-session-abc',
      title: 'Claude title',
      title_override: null,
      snippet: 'Claude prompt',
      cwd: '/Users/hoff/dev/RUDI',
      project_path: '/Users/hoff/dev/RUDI',
      origin_native_file: '/Users/hoff/.claude/projects/users-hoff-dev-RUDI/claude-session-abc.jsonl',
      total_cost: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      turn_count: 0,
      model: null,
      git_branch: null,
      last_active_at: '2026-02-15T10:00:00.000Z',
      created_at: '2026-02-15T09:00:00.000Z',
      parent_session_id: null,
      is_sidechain: 0,
      session_type: 'main',
      origin: 'provider-import',
      status: 'active',
    },
    {
      id: 'rudi-codex-row-id',
      provider: 'codex',
      provider_session_id: codexProviderSid,
      title: null,
      title_override: null,
      snippet: 'Codex prompt',
      cwd: '/Users/hoff/dev/RUDI',
      project_path: '/Users/hoff/dev/RUDI',
      origin_native_file: `/Users/hoff/.codex/sessions/2026/02/15/rollout-2026-02-15T10-00-00-${codexProviderSid}.jsonl`,
      total_cost: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      turn_count: 0,
      model: null,
      git_branch: null,
      last_active_at: '2026-02-15T10:05:00.000Z',
      created_at: '2026-02-15T09:30:00.000Z',
      parent_session_id: null,
      is_sidechain: 0,
      session_type: 'main',
      origin: 'provider-import',
      status: 'active',
    },
    {
      id: 'codex-legacy-fallback-id',
      provider: 'codex',
      provider_session_id: null,
      title: null,
      title_override: null,
      snippet: 'Legacy codex',
      cwd: '/Users/hoff/dev/RUDI',
      project_path: '/Users/hoff/dev/RUDI',
      origin_native_file: '/Users/hoff/.codex/sessions/2026/02/15/codex-legacy-fallback-id.jsonl',
      total_cost: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      turn_count: 0,
      model: null,
      git_branch: null,
      last_active_at: '2026-02-15T10:06:00.000Z',
      created_at: '2026-02-15T09:35:00.000Z',
      parent_session_id: null,
      is_sidechain: 0,
      session_type: 'main',
      origin: 'provider-import',
      status: 'active',
    },
  ];

  const db = createMockDb(dbRows);
  const sessionsModule = createSessionsModule({
    log: () => {},
    broadcast: () => {},
    json: (res, payload) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    },
    error: (res, message, code = 500) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    },
    readBody: async () => ({}),
    getProjectGitStatus: () => null,
    resolveDb: () => db,
  });

  sessionsModule.enableDbSpine();

  const req = { method: 'GET', headers: {} };
  const res = createMockRes();
  const url = new URL('http://localhost/sessions/projects?source=db');

  try {
    const handled = await sessionsModule.handleSessions(req, res, url);
    assert.strictEqual(handled, true);
    assert.strictEqual(res.state.statusCode, 200);

    const parsed = JSON.parse(res.state.body);
    assert.ok(Array.isArray(parsed.projects));
    assert.strictEqual(parsed.projects.length, 1);

    const sessions = parsed.projects[0].sessions;
    assert.strictEqual(sessions.length, 3);

    const claude = sessions.find((s) => s.provider === 'claude');
    assert.ok(claude);
    assert.strictEqual(claude.sessionId, 'claude-session-abc');
    assert.ok(typeof claude.originNativeFile === 'string' && claude.originNativeFile.includes('/.claude/projects/'));

    const codexCanonical = sessions.find((s) => s.provider === 'codex' && s.sessionId === codexProviderSid);
    assert.ok(codexCanonical);
    assert.ok(typeof codexCanonical.originNativeFile === 'string' && codexCanonical.originNativeFile.includes('/.codex/sessions/'));

    const codexFallback = sessions.find((s) => s.provider === 'codex' && s.sessionId === 'codex-legacy-fallback-id');
    assert.ok(codexFallback);
  } finally {
    sessionsModule.cleanup();
  }
});
