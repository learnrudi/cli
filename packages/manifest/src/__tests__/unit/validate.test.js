/**
 * Unit tests for manifest validation
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  validateStack,
  validatePrompt,
  validateWorkflow,
  validateRuntime,
  validateManifest,
  stackSchema,
  promptSchema,
  workflowSchema,
  runtimeSchema
} from '../../validate.js';

// =============================================================================
// STACK VALIDATION
// =============================================================================

test('validateStack: accepts valid stack manifest', () => {
  const manifest = {
    id: 'stack:test',
    name: 'Test Stack',
    version: '1.0.0',
    description: 'A test stack'
  };

  const result = validateStack(manifest);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateStack: rejects missing id', () => {
  const manifest = {
    name: 'Test Stack',
    version: '1.0.0'
  };

  const result = validateStack(manifest);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('id')));
});

test('validateStack: rejects missing name', () => {
  const manifest = {
    id: 'stack:test',
    version: '1.0.0'
  };

  const result = validateStack(manifest);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('name')));
});

test('validateStack: rejects invalid id format', () => {
  const manifest = {
    id: 'Invalid ID With Spaces',
    name: 'Test'
  };

  const result = validateStack(manifest);
  assert.strictEqual(result.valid, false);
});

test('validateStack: accepts id without stack: prefix', () => {
  const manifest = {
    id: 'test-stack',
    name: 'Test Stack'
  };

  const result = validateStack(manifest);
  assert.strictEqual(result.valid, true);
});

test('validateStack: validates requires.secrets structure', () => {
  const manifest = {
    id: 'stack:test',
    name: 'Test Stack',
    requires: {
      secrets: [
        'SIMPLE_SECRET',
        { name: 'COMPLEX_SECRET', required: true, description: 'API key' }
      ]
    }
  };

  const result = validateStack(manifest);
  assert.strictEqual(result.valid, true);
});

test('validateStack: validates inputs structure', () => {
  const manifest = {
    id: 'stack:test',
    name: 'Test Stack',
    inputs: [
      { name: 'file', type: 'file', required: true },
      { name: 'format', type: 'select', options: ['pdf', 'html'] }
    ]
  };

  const result = validateStack(manifest);
  assert.strictEqual(result.valid, true);
});

// =============================================================================
// PROMPT VALIDATION
// =============================================================================

test('validatePrompt: accepts valid prompt manifest', () => {
  const manifest = {
    id: 'prompt:test',
    name: 'Test Prompt',
    description: 'A test prompt',
    category: 'coding'
  };

  const result = validatePrompt(manifest);
  assert.strictEqual(result.valid, true);
});

test('validatePrompt: rejects invalid category', () => {
  const manifest = {
    id: 'prompt:test',
    name: 'Test Prompt',
    category: 'invalid-category'
  };

  const result = validatePrompt(manifest);
  assert.strictEqual(result.valid, false);
});

test('validatePrompt: accepts valid categories', () => {
  const categories = ['coding', 'writing', 'analysis', 'creative'];

  for (const category of categories) {
    const manifest = {
      id: 'prompt:test',
      name: 'Test',
      category
    };

    const result = validatePrompt(manifest);
    assert.strictEqual(result.valid, true, `Should accept category: ${category}`);
  }
});

test('validatePrompt: validates variables structure', () => {
  const manifest = {
    id: 'prompt:test',
    name: 'Test Prompt',
    variables: [
      { name: 'topic', type: 'string', required: true },
      { name: 'style', type: 'select', options: ['formal', 'casual'] }
    ]
  };

  const result = validatePrompt(manifest);
  assert.strictEqual(result.valid, true);
});

// =============================================================================
// WORKFLOW VALIDATION
// =============================================================================

test('validateWorkflow: accepts valid workflow manifest', () => {
  const manifest = {
    id: 'workflow:daily-brief',
    name: 'Daily Brief',
    steps: [
      { id: 'collect', uses: 'stack:calendar' }
    ]
  };

  const result = validateWorkflow(manifest);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateWorkflow: requires executable steps', () => {
  const manifest = {
    id: 'workflow:daily-brief',
    name: 'Daily Brief',
    steps: [
      { id: 'collect' }
    ]
  };

  const result = validateWorkflow(manifest);
  assert.strictEqual(result.valid, false);
});

// =============================================================================
// RUNTIME VALIDATION
// =============================================================================

test('validateRuntime: accepts valid runtime manifest', () => {
  const manifest = {
    id: 'runtime:node',
    name: 'Node.js',
    version: '22.12.0'
  };

  const result = validateRuntime(manifest);
  assert.strictEqual(result.valid, true);
});

test('validateRuntime: validates binaries structure', () => {
  const manifest = {
    id: 'runtime:node',
    name: 'Node.js',
    binaries: [
      {
        platform: 'darwin-arm64',
        url: 'https://example.com/node.tar.gz',
        sha256: 'a'.repeat(64)
      }
    ]
  };

  const result = validateRuntime(manifest);
  assert.strictEqual(result.valid, true);
});

test('validateRuntime: rejects invalid sha256 format', () => {
  const manifest = {
    id: 'runtime:node',
    name: 'Node.js',
    binaries: [
      {
        platform: 'darwin-arm64',
        url: 'https://example.com/node.tar.gz',
        sha256: 'invalid-hash'
      }
    ]
  };

  const result = validateRuntime(manifest);
  assert.strictEqual(result.valid, false);
});

// =============================================================================
// AUTO DETECTION
// =============================================================================

test('validateManifest: auto-detects stack from id prefix', () => {
  const manifest = {
    id: 'stack:test',
    name: 'Test'
  };

  const result = validateManifest(manifest);
  assert.strictEqual(result.kind, 'stack');
  assert.strictEqual(result.valid, true);
});

test('validateManifest: auto-detects prompt from id prefix', () => {
  const manifest = {
    id: 'prompt:test',
    name: 'Test'
  };

  const result = validateManifest(manifest);
  assert.strictEqual(result.kind, 'prompt');
  assert.strictEqual(result.valid, true);
});

test('validateManifest: auto-detects runtime from id prefix', () => {
  const manifest = {
    id: 'runtime:node',
    name: 'Node.js'
  };

  const result = validateManifest(manifest);
  assert.strictEqual(result.kind, 'runtime');
  assert.strictEqual(result.valid, true);
});

test('validateManifest: auto-detects workflow from id prefix', () => {
  const manifest = {
    id: 'workflow:daily-brief',
    name: 'Daily Brief',
    steps: [
      { id: 'collect', run: 'rudi list stacks --json' }
    ]
  };

  const result = validateManifest(manifest);
  assert.strictEqual(result.kind, 'workflow');
  assert.strictEqual(result.valid, true);
});

test('validateManifest: uses explicit kind field', () => {
  const manifest = {
    id: 'test',
    kind: 'stack',
    name: 'Test'
  };

  const result = validateManifest(manifest);
  assert.strictEqual(result.kind, 'stack');
  assert.strictEqual(result.valid, true);
});

test('validateManifest: rejects non-object', () => {
  const result = validateManifest(null);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('object')));
});

test('validateManifest: rejects unknown kind', () => {
  const manifest = {
    id: 'unknown:test',
    name: 'Test'
  };

  const result = validateManifest(manifest);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('Unknown')));
});

// =============================================================================
// SCHEMA EXPORTS
// =============================================================================

test('schema: stackSchema has required fields', () => {
  assert.ok(stackSchema.required.includes('id'));
  assert.ok(stackSchema.required.includes('name'));
  assert.ok(stackSchema.properties.version);
  assert.ok(stackSchema.properties.requires);
});

test('schema: promptSchema has category enum', () => {
  assert.ok(promptSchema.properties.category);
  assert.ok(promptSchema.properties.category.enum.includes('coding'));
});

test('schema: workflowSchema requires steps', () => {
  assert.ok(workflowSchema.required.includes('steps'));
  assert.strictEqual(workflowSchema.properties.steps.type, 'array');
});

test('schema: runtimeSchema has binaries array', () => {
  assert.ok(runtimeSchema.properties.binaries);
  assert.strictEqual(runtimeSchema.properties.binaries.type, 'array');
});
