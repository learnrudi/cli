import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  listRunGroupTemplates,
  loadRunGroupTemplate,
  resolveTemplateToRunGroupBody,
} from '../../commands/agent/templates.js';

describe('listRunGroupTemplates', () => {
  it('finds repo templates', () => {
    const templates = listRunGroupTemplates();
    assert.ok(Array.isArray(templates), 'should return an array');
    assert.ok(templates.length >= 4, 'should find at least 4 repo templates');

    const codeReview = templates.find((t) => t.name === 'code-review-3task');
    assert.ok(codeReview, 'should find code-review-3task template');
    assert.strictEqual(codeReview.source, 'repo', 'code-review-3task source should be repo');
    assert.ok(
      typeof codeReview.description === 'string' && codeReview.description.length > 0,
      'code-review-3task should have non-empty description'
    );

    const parallelBuild = templates.find((t) => t.name === 'parallel-build-2task');
    assert.ok(parallelBuild, 'should find parallel-build-2task template');
    assert.strictEqual(parallelBuild.source, 'repo', 'parallel-build-2task source should be repo');
    assert.ok(
      typeof parallelBuild.description === 'string' && parallelBuild.description.length > 0,
      'parallel-build-2task should have non-empty description'
    );

    const vendorEval = templates.find((t) => t.name === 'vendor-eval-3task');
    assert.ok(vendorEval, 'should find vendor-eval-3task template');
    assert.strictEqual(vendorEval.source, 'repo', 'vendor-eval-3task source should be repo');
    assert.ok(
      typeof vendorEval.description === 'string' && vendorEval.description.length > 0,
      'vendor-eval-3task should have non-empty description'
    );

    const meetingPrep = templates.find((t) => t.name === 'meeting-prep-3task');
    assert.ok(meetingPrep, 'should find meeting-prep-3task template');
    assert.strictEqual(meetingPrep.source, 'repo', 'meeting-prep-3task source should be repo');
    assert.ok(
      typeof meetingPrep.description === 'string' && meetingPrep.description.length > 0,
      'meeting-prep-3task should have non-empty description'
    );
  });

  it('returns sorted list', () => {
    const templates = listRunGroupTemplates();
    const names = templates.map((t) => t.name);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(names, sortedNames, 'template names should be sorted');
  });
});

describe('loadRunGroupTemplate', () => {
  it('loads by name without extension', () => {
    const template = loadRunGroupTemplate('code-review-3task');
    assert.ok(template, 'should return a template object');
    assert.ok(Array.isArray(template.tasks), 'should have tasks array');
    assert.strictEqual(template.tasks.length, 3, 'code-review-3task should have 3 tasks');
    assert.ok(template.name, 'should have name property');
    assert.ok(template.templatePath, 'should have templatePath property');
  });

  it('loads by name with .json extension', () => {
    const template = loadRunGroupTemplate('parallel-build-2task.json');
    assert.ok(template, 'should return a template object');
    assert.ok(Array.isArray(template.tasks), 'should have tasks array');
    assert.strictEqual(template.tasks.length, 2, 'parallel-build-2task should have 2 tasks');
    assert.ok(template.name, 'should have name property');
    assert.ok(template.templatePath, 'should have templatePath property');
  });

  it('loads non-code dependency template', () => {
    const template = loadRunGroupTemplate('vendor-eval-3task');
    assert.ok(template, 'should return a template object');
    assert.ok(Array.isArray(template.tasks), 'should have tasks array');
    assert.strictEqual(template.tasks.length, 3, 'vendor-eval-3task should have 3 tasks');
    assert.strictEqual(template.tasks[2].dependencies.length, 2, 'synthesis task should depend on both research tasks');
  });

  it('throws for missing template', () => {
    assert.throws(
      () => loadRunGroupTemplate('nonexistent-template'),
      /not found/,
      'should throw error with "not found" message'
    );
  });

  it('throws for empty name', () => {
    assert.throws(
      () => loadRunGroupTemplate(''),
      /template name required/,
      'should throw error for empty name'
    );
  });
});

describe('resolveTemplateToRunGroupBody', () => {
  it('merges template with defaults', () => {
    const template = loadRunGroupTemplate('code-review-3task');
    const body = resolveTemplateToRunGroupBody(template);

    assert.ok(body, 'should return a body object');
    assert.ok(Array.isArray(body.tasks), 'should have tasks array');
    assert.strictEqual(body.tasks.length, 3, 'should preserve 3 tasks from template');
    assert.strictEqual(body.provider, 'claude', 'should default provider to claude');
    assert.strictEqual(body.executionMode, 'read_only', 'should preserve template executionMode');
    assert.strictEqual(body.useWorktree, true, 'should default useWorktree to true');
    assert.strictEqual(body.coordinationMode, 'dependency', 'should preserve template coordinationMode');
  });

  it('applies overrides', () => {
    const template = loadRunGroupTemplate('parallel-build-2task');
    const body = resolveTemplateToRunGroupBody(template, {
      name: 'custom',
      provider: 'gemini',
      model: 'pro',
    });

    assert.strictEqual(body.name, 'custom', 'override name should take effect');
    assert.strictEqual(body.provider, 'gemini', 'override provider should take effect');
    assert.strictEqual(body.model, 'pro', 'override model should take effect');
    assert.ok(Array.isArray(body.tasks), 'should still have tasks array');
  });

  it('preserves template tasks', () => {
    const template = loadRunGroupTemplate('code-review-3task');
    const body = resolveTemplateToRunGroupBody(template, { name: 'test' });

    assert.ok(Array.isArray(body.tasks), 'should have tasks array');
    assert.strictEqual(body.tasks.length, 3, 'should preserve all 3 tasks');
    assert.strictEqual(body.tasks[0].name, 'Explorer', 'should preserve first task name');
    assert.strictEqual(body.tasks[1].name, 'Reviewer', 'should preserve second task name');
    assert.strictEqual(body.tasks[2].name, 'Reporter', 'should preserve third task name');
  });

  it('throws for template with no tasks', () => {
    assert.throws(
      () => resolveTemplateToRunGroupBody({ name: 'empty' }),
      /has no tasks/,
      'should throw error for template without tasks'
    );
  });

  it('uses template coordinationMode', () => {
    const template = loadRunGroupTemplate('code-review-3task');
    const body = resolveTemplateToRunGroupBody(template);

    assert.strictEqual(
      body.coordinationMode,
      'dependency',
      'should use template coordinationMode when no override'
    );
  });

  it('preserves non-code dependency tasks', () => {
    const template = loadRunGroupTemplate('meeting-prep-3task');
    const body = resolveTemplateToRunGroupBody(template);

    assert.strictEqual(body.coordinationMode, 'dependency', 'meeting-prep should use dependency coordination');
    assert.strictEqual(body.tasks.length, 3, 'meeting-prep should preserve all tasks');
    assert.strictEqual(body.tasks[0].output.path, 'company-brief.json', 'first task should emit company brief');
    assert.strictEqual(body.tasks[1].output.path, 'company-news.json', 'second task should emit company news');
    assert.strictEqual(body.tasks[2].dependencies.length, 2, 'briefing task should depend on both artifacts');
  });
});
