import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateManifest,
  getManifestGeneratedAt,
} from '../../../scripts/generate-manifest.js';

async function withCatalog(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rudi-manifest-catalog-'));
  try {
    await mkdir(path.join(dir, 'runtimes'), { recursive: true });
    await mkdir(path.join(dir, 'agents'), { recursive: true });
    await mkdir(path.join(dir, 'binaries'), { recursive: true });

    await writeFile(path.join(dir, 'runtimes', 'z-runtime.json'), JSON.stringify({
      id: 'runtime:z-runtime',
      name: 'Z Runtime',
      binary: 'z',
    }));
    await writeFile(path.join(dir, 'runtimes', 'a-runtime.json'), JSON.stringify({
      id: 'runtime:a-runtime',
      name: 'A Runtime',
      binary: 'a',
    }));

    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('getManifestGeneratedAt is deterministic by default and honors SOURCE_DATE_EPOCH', () => {
  assert.equal(getManifestGeneratedAt({}), '1970-01-01T00:00:00.000Z');
  assert.equal(getManifestGeneratedAt({ SOURCE_DATE_EPOCH: '1700000000' }), '2023-11-14T22:13:20.000Z');
});

test('generateManifest is deterministic for unchanged catalog content', async () => {
  await withCatalog(async (catalogPath) => {
    const first = generateManifest({ catalogPath, env: {}, log: () => {} });
    const second = generateManifest({ catalogPath, env: {}, log: () => {} });

    assert.deepEqual(first, second);
    assert.equal(first.generated, '1970-01-01T00:00:00.000Z');
    assert.deepEqual(first.packages.runtimes.map(pkg => pkg.id), ['a-runtime', 'z-runtime']);
  });
});
