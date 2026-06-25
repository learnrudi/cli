## Phase 0: Baseline And Manual Lookup

- Scope: make first-time RUDI CLI setup install or refresh Codex's global managed RUDI instruction block so Codex can discover RUDI stacks, skills, and router-backed MCP tools.
- Files to inspect before editing: `src/commands/init.js`, `src/commands/instructions.js`, `src/__tests__/unit/instructions-command.test.js`, current git status.
- Relevant SWE manual sections: `10-Engineering-Operating-Manual-Index.md`; Appendix C / C7A in `01-Master-Engineering-Doctrine.txt`; F5 and F6 in `06-Security-Engineering-Standard.md`.
- Current-state commands: `git status -sb`; `sed` reads of init/instructions/tests; targeted manual retrieval.
- Risks and invariants: preserve user-written Codex instructions outside the managed RUDI block; do not print secrets; do not hardcode stack inventory; do not change MCP integration semantics.
- Exit criteria: existing behavior and dirty worktree context are understood before editing. Completed.

## Phase 1: Scope Lock

- In scope: generated RUDI instruction wording, first-run `rudi init` instruction installation helper, focused unit tests, and this checklist.
- Non-goals: registry changes, per-stack MCP config, RUDI router implementation, auth setup, unrelated help/route refactors.
- Expected files touched: `src/commands/init.js`, `src/commands/instructions.js`, `src/__tests__/unit/instructions-command.test.js`, `packages/utils/src/help.js`, this checklist.
- External inputs and trust boundaries: CLI flags, existing global `~/.codex/AGENTS.md` content, process home/cwd resolution.
- Failure behavior to define: instruction installation should be idempotent, backup an existing target before changing it, and record failures in init actions without aborting unrelated init work.
- Exit criteria: only scope-locked files are edited. Completed.

## Phase 2: Red Tests

- Observable behavior to prove: generated instructions tell Codex that RUDI uses `~/.rudi/stacks` and `~/.rudi/skills`; init's helper writes a managed Codex block under the supplied home and is idempotent on repeat.
- Test files to add or edit: `src/__tests__/unit/instructions-command.test.js`.
- Red command: `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js`.
- Expected failure: missing new instruction wording and missing init helper export before implementation.
- Exit criteria: expected red failure captured before source change. Completed: `installCodexInstructionBlock` export was missing.

## Phase 3: Implementation

- Implementation rules: reuse existing instruction block patching; add no dependencies; preserve managed block markers; keep opt-out explicit for automation.
- Files allowed to change: `src/commands/init.js`, `src/commands/instructions.js`.
- Validation and error-handling requirements: normalize supported opt-out flag shapes; resolve the Codex target through the existing target resolver; catch write errors and record them.
- Observability requirements: non-quiet init output names whether Codex instructions were installed, updated, unchanged, skipped, or failed.
- Exit criteria: red test passes unchanged. Completed.

## Phase 4: Green Tests And Refactor

- Green command: `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js`.
- Refactor constraints: no broad init cleanup, no unrelated command changes, no dist regeneration unless specifically required.
- Regression checks: `node --check src/commands/init.js`; `node --check src/commands/instructions.js`.
- Exit criteria: focused tests and syntax checks pass. Completed.

## Phase 5: Full Verification

- Targeted tests: instruction command tests.
- Full suite: run if feasible after focused checks; record any unrelated failure.
- Build/typecheck/lint: run syntax checks and a temp esbuild bundle check; do not run `npm run build` because the package build overwrites already-dirty generated `dist/` artifacts that predate this task.
- JS/TS debt scan, if applicable: run the repo's debt runner for edited JS/test files.
- Live smoke checks: run local CLI with `init --skip-downloads --quiet` against a temp `RUDI_HOME`/`HOME` and confirm `.codex/AGENTS.md` contains the managed block.
- Exit criteria: checks pass or residual risk is recorded. Completed.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: none beyond generated instruction text unless help tests reveal a documented flag surface.
- Final files touched: `src/commands/init.js`, `src/commands/instructions.js`, `src/__tests__/unit/instructions-command.test.js`, `packages/utils/src/help.js`, `docs/swe-compliance/2026-06-24-rudi-init-codex-instructions.md`.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js` failed before implementation with missing `installCodexInstructionBlock` export.
  - `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js` passed after implementation: 8 tests.
  - `node --check src/commands/init.js`, `node --check src/commands/instructions.js`, and `node --check packages/utils/src/help.js` passed.
  - `node scripts/run-tests.js src/__tests__/unit/commands.test.js` passed: 29 tests.
  - `node src/index.js help init | rg -n "no-agent-instructions|AGENTS.md RUDI block|rudi init --no-agent-instructions"` passed.
  - `node src/index.js instructions codex | rg -n "~/.rudi/stacks|~/.rudi/skills|single RUDI MCP router|rudi init"` passed.
  - Temp-home smoke: `HOME=<tmp>/home RUDI_HOME=<tmp>/rudi node src/index.js init --skip-downloads --quiet` created `<tmp>/home/.codex/AGENTS.md` with the managed RUDI block.
  - Temp-home opt-out smoke: `HOME=<tmp>/home RUDI_HOME=<tmp>/rudi node src/index.js init --skip-downloads --quiet --no-agent-instructions` did not create Codex instructions.
  - `node scripts/agent-debt-runner.mjs --edited src/commands/init.js,src/commands/instructions.js,src/__tests__/unit/instructions-command.test.js,packages/utils/src/help.js` passed with 0 findings.
  - Temp esbuild bundle check for `src/index.js` passed without writing `dist/`.
  - `npm test` failed with 999 passing and 4 failing tests, all reproduced in `src/__tests__/e2e/permissions-yolo.test.js`.
  - `node scripts/run-tests.js src/__tests__/e2e/permissions-yolo.test.js` reproduced the same 4 permission E2E failures outside this change.
  - `git diff --check -- src/commands/init.js src/commands/instructions.js src/__tests__/unit/instructions-command.test.js packages/utils/src/help.js docs/swe-compliance/2026-06-24-rudi-init-codex-instructions.md` passed.
- Accepted debt: full test suite is blocked by pre-existing permission E2E failures in `src/__tests__/e2e/permissions-yolo.test.js`; `npm run build` was not run to avoid overwriting unrelated dirty generated `dist/` files already present before this task.
- Definition of Done: targeted tests, syntax checks, debt scan, temp bundle proof, and temp-home init smoke proof complete; unrelated dirty files remain untouched.
