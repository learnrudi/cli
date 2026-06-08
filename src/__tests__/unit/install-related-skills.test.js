import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRelatedSkillInstallPlan,
  getRelatedSkillInstallMode,
} from '../../commands/install.js';

const resolvedStack = {
  id: 'stack:video-editor',
  kind: 'stack',
  relatedSkills: [
    {
      id: 'skill:shortform-your-words-script',
      kind: 'skill',
      name: 'Shortform Your Words Script',
      installed: false,
    },
    {
      id: 'skill:shortform-render-qa',
      kind: 'skill',
      name: 'Shortform Render QA',
      installed: true,
    },
  ],
};

test('getRelatedSkillInstallMode maps explicit related-skill flags', () => {
  assert.equal(getRelatedSkillInstallMode({ 'with-related-skills': true }), 'include');
  assert.equal(getRelatedSkillInstallMode({ withRelatedSkills: true }), 'include');
  assert.equal(getRelatedSkillInstallMode({ 'no-related-skills': true }), 'skip');
  assert.equal(getRelatedSkillInstallMode({ noRelatedSkills: true }), 'skip');
  assert.equal(getRelatedSkillInstallMode({}), 'offer');
});

test('buildRelatedSkillInstallPlan only installs missing related skills when explicitly requested', () => {
  const include = buildRelatedSkillInstallPlan(resolvedStack, { 'with-related-skills': true });
  assert.deepEqual(include.missing.map((skill) => skill.id), ['skill:shortform-your-words-script']);
  assert.deepEqual(include.toInstall.map((skill) => skill.id), ['skill:shortform-your-words-script']);

  const skip = buildRelatedSkillInstallPlan(resolvedStack, { 'no-related-skills': true });
  assert.deepEqual(skip.missing.map((skill) => skill.id), ['skill:shortform-your-words-script']);
  assert.deepEqual(skip.toInstall, []);

  const offer = buildRelatedSkillInstallPlan(resolvedStack, {});
  assert.equal(offer.mode, 'offer');
  assert.deepEqual(offer.toInstall, []);
});
