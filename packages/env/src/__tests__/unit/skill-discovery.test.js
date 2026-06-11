import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../..');
const envUrl = pathToFileURL(path.join(repoRoot, 'packages/env/src/index.js')).href;

function runEnvScript(rudiHome, scriptBody, extraEnv = {}) {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', scriptBody, envUrl], {
    cwd: repoRoot,
    env: { ...process.env, RUDI_HOME: rudiHome, ...extraEnv },
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

test('local skill discovery supports flat files and SKILL.md directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-skill-discovery-'));
  const rudiHome = path.join(root, '.rudi');
  const skillsDir = path.join(rudiHome, 'skills');
  fs.mkdirSync(path.join(skillsDir, 'grill-with-docs'), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, 'brainstorm.md'), '---\nname: brainstorm\n---\n');
  fs.writeFileSync(path.join(skillsDir, 'grill-with-docs', 'SKILL.md'), '---\nname: grill-with-docs\n---\n');

  try {
    const result = runEnvScript(rudiHome, `
      const {
        discoverSkillPackages,
        getInstalledPackages,
        getPackagePath,
        isPackageInstalled,
      } = await import(process.argv[1]);

      console.log(JSON.stringify({
        discovered: discoverSkillPackages(),
        installedNames: getInstalledPackages('skill').sort(),
        directoryInstalled: isPackageInstalled('skill:grill-with-docs'),
        directoryPath: getPackagePath('skill:grill-with-docs'),
        missingPath: getPackagePath('skill:new-skill'),
      }));
    `);

    assert.deepEqual(result.installedNames, ['brainstorm', 'grill-with-docs']);
    assert.equal(result.directoryInstalled, true);
    assert.equal(result.directoryPath, path.join(skillsDir, 'grill-with-docs'));
    assert.equal(result.missingPath, path.join(skillsDir, 'new-skill.md'));
    assert.deepEqual(
      result.discovered.map(skill => [skill.name, skill.format, skill.source]).sort(),
      [
        ['brainstorm', 'flat', 'rudi'],
        ['grill-with-docs', 'directory', 'rudi'],
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('external Claude skill discovery preserves RUDI precedence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-claude-skill-discovery-'));
  const rudiHome = path.join(root, '.rudi');
  const claudeHome = path.join(root, '.claude');
  const rudiSkillsDir = path.join(rudiHome, 'skills');
  const claudeSkillsDir = path.join(claudeHome, 'skills');
  fs.mkdirSync(path.join(claudeSkillsDir, 'grill-with-docs'), { recursive: true });
  fs.mkdirSync(path.join(claudeSkillsDir, 'pdf'), { recursive: true });
  fs.mkdirSync(rudiSkillsDir, { recursive: true });
  fs.writeFileSync(path.join(rudiSkillsDir, 'grill-with-docs.md'), '---\nname: grill-with-docs\n---\n');
  fs.writeFileSync(path.join(claudeSkillsDir, 'grill-with-docs', 'SKILL.md'), '---\nname: grill-with-docs\n---\n');
  fs.writeFileSync(path.join(claudeSkillsDir, 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n');

  try {
    const result = runEnvScript(rudiHome, `
      const { discoverSkillPackages } = await import(process.argv[1]);
      console.log(JSON.stringify(discoverSkillPackages({ includeExternal: true })));
    `, { CLAUDE_HOME: claudeHome });

    assert.deepEqual(
      result.map(skill => [skill.name, skill.format, skill.source]).sort(),
      [
        ['grill-with-docs', 'flat', 'rudi'],
        ['pdf', 'directory', 'claude'],
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
