import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('install, related install, update, sync, check and removal honor one private naming policy', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-native-command-policy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const rudiHome = path.join(home, '.rudi');
  const source = path.join(rudiHome, 'skills/image-generator');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: image-generator\ndescription: Generate images\n---\n\nVersion one.\n');
  fs.writeFileSync(path.join(rudiHome, 'native-skills.json'), JSON.stringify({
    schemaVersion: 1, skills: { 'skill:image-generator': { name: 'image-generate', hosts: ['codex', 'claude'] } },
  }));
  const script = String.raw`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { cmdInstall, syncRelatedSkillWrappers } from './src/commands/install.js';
    import { runUpdate } from './src/commands/update.js';
    import { syncSelectedSkillsToNativeHosts } from './src/commands/skills.js';
    import { getSkillCheck } from './src/commands/check.js';
    import { cleanupRemovedSkill } from './src/commands/remove.js';
    const source = path.join(process.env.RUDI_HOME, 'skills/image-generator');
    const skill = { id: 'skill:image-generator', kind: 'skill', name: 'image-generator', version: '1.0.0', source: 'rudi', path: source, entryPath: path.join(source, 'SKILL.md'), dependencies: [], requires: {} };
    const agents = [{ id: 'codex' }, { id: 'claude-code' }];
    const listInstalled = async () => [skill];
    await cmdInstall([skill.id], {}, {
      fetchIndex: async () => ({}), resolvePackage: async () => skill,
      installPackage: async () => ({ success: true, id: skill.id, path: source, installed: [skill.id] }),
      installedAgents: agents, exit: code => assert.fail('unexpected exit ' + code),
    });
    for (const root of [process.env.CODEX_HOME, process.env.CLAUDE_HOME]) {
      assert.equal(fs.existsSync(path.join(root, 'skills/image-generate/SKILL.md')), true);
      assert.equal(fs.existsSync(path.join(root, 'skills/image-generator')), false);
    }
    await syncRelatedSkillWrappers([skill], [{ success: true, id: skill.id, path: source }], agents);
    const sync = await syncSelectedSkillsToNativeHosts({ targets: ['codex', 'claude', 'gemini'], skillIds: [skill.id], dryRun: true }, { listInstalled });
    assert.equal(sync.results.codex.results[0].action, 'would_current');
    assert.equal(sync.results.gemini.results[0].action, 'excluded');
    const update = await runUpdate([skill.id], {}, {
      listInstalled, fetchIndex: async () => ({}), log() {}, error: message => assert.fail(message),
      updatePackage: async () => {
        fs.appendFileSync(skill.entryPath, 'Version two.\n');
        return { success: true, id: skill.id, path: source };
      },
    });
    assert.equal(update.failed, 0);
    assert.deepEqual(update.skillProjection.targets, ['codex', 'claude']);
    assert.match(fs.readFileSync(path.join(process.env.CODEX_HOME, 'skills/image-generate/SKILL.md'), 'utf8'), /Version two/);
    const checked = await getSkillCheck('image-generator', { listInstalled });
    assert.equal(checked.projections.codex.state, 'current');
    assert.equal(checked.projections.claude.state, 'current');
    assert.equal(checked.projections.gemini.state, 'excluded');
    fs.appendFileSync(path.join(process.env.CLAUDE_HOME, 'skills/image-generate/SKILL.md'), 'Private customization.\n');
    const removed = await cleanupRemovedSkill(skill);
    assert.equal(removed.results.codex.action, 'removed');
    assert.equal(removed.results.claude.action, 'drifted');
    assert.equal(fs.existsSync(path.join(process.env.CODEX_HOME, 'skills/image-generate')), false);
    assert.equal(fs.existsSync(path.join(process.env.CLAUDE_HOME, 'skills/image-generate')), true);
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    env: { ...process.env, HOME: home, RUDI_HOME: rudiHome, CODEX_HOME: path.join(home, '.codex'), CLAUDE_HOME: path.join(home, '.claude'), GEMINI_HOME: path.join(home, '.gemini'), ANTIGRAVITY_HOME: path.join(home, '.antigravity') },
    encoding: 'utf8', timeout: 30000,
  }));
});
