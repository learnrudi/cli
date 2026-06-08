import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getSecretName, isSecretRequired } from '../../commands/install.js';

test('install secret helpers normalize supported secret definitions', () => {
  assert.equal(getSecretName('OPENAI_API_KEY'), 'OPENAI_API_KEY');
  assert.equal(getSecretName({ name: 'SLACK_BOT_TOKEN' }), 'SLACK_BOT_TOKEN');
  assert.equal(getSecretName({ key: 'GOOGLE_CREDENTIALS' }), 'GOOGLE_CREDENTIALS');
  assert.equal(getSecretName(null), null);
  assert.equal(getSecretName({ required: true }), null);
});

test('install secret helpers preserve required semantics', () => {
  assert.equal(isSecretRequired('OPENAI_API_KEY'), true);
  assert.equal(isSecretRequired({ name: 'OPTIONAL_TOKEN', required: false }), false);
  assert.equal(isSecretRequired({ key: 'REQUIRED_TOKEN', required: true }), true);
  assert.equal(isSecretRequired(null), true);
});
