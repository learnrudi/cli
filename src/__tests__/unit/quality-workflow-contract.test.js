import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { supportsTrustedPublishingNpm } from '../../../scripts/validate-publish-runtime.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function workflowJob(workflow, name) {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow job ${name} must exist`);
  const contentStart = start + marker.length;
  const nextJobOffset = workflow.slice(contentStart).search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJobOffset === -1
    ? workflow.slice(start)
    : workflow.slice(start, contentStart + nextJobOffset);
}

test('GitHub quality workflow blocks unverified changes', () => {
  const workflow = read('.github/workflows/quality.yml');

  assert.match(workflow, /^name: Quality$/m);
  assert.match(workflow, /^\s{2}pull_request:$/m);
  assert.match(workflow, /^\s{2}push:$/m);
  assert.match(workflow, /^\s{2}contents: read$/m);
  assert.match(workflow, /^\s{4}name: quality$/m);
  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node: \[22, 24\]/);
  assert.match(workflow, /node-version: \$\{\{ matrix\.node \}\}/);
  assert.match(workflow, /RUDI_CLI_TEST_WRAPPER_ACTIVE: ['"]1['"]/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /pnpm build/);
  assert.match(workflow, /node scripts\/agent-debt-runner\.mjs --changed-since/);
  assert.match(workflow, /npm pack --dry-run/);
});

test('npm release workflow verifies the exact version and publishes through OIDC', () => {
  const workflow = read('.github/workflows/publish-npm.yml');

  assert.match(workflow, /^name: Publish npm$/m);
  assert.match(workflow, /^\s{2}workflow_dispatch:$/m);
  assert.match(workflow, /^\s{2}contents: read$/m);
  assert.match(workflow, /^\s{2}id-token: write$/m);
  assert.match(workflow, /^\s{4}name: publish$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/);
  assert.match(workflow, /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/);
  assert.match(workflow, /node-version: ['"]24['"]/);
  assert.match(workflow, /registry-url: ['"]https:\/\/registry\.npmjs\.org['"]/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /node scripts\/validate-publish-runtime\.mjs/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /EXPECTED_VERSION/);
  assert.match(workflow, /npm view @learnrudi\/cli versions --json/);
  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /pnpm build/);
  assert.match(workflow, /git diff --exit-code -- dist src\/packages-manifest\.json/);
  assert.match(workflow, /node scripts\/agent-debt-runner\.mjs --changed-since/);
  assert.match(workflow, /pnpm audit --prod --audit-level=moderate/);
  assert.match(workflow, /npm pack --json --pack-destination/);
  assert.match(workflow, /expectedFiles/);
  assert.match(workflow, /npm publish "\$RUNNER_TEMP\/\$PACKAGE_TARBALL" --access public --ignore-scripts/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
});

test('@learnrudi/mcp release workflow verifies the workspace package and publishes through OIDC', () => {
  const workflow = read('.github/workflows/publish-mcp-npm.yml');
  const packageJson = JSON.parse(read('packages/mcp/package.json'));
  const verifyJob = workflowJob(workflow, 'verify');
  const publishJob = workflowJob(workflow, 'publish');
  const workflowHeader = workflow.slice(0, workflow.indexOf('\njobs:\n'));

  assert.equal(packageJson.name, '@learnrudi/mcp');
  assert.equal(packageJson.version, '1.1.0');
  assert.equal(packageJson.scripts.test, 'node ../../scripts/run-tests.js src/__tests__/unit/*.test.js');
  assert.equal(packageJson.repository.url, 'git+https://github.com/learnrudi/cli.git');
  assert.equal(packageJson.repository.directory, 'packages/mcp');
  assert.match(workflow, /^name: Publish @learnrudi\/mcp$/m);
  assert.match(workflow, /^\s{2}workflow_dispatch:$/m);
  assert.match(workflowHeader, /^\s{2}contents: read$/m);
  assert.doesNotMatch(workflowHeader, /id-token:/);
  assert.match(verifyJob, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(verifyJob, /permissions:\n\s{6}contents: read/);
  assert.doesNotMatch(verifyJob, /id-token:/);
  assert.match(publishJob, /needs: verify/);
  assert.match(publishJob, /permissions:\n\s{6}contents: read\n\s{6}id-token: write/);
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(workflow, /node-version: ['"]24['"]/);
  assert.match(workflow, /registry-url: ['"]https:\/\/registry\.npmjs\.org['"]/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(verifyJob, /node scripts\/validate-publish-runtime\.mjs/);
  assert.match(verifyJob, /pnpm install --frozen-lockfile/);
  assert.match(verifyJob, /pnpm --filter @learnrudi\/mcp test/);
  assert.match(verifyJob, /pnpm audit --prod --audit-level=moderate/);
  assert.doesNotMatch(publishJob, /pnpm install|pnpm --filter|pnpm audit|scripts\/validate-publish-runtime/);
  assert.match(publishJob, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(publishJob, /persist-credentials: false/);
  assert.match(workflow, /packages\/mcp\/package\.json/);
  assert.match(workflow, /registry\.npmjs\.org\/\$\{encodedName\}/);
  assert.match(workflow, /npm pack --json --pack-destination/);
  assert.match(workflow, /expectedFiles/);
  assert.match(verifyJob, /npm pack --json --pack-destination/);
  assert.match(publishJob, /npm pack --json --pack-destination/);
  assert.match(workflow, /npm publish "\$RUNNER_TEMP\/\$PACKAGE_TARBALL" --access public --ignore-scripts/);
  assert.match(publishJob, /--registry=https:\/\/registry\.npmjs\.org/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
});

test('trusted-publishing npm gate enforces the complete minimum version', () => {
  assert.equal(supportsTrustedPublishingNpm('11.4.99'), false);
  assert.equal(supportsTrustedPublishingNpm('11.5.0'), false);
  assert.equal(supportsTrustedPublishingNpm('11.5.1-alpha.0'), false);
  assert.equal(supportsTrustedPublishingNpm('11.5.1-rc.1'), false);
  assert.equal(supportsTrustedPublishingNpm('11.5.1'), true);
  assert.equal(supportsTrustedPublishingNpm('11.6.0'), true);
  assert.equal(supportsTrustedPublishingNpm('12.0.0'), true);
  assert.equal(supportsTrustedPublishingNpm('11.5.1+build.1'), true);
  assert.equal(supportsTrustedPublishingNpm('invalid'), false);
});

test('publishable workspace packages declare remediated dependency floors', () => {
  const cliPackage = JSON.parse(read('package.json'));
  const corePackage = JSON.parse(read('packages/core/package.json'));
  const dbPackage = JSON.parse(read('packages/db/package.json'));
  const manifestPackage = JSON.parse(read('packages/manifest/package.json'));

  assert.equal(cliPackage.dependencies.ajv, '^8.18.0');
  assert.equal(cliPackage.pnpm.overrides['fast-uri'], '3.1.8');
  assert.equal(corePackage.dependencies.yaml, '^2.8.3');
  assert.equal(dbPackage.dependencies.uuid, '^11.1.1');
  assert.equal(manifestPackage.dependencies.ajv, '^8.18.0');
  assert.equal(manifestPackage.dependencies.yaml, '^2.8.3');
});

test('debt scan is portable outside the developer workstation', () => {
  const runner = read('scripts/agent-debt-runner.mjs');
  const scannerPath = path.join(REPO_ROOT, 'scripts/agent-debt-scan.cjs');

  assert.equal(fs.existsSync(scannerPath), true, 'repository-owned scanner must exist');
  assert.doesNotMatch(runner, /\/Users\/hoff\/dev\/dev-help/);
  assert.match(runner, /agent-debt-scan\.cjs/);
});

test('normal builds use the checked-in package manifest without a sibling registry checkout', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.scripts.prebuild, undefined);
  assert.equal(packageJson.scripts['generate:manifest'], 'node scripts/generate-manifest.js');
  assert.match(packageJson.scripts.build, /src\/packages-manifest\.json/);
});
