import {
  calculateWorkflowLeverage,
  normalizeWorkflowInput,
} from './leverage/math.js';

function formatNumber(value) {
  if (!Number.isFinite(value)) return 'unbounded';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatMinutes(value) {
  return `${formatNumber(value)} min`;
}

function printUsage() {
  console.log(`rudi leverage - Calculate agent workflow leverage

USAGE
  rudi leverage [preset] [options]

PRESETS
  frontend                 8h design/engineer/QA workflow baseline

OPTIONS
  --solo <min>             Solo workflow minutes
  --budget <min>           Human attention budget (default: solo minutes)
  --spec <min>             Human spec/direction minutes
  --review <min>           Human final review/fix minutes
  --agents <n>             Number of agent roles/workstreams
  --agent-minutes <min>    Agent minutes per role
  --serial                 Agents run serially instead of in parallel
  --json                   Output JSON

EXAMPLES
  rudi leverage frontend
  rudi leverage --solo 480 --spec 60 --review 30 --agents 3 --agent-minutes 20
  rudi leverage --solo 480 --spec 60 --review 30 --agents 3 --agent-minutes 20 --serial
`);
}

function printHumanResult(result) {
  console.log('Workflow leverage');
  console.log('');
  console.log(`Solo workflow:        ${formatMinutes(result.soloMinutes)}`);
  console.log(`Human attention:      ${formatMinutes(result.humanAttentionMinutes)}`);
  console.log(`  Spec/direction:     ${formatMinutes(result.specMinutes)}`);
  console.log(`  Review/fix:         ${formatMinutes(result.reviewMinutes)}`);
  console.log('');
  console.log(`Agent roles:          ${formatNumber(result.agentRoles)}`);
  console.log(`Agent time/role:      ${formatMinutes(result.agentMinutesPerRole)}`);
  console.log(`Agent wall-clock:     ${formatMinutes(result.agentWallClockMinutes)} ${result.parallelAgents ? '(parallel)' : '(serial)'}`);
  console.log(`Elapsed time:         ${formatMinutes(result.elapsedMinutes)}`);
  console.log('');
  console.log(`Leverage:             ${formatNumber(result.leverage)}x`);
  console.log(`Capacity:             ${formatNumber(result.capacity)} workflows / block`);
  console.log(`Human time saved:     ${formatMinutes(result.timeSavedMinutes)}`);
}

export async function cmdLeverage(args, flags) {
  if (flags.help || flags.h) {
    printUsage();
    return;
  }

  const input = normalizeWorkflowInput(args, flags);
  const result = calculateWorkflowLeverage(input);

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHumanResult(result);
}
