import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildArgs,
  getModelDef,
  loadProviderConfig,
  resolveModel,
} from '../../commands/agent/providers/index.js';

describe('codex provider model registry', () => {
  test('registers GPT-5.4 as a first-class model', () => {
    const config = loadProviderConfig('codex');

    assert.equal(resolveModel(config, 'gpt-5.4'), 'gpt-5.4');

    const def = getModelDef(config, 'gpt-5.4');
    assert.ok(def);
    assert.equal(def.id, 'gpt-5.4');
    assert.equal(def.alias, '5.4');
  });

  test('registers GPT-5.4 mini as a first-class model', () => {
    const config = loadProviderConfig('codex');

    assert.equal(resolveModel(config, 'gpt-5.4-mini'), 'gpt-5.4-mini');

    const def = getModelDef(config, 'gpt-5.4-mini');
    assert.ok(def);
    assert.equal(def.id, 'gpt-5.4-mini');
    assert.equal(def.alias, '5.4-mini');
  });

  test('passes GPT-5.4 through to codex exec args', () => {
    const config = loadProviderConfig('codex');
    const args = buildArgs(config, {
      prompt: 'hello',
      cwd: '/tmp',
      model: 'gpt-5.4',
    });

    assert.deepEqual(args, [
      'exec',
      'hello',
      '--json',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-C',
      '/tmp',
      '-m',
      'gpt-5.4',
    ]);
  });

  test('passes GPT-5.4 mini through to codex exec args', () => {
    const config = loadProviderConfig('codex');
    const args = buildArgs(config, {
      prompt: 'hello',
      cwd: '/tmp',
      model: 'gpt-5.4-mini',
    });

    assert.deepEqual(args, [
      'exec',
      'hello',
      '--json',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-C',
      '/tmp',
      '-m',
      'gpt-5.4-mini',
    ]);
  });
});
