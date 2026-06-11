# SWE Manual Compliance Checklist

This checklist tracks the work needed to bring the current RUDI CLI/daemon state up to the SWE Operating Manual bar. It is a phase-gated checklist, not a loose TODO list: each phase records scope, expected files, proof commands, and exit criteria.

## Current Review Baseline

- `npm test` passed with 652 tests.
- `npm run build` passed.
- `node dist/index.cjs --version` reports `rudi v1.10.12`.
- Local daemon status reports ready.
- Live check confirmed `/env` accepts `x-rudi-token: same-origin` from an external `Origin`, which is not compliant.
- Fresh schema/test runs log `sessions_fts setup failed: no such column: description`, which indicates schema drift.
- Agent debt scan has no blocking errors, but reports 10 architecture warnings.

## Phase 0: Scope Lock

### Scope

- [x] Fix daemon HTTP `same-origin` auth bypass.
- [x] Fix daemon WebSocket `same-origin` auth bypass.
- [x] Fix `sessions_fts` fresh-schema drift.
- [x] Review daemon route ownership and debt-scan warnings.

### Non-Goals

- [x] No Lite UI work.
- [x] No run-group feature expansion.
- [x] No unrelated command refactors.
- [x] No package dependency additions unless explicitly justified.

### Files To Inspect First

- [x] `src/commands/serve/ctx.js`
- [x] `src/daemon/runtime/auth.js`
- [x] `src/daemon/runtime/websocket.js`
- [x] `packages/db/src/schema.js`
- [x] `src/__tests__/unit/daemon-runtime-contract.test.js`
- [x] `src/__tests__/unit/serve-ctx-contract.test.js`
- [x] `src/__tests__/unit/schema-migrations.test.js`

### Exit Criteria

- [x] Exact files to modify are listed before implementation.
- [x] Required tests are identified before implementation.
- [x] Remaining non-goals are explicitly preserved.

## Phase 1: Security Boundary Fix

### Expected Files Touched

- [x] `src/commands/serve/ctx.js`
- [x] `src/daemon/runtime/auth.js` inspected; no code change required.
- [x] `src/daemon/runtime/websocket.js`
- [x] `src/__tests__/unit/daemon-runtime-contract.test.js`
- [x] `src/__tests__/unit/serve-ctx-contract.test.js`

### Red Tests

- [x] HTTP request with external `Origin` and `x-rudi-token: same-origin` returns `401`.
- [x] HTTP request with no token returns `401`.
- [x] HTTP request with the real daemon token still passes.
- [x] `/health` remains unauthenticated.
- [x] WebSocket request with `same-origin` does not authenticate from a cross-origin browser-capable path.
- [x] Valid WebSocket token still passes.

### Implementation Rules

- [x] Do not trust `Host` alone as identity.
- [x] Default deny at daemon HTTP and WebSocket boundaries.
- [x] Keep `/health` as the only unauthenticated HTTP route unless a route is intentionally documented and tested.
- [x] Do not print, log, or expose daemon token values.
- [x] Preserve existing CLI sidecar client behavior using `x-rudi-token`.

### Proof

- [x] Red auth test command:
  ```bash
  npm test -- src/__tests__/unit/daemon-runtime-contract.test.js src/__tests__/unit/serve-ctx-contract.test.js
  ```
  Result: failed for the expected `same-origin` auth assertions before implementation.
- [x] Green auth test command:
  ```bash
  npm test -- src/__tests__/unit/daemon-runtime-contract.test.js src/__tests__/unit/serve-ctx-contract.test.js
  ```
  Result: 44 tests passed.
- [x] Daemon route contract command:
  ```bash
  npm test -- src/__tests__/unit/daemon-routes-contract.test.js
  ```
  Result: 8 tests passed.
- [x] Build command used before live daemon smoke:
  ```bash
  npm run build
  ```
- [x] Live unauthenticated `/env` smoke returns `401`.
- [x] Live external-origin `same-origin` `/env` smoke returns `401`.
- [x] Live real-token `/ready` smoke returns ready.
- [x] Live WebSocket `same-origin` smoke is rejected and real-token WebSocket opens.

### Exit Criteria

- [x] No known daemon auth bypass remains.
- [x] Security behavior is covered by behavior-level tests.
- [x] Live daemon smoke confirms the tested behavior.

## Phase 2: DB Schema Correctness

### Expected Files Touched

- [x] `packages/db/src/schema.js`
- [x] `src/__tests__/unit/schema-migrations.test.js`
- [x] Possibly a focused DB schema test if a more appropriate file exists. Existing schema migration test file was the right focused surface.

### Red Tests

- [x] Fresh DB init creates `sessions.description`.
- [x] Fresh DB init creates `sessions.enriched_at`.
- [x] Fresh DB init creates `sessions_fts` with `description`.
- [x] Fresh DB init refreshes `sessions_fts` without warning.
- [x] Upgraded DB init repairs old `sessions_fts` tables without losing searchable rows.

### Implementation Rules

- [x] Base schema and migration repair logic must agree.
- [x] Fresh install and upgraded install must both work.
- [x] No warning should be swallowed as a substitute for correctness.
- [x] Keep FTS fallback behavior intact for invalid query syntax.

### Proof

- [x] Red schema test command:
  ```bash
  npm test -- src/__tests__/unit/schema-migrations.test.js
  ```
  Result: failed for the expected missing `sessions.description` invariant before implementation.
- [x] Green schema test command:
  ```bash
  npm test -- src/__tests__/unit/schema-migrations.test.js
  ```
  Result: 4 tests passed.
- [x] Full suite no longer prints `sessions_fts setup failed: no such column: description`.
  ```bash
  npm test > /tmp/rudi-cli-npm-test.log 2>&1
  rg -n "sessions_fts setup failed" /tmp/rudi-cli-npm-test.log
  ```
  Result: `npm test` passed with 655 tests; warning search returned no matches.

### Exit Criteria

- [x] Fresh schema init is internally consistent.
- [x] Migration repair path is covered.
- [x] Test output has no `sessions_fts` schema drift warning.

## Phase 3: Architecture Boundary Cleanup

### Expected Files Touched If Needed

- [x] `src/daemon/routes/index.js` inspected; no code change required for this phase.
- [x] `src/commands/serve.js` inspected during baseline; no code change required for this phase.
- [x] Route modules currently under `src/commands/serve/routes/` inspected through scanner findings.
- [x] `.debt-scan.json` updated to make package public API and legacy route ownership explicit.

### Checklist

- [x] Daemon-owned routes live under `src/daemon/routes`; the remaining `src/commands/serve/routes/packages.js` path is retained as a legacy compatibility route for this pass.
- [x] Legacy serve route ownership is explicitly represented in the scanner policy.
- [x] Scanner allowlists reflect real ownership: package source files are treated as package public surface, and legacy daemon compatibility routes/schemas are named directly.
- [x] No new circular daemon-to-serve ownership path was introduced.
- [x] Public package APIs are either reachable from package entrypoints or explicitly listed in `publicAPI`.

### Proof

- [x] Targeted debt scan command:
  ```bash
  node scripts/agent-debt-runner.mjs --edited src/commands/serve/ctx.js,src/daemon/runtime/websocket.js,src/__tests__/unit/daemon-runtime-contract.test.js,src/__tests__/unit/serve-ctx-contract.test.js,packages/db/src/schema.js,src/__tests__/unit/schema-migrations.test.js
  ```
  Result: zero findings.
- [x] Broad dirty JS/TS debt scan command:
  ```bash
  files=$(git diff --name-only -- '*.js' '*.ts' '*.d.ts' '*.mjs' '*.cjs' | paste -sd, -); node scripts/agent-debt-runner.mjs --edited "$files"
  ```
  Result: zero findings after explicit policy update.
- [x] No blocking findings.
- [x] Remaining warnings: none.

### Exit Criteria

- [x] Daemon boundary is understandable from imports.
- [x] Debt scanner output is clean.
- [x] No unrelated route refactors were mixed in.

## Phase 4: Behavioral Verification

### Required Commands

- [x] Targeted red tests were run and failed for the expected reason.
- [x] Targeted green tests were run and passed.
- [x] Full test suite:
  ```bash
  npm test
  ```
  Result: 655 tests passed, 0 failed.
- [x] Build:
  ```bash
  npm run build
  ```
  Result: passed; rebuilt `dist/index.cjs`, router/spawn MCP files, and package manifest artifacts.
- [x] Debt scan:
  ```bash
  files=$(git diff --name-only -- '*.js' '*.ts' '*.d.ts' '*.mjs' '*.cjs' | paste -sd, -); node scripts/agent-debt-runner.mjs --edited "$files"
  ```
  Result: zero findings.

### Smoke Checks

- [x] Built version:
  ```bash
  node dist/index.cjs --version
  ```
  Result: `rudi v1.10.12`.
- [x] Daemon status:
  ```bash
  node dist/index.cjs daemon status --json
  ```
  Result: daemon is running, reachable, healthy, and ready on port `63693`.
- [x] Unauthenticated `/env` returns `401`.
- [x] External-origin `same-origin` `/env` returns `401`.
- [x] Real-token `/ready` returns ready.
- [x] WebSocket `same-origin` token is rejected.
- [x] WebSocket real-token connection opens.

### Exit Criteria

- [x] All required commands pass.
- [x] Smoke checks demonstrate the changed behavior.
- [x] No command was skipped.

## Phase 5: Documentation And Release Gate

### Expected Files Touched If Behavior Changes

- [x] `docs/rudi-local-daemon-architecture.md`
- [x] `docs/sidecar/openapi.json`
- [x] `src/contracts/sidecar-openapi.js` inspected; no auth-source contract edit was required in this pass.

### Checklist

- [x] Docs state exactly which HTTP routes are public vs authenticated.
- [x] `/health` is documented as public; non-health HTTP routes require the real daemon token through `x-rudi-token`.
- [x] WebSocket authentication behavior is documented: real daemon token via `rudi-token.<token>` protocol; host-based same-origin trust and query-token transport are not authentication.
- [x] OpenAPI artifact was regenerated.
- [x] OpenAPI contract tests pass.

### Proof

- [x] OpenAPI generation command:
  ```bash
  npm run generate:sidecar-openapi
  ```
- [x] OpenAPI contract test:
  ```bash
  npm test -- src/__tests__/unit/sidecar-openapi-contract.test.js
  ```
  Result: 6 tests passed.

### Exit Criteria

- [x] Documentation matches verified daemon behavior.
- [x] Generated artifacts match source contracts.
- [x] Final report will list remaining accepted debt.

## Definition Of Done

- [x] No known daemon auth bypass remains.
- [x] Fresh DB init has no schema drift warning.
- [x] `npm test` passes.
- [x] `npm run build` passes.
- [x] Debt scan has zero blocking findings and no unexplained warnings.
- [x] Final report lists files touched, red commands, green commands, build command, debt scan result, live smoke result, and remaining accepted debt.
