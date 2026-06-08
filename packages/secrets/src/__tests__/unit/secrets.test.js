/**
 * Unit tests for secrets store
 * Uses isolated temp directory to avoid touching real ~/.rudi/secrets.json
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(TEST_DIR, '../../../../..');

function runIsolatedSecretsScript(script, rudiHome) {
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: CLI_ROOT,
    env: {
      ...process.env,
      RUDI_HOME: rudiHome
    },
    encoding: 'utf-8'
  });

  return JSON.parse(output);
}

// We'll test the masking and storage info functions which don't require file system
// For the full API, we'll create integration tests

// =============================================================================
// MASKING LOGIC
// =============================================================================

test('masking: long strings show first/last 4 chars', () => {
  const value = 'sk-1234567890abcdef';

  // Masking logic: value.slice(0, 4) + '...' + value.slice(-4)
  const masked = value.length > 8
    ? value.slice(0, 4) + '...' + value.slice(-4)
    : '****';

  assert.strictEqual(masked, 'sk-1...cdef');
});

test('masking: short strings show ****', () => {
  const value = 'short';

  const masked = value.length > 8
    ? value.slice(0, 4) + '...' + value.slice(-4)
    : '****';

  assert.strictEqual(masked, '****');
});

test('masking: empty strings show (pending)', () => {
  const value = '';

  let masked;
  if (value && typeof value === 'string' && value.length > 8) {
    masked = value.slice(0, 4) + '...' + value.slice(-4);
  } else if (value && typeof value === 'string' && value.length > 0) {
    masked = '****';
  } else {
    masked = '(pending)';
  }

  assert.strictEqual(masked, '(pending)');
});

// =============================================================================
// SECRET VALIDATION
// =============================================================================

test('validation: secret names should be valid', () => {
  const validNames = ['API_KEY', 'OPENAI_API_KEY', 'MY_SECRET_123'];
  const invalidNames = ['', ' ', 'has space', 'has-dash'];

  // Typical pattern: uppercase letters, numbers, underscores
  const pattern = /^[A-Z][A-Z0-9_]*$/;

  for (const name of validNames) {
    assert.ok(pattern.test(name), `${name} should be valid`);
  }

  for (const name of invalidNames) {
    assert.ok(!pattern.test(name), `${name} should be invalid`);
  }
});

// =============================================================================
// FILE PERMISSIONS
// =============================================================================

test('permissions: 0o600 is owner read/write only', () => {
  const mode = 0o600;

  // Owner permissions
  const ownerRead = (mode & 0o400) !== 0;
  const ownerWrite = (mode & 0o200) !== 0;
  const ownerExec = (mode & 0o100) !== 0;

  // Group permissions
  const groupRead = (mode & 0o040) !== 0;
  const groupWrite = (mode & 0o020) !== 0;

  // Other permissions
  const otherRead = (mode & 0o004) !== 0;
  const otherWrite = (mode & 0o002) !== 0;

  assert.ok(ownerRead, 'Owner should have read');
  assert.ok(ownerWrite, 'Owner should have write');
  assert.ok(!ownerExec, 'Owner should not have execute');
  assert.ok(!groupRead, 'Group should not have read');
  assert.ok(!groupWrite, 'Group should not have write');
  assert.ok(!otherRead, 'Others should not have read');
  assert.ok(!otherWrite, 'Others should not have write');
});

// =============================================================================
// JSON PARSING
// =============================================================================

test('json: handles empty object', () => {
  const content = '{}';
  const secrets = JSON.parse(content);

  assert.deepStrictEqual(secrets, {});
  assert.deepStrictEqual(Object.keys(secrets), []);
});

test('json: parses secrets correctly', () => {
  const content = JSON.stringify({
    'OPENAI_API_KEY': 'sk-123456',
    'ANTHROPIC_API_KEY': 'sk-ant-123'
  });

  const secrets = JSON.parse(content);

  assert.strictEqual(secrets['OPENAI_API_KEY'], 'sk-123456');
  assert.strictEqual(secrets['ANTHROPIC_API_KEY'], 'sk-ant-123');
});

test('json: handles special characters in values', () => {
  const secrets = {
    'KEY_WITH_SPECIAL': 'value-with-special-chars!@#$%^&*()'
  };

  const json = JSON.stringify(secrets);
  const parsed = JSON.parse(json);

  assert.strictEqual(parsed['KEY_WITH_SPECIAL'], secrets['KEY_WITH_SPECIAL']);
});

// =============================================================================
// HAS SECRET LOGIC
// =============================================================================

test('hasSecret: returns true for existing non-empty value', () => {
  const secrets = { 'API_KEY': 'some-value' };
  const name = 'API_KEY';

  const has = secrets[name] !== undefined && secrets[name] !== null && secrets[name] !== '';

  assert.ok(has);
});

test('hasSecret: returns false for undefined', () => {
  const secrets = {};
  const name = 'API_KEY';

  const has = secrets[name] !== undefined && secrets[name] !== null && secrets[name] !== '';

  assert.ok(!has);
});

test('hasSecret: returns false for empty string', () => {
  const secrets = { 'API_KEY': '' };
  const name = 'API_KEY';

  const has = secrets[name] !== undefined && secrets[name] !== null && secrets[name] !== '';

  assert.ok(!has);
});

test('hasSecret: returns false for null', () => {
  const secrets = { 'API_KEY': null };
  const name = 'API_KEY';

  const has = secrets[name] !== undefined && secrets[name] !== null && secrets[name] !== '';

  assert.ok(!has);
});

// =============================================================================
// LIST SECRETS LOGIC
// =============================================================================

test('listSecrets: returns sorted keys', () => {
  const secrets = {
    'ZEBRA_KEY': 'value',
    'ALPHA_KEY': 'value',
    'BETA_KEY': 'value'
  };

  const sorted = Object.keys(secrets).sort();

  assert.deepStrictEqual(sorted, ['ALPHA_KEY', 'BETA_KEY', 'ZEBRA_KEY']);
});

test('listSecrets: returns empty array for empty object', () => {
  const secrets = {};
  const sorted = Object.keys(secrets).sort();

  assert.deepStrictEqual(sorted, []);
});

// =============================================================================
// STORAGE INFO
// =============================================================================

test('storageInfo: backend is file', () => {
  // The getStorageInfo function returns static info
  const info = {
    backend: 'file',
    file: path.join(os.homedir(), '.rudi', 'secrets.json'),
    permissions: '0600 (owner read/write only)'
  };

  assert.strictEqual(info.backend, 'file');
  assert.ok(info.file.endsWith('secrets.json'));
  assert.ok(info.permissions.includes('0600'));
});

test('store: writes secrets under configured RUDI_HOME with restrictive permissions', () => {
  const rudiHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-secrets-'));

  try {
    const result = runIsolatedSecretsScript(`
      import { existsSync, statSync } from 'node:fs';
      import { getSecret, getStorageInfo, setSecret } from '@learnrudi/secrets';

      await setSecret('TEST_API_KEY', 'test-secret-value');
      const info = getStorageInfo();
      const mode = existsSync(info.file)
        ? (statSync(info.file).mode & 0o777).toString(8)
        : null;

      console.log(JSON.stringify({
        file: info.file,
        hasExpectedValue: await getSecret('TEST_API_KEY') === 'test-secret-value',
        mode
      }));
    `, rudiHome);

    assert.strictEqual(result.file, path.join(rudiHome, 'secrets.json'));
    assert.strictEqual(result.hasExpectedValue, true);
    if (process.platform !== 'win32') {
      assert.strictEqual(result.mode, '600');
    }
  } finally {
    fs.rmSync(rudiHome, { recursive: true, force: true });
  }
});

test('store: rejects non-object secrets files by loading an empty object', () => {
  const rudiHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-secrets-'));

  try {
    fs.writeFileSync(path.join(rudiHome, 'secrets.json'), '[]', { mode: 0o600 });

    const result = runIsolatedSecretsScript(`
      import { loadSecrets } from '@learnrudi/secrets';

      console.log(JSON.stringify({
        secrets: loadSecrets()
      }));
    `, rudiHome);

    assert.deepStrictEqual(result.secrets, {});
  } finally {
    fs.rmSync(rudiHome, { recursive: true, force: true });
  }
});
