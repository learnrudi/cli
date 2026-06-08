import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test('resolvePackage surfaces related skills without adding them to dependency install order', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-related-skills-'));
  const registryRoot = path.join(root, 'registry');
  const rudiHome = path.join(root, '.rudi');

  process.env.RUDI_HOME = rudiHome;
  process.env.USE_LOCAL_REGISTRY = 'true';
  process.env.RUDI_REGISTRY_ROOT = registryRoot;

  writeJson(path.join(registryRoot, 'index.json'), {
    packages: {
      stacks: {
        official: [
          {
            id: 'stack:video-editor',
            name: 'Video Editor',
            version: '1.0.0',
            path: 'catalog/stacks/video-editor'
          }
        ]
      },
      skills: {
        official: [
          {
            id: 'skill:shortform-your-words-script',
            name: 'Shortform Your Words Script',
            version: '1.0.0',
            path: 'catalog/skills/shortform-your-words-script.md'
          }
        ]
      }
    }
  });

  writeJson(path.join(registryRoot, 'catalog/stacks/video-editor/manifest.json'), {
    id: 'video-editor',
    name: 'Video Editor',
    version: '1.0.0',
    related: {
      skills: ['skill:shortform-your-words-script']
    }
  });

  const { resolvePackage, getInstallOrder } = await import('../../resolver.js');

  const resolved = await resolvePackage('stack:video-editor');

  assert.deepEqual(
    resolved.relatedSkills.map((skill) => ({
      id: skill.id,
      kind: skill.kind,
      name: skill.name,
      installed: skill.installed,
    })),
    [
      {
        id: 'skill:shortform-your-words-script',
        kind: 'skill',
        name: 'Shortform Your Words Script',
        installed: false,
      },
    ]
  );
  assert.deepEqual(getInstallOrder(resolved).map((pkg) => pkg.id), ['stack:video-editor']);

  fs.rmSync(root, { recursive: true, force: true });
});
