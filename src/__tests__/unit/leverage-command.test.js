import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateWorkflowLeverage,
  normalizeWorkflowInput,
} from '../../commands/leverage/math.js';
import { cmdLeverage } from '../../commands/leverage.js';

let logLines = [];
const originalLog = console.log;

beforeEach(() => {
  logLines = [];
  console.log = (...args) => {
    logLines.push(args.join(' '));
  };
});

test.after(() => {
  console.log = originalLog;
});

test('leverage math calculates human attention, elapsed time, and capacity for a parallel workflow', () => {
  const result = calculateWorkflowLeverage({
    soloMinutes: 480,
    budgetMinutes: 480,
    specMinutes: 60,
    reviewMinutes: 30,
    agentRoles: 3,
    agentMinutesPerRole: 20,
    parallelAgents: true,
  });

  assert.deepEqual(result, {
    soloMinutes: 480,
    budgetMinutes: 480,
    specMinutes: 60,
    reviewMinutes: 30,
    humanAttentionMinutes: 90,
    agentRoles: 3,
    agentMinutesPerRole: 20,
    agentWorkMinutes: 60,
    agentWallClockMinutes: 20,
    elapsedMinutes: 110,
    leverage: 5.33,
    capacity: 5.33,
    timeSavedMinutes: 390,
    parallelAgents: true,
  });
});

test('leverage math separates serial elapsed time from human attention leverage', () => {
  const result = calculateWorkflowLeverage({
    soloMinutes: 480,
    budgetMinutes: 480,
    specMinutes: 60,
    reviewMinutes: 30,
    agentRoles: 3,
    agentMinutesPerRole: 20,
    parallelAgents: false,
  });

  assert.equal(result.humanAttentionMinutes, 90);
  assert.equal(result.agentWallClockMinutes, 60);
  assert.equal(result.elapsedMinutes, 150);
  assert.equal(result.leverage, 5.33);
});

test('normalization supports the frontend workflow preset with overrides', () => {
  const input = normalizeWorkflowInput(['frontend'], {
    review: '45',
    budget: '600',
  });

  assert.equal(input.soloMinutes, 480);
  assert.equal(input.budgetMinutes, 600);
  assert.equal(input.specMinutes, 60);
  assert.equal(input.reviewMinutes, 45);
  assert.equal(input.agentRoles, 3);
  assert.equal(input.agentMinutesPerRole, 20);
});

test('command prints JSON workflow result', async () => {
  await cmdLeverage([], {
    solo: '480',
    spec: '60',
    review: '30',
    agents: '3',
    'agent-minutes': '20',
    json: true,
  });

  const payload = JSON.parse(logLines.join('\n'));

  assert.equal(payload.humanAttentionMinutes, 90);
  assert.equal(payload.agentWallClockMinutes, 20);
  assert.equal(payload.leverage, 5.33);
});
