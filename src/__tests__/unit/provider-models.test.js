import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildArgs,
  getApprovalArgs,
  getModelDef,
  hasCapability,
  isExternalAgentBinaryPath,
  listProviders,
  loadProviderConfig,
  resolveProviderBinary,
  resolveModel,
} from '../../agent-host/providers/catalog.js';

describe('frontier agent provider registry', () => {
  test('registers all native frontier host contracts', () => {
    assert.deepEqual(listProviders(), ['claude', 'codex', 'gemini', 'antigravity']);
  });

  test('resolves every frontier host from vendor or system locations only', () => {
    const expectedUserLocalPaths = {
      antigravity: '~/.local/bin/agy',
      claude: '~/.local/bin/claude',
      codex: '~/.local/bin/codex',
      gemini: '~/.local/bin/gemini',
    };

    for (const provider of listProviders()) {
      const resolvePaths = loadProviderConfig(provider).binary.resolvePaths;
      assert.equal(resolvePaths[0], expectedUserLocalPaths[provider]);
      assert.equal(resolvePaths.some(candidate => candidate.includes('/.rudi/')), false);
    }
  });

  test('rejects legacy RUDI agent paths even when PATH fallback finds them', () => {
    const home = '/Users/example';
    assert.equal(isExternalAgentBinaryPath(`${home}/.local/bin/codex`, { home }), true);
    assert.equal(isExternalAgentBinaryPath(`${home}/.rudi/bins/codex`, { home }), false);
    assert.equal(isExternalAgentBinaryPath(`${home}/.rudi/runtimes/node/bin/codex`, { home }), false);
    assert.equal(isExternalAgentBinaryPath('codex', { home }), false);
    assert.equal(isExternalAgentBinaryPath('/opt/rudi-owned/bin/codex', {
      home,
      rudiHome: '/opt/rudi-owned',
    }), false);

    const resolved = resolveProviderBinary({
      binary: { name: 'codex', resolvePaths: [], fallback: 'which' },
    }, {
      home,
      runCommandPlanImpl: () => `${home}/.rudi/bins/codex\n`,
    });
    assert.equal(resolved, null);

    const symlinked = resolveProviderBinary({
      binary: { name: 'codex', resolvePaths: [], fallback: 'which' },
    }, {
      home,
      realpathSyncImpl: candidate => candidate.endsWith('/.local/bin/codex')
        ? `${home}/.rudi/agents/codex/bin/codex`
        : candidate,
      runCommandPlanImpl: () => `${home}/.local/bin/codex\n`,
    });
    assert.equal(symlinked, null);
  });

  test('skips non-executable files that mask a usable vendor binary', () => {
    const home = '/Users/example';
    const first = `${home}/.local/bin/codex`;
    const second = '/opt/homebrew/bin/codex';
    const resolved = resolveProviderBinary({
      binary: {
        name: 'codex',
        resolvePaths: ['~/.local/bin/codex', second],
        fallback: null,
      },
    }, {
      accessSyncImpl(candidate) {
        if (candidate === first) throw new Error('not executable');
      },
      existsSyncImpl: () => true,
      home,
      realpathSyncImpl: candidate => candidate,
    });

    assert.equal(resolved, second);
  });

  test('registers the current Claude frontier aliases', () => {
    const config = loadProviderConfig('claude');

    assert.equal(config.models.default, 'claude-opus-5');
    assert.equal(resolveModel(config, 'fable'), 'claude-fable-5');
    assert.equal(resolveModel(config, 'opus'), 'claude-opus-5');
    assert.equal(resolveModel(config, 'sonnet'), 'claude-sonnet-5');
    assert.equal(resolveModel(config, 'haiku'), 'claude-haiku-4-5-20251001');
    assert.equal(hasCapability(config, 'subagents'), true);
    assert.equal(hasCapability(config, 'skills'), true);
    assert.equal(hasCapability(config, 'rawArgs'), true);
  });

  test('uses current Codex aliases while retaining exact previous-generation IDs', () => {
    const config = loadProviderConfig('codex');

    assert.equal(config.models.default, 'gpt-6.1-sol');
    assert.equal(resolveModel(config, 'sol'), 'gpt-6.1-sol');
    assert.equal(resolveModel(config, 'astra'), 'gpt-6-astra');
    assert.equal(resolveModel(config, 'terra'), 'gpt-5.6-terra');
    assert.equal(resolveModel(config, 'luna'), 'gpt-6-luna');
    for (const id of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-sol']) {
      assert.equal(getModelDef(config, id)?.id, id);
    }
    assert.deepEqual(config.models.available.filter(model => model.default).map(model => model.id), ['gpt-6.1-sol']);
    assert.equal(getModelDef(config, 'sol')?.alias, 'sol');
    assert.equal(hasCapability(config, 'subagents'), true);
    assert.equal(hasCapability(config, 'forkSession'), true);
    assert.equal(hasCapability(config, 'skills'), true);
    assert.equal(hasCapability(config, 'rawArgs'), true);
  });

  test('passes the current Codex model and workspace through to codex exec', () => {
    const config = loadProviderConfig('codex');
    const args = buildArgs(config, {
      prompt: 'hello',
      cwd: '/tmp',
      model: 'gpt-5.6-sol',
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
      'gpt-5.6-sol',
    ]);
  });

  test('describes the current Gemini CLI and Antigravity launch surfaces', () => {
    const gemini = loadProviderConfig('gemini');
    const antigravity = loadProviderConfig('antigravity');

    assert.equal(gemini.binary.name, 'gemini');
    assert.equal(gemini.headless.promptDelivery, 'arg-or-stdin');
    assert.equal(gemini.models.default, 'auto');
    assert.equal(resolveModel(gemini, 'pro'), 'gemini-3.1-pro-preview');
    assert.equal(resolveModel(gemini, 'flash'), 'gemini-3.6-flash');
    assert.equal(resolveModel(gemini, 'flash-lite'), 'gemini-3.5-flash-lite');
    assert.equal(hasCapability(gemini, 'skills'), true);
    assert.equal(hasCapability(gemini, 'subagents'), true);

    assert.equal(antigravity.binary.name, 'agy');
    assert.equal(antigravity.headless.promptDelivery, 'arg');
    assert.equal(hasCapability(antigravity, 'skills'), true);
    assert.equal(hasCapability(antigravity, 'subagents'), true);
    assert.equal(hasCapability(antigravity, 'imageGeneration'), true);
  });

  test('appends validated raw vendor arguments after modeled arguments', () => {
    const config = loadProviderConfig('codex');
    const args = buildArgs(config, {
      prompt: 'hello',
      extraArgs: ['--enable', 'plugins'],
    });

    assert.deepEqual(args.slice(-2), ['--enable', 'plugins']);
  });

  test('places Codex global flags before the exec subcommand', () => {
    const config = loadProviderConfig('codex');
    const args = buildArgs(config, {
      prompt: 'hello',
      approvalPolicy: 'never',
      search: true,
      globalExtraArgs: ['--strict-config'],
    });

    assert.deepEqual(args.slice(0, 6), [
      '--strict-config',
      '--ask-for-approval',
      'never',
      '--search',
      'exec',
      'hello',
    ]);
    assert.deepEqual(getApprovalArgs(config, 'never'), [
      '-c',
      'approval_policy="never"',
    ]);
  });

  test('rejects malformed raw vendor arguments before launch', () => {
    const config = loadProviderConfig('codex');

    assert.throws(
      () => buildArgs(config, { prompt: 'hello', extraArgs: '--enable plugins' }),
      /extraArgs must be an array/,
    );
    assert.throws(
      () => buildArgs(config, { prompt: 'hello', extraArgs: ['ok', 'bad\0arg'] }),
      /extraArgs\[1\]/,
    );
    assert.throws(
      () => buildArgs(config, { prompt: 'hello', globalExtraArgs: [''] }),
      /globalExtraArgs\[0\]/,
    );
  });
});
