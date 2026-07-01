## Phase 0: Baseline And Manual Lookup

- Scope: Issue #4, decouple core `rudi init` from the legacy DB/Lite/session layer so default bootstrap creates only capability-layer state.
- Files to inspect before editing: `src/commands/init.js`, `packages/utils/src/help.js`, `src/commands/home.js`, `README.md`, relevant unit tests under `src/__tests__/unit/`, and current git status.
- Relevant SWE manual sections: `10-Engineering-Operating-Manual-Index.md`; Appendix C / C7A in `01-Master-Engineering-Doctrine.txt`; failure behavior doctrine in `01-Master-Engineering-Doctrine.txt`; Appendix G sections G1-G4 in `07-Backend-Application-Engineering-Standard.md`.
- Current-state commands: `git status -sb`; `git remote -v`; `gh repo view --json nameWithOwner,visibility,defaultBranchRef`; `gh issue list --repo learnrudi/cli --state open --search "rudi init database OR rudi.db OR lite" --limit 20 --json number,title,state,url`; targeted `rg`/`sed` reads.
- Risks and invariants: do not delete existing user `rudi.db`; do not remove DB package or legacy commands in this issue; core install/router/secret flows must not require DB; secrets must never be printed; preserve user-authored files outside managed blocks.
- Exit criteria: baseline state and manual guidance are recorded before edits. Completed.

## Phase 1: Scope Lock

- In scope: remove DB initialization from `rudi init`; update help/docs/home wording so DB and `.rudi-lite-*` are legacy/session surfaces; add focused tests and temp-home smoke proof.
- Non-goals: remove `@learnrudi/db`; remove `rudi db`, `rudi serve`, sessions, run groups, or sidecar compatibility; rename `.rudi-lite-*`; change stack install semantics; change shims behavior beyond recommendation.
- Expected files touched: `src/commands/init.js`, `packages/utils/src/help.js`, focused unit tests, possibly `README.md` and `src/commands/home.js` if wording requires it, this checklist.
- External inputs and trust boundaries: CLI flags, filesystem state under `RUDI_HOME`, existing user database files, docs/help output consumed by users and automation.
- Failure behavior to define: `rudi init` should not touch DB at all; DB-dependent commands remain responsible for their own DB initialization/failure behavior.
- Exit criteria: touched files remain within the scoped behavior and documentation surface. Completed.

## Phase 2: Red Tests

- Observable behavior to prove: `cmdInit(... --skip-downloads --no-agent-instructions --quiet)` creates the core local home but does not create `rudi.db`, even when the DB native dependency is unavailable.
- Test files to add or edit: a focused init unit test file under `src/__tests__/unit/`.
- Red command: `node scripts/run-tests.js src/__tests__/unit/init-command.test.js`.
- Expected failure: before implementation, init attempts DB initialization and either creates `rudi.db` or records a DB failure while continuing.
- Exit criteria: red command fails for the expected reason before source changes. Completed: the red command failed because output included `5. Checking database...`, schema initialization logs, and `+ Database created (v27)`.

## Phase 3: Implementation

- Implementation rules: remove only core init DB side effect; do not add dependencies; keep existing directory/download/settings/instruction behavior; preserve legacy DB commands.
- Files allowed to change: `src/commands/init.js`, `packages/utils/src/help.js`, `README.md`, `src/commands/home.js`, focused tests, this checklist.
- Validation and error-handling requirements: no DB import or `initSchema()` call in the core init path; help text must not promise DB initialization in `rudi init`.
- Observability requirements: non-quiet init output should make clear core init is creating capability-layer state, not DB/session state.
- Exit criteria: red test passes unchanged. Completed.

## Phase 4: Green Tests And Refactor

- Green command: `node scripts/run-tests.js src/__tests__/unit/init-command.test.js`.
- Refactor constraints: no broad command cleanup; no generated `dist/` churn unless intentionally required; no changes to legacy DB schema.
- Regression checks: run existing related command/help tests and syntax checks for changed JS files.
- Exit criteria: focused and related tests are green after any refactor. Completed.

## Phase 5: Full Verification

- Targeted tests: `node scripts/run-tests.js src/__tests__/unit/init-command.test.js`; related command/help tests as discovered.
- Full suite: run `npm test` if feasible; record unrelated failures with reproduction.
- Build/typecheck/lint: syntax check changed JS and run a package build or equivalent no-churn bundle check.
- JS/TS debt scan, if applicable: `node scripts/agent-debt-runner.mjs --edited <edited-js-files>`.
- Live smoke checks: run `rudi init --skip-downloads --quiet --no-agent-instructions` against a temp `RUDI_HOME` and confirm no `rudi.db`; run `rudi db init` or an equivalent DB command if available to prove DB remains explicit/lazy.
- Exit criteria: verification proves the behavior and documents residual risk. Completed.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: init help, README home layout if it lists core artifacts, and issue/PR proof notes.
- Final files touched: `src/commands/init.js`, `packages/utils/src/help.js`, `README.md`, `src/commands/home.js`, `src/__tests__/unit/init-command.test.js`, `src/__tests__/unit/home-command.test.js`, and this checklist.
- Commands run and results:
  - Red: `node scripts/run-tests.js src/__tests__/unit/init-command.test.js` failed as expected because `rudi init` attempted and created the database.
  - Green: `node scripts/run-tests.js src/__tests__/unit/init-command.test.js` passed.
  - Focused regression: `node scripts/run-tests.js src/__tests__/unit/init-command.test.js src/__tests__/unit/home-command.test.js` passed.
  - Related regression: `node scripts/run-tests.js src/__tests__/unit/instructions-command.test.js src/__tests__/unit/home-command.test.js src/__tests__/unit/commands.test.js` passed with 39 tests.
  - Syntax: `node --check src/commands/init.js && node --check src/commands/home.js && node --check packages/utils/src/help.js && node --check src/__tests__/unit/init-command.test.js` passed.
  - Help proof: `node src/index.js help init | sed -n '1,80p'` showed no DB initialization step and included the legacy DB note.
  - Stale wording scan: `rg -n "Checking database|Database created|Database exists|Database error|Initializes the database \\(if missing\\)|- Database: rudi.db" src packages README.md docs -g '!node_modules'` returned only the new test assertion.
  - Smoke: temp-home `rudi init --skip-downloads --quiet --no-agent-instructions` left no `rudi.db`; explicit `rudi db init` created a DB when invoked.
  - Bundle check: `npx esbuild src/index.js --bundle --platform=node --format=cjs --outfile=/tmp/rudi-cli-index-check.cjs --define:__RUDI_CLI_VERSION__=$(node -p "JSON.stringify(require('./package.json').version)") --external:better-sqlite3 --external:@lydell/node-pty` passed without writing `dist/`.
  - Debt scan: `node scripts/agent-debt-runner.mjs --edited src/commands/init.js,src/commands/home.js,packages/utils/src/help.js,src/__tests__/unit/init-command.test.js,src/__tests__/unit/home-command.test.js` passed with 0 findings.
  - Diff check: `git diff --check -- README.md packages/utils/src/help.js src/__tests__/unit/home-command.test.js src/__tests__/unit/init-command.test.js src/commands/home.js src/commands/init.js docs/swe-compliance/2026-07-01-decouple-init-db-lite.md` passed.
  - Full suite: `npm test` passed with 1008 tests.
- Accepted debt: legacy DB/session surfaces remain for compatibility; `.rudi-lite-*` naming remains until a separate compatibility issue. During smoke testing, `rudi db path` resolved under `HOME/.rudi` rather than the exported `RUDI_HOME`; that is outside this issue and should be handled separately if DB command environment override support remains important.
- Definition of Done: issue #4 has a passing scoped implementation, proof commands recorded here and in PR, branch pushed, PR opened with `Fixes #4`.
