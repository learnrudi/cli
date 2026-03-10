const EXECUTION_MODE_MAP = {
  worktree: 'worktree',
  shared: 'shared_cwd',
  shared_cwd: 'shared_cwd',
  read_only: 'read_only',
  readonly: 'read_only',
  detached: 'detached',
};

const COORDINATION_MODE_MAP = {
  flat: 'flat',
  phased: 'phased',
  supervisor: 'supervisor',
};

function trimOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => trimOrNull(entry))
    .filter(Boolean);
}

function normalizeIntegerArray(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number.isInteger(entry) ? entry : null)
    .filter((entry) => entry !== null && entry >= min && entry <= max);
}

export function normalizeExecutionMode(input, { useWorktree } = {}) {
  if (typeof input === 'string') {
    const normalized = EXECUTION_MODE_MAP[input.trim().toLowerCase()];
    if (normalized) return normalized;
  }
  return useWorktree === false ? 'shared_cwd' : 'worktree';
}

export function normalizeCoordinationMode(input) {
  if (typeof input === 'string') {
    const normalized = COORDINATION_MODE_MAP[input.trim().toLowerCase()];
    if (normalized) return normalized;
  }
  return 'flat';
}

export function normalizeTaskSpec(task, idx, defaults = {}) {
  if (typeof task === 'string') {
    return {
      prompt: task.trim(),
      name: null,
      provider: defaults.provider || null,
      model: defaults.model || null,
      role: null,
      goal: null,
      deliverable: null,
      rationale: null,
      filesTouched: [],
      dependsOn: [],
      requiresWrite: null,
      contextPaths: [],
      artifactsIn: [],
      artifactsOut: [],
      metadata: {},
    };
  }

  if (!task || typeof task !== 'object') {
    return {
      prompt: '',
      name: `Task ${idx + 1}`,
      provider: defaults.provider || null,
      model: defaults.model || null,
      role: null,
      goal: null,
      deliverable: null,
      rationale: null,
      filesTouched: [],
      dependsOn: [],
      requiresWrite: null,
      contextPaths: [],
      artifactsIn: [],
      artifactsOut: [],
      metadata: {},
    };
  }

  const metadata = {};
  for (const [key, value] of Object.entries(task)) {
    if ([
      'prompt', 'name', 'provider', 'model', 'role', 'goal', 'deliverable', 'rationale',
      'files_touched', 'filesTouched', 'depends_on', 'dependsOn', 'requires_write', 'requiresWrite',
      'context_paths', 'contextPaths', 'artifacts_in', 'artifactsIn', 'artifacts_out', 'artifactsOut',
    ].includes(key)) {
      continue;
    }
    metadata[key] = value;
  }

  return {
    prompt: trimOrNull(task.prompt) || '',
    name: trimOrNull(task.name),
    provider: trimOrNull(task.provider) || defaults.provider || null,
    model: trimOrNull(task.model) || defaults.model || null,
    role: trimOrNull(task.role),
    goal: trimOrNull(task.goal),
    deliverable: trimOrNull(task.deliverable),
    rationale: trimOrNull(task.rationale),
    filesTouched: normalizeStringArray(task.filesTouched ?? task.files_touched),
    dependsOn: normalizeIntegerArray(task.dependsOn ?? task.depends_on),
    requiresWrite: typeof (task.requiresWrite ?? task.requires_write) === 'boolean'
      ? (task.requiresWrite ?? task.requires_write)
      : null,
    contextPaths: normalizeStringArray(task.contextPaths ?? task.context_paths),
    artifactsIn: normalizeStringArray(task.artifactsIn ?? task.artifacts_in),
    artifactsOut: normalizeStringArray(task.artifactsOut ?? task.artifacts_out),
    metadata,
  };
}

export function normalizeGroupTasks(body, defaults = {}) {
  const rawTasks = Array.isArray(body?.tasks)
    ? body.tasks
    : (Array.isArray(body?.prompts) ? body.prompts : []);

  return rawTasks
    .map((task, idx) => normalizeTaskSpec(task, idx, defaults))
    .filter((task) => task.prompt.length > 0);
}

export function buildPhasePlan(tasks, sequentialPhases) {
  const indices = tasks.map((_, idx) => idx);
  if (!Array.isArray(sequentialPhases) || sequentialPhases.length === 0) {
    return indices.length > 0 ? [indices] : [];
  }

  const seen = new Set();
  const phases = [];
  for (const phase of sequentialPhases) {
    if (!Array.isArray(phase)) continue;
    const normalized = [];
    for (const rawIdx of phase) {
      if (!Number.isInteger(rawIdx)) continue;
      if (rawIdx < 0 || rawIdx >= tasks.length) continue;
      if (seen.has(rawIdx)) continue;
      seen.add(rawIdx);
      normalized.push(rawIdx);
    }
    if (normalized.length > 0) phases.push(normalized);
  }

  const remainder = indices.filter((idx) => !seen.has(idx));
  if (remainder.length > 0) phases.push(remainder);
  return phases;
}
