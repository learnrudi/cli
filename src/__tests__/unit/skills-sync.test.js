import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildCodexSkillFiles,
  syncCodexSkills,
} from '../../commands/skills.js';

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('buildCodexSkillFiles normalizes RUDI skill metadata for Codex', () => {
  const files = buildCodexSkillFiles(
    {
      id: 'skill:grill-with-docs',
      name: 'Grill With Docs',
      description: 'Stress-test a plan against the existing domain model',
    },
    [
      '---',
      'name: Grill With Docs',
      'description: Registry description',
      'version: 1.0.0',
      '---',
      '',
      'Ask questions one at a time.',
      '',
    ].join('\n')
  );

  assert.equal(files.skillName, 'grill-with-docs');
  assert.match(files.skillMd, /^name: grill-with-docs$/m);
  assert.match(files.skillMd, /^description: "Stress-test a plan against the existing domain model"$/m);
  assert.match(files.skillMd, /Ask questions one at a time\./);
  assert.match(files.openaiYaml, /display_name: "Grill With Docs"/);
  assert.match(files.openaiYaml, /default_prompt: "Use \$grill-with-docs/);
});

test('syncCodexSkills creates native Codex skill wrappers for RUDI skills', async () => {
  const root = makeTempRoot('rudi-skills-sync-');

  try {
    const source = path.join(root, 'grill-with-docs.md');
    const codexRoot = path.join(root, 'codex-skills');
    fs.writeFileSync(source, [
      '---',
      'name: Grill With Docs',
      'description: Stress-test docs',
      '---',
      '',
      'Ask questions one at a time.',
      '',
    ].join('\n'));

    const result = await syncCodexSkills({
      codexRoot,
      skills: [
        {
          id: 'skill:grill-with-docs',
          kind: 'skill',
          name: 'Grill With Docs',
          description: 'Stress-test docs',
          source: 'rudi',
          entryPath: source,
        },
      ],
    });

    const skillPath = path.join(codexRoot, 'grill-with-docs', 'SKILL.md');
    const openaiPath = path.join(codexRoot, 'grill-with-docs', 'agents', 'openai.yaml');

    assert.equal(result.results[0].action, 'created');
    assert.equal(fs.existsSync(skillPath), true);
    assert.equal(fs.existsSync(openaiPath), true);
    assert.match(fs.readFileSync(skillPath, 'utf-8'), /name: grill-with-docs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('syncCodexSkills skips existing wrappers unless force is set', async () => {
  const root = makeTempRoot('rudi-skills-sync-existing-');

  try {
    const source = path.join(root, 'skill.md');
    const codexRoot = path.join(root, 'codex-skills');
    const targetDir = path.join(codexRoot, 'example-skill');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), 'existing');
    fs.writeFileSync(source, '---\nname: Example Skill\ndescription: Example\n---\n\nnew body\n');

    const skills = [
      {
        id: 'skill:example-skill',
        kind: 'skill',
        name: 'Example Skill',
        description: 'Example',
        source: 'rudi',
        entryPath: source,
      },
    ];

    const skipped = await syncCodexSkills({ codexRoot, skills });
    assert.equal(skipped.results[0].action, 'skipped');
    assert.equal(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8'), 'existing');

    const updated = await syncCodexSkills({ codexRoot, skills, force: true });
    assert.equal(updated.results[0].action, 'updated');
    assert.match(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8'), /new body/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
