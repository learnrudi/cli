## Phase 0: Baseline And Manual Lookup

- Scope: Issue #6, archive legacy DB/session/run-group commands out of the default CLI discovery surface while preserving compatibility command dispatch.
- Files to inspect before editing: `packages/utils/src/help.js`, `src/index.js`, `src/commands/db.js`, `src/commands/session.js`, `src/commands/run-group.js`, `src/commands/parallel.js`, `README.md`, `AGENTS.md`, relevant unit tests under `src/__tests__/unit/`, and current git status.
- Relevant SWE manual sections: `10-Engineering-Operating-Manual-Index.md`; core principles and Appendix C / C7A in `01-Master-Engineering-Doctrine.txt`; backend lifecycle/configuration sections G9-G12 in `07-Backend-Application-Engineering-Standard.md`; security trust-boundary/secrets guidance in `06-Security-Engineering-Standard.md`.
- Current-state commands: `git status -sb`; `git remote -v`; `gh repo view --json nameWithOwner,visibility,defaultBranchRef`; targeted `rg`/`sed` reads; `node src/index.js --help` before edits.
- Risks and invariants: do not delete `packages/db`; do not break existing users who call `rudi db`, `rudi session`, `rudi parallel`, or `rudi run-group`; do not rename `.rudi-lite-*` files here; core install/router/index/integrate/init flows must remain independent of DB/session code; never print secrets, tokens, or session content during verification.
- Exit criteria: baseline state and manual guidance are recorded before edits. Completed.

## Phase 1: Scope Lock

- In scope: remove DB/session/run-group/Lite orchestration commands from default help; add compatibility notices to command-specific help; remove the legacy DB auto-fix from core `rudi doctor`; align README and project instructions language where they present command inventory; add focused tests.
- Non-goals: delete DB/session/run-group implementation; remove command aliases or dispatch; modify sidecar routes, daemon schemas, database schema, session importers, or `.rudi-lite-*` files; change destructive DB/session command behavior.
- Expected files touched: `packages/utils/src/help.js`, `src/commands/doctor.js`, legacy command help text, `README.md`, `AGENTS.md`, focused unit tests, and this checklist. `src/index.js` may change only for the stale top-level command inventory comment.
- External inputs and trust boundaries: CLI help arguments, user-facing command discovery output, existing database/session files, sidecar token/port files, and docs consumed by users and agents.
- Failure behavior to define: compatibility commands remain callable and keep their existing failure behavior; default help should no longer imply DB/session/run-group are current core RUDI workflows.
- Exit criteria: touched files remain within the public-surface archival boundary. Completed.

## Phase 2: Red Tests

- Observable behavior to prove: default `printHelp()` omits first-class `DATABASE` and `SESSIONS` sections and omits `parallel <tasks...>` / `run-group <cmd>` from the primary `RUN` section, while topic help for `db`, `session`, `parallel`, and `run-group` remains reachable and marked as legacy compatibility. `rudi doctor --fix` must not initialize `rudi.db`.
- Test files to add or edit: `src/__tests__/unit/commands.test.js` or another existing help-focused unit test.
- Red command: `node scripts/run-tests.js src/__tests__/unit/commands.test.js`.
- Expected failure: before implementation, default help still contains `DATABASE`, `SESSIONS`, `parallel <tasks...>`, and `run-group <cmd>`; command-specific help lacks explicit compatibility notices; `doctor --fix` creates `rudi.db`.
- Exit criteria: red command fails for the expected reason before source changes. Completed: the red command failed on the default help `DATABASE` section and on `doctor --fix` output that initialized the legacy database.

## Phase 3: Implementation

- Implementation rules: change help/docs text and remove only the core doctor DB side effect; preserve callable legacy command dispatch; do not add dependencies; do not churn generated artifacts.
- Files allowed to change: `packages/utils/src/help.js`, `src/commands/doctor.js`, `src/commands/db.js`, `src/commands/session.js`, `src/commands/run-group.js`, `README.md`, `AGENTS.md`, focused tests, and this checklist unless red/green evidence shows a narrower source file must be touched.
- Validation and error-handling requirements: command-specific help should clearly identify compatibility status without changing runtime validation or destructive-operation gates.
- Observability requirements: default help should communicate current core RUDI surfaces clearly; compatibility topic help should explain that the commands remain for existing DB/session/run-group workflows.
- Exit criteria: red test passes unchanged. Completed.

## Phase 4: Green Tests And Refactor

- Green command: `node scripts/run-tests.js src/__tests__/unit/commands.test.js`.
- Refactor constraints: no broad command cleanup; no import/dispatch changes unless explicitly justified; no `dist/` churn.
- Regression checks: related help/docs tests and syntax checks for changed JS files.
- Exit criteria: focused and related tests are green after any refactor. Completed: the unchanged red command passed with 32 tests.

## Phase 5: Full Verification

- Targeted tests: `node scripts/run-tests.js src/__tests__/unit/commands.test.js` plus related command/help tests discovered during edits.
- Full suite: run `npm test` if feasible; record unrelated failures with reproduction.
- Build/typecheck/lint: syntax check changed JS and run a no-churn bundle check.
- JS/TS debt scan, if applicable: `node scripts/agent-debt-runner.mjs --edited <edited-js-files>`.
- Live smoke checks: run default help and topic help commands locally; confirm no database/session values or secrets are printed.
- Exit criteria: verification proves the behavior and documents residual risk. Completed.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: README and AGENTS command inventory language only; do not regenerate sidecar OpenAPI unless sidecar contract changes.
- Final files touched: `AGENTS.md`, `README.md`, `packages/utils/src/help.js`, `src/__tests__/unit/commands.test.js`, `src/commands/db.js`, `src/commands/doctor.js`, `src/commands/run-group.js`, `src/commands/session.js`, `src/index.js`, and this checklist.
- Commands run and results:
  - Red: `node scripts/run-tests.js src/__tests__/unit/commands.test.js` failed as expected because default help still contained `DATABASE` and `doctor --fix` initialized the legacy DB.
  - Green: `node scripts/run-tests.js src/__tests__/unit/commands.test.js` passed with 32 tests.
  - Related regression: `node scripts/run-tests.js src/__tests__/unit/commands.test.js src/__tests__/unit/init-command.test.js src/__tests__/unit/home-command.test.js src/__tests__/unit/daemon-cli-integration.test.js src/__tests__/unit/run-group-command.test.js` passed with 41 tests.
  - Syntax: `node --check packages/utils/src/help.js && node --check src/commands/doctor.js && node --check src/commands/db.js && node --check src/commands/session.js && node --check src/commands/run-group.js && node --check src/index.js && node --check src/__tests__/unit/commands.test.js` passed.
  - Smoke: default `rudi help` omitted first-class legacy DB/session/run-group entries; `rudi help db`, `rudi help session`, `rudi help parallel`, and `rudi help run-group` included `LEGACY COMPATIBILITY`; temp-home `rudi doctor --fix` did not create `rudi.db`.
  - Bundle check: `npx esbuild src/index.js --bundle --platform=node --format=cjs --outfile=/tmp/rudi-cli-index-check.cjs --define:__RUDI_CLI_VERSION__=$(node -p "JSON.stringify(require('./package.json').version)") --external:better-sqlite3 --external:@lydell/node-pty` passed.
  - Debt scan: `node scripts/agent-debt-runner.mjs --edited packages/utils/src/help.js,src/commands/doctor.js,src/commands/db.js,src/commands/session.js,src/commands/run-group.js,src/index.js,src/__tests__/unit/commands.test.js` passed with 0 findings.
  - Diff check: `git diff --check -- AGENTS.md README.md packages/utils/src/help.js src/__tests__/unit/commands.test.js src/commands/db.js src/commands/doctor.js src/commands/run-group.js src/commands/session.js src/index.js docs/swe-compliance/2026-07-01-archive-legacy-cli-surface.md` passed.
  - Stale wording scan: remaining matches were expected legacy/comment/test/checklist references, not default help or doctor DB imports.
  - Full suite: `npm test` passed with 1010 tests.
- Accepted debt: physical deletion of DB/session/run-group packages and sidecar routes remains out of scope; `.rudi-lite-*` rename/removal remains out of scope. Unrelated local modifications in `dist/index.cjs`, `dist/packages-manifest.json`, `src/packages-manifest.json`, `src/commands/skills.js`, and `src/__tests__/unit/skills-sync.test.js` are not part of issue #6 and are intentionally left unstaged.
- Definition of Done: issue #6 has a passing scoped implementation, proof commands recorded here and in PR, branch pushed, PR opened with `Fixes #6`.
