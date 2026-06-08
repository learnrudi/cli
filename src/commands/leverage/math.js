const FRONTEND_PRESET = {
  soloMinutes: 480,
  budgetMinutes: 480,
  specMinutes: 60,
  reviewMinutes: 30,
  agentRoles: 3,
  agentMinutesPerRole: 20,
  parallelAgents: true,
};

const DEFAULT_INPUT = {
  budgetMinutes: null,
  specMinutes: 0,
  reviewMinutes: 0,
  agentRoles: 1,
  agentMinutesPerRole: 20,
  parallelAgents: true,
};

function roundTo(value, decimals = 2) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function coerceNumber(name, value, { required = false, min = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error(`${name} is required.`);
    }
    return undefined;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a number.`);
  }

  if (number < min) {
    throw new Error(`${name} must be at least ${min}.`);
  }

  return number;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function getPreset(args) {
  const presetName = args[0];

  if (!presetName) {
    return {};
  }

  if (presetName === 'frontend' || presetName === 'frontend-design') {
    return FRONTEND_PRESET;
  }

  throw new Error(`Unknown leverage preset: ${presetName}`);
}

export function normalizeWorkflowInput(args = [], flags = {}) {
  const preset = getPreset(args);
  const soloMinutes = coerceNumber(
    'solo minutes',
    firstDefined(flags.solo, flags['solo-minutes'], preset.soloMinutes),
    { required: true, min: 1 },
  );
  const budgetMinutes = coerceNumber(
    'budget minutes',
    firstDefined(flags.budget, flags['budget-minutes'], preset.budgetMinutes, soloMinutes),
    { min: 1 },
  );
  const specMinutes = coerceNumber(
    'spec minutes',
    firstDefined(flags.spec, flags['spec-minutes'], preset.specMinutes, DEFAULT_INPUT.specMinutes),
  );
  const reviewMinutes = coerceNumber(
    'review minutes',
    firstDefined(flags.review, flags['review-minutes'], preset.reviewMinutes, DEFAULT_INPUT.reviewMinutes),
  );
  const agentRoles = coerceNumber(
    'agent roles',
    firstDefined(flags.agents, flags.roles, flags['agent-roles'], preset.agentRoles, DEFAULT_INPUT.agentRoles),
    { min: 1 },
  );
  const agentMinutesPerRole = coerceNumber(
    'agent minutes',
    firstDefined(
      flags['agent-minutes'],
      flags['agent-minutes-per-role'],
      preset.agentMinutesPerRole,
      DEFAULT_INPUT.agentMinutesPerRole,
    ),
  );
  const parallelAgents = flags.serial ? false : firstDefined(preset.parallelAgents, DEFAULT_INPUT.parallelAgents);

  return {
    soloMinutes,
    budgetMinutes,
    specMinutes,
    reviewMinutes,
    agentRoles,
    agentMinutesPerRole,
    parallelAgents,
  };
}

export function calculateWorkflowLeverage(input) {
  const normalized = {
    ...DEFAULT_INPUT,
    ...input,
  };

  const soloMinutes = coerceNumber('solo minutes', normalized.soloMinutes, { required: true, min: 1 });
  const budgetMinutes = coerceNumber('budget minutes', normalized.budgetMinutes ?? soloMinutes, { min: 1 });
  const specMinutes = coerceNumber('spec minutes', normalized.specMinutes);
  const reviewMinutes = coerceNumber('review minutes', normalized.reviewMinutes);
  const agentRoles = coerceNumber('agent roles', normalized.agentRoles, { min: 1 });
  const agentMinutesPerRole = coerceNumber('agent minutes', normalized.agentMinutesPerRole);
  const humanAttentionMinutes = specMinutes + reviewMinutes;
  const agentWorkMinutes = agentRoles * agentMinutesPerRole;
  const agentWallClockMinutes = normalized.parallelAgents ? agentMinutesPerRole : agentWorkMinutes;
  const elapsedMinutes = humanAttentionMinutes + agentWallClockMinutes;
  const leverage = humanAttentionMinutes === 0 ? Infinity : soloMinutes / humanAttentionMinutes;
  const capacity = humanAttentionMinutes === 0 ? Infinity : budgetMinutes / humanAttentionMinutes;

  return {
    soloMinutes: roundTo(soloMinutes),
    budgetMinutes: roundTo(budgetMinutes),
    specMinutes: roundTo(specMinutes),
    reviewMinutes: roundTo(reviewMinutes),
    humanAttentionMinutes: roundTo(humanAttentionMinutes),
    agentRoles: roundTo(agentRoles),
    agentMinutesPerRole: roundTo(agentMinutesPerRole),
    agentWorkMinutes: roundTo(agentWorkMinutes),
    agentWallClockMinutes: roundTo(agentWallClockMinutes),
    elapsedMinutes: roundTo(elapsedMinutes),
    leverage: roundTo(leverage),
    capacity: roundTo(capacity),
    timeSavedMinutes: roundTo(soloMinutes - humanAttentionMinutes),
    parallelAgents: Boolean(normalized.parallelAgents),
  };
}
