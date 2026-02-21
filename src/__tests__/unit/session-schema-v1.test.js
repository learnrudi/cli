import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';
import { createSessionsIngesterModule } from '../../commands/sessions/ingester.js';
import {
  RUDI_SCHEMA_NAMESPACE,
  RUDI_SCHEMA_VERSION,
  isSchemaEnvelopeCompatible,
  toSessionDocument,
  toTurnDocument,
  validateSessionDocument,
  validateTurnDocument,
} from '../../schema/rudi-session/v1/index.js';

function isoFor(n) {
  const ms = Date.parse('2026-02-18T00:00:00.000Z') + (n * 1000);
  return new Date(ms).toISOString();
}

function buildClaudeUsageTurn(turnNumber) {
  return [
    {
      type: 'user',
      uuid: `user-turn-${turnNumber}`,
      timestamp: isoFor(turnNumber * 2),
      message: { role: 'user', content: `User ${turnNumber}` },
    },
    {
      type: 'assistant',
      timestamp: isoFor(turnNumber * 2 + 1),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Assistant ${turnNumber}` }],
        model: 'claude-sonnet-4-5-20250929',
        usage: {
          input_tokens: 100 * turnNumber,
          output_tokens: 50 * turnNumber,
          cache_read_input_tokens: 10 * turnNumber,
          cache_creation_input_tokens: 5 * turnNumber,
        },
      },
    },
  ];
}

function buildClaudeCompactionTurn(turnNumber) {
  const entries = buildClaudeUsageTurn(turnNumber);
  entries.push({
    type: 'system',
    subtype: 'context_compaction',
    timestamp: isoFor(turnNumber * 2 + 2),
    compaction: {
      trigger: 'token_limit',
      preTokens: 180000,
      tokensSaved: 42000,
      compactedToolIds: ['toolu_schema_1'],
    },
  });
  return entries;
}

async function writeJsonl(filePath, entries) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf-8',
  );
}

async function withHarness(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-schema-v1-'));
  const dbPath = path.join(tmp, 'test.db');
  const claudeRoot = path.join(tmp, '.claude', 'projects');
  await fs.mkdir(claudeRoot, { recursive: true });

  const db = new Database(dbPath);
  initSchemaWithDb(db);

  const ingester = createSessionsIngesterModule({
    log: () => {},
    resolveDb: () => db,
    paths: {
      claudeProjectsDir: claudeRoot,
      codexSessionsDir: path.join(tmp, '.codex', 'sessions'),
    },
  });

  try {
    await fn({ db, ingester, claudeRoot });
  } finally {
    ingester.cleanup();
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('session and turn rows map to schema-v1 documents with valid required fields', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'schema-v1-basic';
    const filePath = path.join(claudeRoot, 'proj-a', `${sessionId}.jsonl`);
    const entries = [
      ...buildClaudeUsageTurn(1),
      ...buildClaudeUsageTurn(2),
    ];
    await writeJsonl(filePath, entries);
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const sessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    const turnRows = db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number ASC').all(sessionId);
    assert.ok(sessionRow, 'session row should exist');
    assert.strictEqual(turnRows.length, 2, 'two turns expected');

    const sessionDoc = toSessionDocument(sessionRow);
    assert.strictEqual(sessionDoc.schemaNamespace, RUDI_SCHEMA_NAMESPACE);
    assert.strictEqual(sessionDoc.schemaVersion, RUDI_SCHEMA_VERSION);
    assert.strictEqual(sessionDoc.kind, 'session');
    assert.strictEqual(sessionDoc.id, sessionId);
    assert.strictEqual(sessionDoc.metrics.turnCount, 2);
    assert.ok(sessionDoc.metrics.totalCostUsd > 0, 'session cost should be populated');
    assert.ok(validateSessionDocument(sessionDoc).ok, 'session document should validate');

    const turnDoc = toTurnDocument(turnRows[0]);
    assert.strictEqual(turnDoc.kind, 'turn');
    assert.strictEqual(turnDoc.turnNumber, 1);
    assert.strictEqual(turnDoc.content.userMessage, 'User 1');
    assert.strictEqual(turnDoc.content.assistantResponse, 'Assistant 1');
    assert.strictEqual(turnDoc.usage.inputTokens, 115);
    assert.strictEqual(turnDoc.usage.contextTokens, 115);
    assert.strictEqual(turnDoc.usage.outputTokens, 50);
    assert.ok(validateTurnDocument(turnDoc).ok, 'turn document should validate');
  });
});

test('compaction metadata flows into schema-v1 turn tooling payload', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'schema-v1-compaction';
    const filePath = path.join(claudeRoot, 'proj-b', `${sessionId}.jsonl`);
    await writeJsonl(filePath, buildClaudeCompactionTurn(1));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const turnRow = db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number DESC LIMIT 1').get(sessionId);
    assert.ok(turnRow, 'turn row should exist');
    const turnDoc = toTurnDocument(turnRow);

    assert.ok(turnDoc.tooling.compaction, 'compaction metadata should be present');
    assert.strictEqual(turnDoc.tooling.compaction.trigger, 'token_limit');
    assert.strictEqual(turnDoc.tooling.compaction.preTokens, 180000);
    assert.strictEqual(turnDoc.tooling.compaction.tokensSaved, 42000);
    assert.deepStrictEqual(turnDoc.tooling.compaction.compactedToolIds, ['toolu_schema_1']);
    assert.ok(validateTurnDocument(turnDoc).ok, 'turn document should validate');
  });
});

test('schema compatibility accepts v1 semver and rejects invalid/other-major versions', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'schema-v1-versioning';
    const filePath = path.join(claudeRoot, 'proj-c', `${sessionId}.jsonl`);
    await writeJsonl(filePath, buildClaudeUsageTurn(1));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const sessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    const turnRow = db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number DESC LIMIT 1').get(sessionId);
    assert.ok(sessionRow, 'session row should exist');
    assert.ok(turnRow, 'turn row should exist');

    const sessionDoc = toSessionDocument(sessionRow);
    const turnDoc = toTurnDocument(turnRow);

    for (const version of ['1.0.0', '1.1.0', '1.9.9']) {
      const sessionCandidate = { ...sessionDoc, schemaVersion: version };
      const turnCandidate = { ...turnDoc, schemaVersion: version };
      assert.ok(
        validateSessionDocument(sessionCandidate).ok,
        `session should accept ${version}`,
      );
      assert.ok(
        validateTurnDocument(turnCandidate).ok,
        `turn should accept ${version}`,
      );
      assert.ok(
        isSchemaEnvelopeCompatible(sessionCandidate, 'session'),
        `session envelope should be compatible for ${version}`,
      );
      assert.ok(
        isSchemaEnvelopeCompatible(turnCandidate, 'turn'),
        `turn envelope should be compatible for ${version}`,
      );
    }

    for (const version of ['1.0', 'foo', '2.0.0']) {
      const sessionCandidate = { ...sessionDoc, schemaVersion: version };
      const turnCandidate = { ...turnDoc, schemaVersion: version };
      assert.ok(
        !validateSessionDocument(sessionCandidate).ok,
        `session should reject ${version}`,
      );
      assert.ok(
        !validateTurnDocument(turnCandidate).ok,
        `turn should reject ${version}`,
      );
      assert.ok(
        !isSchemaEnvelopeCompatible(sessionCandidate, 'session'),
        `session envelope should reject ${version}`,
      );
      assert.ok(
        !isSchemaEnvelopeCompatible(turnCandidate, 'turn'),
        `turn envelope should reject ${version}`,
      );
    }

    const badNamespaceSession = {
      ...sessionDoc,
      schemaNamespace: 'io.rudi.session.v2',
      schemaVersion: RUDI_SCHEMA_VERSION,
    };
    assert.ok(!validateSessionDocument(badNamespaceSession).ok);
    assert.ok(!isSchemaEnvelopeCompatible(badNamespaceSession, 'session'));
    assert.strictEqual(
      isSchemaEnvelopeCompatible({ ...turnDoc, kind: 'session' }, 'turn'),
      false,
      'kind mismatch should fail compatibility check',
    );
  });
});
