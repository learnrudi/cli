import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getModelDef, loadProviderConfig } from './providers/catalog.js';

const validatedProfiles = new WeakSet();
export const TASK_MODE = 'registered-shared';
export const TASK_MAX_BYTES = 262144;

export function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw new Error(`${label} has invalid fields`);
  }
}

export function taskText(value, label, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || !value.isWellFormed()
      || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value) > max) {
    throw new Error(`${label} must be bounded valid text`);
  }
  return value;
}

export function inside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function canonicalDirectory(value, label) {
  taskText(value, label);
  if (!path.isAbsolute(value) || path.normalize(value) !== value || /[\*?\[\]]/u.test(value)
      || fs.realpathSync(value) !== value || !fs.statSync(value).isDirectory()) {
    throw new Error(`${label} must be an existing canonical directory without aliases or glob characters`);
  }
  return value;
}

export function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

export function readTaskReference(reference, label) {
  exactFields(reference, ['path', 'sha256'], label);
  taskText(reference.path, `${label} path`);
  if (!/^[a-f0-9]{64}$/u.test(reference.sha256)) throw new Error(`${label} requires SHA-256`);
  const name = reference.path;
  if (!path.isAbsolute(name) || fs.realpathSync(name) !== name) throw new Error(`${label} path must be canonical`);
  const bytes = readTaskRegularFile(name, TASK_MAX_BYTES);
  if (bytes.length < 1 || sha256(bytes) !== reference.sha256) throw new Error(`${label} hash mismatch`);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// Open nonblocking before fstat so a FIFO cannot wedge the host. Read at most
// maximum + 1 bytes even if a file grows after stat; special files never reach read.
export function readTaskRegularFile(filename, maximum, singleLink = false) {
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  const fd = fs.openSync(filename, flags);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > maximum || (singleLink && before.nlink !== 1)) {
      throw new Error('invalid bounded regular file or hardlink');
    }
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size <= maximum) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fs.fstatSync(fd);
    if (size > maximum || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('file overflow or changed during verification');
    }
    return buffer.subarray(0, size);
  } finally { fs.closeSync(fd); }
}

function roots(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error(`${label} requires 1..16 roots`);
  const result = value.map(entry => canonicalDirectory(entry, label));
  if (new Set(result).size !== result.length) throw new Error(`${label} duplicates`);
  return result;
}

export function validateTaskProfile(value, binding) {
  exactFields(value, ['schema_version', 'provider', 'model', 'workspace_mode', 'working_directory',
    'read_roots', 'write_roots', 'network', 'timeout_ms',
    ...(value?.provider === 'claude' || Object.hasOwn(value || {}, 'account') ? ['account'] : []),
    ...(Object.hasOwn(value || {}, 'reasoning_effort') ? ['reasoning_effort'] : [])], 'execution profile');
  if (value.schema_version !== 1 || !['codex', 'claude'].includes(value.provider) || value.workspace_mode !== TASK_MODE) {
    throw new Error('unsupported task provider/profile version/workspace mode');
  }
  const model = getModelDef(loadProviderConfig(value.provider), value.model);
  if (model?.id !== value.model) throw new Error('task requires an exact configured model');
  if (Object.hasOwn(value, 'reasoning_effort') && !model.reasoningEfforts?.includes(value.reasoning_effort)) {
    throw new Error('unsupported reasoning effort for task provider/model');
  }
  if (!['enabled', 'disabled'].includes(value.network)) throw new Error('network must be enabled or disabled');
  if (!Number.isSafeInteger(value.timeout_ms) || value.timeout_ms < 1 || value.timeout_ms > 3600000) throw new Error('invalid task timeout');
  const project = canonicalDirectory(value.working_directory, 'working_directory');
  const read = roots(value.read_roots, 'read roots');
  const write = roots(value.write_roots, 'write roots');
  const runtime = canonicalDirectory(binding.outputs.runtime, 'runtime');
  const deliverables = roots(binding.outputs.deliverables, 'deliverables');
  if (project !== binding.working_directory || !read.includes(project)) throw new Error('shared working directory must match and be a read root');
  if ([...write].sort().join('\0') !== [...deliverables].sort().join('\0')
      || write.some(root => inside(project, root) || inside(runtime, root) || inside(root, runtime))) {
    throw new Error('write roots must exactly match deliverables and exclude project/control roots');
  }
  const account = value.provider === 'claude' ? validateClaudeAccount(value.account, [...read, ...write, runtime])
    : Object.hasOwn(value, 'account') ? validateCodexAccount(value.account, [...read, ...write, runtime]) : null;
  const profile = Object.freeze({ ...value, ...(account ? { account } : {}), read_roots: Object.freeze(read), write_roots: Object.freeze(write) });
  assertWritableTaskRoots(profile);
  validatedProfiles.add(profile);
  return profile;
}

function validateCodexAccount(value, workspaceRoots) {
  exactFields(value, ['id', 'email', 'config_directory'], 'Codex account');
  if (typeof value.id !== 'string' || !/^codex-[a-z0-9][a-z0-9-]{0,47}$/u.test(value.id)) throw new Error('invalid Codex account id');
  taskText(value.email, 'Codex account email', 254);
  if (!/^[^\s@]+@[^\s@]+$/u.test(value.email)) throw new Error('invalid Codex account email');
  const directory = canonicalDirectory(value.config_directory, 'Codex account directory');
  const stat = fs.statSync(directory);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error('Codex account directory must be private and owned by this user');
  if (workspaceRoots.some(root => inside(root, directory) || inside(directory, root))) throw new Error('Codex account directory overlaps task roots');
  // The native account probe cannot ignore user config. Dedicated account
  // homes therefore carry authentication/session state only, never config.
  for (const name of ['config.toml', 'managed_config.toml', 'requirements.toml']) {
    if (fs.existsSync(path.join(directory, name))) throw new Error('Codex account configuration requires separate qualification');
  }
  return Object.freeze({ ...value });
}

export function assertTaskProfile(profile) {
  if (!validatedProfiles.has(profile)) throw new Error('registered shared workspace requires a validated task profile');
}

// Path sandboxes cannot make an existing hardlink safe: writing the allowed
// name changes the read-only inode too. Reject aliases before provider startup.
export function assertWritableTaskRoots(profile) {
  const pending = [...profile.write_roots];
  let visited = 0;
  while (pending.length) {
    if (++visited > 100000) throw new Error('task writable tree exceeds preflight limit');
    const filename = pending.pop();
    const entry = fs.lstatSync(filename);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error('task writable tree contains a symlink or special file');
    }
    if (entry.isFile() && entry.nlink !== 1) throw new Error('task writable tree contains a hardlink');
    if (entry.isDirectory()) {
      for (const name of fs.readdirSync(filename)) pending.push(path.join(filename, name));
    }
  }
}

export function parseTaskJson(source) {
  const value = JSON.parse(source, (_key, entry) => {
    if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('non-finite task JSON');
    return entry;
  });
  // Syntax is already validated by JSON.parse. Track object keys over JSON's
  // string/punctuation tokens so escaped spellings cannot hide duplicate keys.
  const stack = [];
  for (const [token] of source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/gu)) {
    const frame = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && frame) frame.key = true;
    else if (token.startsWith('"') && frame?.key) {
      const key = JSON.parse(token);
      if (frame.keys.has(key)) throw new Error('duplicate task JSON key');
      frame.keys.add(key);
      frame.key = false;
    }
  }
  return value;
}

// Credentials and transcripts are host state, never part of a task workspace.
function validateClaudeAccount(value, workspaceRoots) {
  exactFields(value, ['id','email','organization_id','config_directory','anthropic_directory'], 'Claude account');
  if (typeof value.id !== 'string' || !/^claude-[a-z0-9][a-z0-9-]{0,47}$/u.test(value.id)) throw new Error('invalid Claude account id');
  taskText(value.email, 'Claude account email', 254);
  taskText(value.organization_id, 'Claude organization id', 128);
  if (!/^[^\s@]+@[^\s@]+$/u.test(value.email)) throw new Error('invalid Claude account email');
  const directories = [value.config_directory, value.anthropic_directory];
  for (const directory of directories) {
    canonicalDirectory(directory, 'Claude account directory');
    const stat = fs.statSync(directory);
    if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw new Error('Claude account directory must be private and owned by this user');
    if (workspaceRoots.some(root => inside(root, directory) || inside(directory, root))) throw new Error('Claude account directory overlaps task roots');
  }
  if (inside(directories[0],directories[1]) || inside(directories[1],directories[0])) throw new Error('Claude account directories overlap');
  return Object.freeze({...value});
}
