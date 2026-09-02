import crypto from 'node:crypto';
import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const NATIVE_SKILL_HOSTS = Object.freeze([
  'codex',
  'claude',
  'gemini',
  'antigravity',
]);

const RESOURCE_DIRECTORIES = Object.freeze(['assets', 'references', 'scripts']);
const RECEIPT_SCHEMA_VERSION = 2;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRUSTED_PLATFORM_SYMLINKS = new Set(
  process.platform === 'darwin' ? ['/etc', '/tmp', '/var'] : [],
);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compactText(value, maxLength = 160) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
}

function lowerFirst(value) {
  if (!value) return value;
  return `${value[0].toLowerCase()}${value.slice(1)}`;
}

function humanizeSkillDisplayName(value) {
  const compact = compactText(value, 80);
  if (!SKILL_NAME_PATTERN.test(compact)) return compact;
  return compact
    .split('-')
    .map(part => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function yamlString(value) {
  return JSON.stringify(String(value || ''));
}

function parseSimpleFrontmatter(frontmatter = '') {
  const metadata = {};
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    metadata[match[1]] = value;
  }
  return metadata;
}

function stripFrontmatter(content = '') {
  if (!content.startsWith('---\n')) {
    return { metadata: {}, body: content.trimStart() };
  }
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    return { metadata: {}, body: content.trimStart() };
  }
  return {
    metadata: parseSimpleFrontmatter(content.slice(4, end)),
    body: content.slice(end + 5).trimStart(),
  };
}

export function normalizeNativeSkillName(skill) {
  const raw = String(skill?.id || '').replace(/^skill:/, '');
  if (!SKILL_NAME_PATTERN.test(raw)) {
    throw new Error(`Invalid native skill package id: ${skill?.id || '<missing>'}`);
  }
  return raw;
}

function shortDescription(description, fallback) {
  return compactText(description || fallback, 64);
}

function defaultPrompt(skillName, description, displayName) {
  const action = compactText(lowerFirst(description || `run the ${displayName} workflow`), 120);
  return `Use $${skillName} to ${action}.`;
}

export function buildPortableSkillFiles(skill, sourceContent) {
  const skillName = normalizeNativeSkillName(skill);
  const parsed = stripFrontmatter(sourceContent);
  const displayName = compactText(parsed.metadata.name || skill.name || skillName, 80);
  const description = compactText(
    skill.description || parsed.metadata.description || `${displayName} RUDI skill`,
    320,
  );
  const body = parsed.body
    || `Use the installed RUDI skill \`skill:${skillName}\` as the source of truth.`;
  const skillMd = [
    '---',
    `name: ${yamlString(skillName)}`,
    `description: ${yamlString(description)}`,
    '---',
    '',
    body.trimEnd(),
    '',
  ].join('\n');
  return { skillName, skillMd };
}

export function buildCodexSkillFiles(skill, sourceContent) {
  const baseFiles = buildPortableSkillFiles(skill, sourceContent);
  const { skillName } = baseFiles;
  const parsed = stripFrontmatter(sourceContent);
  const displayName = humanizeSkillDisplayName(parsed.metadata.name || skill.name || skillName);
  const description = compactText(
    skill.description || parsed.metadata.description || `${displayName} RUDI skill`,
    320,
  );
  const openaiYaml = [
    'interface:',
    `  display_name: ${yamlString(displayName)}`,
    `  short_description: ${yamlString(shortDescription(description, displayName))}`,
    `  default_prompt: ${yamlString(defaultPrompt(skillName, description, displayName))}`,
    '',
  ].join('\n');
  return { ...baseFiles, openaiYaml };
}

function assertSupportedHost(host) {
  if (!NATIVE_SKILL_HOSTS.includes(host)) {
    throw new Error(`Unsupported native skill host: ${host}`);
  }
}

function taskHome(options = {}) {
  return path.resolve(options.homeDir || options.env?.HOME || os.homedir());
}

export function getNativeSkillRoot(host, options = {}) {
  assertSupportedHost(host);
  const env = options.env || process.env;
  const home = taskHome(options);
  if (host === 'codex') {
    return path.join(path.resolve(env.CODEX_HOME || path.join(home, '.codex')), 'skills');
  }
  if (host === 'claude') {
    return path.join(path.resolve(env.CLAUDE_HOME || path.join(home, '.claude')), 'skills');
  }
  if (host === 'gemini') {
    return path.join(path.resolve(env.GEMINI_HOME || path.join(home, '.gemini')), 'skills');
  }
  return path.join(
    path.resolve(env.ANTIGRAVITY_HOME || path.join(home, '.gemini', 'antigravity-cli')),
    'skills',
  );
}

export function getNativeSkillReceiptRoot(options = {}) {
  const env = options.env || process.env;
  const rudiHome = path.resolve(env.RUDI_HOME || path.join(taskHome(options), '.rudi'));
  return path.join(rudiHome, 'state', 'native-skills');
}

export function configuredNativeSkillHosts(installedAgents = []) {
  const ids = new Set((installedAgents || []).map(agent => agent?.id).filter(Boolean));
  const hosts = [];
  if (ids.has('codex')) hosts.push('codex');
  if (ids.has('claude-code') || ids.has('claude-desktop') || ids.has('claude')) hosts.push('claude');
  if (ids.has('gemini')) hosts.push('gemini');
  if (ids.has('antigravity') || ids.has('google')) hosts.push('antigravity');
  return hosts;
}

function safeRelativePath(relativePath) {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes('\0') ||
    relativePath.split(path.sep).some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe native skill resource path: ${relativePath}`);
  }
  return relativePath;
}

function assertRealEntry(stat, entryPath, expected) {
  if (stat.isSymbolicLink()) {
    throw new Error(`Native skill resources cannot contain symbolic links: ${entryPath}`);
  }
  if (expected === 'file' && !stat.isFile()) {
    throw new Error(`Native skill resource must be a regular file: ${entryPath}`);
  }
  if (expected === 'directory' && !stat.isDirectory()) {
    throw new Error(`Native skill resource must be a directory: ${entryPath}`);
  }
}

async function assertNoSymlinkPathComponents(candidate, label, options = {}) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT' && options.allowMissingTail === true) return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      if (!TRUSTED_PLATFORM_SYMLINKS.has(current)) {
        throw new Error(`${label} cannot contain symbolic links: ${current}`);
      }
      continue;
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} ancestor must be a real directory: ${current}`);
    }
  }
}

async function assertSafeRoot(root, label) {
  await assertNoSymlinkPathComponents(root, label, { allowMissingTail: true });
  try {
    const stat = await fsp.lstat(root);
    assertRealEntry(stat, root, 'directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function collectResourceEntries(sourceRoot, resourceName, entries, sourceEntries) {
  const resourceRoot = path.join(sourceRoot, resourceName);
  let rootStat;
  try {
    rootStat = await fsp.lstat(resourceRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  assertRealEntry(rootStat, resourceRoot, 'directory');
  entries.push({ type: 'directory', relativePath: resourceName, mode: rootStat.mode & 0o777 });
  sourceEntries.push({ type: 'directory', relativePath: resourceName, mode: rootStat.mode & 0o777 });

  async function walk(directory, relativeDirectory) {
    const children = await fsp.readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const childPath = path.join(directory, child.name);
      const relativePath = safeRelativePath(path.join(relativeDirectory, child.name));
      const stat = await fsp.lstat(childPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Native skill resources cannot contain symbolic links: ${childPath}`);
      }
      if (stat.isDirectory()) {
        const entry = { type: 'directory', relativePath, mode: stat.mode & 0o777 };
        entries.push(entry);
        sourceEntries.push(entry);
        await walk(childPath, relativePath);
      } else if (stat.isFile()) {
        const content = await fsp.readFile(childPath);
        const entry = {
          type: 'file',
          relativePath,
          mode: stat.mode & 0o777,
          content,
        };
        entries.push(entry);
        sourceEntries.push(entry);
      } else {
        throw new Error(`Unsupported native skill resource type: ${childPath}`);
      }
    }
  }

  await walk(resourceRoot, resourceName);
}

async function readBundledCodexMetadata(sourceRoot) {
  const metadataPath = path.join(sourceRoot, 'agents', 'openai.yaml');
  let metadataStat;
  try {
    metadataStat = await fsp.lstat(metadataPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  assertRealEntry(metadataStat, metadataPath, 'file');
  return fsp.readFile(metadataPath);
}

function manifestEntry(entry) {
  if (entry.type === 'directory') {
    return { path: entry.relativePath, type: entry.type, mode: entry.mode };
  }
  return {
    path: entry.relativePath,
    type: entry.type,
    mode: entry.mode,
    size: entry.content.length,
    digest: sha256(entry.content),
  };
}

function digestEntries(entries) {
  const manifest = entries
    .map(manifestEntry)
    .sort((a, b) => a.path.localeCompare(b.path));
  return { manifest, digest: sha256(JSON.stringify(manifest)) };
}

function resolveSourceIdentity(source) {
  if (typeof source === 'string' && source.trim()) return source.trim();
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  return source.resolvedCommit
    || source.checksum
    || source.requestedRef
    || source.type
    || null;
}

async function buildProjection(host, skill) {
  assertSupportedHost(host);
  const skillName = normalizeNativeSkillName(skill);
  const sourcePath = path.resolve(skill.entryPath || skill.path || '');
  await assertNoSymlinkPathComponents(sourcePath, 'Native skill source path');
  let sourceStat;
  try {
    sourceStat = await fsp.lstat(sourcePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Source skill file not found: ${sourcePath}`);
    }
    throw error;
  }
  assertRealEntry(sourceStat, sourcePath, 'file');
  const sourceContent = await fsp.readFile(sourcePath);
  const sourceText = sourceContent.toString('utf8');
  const generated = host === 'codex'
    ? buildCodexSkillFiles(skill, sourceText)
    : buildPortableSkillFiles(skill, sourceText);
  const entries = [{
    type: 'file',
    relativePath: 'SKILL.md',
    mode: 0o644,
    content: Buffer.from(generated.skillMd),
  }];
  const sourceEntries = [{
    type: 'file',
    relativePath: 'SKILL.md',
    mode: sourceStat.mode & 0o777,
    content: sourceContent,
  }];
  let codexMetadata = host === 'codex' ? Buffer.from(generated.openaiYaml) : null;
  let packageDigest;
  if (path.basename(sourcePath) === 'SKILL.md') {
    const sourceRoot = path.dirname(sourcePath);
    const completePackage = await inspectTree(sourceRoot);
    if (!completePackage) {
      throw new Error(`Source skill package not found: ${sourceRoot}`);
    }
    packageDigest = completePackage.digest;
    if (host === 'codex') {
      codexMetadata = await readBundledCodexMetadata(sourceRoot) ?? codexMetadata;
    }
    for (const resourceName of RESOURCE_DIRECTORIES) {
      await collectResourceEntries(sourceRoot, resourceName, entries, sourceEntries);
    }
  } else {
    packageDigest = digestEntries(sourceEntries).digest;
  }
  if (host === 'codex') {
    entries.push({ type: 'directory', relativePath: 'agents', mode: 0o755 });
    entries.push({
      type: 'file',
      relativePath: path.join('agents', 'openai.yaml'),
      mode: 0o644,
      content: codexMetadata,
    });
  }
  const rendered = digestEntries(entries);
  const sourceIdentity = resolveSourceIdentity(skill.source);
  return {
    entries,
    packageVersion: String(skill.version || 'unknown'),
    packageDigest,
    renderedTreeDigest: rendered.digest,
    renderedTreeManifest: rendered.manifest,
    skillId: skill.id,
    skillName,
    sourceDigest: sha256(sourceContent),
    sourceIdentity,
  };
}

async function inspectTree(root) {
  const entries = [];
  let stat;
  try {
    stat = await fsp.lstat(root);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  assertRealEntry(stat, root, 'directory');

  async function walk(directory, relativeDirectory = '') {
    const children = await fsp.readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const childPath = path.join(directory, child.name);
      const relativePath = safeRelativePath(
        relativeDirectory ? path.join(relativeDirectory, child.name) : child.name,
      );
      const childStat = await fsp.lstat(childPath);
      if (childStat.isSymbolicLink()) {
        throw new Error(`Native skill trees cannot contain symbolic links: ${childPath}`);
      }
      if (childStat.isDirectory()) {
        entries.push({
          type: 'directory',
          relativePath,
          mode: childStat.mode & 0o777,
        });
        await walk(childPath, relativePath);
      } else if (childStat.isFile()) {
        entries.push({
          type: 'file',
          relativePath,
          mode: childStat.mode & 0o777,
          content: await fsp.readFile(childPath),
        });
      } else {
        throw new Error(`Unsupported native skill tree entry: ${childPath}`);
      }
    }
  }
  await walk(root);
  return digestEntries(entries);
}

function receiptPathFor(receiptRoot, host, skillName) {
  return path.join(path.resolve(receiptRoot), host, `${skillName}.json`);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function receiptIdentityDigest(receipt) {
  return receipt ? sha256(JSON.stringify(receipt)) : null;
}

function validateReceipt(receipt, expected = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('Native skill receipt must be an object');
  }
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error(`Unsupported native skill receipt schema: ${receipt.schemaVersion}`);
  }
  if (!NATIVE_SKILL_HOSTS.includes(receipt.host)) {
    throw new Error(`Invalid native skill receipt host: ${receipt.host}`);
  }
  if (!String(receipt.skillId || '').startsWith('skill:')) {
    throw new Error('Invalid native skill receipt skillId');
  }
  if (!SKILL_NAME_PATTERN.test(receipt.skillName || '')) {
    throw new Error('Invalid native skill receipt skillName');
  }
  if (receipt.skillId !== `skill:${receipt.skillName}`) {
    throw new Error('Native skill receipt id/name mismatch');
  }
  if (typeof receipt.packageVersion !== 'string' || !receipt.packageVersion.trim()) {
    throw new Error('Invalid native skill receipt packageVersion');
  }
  if (
    receipt.sourceIdentity !== null
    && (typeof receipt.sourceIdentity !== 'string' || !receipt.sourceIdentity.trim())
  ) {
    throw new Error('Invalid native skill receipt sourceIdentity');
  }
  if (!DIGEST_PATTERN.test(receipt.sourceDigest || '')) {
    throw new Error('Invalid native skill receipt sourceDigest');
  }
  if (!DIGEST_PATTERN.test(receipt.packageDigest || '')) {
    throw new Error('Invalid native skill receipt packageDigest');
  }
  if (!DIGEST_PATTERN.test(receipt.renderedTreeDigest || '')) {
    throw new Error('Invalid native skill receipt renderedTreeDigest');
  }
  if (typeof receipt.targetDir !== 'string' || path.resolve(receipt.targetDir) !== receipt.targetDir) {
    throw new Error('Invalid native skill receipt targetDir');
  }
  if (!isIsoTimestamp(receipt.createdAt) || !isIsoTimestamp(receipt.updatedAt)) {
    throw new Error('Invalid native skill receipt timestamps');
  }
  if (receipt.createdAt > receipt.updatedAt) {
    throw new Error('Invalid native skill receipt timestamp order');
  }
  if (expected.host && receipt.host !== expected.host) {
    throw new Error(`Native skill receipt host mismatch: ${receipt.host}`);
  }
  if (expected.skillId && receipt.skillId !== expected.skillId) {
    throw new Error(`Native skill receipt skill mismatch: ${receipt.skillId}`);
  }
  if (expected.skillName && receipt.skillName !== expected.skillName) {
    throw new Error(`Native skill receipt name mismatch: ${receipt.skillName}`);
  }
  if (expected.targetDir && receipt.targetDir !== path.resolve(expected.targetDir)) {
    throw new Error(`Native skill receipt target mismatch: ${receipt.targetDir}`);
  }
  return receipt;
}

async function readReceipt(receiptPath, expected = {}) {
  await assertNoSymlinkPathComponents(receiptPath, 'Native skill receipt path', {
    allowMissingTail: true,
  });
  let stat;
  try {
    stat = await fsp.lstat(receiptPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  assertRealEntry(stat, receiptPath, 'file');
  let receipt;
  try {
    receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid native skill receipt ${receiptPath}: ${error.message}`);
  }
  return validateReceipt(receipt, expected);
}

async function assertReceiptUnchanged(receiptPath, priorReceipt, expected) {
  const currentReceipt = await readReceipt(receiptPath, expected);
  if (receiptIdentityDigest(currentReceipt) !== receiptIdentityDigest(priorReceipt)) {
    throw new Error(`Native skill receipt changed during reconciliation: ${receiptPath}`);
  }
}

async function ensureRealDirectory(directory) {
  await assertSafeRoot(directory, 'Native skill directory');
  try {
    const stat = await fsp.lstat(directory);
    assertRealEntry(stat, directory, 'directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fsp.lstat(directory);
    assertRealEntry(stat, directory, 'directory');
  }
}

async function writeProjectionStage(targetRoot, projection) {
  await assertSafeRoot(targetRoot, 'Native skill target root');
  await ensureRealDirectory(targetRoot);
  const stageDir = await fsp.mkdtemp(path.join(targetRoot, `.${projection.skillName}.rudi-stage-`));
  try {
    for (const entry of projection.entries) {
      const destination = path.join(stageDir, safeRelativePath(entry.relativePath));
      const resolvedDestination = path.resolve(destination);
      if (!resolvedDestination.startsWith(`${path.resolve(stageDir)}${path.sep}`)) {
        throw new Error(`Native skill stage path escapes target: ${entry.relativePath}`);
      }
      if (entry.type === 'directory') {
        await fsp.mkdir(destination, { recursive: true, mode: entry.mode });
        await fsp.chmod(destination, entry.mode);
      } else {
        await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
        await fsp.writeFile(destination, entry.content, { flag: 'wx', mode: entry.mode });
        await fsp.chmod(destination, entry.mode);
      }
    }
    const staged = await inspectTree(stageDir);
    if (staged.digest !== projection.renderedTreeDigest) {
      throw new Error('Staged native skill tree did not match the expected render digest');
    }
    return stageDir;
  } catch (error) {
    await fsp.rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}

async function atomicWriteReceipt(receiptPath, receipt) {
  const directory = path.dirname(receiptPath);
  await assertSafeRoot(directory, 'Native skill receipt directory');
  await ensureRealDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(receiptPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await fsp.rename(temporary, receiptPath);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

function receiptFor(host, projection, targetDir, priorReceipt = null) {
  const now = new Date().toISOString();
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    host,
    skillId: projection.skillId,
    skillName: projection.skillName,
    packageVersion: projection.packageVersion,
    sourceIdentity: projection.sourceIdentity,
    sourceDigest: projection.sourceDigest,
    packageDigest: projection.packageDigest,
    renderedTreeDigest: projection.renderedTreeDigest,
    targetDir,
    createdAt: priorReceipt?.createdAt || now,
    updatedAt: now,
  };
}

function resultBase(host, projection, targetDir, receiptPath) {
  return {
    host,
    id: projection.skillId,
    skillName: projection.skillName,
    targetDir,
    receiptPath,
    packageVersion: projection.packageVersion,
    sourceIdentity: projection.sourceIdentity,
    sourceDigest: projection.sourceDigest,
    packageDigest: projection.packageDigest,
    renderedTreeDigest: projection.renderedTreeDigest,
    restartRequired: false,
  };
}

export async function inspectNativeSkillProjection(options = {}) {
  const host = options.host;
  const skill = options.skill;
  const projection = await buildProjection(host, skill);
  const targetRoot = path.resolve(options.targetRoot || getNativeSkillRoot(host, options));
  const receiptRoot = path.resolve(options.receiptRoot || getNativeSkillReceiptRoot(options));
  await assertSafeRoot(targetRoot, 'Native skill target root');
  await assertSafeRoot(receiptRoot, 'Native skill receipt root');
  const targetDir = path.join(targetRoot, projection.skillName);
  const receiptPath = receiptPathFor(receiptRoot, host, projection.skillName);
  const receiptExpectation = {
    host,
    skillId: projection.skillId,
    skillName: projection.skillName,
    targetDir,
  };
  const receipt = await readReceipt(receiptPath, receiptExpectation);
  const actual = await inspectTree(targetDir);
  let state;
  if (!actual) {
    state = 'missing';
  } else if (!receipt) {
    state = 'unmanaged';
  } else if (actual.digest !== receipt.renderedTreeDigest) {
    state = 'drifted';
  } else if (
    actual.digest === projection.renderedTreeDigest &&
    receipt.sourceDigest === projection.sourceDigest &&
    receipt.packageDigest === projection.packageDigest &&
    receipt.sourceIdentity === projection.sourceIdentity &&
    receipt.packageVersion === projection.packageVersion
  ) {
    state = 'current';
  } else {
    state = 'update_available';
  }
  return {
    ...resultBase(host, projection, targetDir, receiptPath),
    actualTreeDigest: actual?.digest || null,
    expectedMatchesActual: actual?.digest === projection.renderedTreeDigest,
    managed: Boolean(receipt),
    receipt,
    state,
  };
}

async function promoteProjection({
  stageDir,
  targetDir,
  receiptPath,
  receipt,
  priorReceipt,
  receiptExpectation,
  priorActualDigest,
  writeReceipt = atomicWriteReceipt,
}) {
  const targetRoot = path.dirname(targetDir);
  const backupDir = path.join(
    targetRoot,
    `.${path.basename(targetDir)}.rudi-backup-${crypto.randomUUID()}`,
  );
  let backedUp = false;
  let promoted = false;
  try {
    await assertSafeRoot(targetRoot, 'Native skill target root');
    await assertSafeRoot(path.dirname(receiptPath), 'Native skill receipt directory');
    const current = await inspectTree(targetDir);
    if ((current?.digest || null) !== (priorActualDigest || null)) {
      throw new Error(`Native skill target changed during reconciliation: ${targetDir}`);
    }
    await assertReceiptUnchanged(receiptPath, priorReceipt, receiptExpectation);
    if (current) {
      await fsp.rename(targetDir, backupDir);
      backedUp = true;
    }
    await fsp.rename(stageDir, targetDir);
    promoted = true;
    await assertReceiptUnchanged(receiptPath, priorReceipt, receiptExpectation);
    await writeReceipt(receiptPath, receipt);
  } catch (error) {
    const rollbackErrors = [];
    if (promoted) {
      try {
        await fsp.rename(targetDir, stageDir);
      } catch (rollbackError) {
        rollbackErrors.push(`failed projection could not be staged: ${rollbackError.message}`);
      }
    }
    if (backedUp) {
      try {
        await fsp.rename(backupDir, targetDir);
      } catch (rollbackError) {
        rollbackErrors.push(`prior projection could not be restored: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${error.message}; rollback failed: ${rollbackErrors.join('; ')}`, { cause: error });
    }
    throw error;
  }
  const warnings = [];
  if (backedUp) {
    try {
      await fsp.rm(backupDir, { recursive: true });
    } catch (error) {
      warnings.push(`Accepted prior projection backup remains at ${backupDir}: ${error.message}`);
    }
  }
  return warnings;
}

export async function reconcileNativeSkill(options = {}) {
  const host = options.host;
  const skill = options.skill;
  try {
    const inspected = await inspectNativeSkillProjection(options);
    const base = {
      host,
      id: inspected.id,
      skillName: inspected.skillName,
      targetDir: inspected.targetDir,
      receiptPath: inspected.receiptPath,
      packageVersion: inspected.packageVersion,
      sourceIdentity: inspected.sourceIdentity,
      sourceDigest: inspected.sourceDigest,
      packageDigest: inspected.packageDigest,
      renderedTreeDigest: inspected.renderedTreeDigest,
      previousState: inspected.state,
      restartRequired: false,
    };
    const force = options.force === true;
    const dryRun = options.dryRun === true;

    if (inspected.state === 'current') {
      return { ...base, action: dryRun ? 'would_current' : 'current' };
    }
    if (inspected.state === 'unmanaged' && !inspected.expectedMatchesActual && !force) {
      return {
        ...base,
        action: dryRun ? 'would_preserve_unmanaged' : 'unmanaged',
        reason: 'Existing native skill tree has no RUDI ownership receipt',
      };
    }
    if (inspected.state === 'drifted' && !force) {
      return {
        ...base,
        action: dryRun ? 'would_preserve_drifted' : 'drifted',
        reason: 'Managed native skill tree differs from its ownership receipt',
      };
    }
    if (inspected.state === 'unmanaged' && inspected.expectedMatchesActual) {
      if (dryRun) return { ...base, action: 'would_adopt' };
      const projection = await buildProjection(host, skill);
      await assertSafeRoot(path.dirname(inspected.targetDir), 'Native skill target root');
      await assertSafeRoot(path.dirname(path.dirname(inspected.receiptPath)), 'Native skill receipt root');
      const current = await inspectTree(inspected.targetDir);
      if (current?.digest !== projection.renderedTreeDigest) {
        throw new Error(`Native skill target changed during adoption: ${inspected.targetDir}`);
      }
      const receiptExpectation = {
        host,
        skillId: projection.skillId,
        skillName: projection.skillName,
        targetDir: inspected.targetDir,
      };
      await assertReceiptUnchanged(inspected.receiptPath, null, receiptExpectation);
      await atomicWriteReceipt(
        inspected.receiptPath,
        receiptFor(host, projection, inspected.targetDir),
      );
      return { ...base, action: 'adopted' };
    }

    const projection = await buildProjection(host, skill);
    const receipt = receiptFor(host, projection, inspected.targetDir, inspected.receipt);
    const targetChanges = inspected.actualTreeDigest !== projection.renderedTreeDigest;
    const action = inspected.state === 'missing' ? 'created' : 'updated';
    if (dryRun) {
      return {
        ...base,
        action: action === 'created' ? 'would_create' : 'would_update',
        restartRequired: targetChanges,
      };
    }
    if (!targetChanges) {
      const current = await inspectTree(inspected.targetDir);
      if (current?.digest !== inspected.actualTreeDigest) {
        throw new Error(`Native skill target changed during reconciliation: ${inspected.targetDir}`);
      }
      const receiptExpectation = {
        host,
        skillId: projection.skillId,
        skillName: projection.skillName,
        targetDir: inspected.targetDir,
      };
      await assertReceiptUnchanged(
        inspected.receiptPath,
        inspected.receipt,
        receiptExpectation,
      );
      await atomicWriteReceipt(inspected.receiptPath, receipt);
      return { ...base, action, restartRequired: false };
    }
    const targetRoot = path.dirname(inspected.targetDir);
    const stageDir = await writeProjectionStage(targetRoot, projection);
    try {
      const warnings = await promoteProjection({
        stageDir,
        targetDir: inspected.targetDir,
        receiptPath: inspected.receiptPath,
        receipt,
        priorReceipt: inspected.receipt,
        receiptExpectation: {
          host,
          skillId: projection.skillId,
          skillName: projection.skillName,
          targetDir: inspected.targetDir,
        },
        priorActualDigest: inspected.actualTreeDigest,
        writeReceipt: options.operations?.writeReceipt || atomicWriteReceipt,
      });
      return {
        ...base,
        action,
        forced: force && ['drifted', 'unmanaged'].includes(inspected.state),
        restartRequired: true,
        warnings,
      };
    } finally {
      await fsp.rm(stageDir, { recursive: true, force: true });
    }
  } catch (error) {
    let skillName = null;
    try {
      skillName = normalizeNativeSkillName(skill);
    } catch {
      // Preserve the original validation error below.
    }
    return {
      host,
      id: skill?.id || null,
      skillName,
      action: 'failed',
      error: error instanceof Error ? error.message : String(error),
      restartRequired: false,
    };
  }
}

export async function reconcileNativeSkills(options = {}) {
  const hosts = options.hosts || [];
  const skills = options.skills || [];
  const results = {};
  const failures = [];
  for (const host of hosts) {
    assertSupportedHost(host);
    results[host] = [];
    for (const skill of skills) {
      const targetRoot = options.roots?.[host] || getNativeSkillRoot(host, options);
      const result = await reconcileNativeSkill({
        ...options,
        host,
        skill,
        targetRoot,
      });
      results[host].push(result);
      if (result.action === 'failed') failures.push(result);
    }
  }
  return {
    hosts,
    skillIds: skills.map(skill => skill.id),
    results,
    failed: failures.length,
    failures,
    restartRequired: Object.values(results).flat().some(result => result.restartRequired),
  };
}

async function unlinkReceipt(receiptPath) {
  await assertNoSymlinkPathComponents(receiptPath, 'Native skill receipt path');
  const stat = await fsp.lstat(receiptPath);
  assertRealEntry(stat, receiptPath, 'file');
  await fsp.unlink(receiptPath);
}

async function removeOrphanReceipt({
  receiptPath,
  receipt,
  receiptExpectation,
  targetDir,
  operations = {},
}) {
  const receiptDirectory = path.dirname(receiptPath);
  await assertSafeRoot(receiptDirectory, 'Native skill receipt directory');
  await assertReceiptUnchanged(receiptPath, receipt, receiptExpectation);
  const isolatedReceiptPath = path.join(
    receiptDirectory,
    `.${path.basename(receiptPath)}.rudi-orphan-${crypto.randomUUID()}`,
  );
  await fsp.rename(receiptPath, isolatedReceiptPath);

  try {
    await operations.afterOrphanReceiptIsolation?.(isolatedReceiptPath);
    const isolatedReceipt = await readReceipt(isolatedReceiptPath, receiptExpectation);
    if (receiptIdentityDigest(isolatedReceipt) !== receiptIdentityDigest(receipt)) {
      throw new Error(`Native skill receipt changed during orphan receipt removal: ${receiptPath}`);
    }
    const [currentTarget, currentReceipt] = await Promise.all([
      inspectTree(targetDir),
      readReceipt(receiptPath, receiptExpectation),
    ]);
    if (currentTarget || currentReceipt) {
      throw new Error(`Native skill state changed during orphan receipt removal: ${receiptPath}`);
    }
    await unlinkReceipt(isolatedReceiptPath);
  } catch (error) {
    let preservation = `prior receipt preserved at ${isolatedReceiptPath}`;
    try {
      const [currentTarget, currentReceipt] = await Promise.all([
        inspectTree(targetDir),
        readReceipt(receiptPath, receiptExpectation),
      ]);
      if (
        !currentReceipt
        && (!currentTarget || currentTarget.digest === receipt.renderedTreeDigest)
      ) {
        await fsp.link(isolatedReceiptPath, receiptPath);
        await fsp.unlink(isolatedReceiptPath);
        preservation = 'prior receipt restored';
      }
    } catch (restoreError) {
      preservation = `${preservation}; restoration check failed: ${restoreError.message}`;
    }
    throw new Error(`${error.message}; ${preservation}`, { cause: error });
  }
}

export async function removeNativeSkillProjection(options = {}) {
  const host = options.host;
  const skill = options.skill;
  try {
    assertSupportedHost(host);
    const skillName = normalizeNativeSkillName(skill);
    const targetRoot = path.resolve(options.targetRoot || getNativeSkillRoot(host, options));
    const receiptRoot = path.resolve(options.receiptRoot || getNativeSkillReceiptRoot(options));
    await assertSafeRoot(targetRoot, 'Native skill target root');
    await assertSafeRoot(receiptRoot, 'Native skill receipt root');
    const targetDir = path.join(targetRoot, skillName);
    const receiptPath = receiptPathFor(receiptRoot, host, skillName);
    const receiptExpectation = { host, skillId: skill.id, skillName, targetDir };
    const receipt = await readReceipt(receiptPath, receiptExpectation);
    const actual = await inspectTree(targetDir);
    const base = { host, id: skill.id, skillName, targetDir, receiptPath, restartRequired: false };
    if (!receipt) {
      return actual
        ? { ...base, action: 'unmanaged', reason: 'No RUDI ownership receipt; wrapper preserved' }
        : { ...base, action: 'missing' };
    }
    if (!actual) {
      if (options.dryRun === true) return { ...base, action: 'would_remove_receipt' };
      await removeOrphanReceipt({
        receiptPath,
        receipt,
        receiptExpectation,
        targetDir,
        operations: options.operations,
      });
      return { ...base, action: 'removed_receipt' };
    }
    if (actual.digest !== receipt.renderedTreeDigest) {
      return {
        ...base,
        action: 'drifted',
        reason: 'Managed wrapper differs from its receipt; wrapper and receipt preserved',
      };
    }
    if (options.dryRun === true) {
      return { ...base, action: 'would_remove', restartRequired: true };
    }
    const backupDir = path.join(targetRoot, `.${skillName}.rudi-remove-${crypto.randomUUID()}`);
    await assertSafeRoot(targetRoot, 'Native skill target root');
    await assertSafeRoot(receiptRoot, 'Native skill receipt root');
    await assertReceiptUnchanged(receiptPath, receipt, receiptExpectation);
    await fsp.rename(targetDir, backupDir);
    try {
      await options.operations?.afterRemoveRename?.(backupDir);
      const isolated = await inspectTree(backupDir);
      if (isolated?.digest !== actual.digest) {
        throw new Error(`Native skill target changed during removal: ${targetDir}`);
      }
      await assertReceiptUnchanged(receiptPath, receipt, receiptExpectation);
      await unlinkReceipt(receiptPath);
    } catch (error) {
      try {
        await fsp.rename(backupDir, targetDir);
      } catch (rollbackError) {
        throw new Error(
          `${error.message}; native skill removal rollback failed: ${rollbackError.message}`,
          { cause: error },
        );
      }
      throw error;
    }
    const warnings = [];
    try {
      await fsp.rm(backupDir, { recursive: true });
    } catch (error) {
      warnings.push(`Removed wrapper backup remains at ${backupDir}: ${error.message}`);
    }
    return { ...base, action: 'removed', restartRequired: true, warnings };
  } catch (error) {
    return {
      host,
      id: skill?.id || null,
      action: 'failed',
      error: error instanceof Error ? error.message : String(error),
      restartRequired: false,
    };
  }
}

export async function removeNativeSkillProjections(options = {}) {
  const results = {};
  const failures = [];
  for (const host of options.hosts || NATIVE_SKILL_HOSTS) {
    const result = await removeNativeSkillProjection({
      ...options,
      host,
      targetRoot: options.roots?.[host] || getNativeSkillRoot(host, options),
    });
    results[host] = result;
    if (result.action === 'failed') failures.push(result);
  }
  return {
    results,
    failed: failures.length,
    failures,
    restartRequired: Object.values(results).some(result => result.restartRequired),
  };
}

export async function summarizeNativeSkillHost(host, options = {}) {
  assertSupportedHost(host);
  const targetRoot = path.resolve(options.targetRoot || getNativeSkillRoot(host, options));
  const receiptRoot = path.resolve(options.receiptRoot || getNativeSkillReceiptRoot(options));
  try {
    await assertSafeRoot(targetRoot, 'Native skill target root');
    await assertSafeRoot(receiptRoot, 'Native skill receipt root');
  } catch (error) {
    return {
      current: 0,
      drifted: 0,
      missing: 0,
      failed: 1,
      totalManaged: 0,
      skillsSynchronized: false,
      error: error.message,
    };
  }
  const hostReceiptRoot = path.join(receiptRoot, host);
  const summary = { current: 0, drifted: 0, missing: 0, failed: 0, totalManaged: 0 };
  let names;
  try {
    const stat = await fsp.lstat(hostReceiptRoot);
    assertRealEntry(stat, hostReceiptRoot, 'directory');
    names = (await fsp.readdir(hostReceiptRoot)).filter(name => name.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return { ...summary, skillsSynchronized: false };
    return { ...summary, failed: 1, skillsSynchronized: false, error: error.message };
  }
  for (const name of names) {
    try {
      const skillName = name.slice(0, -'.json'.length);
      if (!SKILL_NAME_PATTERN.test(skillName)) throw new Error(`Invalid receipt name: ${name}`);
      const targetDir = path.join(targetRoot, skillName);
      const receipt = await readReceipt(path.join(hostReceiptRoot, name), {
        host,
        skillId: `skill:${skillName}`,
        skillName,
        targetDir,
      });
      const actual = await inspectTree(targetDir);
      summary.totalManaged += 1;
      if (!actual) summary.missing += 1;
      else if (actual.digest === receipt.renderedTreeDigest) summary.current += 1;
      else summary.drifted += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return {
    ...summary,
    skillsSynchronized: summary.totalManaged > 0
      && summary.current === summary.totalManaged
      && summary.failed === 0,
  };
}

export async function getManagedNativeSkillHosts(skill, options = {}) {
  const skillName = normalizeNativeSkillName(skill);
  const receiptRoot = path.resolve(options.receiptRoot || getNativeSkillReceiptRoot(options));
  await assertSafeRoot(receiptRoot, 'Native skill receipt root');
  const hosts = [];
  for (const host of NATIVE_SKILL_HOSTS) {
    const receiptPath = receiptPathFor(receiptRoot, host, skillName);
    const targetDir = path.join(getNativeSkillRoot(host, options), skillName);
    const receipt = await readReceipt(receiptPath, {
      host,
      skillId: skill.id,
      skillName,
      targetDir,
    });
    if (receipt) hosts.push(host);
  }
  return hosts;
}
