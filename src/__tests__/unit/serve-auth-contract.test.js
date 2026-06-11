import { after, describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMockCtx, createMockReq, createMockRes, parseResBody } from '../helpers/serve-mocks.js';

const ORIGINAL_ENV = {
  RUDI_HOME: process.env.RUDI_HOME,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
};

const TEST_RUDI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-auth-route-'));
process.env.RUDI_HOME = TEST_RUDI_HOME;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.OPENAI_API_KEY;
delete process.env.CODEX_API_KEY;

const importId = `${process.pid}-${Date.now()}`;
const { buildAuthRoutes } = await import(`../../commands/serve/routes/auth.js?test=${importId}`);
const { checkClaudeCredential } = await import(`../../commands/agent/auth/claude.js?test=${importId}`);
const { checkCodexCredential } = await import(`../../commands/agent/auth/codex.js?test=${importId}`);
const { setSecret } = await import('@learnrudi/secrets');

after(() => {
  fs.rmSync(TEST_RUDI_HOME, { recursive: true, force: true });

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function resetCredentialState() {
  fs.rmSync(path.join(TEST_RUDI_HOME, '.env'), { force: true });
  fs.rmSync(path.join(TEST_RUDI_HOME, 'secrets.json'), { force: true });
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_API_KEY;
}

function readSecretsFile() {
  return JSON.parse(fs.readFileSync(path.join(TEST_RUDI_HOME, 'secrets.json'), 'utf-8'));
}

async function callAuthRoute(method, pathname, body) {
  const { handle } = buildAuthRoutes(createMockCtx());
  const { req, url } = createMockReq(method, pathname, { body });
  const res = createMockRes();

  await handle(req, res, url);

  return res;
}

describe('buildAuthRoutes credential storage contracts', { concurrency: false }, () => {
  test('POST /auth/login stores API keys in the secrets store without writing .env', async () => {
    resetCredentialState();

    const res = await callAuthRoute('POST', '/auth/login', {
      provider: 'claude',
      apiKey: 'sk-ant-api-route-test',
    });

    assert.strictEqual(res.state.statusCode, 200);
    assert.deepStrictEqual(parseResBody(res), { ok: true });
    assert.strictEqual(fs.existsSync(path.join(TEST_RUDI_HOME, '.env')), false);
    assert.strictEqual(readSecretsFile().ANTHROPIC_API_KEY, 'sk-ant-api-route-test');
    assert.strictEqual(process.env.ANTHROPIC_API_KEY, 'sk-ant-api-route-test');
  });

  test('POST /auth/login stores OAuth tokens in the secrets store without writing .env', async () => {
    resetCredentialState();

    const res = await callAuthRoute('POST', '/auth/login', {
      provider: 'claude',
      oauthToken: 'sk-ant-oat-route-test',
    });

    assert.strictEqual(res.state.statusCode, 200);
    assert.deepStrictEqual(parseResBody(res), { ok: true });
    assert.strictEqual(fs.existsSync(path.join(TEST_RUDI_HOME, '.env')), false);
    assert.strictEqual(readSecretsFile().CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat-route-test');
    assert.strictEqual(process.env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat-route-test');
  });

  test('checkClaudeCredential reads Claude credentials from the RUDI secrets store', async () => {
    resetCredentialState();
    await setSecret('ANTHROPIC_API_KEY', 'sk-ant-secret-store-test');
    delete process.env.ANTHROPIC_API_KEY;

    assert.deepStrictEqual(checkClaudeCredential(), {
      authenticated: true,
      method: 'api-key',
    });
    assert.strictEqual(process.env.ANTHROPIC_API_KEY, 'sk-ant-secret-store-test');
  });

  test('POST /auth/login stores Codex API keys in the secrets store without writing .env', async () => {
    resetCredentialState();

    const res = await callAuthRoute('POST', '/auth/login', {
      provider: 'codex',
      apiKey: 'sk-openai-route-test',
    });

    assert.strictEqual(res.state.statusCode, 200);
    assert.deepStrictEqual(parseResBody(res), { ok: true });
    assert.strictEqual(fs.existsSync(path.join(TEST_RUDI_HOME, '.env')), false);
    assert.strictEqual(readSecretsFile().OPENAI_API_KEY, 'sk-openai-route-test');
    assert.strictEqual(readSecretsFile().ANTHROPIC_API_KEY, undefined);
    assert.strictEqual(process.env.OPENAI_API_KEY, 'sk-openai-route-test');
  });

  test('checkCodexCredential reads Codex credentials from the RUDI secrets store', async () => {
    resetCredentialState();
    await setSecret('OPENAI_API_KEY', 'sk-openai-secret-store-test');
    delete process.env.OPENAI_API_KEY;

    assert.deepStrictEqual(checkCodexCredential(), {
      authenticated: true,
      method: 'api-key',
    });
    assert.strictEqual(process.env.OPENAI_API_KEY, 'sk-openai-secret-store-test');
  });
});
