## Phase 0: Baseline And Manual Lookup

- [x] Scope:
  - Fix `rudi auth google-workspace <email>` so declared stack secrets from the RUDI secrets store are injected into the stack auth subprocess.
  - Verify Google Workspace auth state remains under `~/.rudi/state/stacks/google-workspace/accounts/<email>/`.
  - Clean up registry Google Workspace credential docs/source if write access is available.
- [x] Files to inspect before editing:
  - `/Users/hoff/dev/RUDI/apps/cli/src/commands/auth.js`
  - `/Users/hoff/dev/RUDI/apps/cli/src/__tests__/unit/auth-command-execution.test.js`
  - `/Users/hoff/dev/RUDI/apps/cli/packages/secrets/src/index.js`
  - `/Users/hoff/dev/RUDI/apps/cli/packages/runner/src/secrets.js`
  - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/src/auth.ts`
  - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/src/oauthCredentials.ts`
  - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/src/state.ts`
  - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/README.md`
  - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/manifest.json`
  - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/manifest.v2.json`
- [x] Relevant SWE manual sections:
  - `/Users/hoff/dev/dev-help/01-Master-Engineering-Doctrine.txt`: boundary discipline, explicit failure behavior, observability, Appendix C testing discipline.
  - `/Users/hoff/dev/dev-help/06-Security-Engineering-Standard.md`: F5 trust boundaries, F7 secrets management, F10 security observability.
  - `/Users/hoff/dev/dev-help/07-Backend-Application-Engineering-Standard.md`: G12 configuration and secrets separation.
- [x] Current-state commands:
  - `git -C /Users/hoff/dev/RUDI/apps/cli status --short`
  - `git -C /Users/hoff/dev/RUDI/apps/registry status --short`
  - `rg -n "GOOGLE_CREDENTIALS|google-workspace|credentials\\.json|token\\.json|accounts|auth google" /Users/hoff/dev/RUDI/apps/cli /Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace`
- [x] Risks and invariants:
  - Never print or log secret values.
  - Auth subprocess must receive secrets as environment variables, not shell-expanded command text.
  - Missing required secrets must fail before launching browser OAuth.
  - Mutable tokens and account state must not be stored under installed stack source.
  - Existing dirty registry work, especially Tasks additions, must not be overwritten.
- [x] Exit criteria:
  - The defect and cross-repo boundaries are documented before implementation.

## Phase 1: Scope Lock

- [x] In scope:
  - CLI `rudi auth` resolves installed stack `requires.secrets`.
  - CLI passes resolved secrets into Node and Python auth subprocesses.
  - Unit tests cover secret injection and missing-secret failure.
  - Documentation/manifest references are aligned to the RUDI secrets store and state directory when registry edits are possible.
- [x] Non-goals:
  - Do not redesign the secrets backend.
  - Do not add a new Google OAuth credential format.
  - Do not touch unrelated Google Tasks work already dirty in the registry.
  - Do not run a live Google OAuth browser flow with real credentials in automated verification.
- [x] Expected files touched:
  - `/Users/hoff/dev/RUDI/apps/cli/src/commands/auth.js`
  - `/Users/hoff/dev/RUDI/apps/cli/src/__tests__/unit/auth-command-execution.test.js`
  - `/Users/hoff/dev/RUDI/apps/cli/docs/swe-compliance/2026-06-23-google-workspace-auth-secret-wiring.md`
  - Optional, if registry edits are allowed:
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/src/auth.ts`
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/README.md`
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/manifest.json`
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/manifest.v2.json`
- [x] External inputs and trust boundaries:
  - CLI args: stack id and account email.
  - Installed stack manifest: local file but still parsed as package metadata.
  - RUDI secrets store: trusted storage location, values must remain unprinted.
  - Subprocess env: boundary where secrets are injected.
- [x] Failure behavior to define:
  - Missing required secret causes `rudi auth` to fail with secret names and setup command only.
  - Optional missing secrets are ignored.
  - Invalid subprocess args continue to reject NUL bytes.
- [x] Exit criteria:
  - Red tests can be written against exported auth helpers without invoking a real browser.

## Phase 2: Red Tests

- [x] Observable behavior to prove:
  - A stack declaring `GOOGLE_CREDENTIALS` receives that value in the auth subprocess environment from RUDI secrets.
  - A missing required secret fails before subprocess launch.
  - Optional missing secrets do not block auth.
- [x] Test files to add or edit:
  - `/Users/hoff/dev/RUDI/apps/cli/src/__tests__/unit/auth-command-execution.test.js`
- [x] Red command:
  - `npm test -- src/__tests__/unit/auth-command-execution.test.js`
  - Sandbox equivalent used because `npm` was not on PATH: `/Users/hoff/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-tests.js src/__tests__/unit/auth-command-execution.test.js`
- [x] Expected failure:
  - Failed as expected: `SyntaxError: The requested module '../../commands/auth.js' does not provide an export named 'buildAuthEnvironment'`.
- [x] Exit criteria:
  - Red failure is captured before implementation.

## Phase 3: Implementation

- [x] Implementation rules:
  - Reuse installed manifest `requires.secrets` / `secrets` metadata.
  - Resolve secret names supporting both `{ name }` and `{ key }`.
  - Do not log secret values.
  - Use `execFileSync` argv/env, never shell command construction.
- [x] Files allowed to change:
  - `/Users/hoff/dev/RUDI/apps/cli/src/commands/auth.js`
  - `/Users/hoff/dev/RUDI/apps/cli/src/__tests__/unit/auth-command-execution.test.js`
  - This checklist file.
  - Registry Google Workspace files only after explicit write approval/escalation.
- [x] Validation and error-handling requirements:
  - Secret names must be non-empty strings before lookup.
  - Required missing secrets must produce a deterministic error.
  - Optional missing secrets must be skipped.
- [x] Observability requirements:
  - User-facing errors may name missing secret keys and setup commands.
  - Secret values must never appear in stdout/stderr or test failure fixtures.
- [x] Exit criteria:
  - CLI auth helper and command paths inject the resolved env.

## Phase 4: Green Tests And Refactor

- [x] Green command:
  - `npm test -- src/__tests__/unit/auth-command-execution.test.js`
  - Sandbox equivalent used: `/Users/hoff/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-tests.js src/__tests__/unit/auth-command-execution.test.js`
  - Result: passed, 6 tests.
  - Registry red/green command: `/Users/hoff/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx state.test.cjs`
  - Registry red result: failed on `auth must not use a personal default credentials path`.
  - Registry green result: passed after removing the default fallback.
- [x] Refactor constraints:
  - Keep helpers small and command-local unless another command needs them.
  - No broad command restructuring.
- [x] Regression checks:
  - Existing argv-safety tests still pass.
  - Node, tsx, and Python auth subprocess plans remain argv arrays.
- [x] Exit criteria:
  - Targeted tests pass unchanged after implementation.

## Phase 5: Full Verification

- [x] Targeted tests:
  - `npm test -- src/__tests__/unit/auth-command-execution.test.js`
  - Sandbox equivalent used: `/Users/hoff/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-tests.js src/__tests__/unit/auth-command-execution.test.js`
  - Result: passed, 6 tests.
  - Registry stack command: `/Users/hoff/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx state.test.cjs`
  - Result: passed.
- [x] Full suite:
  - `npm test`
  - Sandbox run failed on writes to `~/.rudi/cache/registry.json`.
  - `/private/tmp` RUDI_HOME run removed cache-write failures but invalidated env contract tests that expect home-relative `RUDI_HOME`.
  - Escalated normal-home run completed with 3 unrelated failures:
    - `src/__tests__/unit/contract-validator.test.js`: `allows allowlisted commands`.
    - `src/__tests__/unit/start-route-contract.test.js`: concurrent `/agent/start` process reuse.
    - `src/__tests__/unit/start-route-contract.test.js`: Claude stream-json stdin launch.
- [x] Build/typecheck/lint:
  - `npm run build`
  - CLI build passed via `/Users/hoff/.rudi/runtimes/node/bin/npm run build`.
  - Google Workspace stack build passed via `/Users/hoff/.rudi/runtimes/node/bin/npm run build`.
  - Registry public validation passed: `errors: 0`, `warnings: 0`, `referencedPackages: 84`.
- [x] JS/TS debt scan, if applicable:
  - `node scripts/agent-debt-runner.mjs --edited src/commands/auth.js,src/__tests__/unit/auth-command-execution.test.js`
  - CLI result: clean, 0 findings.
  - Registry result: clean, 0 findings for `catalog/stacks/google-workspace/src/auth.ts` and `catalog/stacks/google-workspace/state.test.cjs`.
- [x] Live smoke checks:
  - Temp-home subprocess-env smoke that proves `buildAuthEnvironment` resolves a secret without printing it.
  - No real Google browser OAuth flow unless a test credential is explicitly provided.
  - Temp fake stack command passed: `RUDI_HOME=/private/tmp/rudi-auth-smoke-home-283711 node src/index.js auth env-auth user@example.com`.
  - Result file: `{"account":"user@example.com","hasCredential":true}`.
- [x] Exit criteria:
  - Verification is green or a concrete residual risk is recorded.

## Phase 6: Docs, Contracts, And Closure

- [x] Docs or API contracts to update:
  - CLI checklist records proof.
  - Registry Google Workspace README/manifest should document:
    - `rudi secrets set GOOGLE_CREDENTIALS`
    - `rudi auth google-workspace <email>`
    - tokens under `~/.rudi/state/stacks/google-workspace/accounts/<email>/token.json`
    - no writes under `~/.rudi/stacks/google-workspace/accounts/...`
- [x] Final files touched:
  - `/Users/hoff/dev/RUDI/apps/cli/src/commands/auth.js`
  - `/Users/hoff/dev/RUDI/apps/cli/src/__tests__/unit/auth-command-execution.test.js`
  - `/Users/hoff/dev/RUDI/apps/cli/dist/index.cjs`
  - `/Users/hoff/dev/RUDI/apps/cli/docs/swe-compliance/2026-06-23-google-workspace-auth-secret-wiring.md`
  - Registry readback verified Google Workspace auth/docs cleanup in current checkout:
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/src/auth.ts`
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/state.test.cjs`
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/README.md`
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/manifest.json`
    - `/Users/hoff/dev/RUDI/apps/registry/catalog/stacks/google-workspace/manifest.v2.json`
- [x] Commands run and results:
  - Red CLI targeted auth test: failed for missing `buildAuthEnvironment` export.
  - Green CLI targeted auth test: passed, 6 tests.
  - Red registry state/auth test: failed on personal default credential fallback.
  - Green registry state/auth test: passed.
  - CLI build: passed.
  - Google Workspace stack build: passed.
  - Registry public validation: passed, 0 errors / 0 warnings.
  - CLI debt scan: passed, 0 findings.
  - Registry debt scan: passed, 0 findings.
  - Live fake-stack auth smoke: passed.
- [x] Accepted debt:
  - Full CLI suite still has 3 unrelated failures in `contract-validator.test.js` and `start-route-contract.test.js`.
  - No live Google OAuth browser flow was run because no test Google credential was provided and the workflow would be externally visible.
- [x] Definition of Done:
  - Targeted tests pass.
  - Full relevant suite/build pass or gap is recorded.
  - Debt scan has no blocking findings.
  - Smoke proof exists without exposing secrets.
  - Docs/contracts match verified behavior or registry write constraint is recorded.
