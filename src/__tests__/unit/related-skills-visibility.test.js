import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getRelatedSkillIds,
  formatRelatedSkillsLine,
} from '../../commands/related-skills.js';

test('getRelatedSkillIds normalizes related skill ids from stack metadata', () => {
  assert.deepEqual(
    getRelatedSkillIds({
      related: {
        skills: ['shortform-your-words-script', 'prompt:legacy-skill', 'skill:render-qa', 'stack:not-a-skill', '', null],
      },
    }),
    ['skill:shortform-your-words-script', 'skill:legacy-skill', 'skill:render-qa']
  );
});

test('formatRelatedSkillsLine returns a display line only when related skills exist', () => {
  assert.equal(
    formatRelatedSkillsLine({
      related: {
        skills: ['skill:shortform-your-words-script'],
      },
    }),
    'Related skills: skill:shortform-your-words-script'
  );
  assert.equal(formatRelatedSkillsLine({}), null);
});
