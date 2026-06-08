# RUDI Update Command And CLI Compliance Checklist

This checklist governs the `rudi update` modernization and a bounded CLI compliance investigation. It follows the SWE Operating Manual and records scope, files, tests, proof commands, smoke checks, accepted debt, and Definition of Done.

## Phase 0: Baseline And Manual Lookup

- Scope:
  - [x] Investigate current `rudi update` behavior for stacks, runtimes, registry refresh, indexing, and mutable stack state.
  - [x] Establish CLI compliance risks without broad unrelated refactors.
  - [x] Fix `rudi update stack:<name>` so stack updates use the core installer path, migrate install-local mutable state out of the source tree by default, and rebuild the tool index.
  - [x] Prove how update mutates an installed stack through an isolated `RUDI_HOME` smoke before touching the real installed stack.
- Files to inspect before editing:
  - [x] `src/commands/update.js`
  - [x] `packages/core/src/installer.js`
  - [x] `packages/registry-client/src/index.js`
  - [x] `src/commands/index-tools.js`
  - [x] `src/commands/install.js`
  - [x] `src/index.js`
  - [x] `packages/core/src/installer.js` installed-package discovery and force reinstall path.
  - [x] Existing command tests under `src/__tests__/unit/`
  - [x] `catalog/stacks/video-editor/manifest.json` in the local registry checkout.
- Relevant SWE manual sections:
  - [x] Master Doctrine: explicit invariants, designed failure behavior, destructive operation guards, state ownership, red-green-refactor.
  - [x] Testing Doctrine Appendix C: behavior-level tests and red-green proof.
  - [x] Security Standard: integrity, least privilege, destructive operation safeguards, regression tests for discovered issues.
  - [x] Backend Standard: named operations, state transitions, idempotency, side effects, resource management.
  - [x] Build Order: operations before interfaces; phase gates before progression.
- Current-state commands:
  - [x] `git status -sb`
  - [x] `rg -n "updatePackage|cmdUpdate|cmdIndex|rebuildToolIndex|statePaths|preserve|runsRoot|RUDI_REGISTRY_ROOT|USE_LOCAL_REGISTRY" src packages docs package.json`
  - [x] Targeted source reads for `update.js`, core installer, registry client, index command, and install command.
- Risks and invariants:
  - [x] Stack source updates must not preserve install-local runtime directories in place by default; legacy state should be relocated outside the install path.
  - [x] Stack update must refresh the router cache after changing stack source.
  - [x] Registry source is external input and must be resolved through existing registry/installer boundaries.
  - [x] Repeated update should be safe and should not recreate install-local runtime-state debt.
  - [x] Installed package discovery must return canonical package IDs such as `stack:video-editor`, even when a legacy installed manifest used an unqualified id.
  - [x] Local registry development copies must not copy generated directories such as `runs/`, `.test-rudi/`, `outputs/`, or `composer/public/media/` into installed stack source.
  - [x] No secrets or registry tokens may be printed.
- Exit criteria:
  - [x] Baseline behavior and risk are recorded.
  - [x] Manual sections are identified.
  - [x] Scope is narrow enough to implement safely.

## Phase 1: Scope Lock

- In scope:
  - [x] Modernize `rudi update stack:<name>`.
  - [x] Use core installer/update primitive instead of duplicated stack update logic.
  - [x] Refresh registry index before update.
  - [x] Rebuild tool index after stack updates.
  - [x] Do not preserve mutable stack-local state such as `runs/` inside the install path unless the caller explicitly opts in.
  - [x] Migrate legacy install-local mutable state into `~/.rudi/state/stacks/<stack>/...` before replacing installed stack source.
  - [x] Add bounded CLI compliance findings for command-level issues discovered during this work.
- Non-goals:
  - [x] Registry source edits are limited to companion source-of-truth fixes needed for `stack:video-editor`.
  - [x] No Lite UI work.
  - [x] No new dependencies.
  - [x] No broad command refactor outside update/index/install ownership boundaries.
  - [x] Do not mutate the real installed video-editor state during this CLI pass; prove migration through isolated temp-home smoke.
- Expected files touched:
  - [x] `src/commands/update.js`
  - [x] `packages/core/src/installer.js` for installer-boundary state preservation.
  - [x] `packages/registry-client/src/index.js` for local-registry copy filtering.
  - [x] Focused tests under `src/__tests__/unit/` and `packages/core/src/__tests__/unit/`.
  - [x] This checklist.
- External inputs and trust boundaries:
  - [x] Package IDs from CLI args.
  - [x] Registry metadata and stack source paths.
  - [x] Installed package directories under `~/.rudi`.
  - [x] Mutable stack-local state directories.
- Failure behavior to define:
  - [x] Missing installed package.
  - [x] Unknown package ID.
  - [x] Ambiguous bare package name.
  - [x] Installer failure after explicit state backup.
  - [x] Tool index rebuild failure after successful stack update.
  - [x] Explicit state preservation failure.
- Exit criteria:
  - [x] Exact behavior contract is encoded in tests before implementation.

## Phase 2: Red Tests

- Observable behavior to prove:
  - [x] `rudi update stack:video-editor` delegates to core update/install with force semantics.
  - [x] A changed stack triggers one router cache rebuild.
  - [x] `rudi update` over multiple packages indexes once after stack updates.
  - [x] Stack-local `runs/` is migrated out of the install tree across force reinstall unless `--preserve-state` is passed.
  - [x] Bare ambiguous package names do not silently default to `runtime:*`.
  - [x] Local registry stack copies exclude generated source-checkout state and dependency directories.
  - [x] Installed legacy stack manifests are canonicalized to `stack:<name>` during installed-package discovery.
  - [x] Core `updatePackage(..., { preserveState: false })` relocates install-local stack state into `~/.rudi/state/stacks/<stack>/`.
- Test files to add or edit:
  - [x] `src/__tests__/unit/update-command.test.js`
  - [x] `packages/core/src/__tests__/unit/installer-state-preservation.test.js`
  - [x] `packages/core/src/__tests__/unit/installer-list-installed.test.js`
  - [x] `packages/registry-client/src/__tests__/unit/index.test.js`
- Red command:
  ```bash
  npm test -- src/__tests__/unit/update-command.test.js
  ```
  Result: failed before implementation because `resolveUpdateTarget` was not exported from `update.js`.
  Revised red command after clean state-layout decision:
  ```bash
  npm test -- src/__tests__/unit/update-command.test.js
  ```
  Result: failed because the default update path still passed `{ preserveState: true }` to the installer.
  Additional red command:
  ```bash
  npm test -- packages/core/src/__tests__/unit/installer-state-preservation.test.js
  ```
  Result: failed before implementation because `withPreservedInstallState` was not exported from core installer.
  Additional red command after mutation smoke:
  ```bash
  npm test -- packages/core/src/__tests__/unit/installer-list-installed.test.js
  ```
  Result: failed because a legacy installed stack manifest id `video-editor` was listed as `video-editor` instead of `stack:video-editor`.
  Additional red command:
  ```bash
  npm test -- packages/core/src/__tests__/unit/installer-state-preservation.test.js
  ```
  Result: failed because `installPackage` dropped `preserveState: false` before calling the per-package installer.
  Revised red command after state-relocation decision:
  ```bash
  npm test -- packages/core/src/__tests__/unit/installer-state-preservation.test.js
  ```
  Result: failed because the migrated state file was missing from `state/stacks/state-demo/runs/sentinel/project.json`.
  Additional red command:
  ```bash
  npm test -- packages/registry-client/src/__tests__/unit/index.test.js
  ```
  Result: failed before implementation because local registry source copy included generated stack directories such as `runs/`.
- Expected failure:
  - [x] Tests failed because current `update.js` did not export the new behavior helpers, core installer did not export state preservation, the clean-state revision still preserved install-local state by default, installed discovery returned legacy ids, local registry copies included generated state, and the later migration requirement did not yet relocate install-local state.
- Exit criteria:
  - [x] Red failures were for the expected behavior gaps.

## Phase 3: Implementation

- Implementation rules:
  - [x] Keep `update.js` as CLI orchestration; keep install/update mechanics in core installer where practical.
  - [x] Preserve state before destructive reinstall only when explicitly requested and restore it after install succeeds.
  - [x] Propagate `preserveState` and `preserveStatePaths` through `installPackage` into `installSinglePackage`.
  - [x] Relocate default stack mutable paths to `PATHS.home/state/stacks/<stack>/...` before source replacement when preservation is not requested.
  - [x] Refuse migration when the state destination already has a conflicting file path.
  - [x] If explicit state preservation is requested and install fails, restore state and surface the failure.
  - [x] Canonicalize installed directory-package IDs at `listInstalled()` rather than weakening `update.js` resolution.
  - [x] Filter generated/local-only directories from local registry source copies.
  - [x] Rebuild tool index once per command invocation when any stack changed.
  - [x] Do not log secrets or hidden token values.
  - [x] Keep output concise and script-friendly.
- Files allowed to change:
  - [x] `src/commands/update.js`
  - [x] `packages/core/src/installer.js`
  - [x] `packages/registry-client/src/index.js`
  - [x] Focused test files.
  - [x] This checklist.
  - [x] `README.md` for user-facing command example alignment.
- Validation and error-handling requirements:
  - [x] Validate package IDs and ambiguity.
  - [x] Validate installed manifest ID kind when a prefix is present.
  - [x] Treat registry and filesystem data as untrusted.
  - [x] Return or print clear failures without swallowing installer/index errors.
- Observability requirements:
  - [x] Progress output states registry refresh, update, optional state migration/preservation, and index rebuild without exposing secrets.
- Exit criteria:
  - [x] Implementation is the smallest change that satisfies red tests.

## Phase 4: Green Tests And Refactor

- Green command:
  ```bash
  npm test -- src/__tests__/unit/update-command.test.js
  ```
  Result after implementation:
  ```bash
  npm test -- src/__tests__/unit/update-command.test.js packages/core/src/__tests__/unit/installer-state-preservation.test.js
  ```
  Passed: 6 tests, 0 failed.
  Revised green command after clean state-layout decision:
  ```bash
  npm test -- src/__tests__/unit/update-command.test.js
  ```
  Passed: 5 tests, 0 failed.
  Final targeted green command:
  ```bash
  npm test -- packages/core/src/__tests__/unit/installer-state-preservation.test.js packages/core/src/__tests__/unit/installer-list-installed.test.js
  ```
  Passed: 4 tests, 0 failed.
  Revised migration green command:
  ```bash
  npm test -- packages/core/src/__tests__/unit/installer-state-preservation.test.js
  ```
  Passed: 3 tests, 0 failed.
- Refactor constraints:
  - [x] Refactor only after green.
  - [x] Preserve existing command export and `upgrade` alias behavior.
- Regression checks:
  - [x] Existing command export tests.
  - [x] Installer tests because core installer is touched.
  - [x] Registry-client tests because local registry copy behavior is touched.
- Exit criteria:
  - [x] Targeted tests pass unchanged after implementation.

## Phase 5: Full Verification

- Targeted tests:
  - [x] `npm test -- src/__tests__/unit/update-command.test.js`
    - Clean-state revision result: 5 tests passed, 0 failed.
  - [x] `npm test -- packages/core/src/__tests__/unit/installer-state-preservation.test.js`
    - Final result: 3 tests passed, 0 failed.
  - [x] `npm test -- packages/core/src/__tests__/unit/installer-list-installed.test.js`
    - Final result: 1 test passed, 0 failed.
  - [x] `npm test -- packages/registry-client/src/__tests__/unit/index.test.js`
    - Final result included in combined command: local registry generated-directory exclusion passed.
  - [x] `npm test -- src/__tests__/unit/commands.test.js src/__tests__/unit/update-command.test.js packages/core/src/__tests__/unit/installer-state-preservation.test.js`
    - Latest result: 36 tests passed, 0 failed.
  - [x] `npm test -- src/__tests__/unit/update-command.test.js packages/registry-client/src/__tests__/unit/index.test.js packages/core/src/__tests__/unit/installer-state-preservation.test.js`
    - Latest result: 20 tests passed, 0 failed.
  - [x] `npm test -- src/__tests__/unit/update-command.test.js packages/core/src/__tests__/unit/installer-state-preservation.test.js packages/core/src/__tests__/unit/installer-list-installed.test.js packages/registry-client/src/__tests__/unit/index.test.js`
    - Migration revision result: 22 tests passed, 0 failed.
  - [x] `npm test -- src/__tests__/unit/commands.test.js src/__tests__/unit/update-command.test.js packages/core/src/__tests__/unit/installer-state-preservation.test.js packages/core/src/__tests__/unit/installer-list-installed.test.js`
    - Migration revision result: 38 tests passed, 0 failed.
- Full suite:
  - [x] `npm test`
    - Latest result: 664 tests passed, 0 failed.
- Build/typecheck/lint:
  - [x] `npm run build`
    - Latest result: passed and rebuilt `dist/index.cjs`, router/spawn MCP files, and package manifest artifacts.
- JS/TS debt scan, if applicable:
  - [x] `node scripts/agent-debt-runner.mjs --edited src/commands/update.js,packages/core/src/installer.js,src/__tests__/unit/update-command.test.js,packages/core/src/__tests__/unit/installer-state-preservation.test.js`
    - Result: zero findings.
  - [x] `node scripts/agent-debt-runner.mjs --edited src/commands/update.js,src/__tests__/unit/update-command.test.js`
    - Clean-state revision result: zero findings.
  - [x] `node scripts/agent-debt-runner.mjs --edited src/commands/update.js,src/__tests__/unit/update-command.test.js,packages/core/src/installer.js,packages/core/src/__tests__/unit/installer-state-preservation.test.js,packages/core/src/__tests__/unit/installer-list-installed.test.js,packages/registry-client/src/index.js,packages/registry-client/src/__tests__/unit/index.test.js`
    - Final result: zero findings.
- Live smoke checks:
  - [x] Safe non-mutating CLI smoke:
    ```bash
    node dist/index.cjs --version
    node dist/index.cjs update stack:__definitely_not_installed__
    ```
    - Latest result: version prints `rudi v1.10.12`; missing stack update exits non-zero with `Package not installed`.
  - [x] Real installed stack update skipped intentionally because `/Users/hoff/.rudi/stacks/video-editor/runs` currently contains 623M of install-local runs.
  - [x] Isolated mutation smoke passed with temp `RUDI_HOME` and local registry:
    - `node dist/index.cjs install stack:video-editor --force`
    - add `stacks/video-editor/runs/sentinel/project.json`
    - `node dist/index.cjs update stack:video-editor`
    - Superseded clean-state result: sentinel was removed from install-local source, install-local `runs/` was absent, generated checkout dirs were absent, manifest id was `stack:video-editor`, state-root code installed, and tool index rebuilt with 39 tools and no stack error.
  - [x] Revised isolated migration smoke passed with temp `RUDI_HOME` and local registry:
    - `node dist/index.cjs install stack:video-editor --force`
    - add `stacks/video-editor/runs/sentinel/project.json`
    - `node dist/index.cjs update stack:video-editor`
    - Result: install-local sentinel absent, install-local `runs/` absent, state sentinel present at `state/stacks/video-editor/runs/sentinel/project.json`, generated checkout dirs absent, manifest id `stack:video-editor`, state-root code installed, tool index rebuilt with 39 tools and no stack error.
- Exit criteria:
  - [x] Verification commands pass and the skipped destructive smoke is explicitly recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update:
  - [x] `README.md` maintenance example updated to use explicit `stack:<name>`, mention tool-index rebuild, and document `--preserve-state` as opt-in.
  - [x] Registry/stack state guidance recorded as resolved for video-editor source layout: runtime data belongs under `~/.rudi/state/stacks/video-editor/`, not the install path.
- Final files touched:
  - [x] `src/commands/update.js`
  - [x] `packages/core/src/installer.js`
  - [x] `packages/registry-client/src/index.js`
  - [x] `src/__tests__/unit/update-command.test.js`
  - [x] `packages/core/src/__tests__/unit/installer-state-preservation.test.js`
  - [x] `packages/core/src/__tests__/unit/installer-list-installed.test.js`
  - [x] `packages/registry-client/src/__tests__/unit/index.test.js`
  - [x] `README.md`
  - [x] `docs/swe-compliance/2026-06-08-rudi-update-cli-compliance.md`
  - [x] Clean-state revision touched `src/commands/update.js`, `src/__tests__/unit/update-command.test.js`, `README.md`, core installer/list tests, registry-client copy filtering/tests, and this checklist.
- Commands run and results:
  - [x] Red commands recorded in Phase 2.
  - [x] Green commands recorded in Phase 4.
  - [x] Full suite/build/debt/smoke commands recorded in Phase 5.
- Accepted debt:
  - [x] Automatic migration is included for default install-local stack state paths during update, but the actual installed video-editor stack was not mutated in this pass.
  - [x] The temp-home smoke proves the existing 623M run directory should move to `~/.rudi/state/stacks/video-editor/runs/` before source replacement when the real update is run.
  - [x] Broader CLI compliance findings beyond this fix should be follow-up phases, not mixed into this implementation.
  - [x] Bounded CLI audit found many shell-string `execSync` usages in installer, registry client, status/check, auth, git, and legacy agent routes. Follow-up should convert untrusted command construction to `execFileSync`/`spawn` arg arrays or explicitly justify safe constants.
  - [x] Bounded CLI audit found scattered destructive removals across installer, registry client, install/remove/studio/agent compatibility routes. Follow-up should centralize destructive-operation guards and state preservation policy.
  - [x] Bounded CLI audit found many empty cleanup catches. Some are acceptable cleanup best-effort paths, but follow-up should distinguish intentional best-effort cleanup from swallowed operational failures.
- Definition of Done:
  - [x] `rudi update stack:<name>` has tested stack update behavior.
  - [x] Mutable stack-local state is migrated out of the install path by default and is only preserved in place through explicit opt-in.
  - [x] Stack updates rebuild router cache.
  - [x] Targeted tests pass.
  - [x] Full suite/build/debt scan pass or documented gap exists.
  - [x] Final report lists files touched, red/green commands, build/debt results, smoke evidence, and accepted debt.
