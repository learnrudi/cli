/**
 * Unit tests for runner secret access
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(TEST_DIR, '../../../../..');

function runIsolatedRunnerScript(script, rudiHome) {
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

test('runner secrets use the shared RUDI_HOME-backed secrets store', () => {
  const rudiHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-runner-secrets-'));

  try {
    const result = runIsolatedRunnerScript(`
      import { setSecret as setSharedSecret, getStorageInfo } from '@learnrudi/secrets';
      import {
        checkSecrets,
        getSecrets,
        listSecretNames,
        redactSecrets
      } from '@learnrudi/runner/secrets';

      await setSharedSecret('RUNNER_SHARED_SECRET', 'runner-secret-value');

      const readiness = checkSecrets([
        { name: 'RUNNER_SHARED_SECRET' },
        { name: 'OPTIONAL_MISSING', required: false },
        { name: 'MISSING_REQUIRED' }
      ]);
      const resolved = await getSecrets([
        'RUNNER_SHARED_SECRET',
        { name: 'OPTIONAL_MISSING', required: false }
      ]);

      let missingError = null;
      try {
        await getSecrets(['MISSING_REQUIRED']);
      } catch (error) {
        missingError = error instanceof Error ? error.message : String(error);
      }

      console.log(JSON.stringify({
        file: getStorageInfo().file,
        hasSharedSecret: resolved.RUNNER_SHARED_SECRET === 'runner-secret-value',
        names: listSecretNames(),
        readiness,
        redacted: redactSecrets('value runner-secret-value', resolved),
        missingError
      }));
    `, rudiHome);

    assert.strictEqual(result.file, path.join(rudiHome, 'secrets.json'));
    assert.strictEqual(result.hasSharedSecret, true);
    assert.deepStrictEqual(result.names, ['RUNNER_SHARED_SECRET']);
    assert.deepStrictEqual(result.readiness, {
      satisfied: false,
      missing: ['MISSING_REQUIRED']
    });
    assert.strictEqual(result.redacted, 'value [REDACTED]');
    assert.strictEqual(result.missingError, 'Missing required secret: MISSING_REQUIRED');
  } finally {
    fs.rmSync(rudiHome, { recursive: true, force: true });
  }
});
