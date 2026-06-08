import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSecretStatus,
  getSecretsReadiness,
  listMaskedSecrets,
  listSecretStatuses,
} from '../../daemon/operations/secrets.js';
import {
  validateSecretStatus,
} from '../../daemon/schemas/index.js';

const checkedAt = '2026-05-17T12:00:00.000Z';

test('listMaskedSecrets preserves the legacy masked secret map', async () => {
  const masked = await listMaskedSecrets({
    async getMaskedSecrets() {
      return {
        API_TOKEN: 'abcd...1234',
        PENDING_TOKEN: '(pending)',
      };
    },
  });

  assert.deepEqual(masked, {
    API_TOKEN: 'abcd...1234',
    PENDING_TOKEN: '(pending)',
  });
});

test('listSecretStatuses combines metadata, stack requirements, and masked storage without values', async () => {
  const statuses = await listSecretStatuses({
    checkedAt,
    config: {
      secrets: {
        OPENAI_API_KEY: { configured: false, provider: 'secrets.json' },
        OPTIONAL_KEY: { configured: true, provider: 'keychain' },
      },
      stacks: {
        'stack:images': {
          secrets: [
            { name: 'OPENAI_API_KEY', required: true },
            { name: 'OPTIONAL_KEY', required: false },
            'LEGACY_TOKEN',
          ],
        },
        'stack:mail': {
          secrets: [{ name: 'OPENAI_API_KEY', required: true }],
        },
      },
    },
    maskedSecrets: {
      OPENAI_API_KEY: '(pending)',
      OPTIONAL_KEY: 'opti...abcd',
      EXTRA_TOKEN: 'extr...0000',
    },
    storageInfo: { backend: 'file' },
  });

  assert.deepEqual(statuses, [
    {
      name: 'EXTRA_TOKEN',
      configured: true,
      requiredFor: [],
      optionalFor: [],
      source: 'secrets.json',
      lastCheckedAt: checkedAt,
    },
    {
      name: 'LEGACY_TOKEN',
      configured: false,
      requiredFor: ['stack:images'],
      optionalFor: [],
      source: 'unknown',
      lastCheckedAt: checkedAt,
    },
    {
      name: 'OPENAI_API_KEY',
      configured: false,
      requiredFor: ['stack:images', 'stack:mail'],
      optionalFor: [],
      source: 'secrets.json',
      lastCheckedAt: checkedAt,
    },
    {
      name: 'OPTIONAL_KEY',
      configured: true,
      requiredFor: [],
      optionalFor: ['stack:images'],
      source: 'keychain',
      lastCheckedAt: checkedAt,
    },
  ]);

  for (const status of statuses) {
    assert.deepEqual(validateSecretStatus(status), { ok: true, errors: [] });
    assert.equal(Object.hasOwn(status, 'value'), false);
    assert.equal(Object.hasOwn(status, 'maskedValue'), false);
  }
});

test('createSecretStatus reports env readiness without exposing env values', () => {
  const status = createSecretStatus('ENV_TOKEN', {
    checkedAt,
    env: { ENV_TOKEN: 'super-secret' },
    metadata: { provider: 'env' },
    maskedSecrets: {},
  });

  assert.deepEqual(status, {
    name: 'ENV_TOKEN',
    configured: true,
    requiredFor: [],
    optionalFor: [],
    source: 'env',
    lastCheckedAt: checkedAt,
  });
});

test('getSecretsReadiness reports missing required secrets by name only', async () => {
  const readiness = await getSecretsReadiness({
    checkedAt,
    config: {
      stacks: {
        'stack:images': {
          secrets: [
            { name: 'OPENAI_API_KEY', required: true },
            { name: 'OPTIONAL_KEY', required: false },
          ],
        },
      },
    },
    maskedSecrets: {
      OPENAI_API_KEY: '(pending)',
      OPTIONAL_KEY: 'opti...abcd',
    },
    storageInfo: { backend: 'file' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.total, 2);
  assert.equal(readiness.configured, 1);
  assert.equal(readiness.pending, 1);
  assert.deepEqual(readiness.missingRequired, ['OPENAI_API_KEY']);
});
