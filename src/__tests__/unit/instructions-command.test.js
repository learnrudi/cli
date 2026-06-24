import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  RUDI_INSTRUCTIONS_BEGIN,
  RUDI_INSTRUCTIONS_END,
  buildInstalledRudiReferenceLines,
  buildRudiInstructionBlock,
  hasManagedInstructionBlock,
  normalizeInstructionAgent,
  patchManagedInstructionBlock,
  removeManagedInstructionBlock,
  resolveInstructionTarget,
} from '../../commands/instructions.js';

test('buildRudiInstructionBlock emits a bounded discover-first block', () => {
  const block = buildRudiInstructionBlock('codex');

  assert.match(block, new RegExp(RUDI_INSTRUCTIONS_BEGIN));
  assert.match(block, new RegExp(RUDI_INSTRUCTIONS_END));
  assert.match(block, /RUDI is a local tools, secrets, and MCP capability layer/);
  assert.match(block, /rudi list stacks --json/);
  assert.match(block, /Stack manifests may declare related skills/);
  assert.match(block, /--with-related-skills/);
  assert.match(block, /rudi integrate codex/);
  assert.doesNotMatch(block, /rudi mcp --list/);
});

test('buildRudiInstructionBlock includes installed SWE references when available', () => {
  const block = buildRudiInstructionBlock('codex', {
    installed: {
      stacks: [
        {
          id: 'stack:swe-engineering',
          description: 'Portable SWE Operating Manual reference and JS/TS agent debt scanning tools for engineering workflows',
        },
      ],
      skills: [
        {
          id: 'skill:swe-compliance-checklist',
          source: 'rudi',
          description: 'Create and execute phase-gated SWE Operating Manual compliance checklists for software changes',
        },
      ],
    },
  });

  assert.match(block, /Installed RUDI references/);
  assert.match(block, /`stack:swe-engineering`/);
  assert.match(block, /`skill:swe-compliance-checklist`/);
  assert.match(block, /swe_manual_read/);
  assert.match(block, /swe_debt_scan/);
});

test('buildInstalledRudiReferenceLines omits external skills and empty inventory', () => {
  assert.deepEqual(buildInstalledRudiReferenceLines(), []);

  const lines = buildInstalledRudiReferenceLines({
    skills: [
      { id: 'skill:local-rudi', source: 'rudi' },
      { id: 'skill:external-claude', source: 'claude' },
    ],
  });

  assert.equal(lines.some(line => line.includes('skill:local-rudi')), true);
  assert.equal(lines.some(line => line.includes('skill:external-claude')), false);
});

test('patchManagedInstructionBlock appends a managed block to existing content', () => {
  const existing = '# Existing Instructions\n\nKeep this line.\n';
  const result = patchManagedInstructionBlock(existing, buildRudiInstructionBlock('claude'));

  assert.equal(result.action, 'added');
  assert.equal(result.changed, true);
  assert.match(result.content, /# Existing Instructions/);
  assert.equal(hasManagedInstructionBlock(result.content), true);
});

test('patchManagedInstructionBlock replaces an existing managed block idempotently', () => {
  const old = [
    '# Existing Instructions',
    '',
    RUDI_INSTRUCTIONS_BEGIN,
    'old content',
    RUDI_INSTRUCTIONS_END,
    '',
  ].join('\n');

  const first = patchManagedInstructionBlock(old, buildRudiInstructionBlock('codex'));
  const second = patchManagedInstructionBlock(first.content, buildRudiInstructionBlock('codex'));

  assert.equal(first.action, 'updated');
  assert.equal(first.changed, true);
  assert.doesNotMatch(first.content, /old content/);
  assert.equal(second.action, 'none');
  assert.equal(second.changed, false);
});

test('removeManagedInstructionBlock removes only the managed block', () => {
  const existing = [
    '# Existing Instructions',
    '',
    buildRudiInstructionBlock('claude'),
    '',
    'Keep this line.',
    '',
  ].join('\n');

  const result = removeManagedInstructionBlock(existing);

  assert.equal(result.action, 'removed');
  assert.equal(result.changed, true);
  assert.match(result.content, /# Existing Instructions/);
  assert.match(result.content, /Keep this line/);
  assert.equal(hasManagedInstructionBlock(result.content), false);
});

test('resolveInstructionTarget maps global and project instruction files', () => {
  const env = {
    home: '/Users/test',
    cwd: '/Users/test/project',
  };

  assert.equal(
    resolveInstructionTarget('claude', {}, env),
    path.join('/Users/test', '.claude', 'CLAUDE.md')
  );
  assert.equal(
    resolveInstructionTarget('codex', {}, env),
    path.join('/Users/test', '.codex', 'AGENTS.md')
  );
  assert.equal(
    resolveInstructionTarget('codex', { project: true }, env),
    path.join('/Users/test/project', 'AGENTS.md')
  );
  assert.equal(
    resolveInstructionTarget('claude-code', { project: true }, env),
    path.join('/Users/test/project', 'CLAUDE.md')
  );
});

test('normalizeInstructionAgent keeps unknown targets generic', () => {
  assert.equal(normalizeInstructionAgent('claude-code'), 'claude');
  assert.equal(normalizeInstructionAgent('openai'), 'codex');
  assert.equal(normalizeInstructionAgent('cursor'), 'generic');
});
