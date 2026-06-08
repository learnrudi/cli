## Phase 0: Baseline And Manual Lookup

- Scope: add stack-related skill guidance to generated RUDI agent instructions and make the existing local `instructions` command commit-ready.
- Files to inspect before editing: `src/commands/instructions.js`, `src/__tests__/unit/instructions-command.test.js`, `src/index.js`, `packages/utils/src/help.js`, current git status.
- Relevant SWE manual sections: `10-Engineering-Operating-Manual-Index.md`; Appendix C / C7A in `01-Master-Engineering-Doctrine.txt`.
- Current-state commands: `git status -sb`; `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js`.
- Risks and invariants: do not stage unrelated local command work; generated instructions must stay inventory-discovery-first and must not hardcode installed stacks, secrets, or host-specific paths beyond documented RUDI defaults.
- Exit criteria: existing instruction tests pass before adding the red assertion.

## Phase 1: Scope Lock

- In scope: `rudi instructions` command file, its unit test, route/help entries needed to expose it, and generated guidance for related skills.
- Non-goals: dynamic inventory rendering, daemon/runtime/local-LLM/leverage command work, unrelated help updates, registry changes.
- Expected files touched: `src/commands/instructions.js`, `src/__tests__/unit/instructions-command.test.js`, `src/index.js`, `packages/utils/src/help.js`, this checklist.
- External inputs and trust boundaries: agent argument normalization, explicit instruction file path, existing instruction file contents.
- Failure behavior to define: conflicting `--install`/`--remove`; generic install/remove without `--path`; idempotent managed block replacement.
- Exit criteria: only instruction-specific hunks are edited or staged.

## Phase 2: Red Tests

- Observable behavior to prove: generated instructions explain that stacks may declare related skills and name the install flag that carries them.
- Test files to add or edit: `src/__tests__/unit/instructions-command.test.js`.
- Red command: `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js`.
- Expected failure: assertion looking for related-skill guidance fails before implementation.
- Exit criteria: red failure captured before source change.

## Phase 3: Implementation

- Implementation rules: add static discover-first guidance only; do not hardcode local Hoff Digital skills or current installed inventory.
- Files allowed to change: `src/commands/instructions.js`, `src/index.js`, `packages/utils/src/help.js`.
- Validation and error-handling requirements: preserve existing command validation and idempotent block patch/remove behavior.
- Observability requirements: command output and JSON payload remain explicit about target path, action, dry run, and backup path.
- Exit criteria: red test passes unchanged.

## Phase 4: Green Tests And Refactor

- Green command: `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js`.
- Refactor constraints: no broad command/help cleanup; no unrelated command feature staging.
- Regression checks: `node scripts/run-tests.js src/__tests__/unit/commands.test.js`.
- Exit criteria: instruction and command-export tests pass.

## Phase 5: Full Verification

- Targeted tests: instruction command tests and command export tests.
- Full suite: `npm test`.
- Build/typecheck/lint: `npm run build`.
- JS/TS debt scan, if applicable: run agent debt scan for edited JS files.
- Live smoke checks: run `rudi instructions codex` through the local CLI and confirm related-skill guidance appears.
- Exit criteria: all checks pass or residual risk is recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: CLI help for `rudi instructions`.
- Final files touched: `src/commands/instructions.js`, `src/__tests__/unit/instructions-command.test.js`, `src/index.js`, `src/__tests__/unit/commands.test.js`, `packages/utils/src/help.js`, this checklist.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js` passed before the red assertion.
  - `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js` failed on the expected missing related-skill guidance assertion.
  - `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js` passed after implementation.
  - `node scripts/run-tests.js src/__tests__/unit/commands.test.js` passed.
  - `node src/index.js instructions codex | rg -n "related skills|--with-related-skills|rudi integrate codex"` passed.
  - `node src/index.js help instructions | rg -n "rudi instructions|--install|--remove"` passed.
  - `npm run build` passed.
  - `npm test` passed with 664 tests.
  - `node scripts/agent-debt-runner.mjs --edited src/commands/instructions.js,src/__tests__/unit/instructions-command.test.js,src/index.js,packages/utils/src/help.js,src/__tests__/unit/commands.test.js` passed with 0 findings.
- Accepted debt: dirty worktree contains unrelated local changes that remain unstaged.
- Definition of Done: tests, build, debt scan, smoke check, and isolated commit complete.
