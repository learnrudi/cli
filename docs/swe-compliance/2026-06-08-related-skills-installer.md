# Related Skills Installer SWE Checklist

## Phase 0: Baseline And Manual Lookup

- Scope: make `rudi install stack:<id>` understand registry `related.skills` as optional editable companion skills.
- Files to inspect before editing: `AGENTS.md`, `package.json`, `packages/core/src/resolver.js`, `packages/core/src/installer.js`, `src/commands/install.js`, existing unit tests under `packages/core/src/__tests__/unit/` and `src/__tests__/unit/`.
- Relevant SWE manual sections: master doctrine principles on explicit invariants, dependency discipline, failure behavior, testing Appendix C red-green-refactor, infrastructure artifact traceability, and build-order dependency/failure gates.
- Current-state commands: `git status -sb`; targeted `rg` for install/resolver/skill paths; targeted test commands before and after edits.
- Risks and invariants: related skills are recommendations, not hard dependencies; installing a stack must not overwrite a user-edited local skill by default; `requires.stacks` remains a hard dependency path for skills/workflows; JSON/non-interactive behavior must not hang for prompts.
- Exit criteria: baseline inspected, dirty worktree acknowledged, plan saved, and first red test targets one observable behavior.

## Phase 1: Scope Lock

- In scope: resolver metadata for `related.skills`; install CLI display and explicit `--with-related-skills` / `--no-related-skills` behavior; install result reporting for related skills.
- Non-goals: full registry redesign; changing stack runtime install behavior; refactoring daemon routes; changing social/video stack source; overwriting edited local skills without explicit force.
- Expected files touched: this checklist, `packages/core/src/resolver.js`, focused resolver/install tests, and possibly `src/commands/install.js`.
- External inputs and trust boundaries: registry package metadata, local `RUDI_HOME`, local installed package files, CLI flags, and terminal interactivity.
- Failure behavior to define: missing related skill metadata should warn or skip without blocking the stack; failed related skill installation should not roll back a successfully installed stack unless explicitly treated as fatal.
- Exit criteria: the intended behavior is locked before implementation and tests describe the contract.

## Phase 2: Red Tests

- Observable behavior to prove: a stack package with `related.skills` resolves those skills separately from hard dependencies, and default install order does not include them.
- Test files to add or edit: `packages/core/src/__tests__/unit/resolver-related-skills.test.js`.
- Red command: `node ../../scripts/run-tests.js src/__tests__/unit/resolver-related-skills.test.js` from `packages/core`.
- Expected failure: resolved packages do not expose related skills yet.
- Red result: failed as expected with `Cannot read properties of undefined (reading 'map')` because `resolved.relatedSkills` did not exist.
- Exit criteria: red failure observed for the expected missing behavior.

## Phase 3: Implementation

- Implementation rules: keep `related.skills` out of dependency order unless explicitly requested; preserve existing `requires.*` behavior; do not introduce dependencies; validate related skill IDs to `skill:*`.
- Files allowed to change: `packages/core/src/resolver.js`, focused tests, and `src/commands/install.js` only if needed for the current phase.
- Validation and error-handling requirements: malformed or missing related skill entries are ignored or reported without crashing; missing registry entries are not treated as required dependency failures.
- Observability requirements: CLI output must clearly distinguish required dependencies from optional related skills.
- Implemented behavior: resolver now returns `relatedSkills` separately from `dependencies`; install command now displays related skills, supports `--with-related-skills` and `--no-related-skills`, prompts only on interactive terminals by default, and installs related skills without passing stack `--force`.
- Exit criteria: red test passes with the smallest resolver and install-command change.

## Phase 4: Green Tests And Refactor

- Green command: rerun the exact red command unchanged.
- Refactor constraints: only extract helpers if they reduce repeated ID normalization or CLI branching.
- Regression checks: targeted resolver tests and command routing flag tests if flags are added.
- Green result: `node ../../scripts/run-tests.js src/__tests__/unit/resolver-related-skills.test.js` passed; `node scripts/run-tests.js src/__tests__/unit/install-related-skills.test.js` passed.
- Exit criteria: targeted tests pass after cleanup.

## Phase 5: Full Verification

- Targeted tests: resolver related-skills tests; relevant install/routing command tests.
- Full suite: `npm test` when feasible.
- Build/typecheck/lint: `npm run build`.
- JS/TS debt scan, if applicable: run the repo debt scanner against edited JS files with package entrypoints where possible.
- Live smoke checks: dry-run or temp `RUDI_HOME` install flow against a local registry fixture if CLI behavior changes.
- Targeted test results: resolver related-skills test passed; install related-skills planning test passed.
- Full suite result: `npm test` passed with 662 tests.
- Build result: `npm run build` passed.
- Debt scan result: `node /Users/hoff/dev/dev-help/agent-debt-scan.js --repo /Users/hoff/dev/RUDI/apps/cli --entrypoint src/index.js --entrypoint packages/core/src/index.js --files packages/core/src/resolver.js,src/commands/install.js,packages/core/src/__tests__/unit/resolver-related-skills.test.js,src/__tests__/unit/install-related-skills.test.js --json` reported 0 findings.
- Live smoke result: temp local registry + temp `RUDI_HOME` install of `stack:demo-related-stack --with-related-skills` exited 0, installed the stack manifest, and wrote `skills/demo-related-skill.md`.
- Exit criteria: no blocking findings remain.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: CLI help/README only if user-facing flags or install output change.
- Final files touched: `packages/core/src/resolver.js`, `packages/core/src/__tests__/unit/resolver-related-skills.test.js`, `src/commands/install.js`, `src/__tests__/unit/install-related-skills.test.js`, this checklist, and generated build artifacts from `npm run build`.
- Commands run and results: red resolver test failed for expected reason; targeted resolver and install tests passed; `npm run build` passed; `npm test` passed; debt scan passed; temp install smoke passed.
- Accepted debt: the CLI worktree had many pre-existing dirty files, including prior edits in `packages/core/src/resolver.js` and `src/commands/install.js`; this change was not committed as a clean boundary because those files already contained unrelated local work.
- Definition of Done: related skills are discoverable, optional, editable after install, protected from overwrite by default, and proven by tests/build/debt scan.
