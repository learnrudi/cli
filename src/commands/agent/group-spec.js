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
  dependency: 'dependency',
  supervisor: 'supervisor',
};

const FAILURE_POLICIES = new Set(['stop-all', 'stop-downstream', 'continue', 'escalate']);
const MERGE_POLICIES = new Set(['git', 'manual', 'synthesize', 'concatenate']);
const EVIDENCE_TYPES = new Set(['artifact_exists', 'json_file', 'command']);
const IO_TYPES = new Set(['file', 'directory']);

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

function normalizeStringArrayUnique(value) {
  return [...new Set(normalizeStringArray(value))];
}

function normalizeCommandSpec(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' ? entry.trim() : '')
      .filter(Boolean);
  }
  const single = trimOrNull(value);
  return single ? [single] : [];
}

function normalizeIoSpecArray(value) {
  if (!Array.isArray(value)) return [];

  const normalized = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const type = trimOrNull(entry.type);
    const path = trimOrNull(entry.path);
    if (!type || !path || !IO_TYPES.has(type)) continue;
    normalized.push({
      type,
      path,
      optional: entry.optional === true,
    });
  }
  return normalized;
}

function normalizeEvidenceSpec(value) {
  if (!value || typeof value !== 'object') return null;
  const type = trimOrNull(value.type);
  if (!type || !EVIDENCE_TYPES.has(type)) return null;

  const path = trimOrNull(value.path);
  const command = normalizeCommandSpec(value.command ?? value.argv);
  if ((type === 'artifact_exists' || type === 'json_file') && !path) return null;
  if (type === 'command' && command.length === 0) return null;

  return {
    type,
    path,
    command,
  };
}

function normalizeOutputSpec(value) {
  if (!value || typeof value !== 'object') return null;
  const type = trimOrNull(value.type);
  const outputPath = trimOrNull(value.path);
  if (!type || !outputPath || !IO_TYPES.has(type)) return null;
  return {
    type,
    path: outputPath,
  };
}

function normalizeDependencySpec(value, fallbackDependsOn = []) {
  const normalized = [];
  const seen = new Set();
  const pushEntry = (taskIndex, artifact = null) => {
    if (!Number.isInteger(taskIndex) || taskIndex < 0) return;
    const normalizedArtifact = trimOrNull(artifact);
    const dedupeKey = `${taskIndex}:${normalizedArtifact || ''}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push({
      taskIndex,
      artifact: normalizedArtifact,
    });
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (Number.isInteger(entry)) {
        pushEntry(entry);
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      pushEntry(entry.taskIndex, entry.artifact);
    }
  }

  for (const taskIndex of normalizeIntegerArray(fallbackDependsOn)) {
    if (normalized.some((entry) => entry.taskIndex === taskIndex)) continue;
    pushEntry(taskIndex);
  }

  return normalized;
}

function normalizePolicy(value, allowedValues) {
  const normalized = trimOrNull(value);
  return normalized && allowedValues.has(normalized) ? normalized : null;
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
      scope: null,
      provider: defaults.provider || null,
      model: defaults.model || null,
      role: null,
      goal: null,
      deliverable: null,
      rationale: null,
      inputs: [],
      tools: [],
      evidence: null,
      output: null,
      dependencies: [],
      failurePolicy: null,
      mergePolicy: null,
      validation: null,
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
      scope: null,
      provider: defaults.provider || null,
      model: defaults.model || null,
      role: null,
      goal: null,
      deliverable: null,
      rationale: null,
      inputs: [],
      tools: [],
      evidence: null,
      output: null,
      dependencies: [],
      failurePolicy: null,
      mergePolicy: null,
      validation: null,
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
      'prompt', 'name', 'scope', 'provider', 'model', 'role', 'goal', 'deliverable', 'rationale',
      'inputs', 'tools', 'evidence', 'output', 'dependencies',
      'failure_policy', 'failurePolicy', 'merge_policy', 'mergePolicy',
      'validation', 'validation_command', 'validationCommand',
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
    scope: trimOrNull(task.scope),
    provider: trimOrNull(task.provider) || defaults.provider || null,
    model: trimOrNull(task.model) || defaults.model || null,
    role: trimOrNull(task.role),
    goal: trimOrNull(task.goal),
    deliverable: trimOrNull(task.deliverable),
    rationale: trimOrNull(task.rationale),
    inputs: normalizeIoSpecArray(task.inputs),
    tools: normalizeStringArrayUnique(task.tools),
    evidence: normalizeEvidenceSpec(task.evidence),
    output: normalizeOutputSpec(task.output),
    dependencies: normalizeDependencySpec(task.dependencies, task.dependsOn ?? task.depends_on),
    failurePolicy: normalizePolicy(task.failurePolicy ?? task.failure_policy, FAILURE_POLICIES),
    mergePolicy: normalizePolicy(task.mergePolicy ?? task.merge_policy, MERGE_POLICIES),
    validation: (() => {
      if (!task.validation && !task.validationCommand && !task.validation_command) return null;
      const source = task.validation && typeof task.validation === 'object'
        ? task.validation
        : { command: task.validationCommand ?? task.validation_command };
      const command = normalizeCommandSpec(source.command ?? source.argv);
      return command.length > 0 ? { command } : null;
    })(),
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
