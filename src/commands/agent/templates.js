import fs from 'fs';
import path from 'path';
import os from 'os';
const USER_TEMPLATE_DIR = path.join(os.homedir(), '.rudi', 'templates');

function getRuntimeDirectories() {
  const dirs = new Set();
  if (typeof __dirname === 'string' && __dirname) {
    dirs.add(__dirname);
  }
  if (typeof process.argv[1] === 'string' && process.argv[1]) {
    dirs.add(path.dirname(path.resolve(process.argv[1])));
  }
  dirs.add(process.cwd());
  return Array.from(dirs);
}

function getTemplateDirectories() {
  const candidates = new Set();

  for (const baseDir of getRuntimeDirectories()) {
    candidates.add(path.resolve(baseDir, 'templates', 'run-groups'));
    candidates.add(path.resolve(baseDir, '..', 'templates', 'run-groups'));
    candidates.add(path.resolve(baseDir, '..', '..', 'templates', 'run-groups'));
    candidates.add(path.resolve(baseDir, '..', '..', '..', 'templates', 'run-groups'));
  }

  candidates.add(USER_TEMPLATE_DIR);
  return Array.from(candidates);
}

function readTemplateFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid template: ${filePath}`);
  }
  return parsed;
}

export function listRunGroupTemplates() {
  const deduped = new Map();

  for (const dir of getTemplateDirectories()) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const name = entry.name.replace(/\.json$/i, '');
      if (deduped.has(name)) continue;
      const filePath = path.join(dir, entry.name);
      let description = null;
      try {
        description = readTemplateFile(filePath).description || null;
      } catch {
        description = null;
      }
      deduped.set(name, {
        name,
        path: filePath,
        source: dir === USER_TEMPLATE_DIR ? 'user' : 'repo',
        description,
      });
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function loadRunGroupTemplate(name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw new Error('template name required');
  }

  const candidates = [
    normalizedName,
    normalizedName.endsWith('.json') ? normalizedName : `${normalizedName}.json`,
  ];

  for (const dir of getTemplateDirectories()) {
    for (const candidate of candidates) {
      const filePath = path.join(dir, candidate);
      if (!fs.existsSync(filePath)) continue;
      const template = readTemplateFile(filePath);
      return {
        ...template,
        name: template.name || normalizedName,
        templatePath: filePath,
      };
    }
  }

  throw new Error(`template not found: ${normalizedName}`);
}

export function resolveTemplateToRunGroupBody(template, overrides = {}) {
  if (!template || typeof template !== 'object') {
    throw new Error('template object required');
  }

  const tasks = Array.isArray(template.tasks) ? template.tasks : [];
  if (tasks.length === 0) {
    throw new Error(`template "${template.name || 'unknown'}" has no tasks`);
  }

  return {
    name: overrides.name ?? template.name ?? null,
    provider: overrides.provider ?? template.provider ?? 'claude',
    model: overrides.model ?? template.model ?? null,
    baseBranch: overrides.baseBranch ?? template.baseBranch ?? null,
    cwd: overrides.cwd ?? template.cwd ?? process.cwd(),
    permissionMode: overrides.permissionMode ?? template.permissionMode ?? null,
    systemPrompt: overrides.systemPrompt ?? template.systemPrompt ?? null,
    executionMode: overrides.executionMode ?? template.executionMode ?? 'worktree',
    useWorktree: overrides.useWorktree ?? template.useWorktree ?? true,
    coordinationMode: overrides.coordinationMode ?? template.coordinationMode ?? 'flat',
    sequentialPhases: overrides.sequentialPhases ?? template.sequentialPhases ?? null,
    allowValidationCommands: overrides.allowValidationCommands ?? template.allowValidationCommands ?? false,
    tasks,
  };
}
