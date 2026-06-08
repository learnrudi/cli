# CLI Dirty Worktree Triage Checklist

## Phase 0: Baseline And Manual Lookup

- Scope: sort the existing dirty CLI worktree into coherent, reviewable commits without reverting unrelated local work.
- Files to inspect before editing: `git status -sb`, `git diff --stat`, local compliance docs, changed command/package files, and untracked test files.
- Relevant SWE manual sections: `10-Engineering-Operating-Manual-Index.md`; Appendix C / C7A in `01-Master-Engineering-Doctrine.txt`.
- Current-state commands: `git status -sb`; `git diff --stat`; targeted diffs for package lifecycle, daemon, runtime, leverage, and security/schema groups.
- Risks and invariants: no bulk staging; no hidden daemon/runtime/leverage files in package lifecycle commits; no clean-checkout import of untracked modules; generated `dist/` artifacts are not staged while the source tree still contains unrelated local changes.
- Exit criteria: dirty work is classified before the next commit.

## Phase 1: Scope Lock

- In scope for first cleanup commit: package lifecycle and workflow support, including workflow package kind, update command state migration, local registry source filtering, and related tests/docs.
- Non-goals for first cleanup commit: daemon command/lifecycle, daemon HTTP schema/routes, local LLM runtime command, leverage command, package publish/dependency metadata, generated `dist/` output, and unrelated security hardening.
- Expected files touched in first cleanup commit: env/manifest/registry-client/core installer/update/list/search/remove/help surfaces, focused tests, and this checklist if its status is useful to reviewers.
- External inputs and trust boundaries: package IDs, registry index entries, local registry source paths, installed package manifests, mutable install-local stack state.
- Failure behavior to define: ambiguous update targets, missing installed packages, install-local state migration conflicts, unsupported single-file package placeholders, invalid workflow manifests.
- Exit criteria: first commit has no dependency on untracked daemon modules.

## Phase 2: Red Tests

- Observable behavior to prove: existing local tests already encode the intended behavior for update target resolution, state migration, workflow package paths, workflow manifest validation, and local registry copy filtering.
- Test files to add or edit: no new red tests planned in this triage pass unless a missing behavior gap is found while isolating the commit.
- Red command: use recorded red commands from `docs/swe-compliance/2026-06-08-rudi-update-cli-compliance.md` for update/state migration behavior.
- Expected failure: already recorded before this triage; this pass is isolation and verification, not new feature design.
- Exit criteria: targeted green commands are rerun after isolation.

## Phase 3: Implementation

- Implementation rules: stage exact hunks; prefer source-level independence over pulling daemon files into package lifecycle; keep generated artifacts out until their source slice is settled.
- Files allowed to change during first cleanup commit: package lifecycle files and focused docs/tests only.
- Validation and error-handling requirements: package kind parsing remains explicit; update errors are surfaced; state migration refuses overwrite conflicts; local registry copy filters generated/dependency paths.
- Observability requirements: update prints registry refresh, update progress, and tool-index rebuild without printing secrets.
- Exit criteria: staged diff contains only the first cleanup commit scope.

## Phase 4: Green Tests And Refactor

- Green command: run focused package lifecycle/update/workflow tests after staging decision.
- Refactor constraints: no unrelated cleanup while slicing commits.
- Regression checks: command export/shortcut tests and affected package tests.
- Exit criteria: targeted tests pass in the current worktree.

## Phase 5: Full Verification

- Targeted tests: package lifecycle/update/workflow commands.
- Full suite: `npm test` when the slice is stable.
- Build/typecheck/lint: `npm run build` when the slice is stable.
- JS/TS debt scan, if applicable: run `scripts/agent-debt-runner.mjs` for edited JS files in the committed slice.
- Live smoke checks: run lightweight CLI smoke for workflow package path/listing and update missing-package behavior where practical.
- Exit criteria: all checks pass or residual risk is recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: README/package docs only when they match committed behavior.
- Final files touched in first cleanup commit: `packages/env/src/index.js`, `packages/manifest/src/validate.js`, `packages/registry-client/src/index.js`, `packages/core/src/installer.js`, `packages/core/src/lockfile.js`, `src/commands/update.js`, `src/commands/list.js`, `src/commands/search.js`, `src/commands/remove.js`, `src/index.js`, `packages/utils/src/help.js`, focused tests, README, update compliance checklist, and this triage checklist.
- Commands run and results:
  - `node scripts/run-tests.js packages/env/src/__tests__/unit/env.test.js packages/manifest/src/__tests__/unit/validate.test.js packages/registry-client/src/__tests__/unit/index.test.js` passed.
  - `node scripts/run-tests.js src/__tests__/unit/update-command.test.js packages/core/src/__tests__/unit/installer-state-preservation.test.js packages/core/src/__tests__/unit/installer-list-installed.test.js` passed.
  - `node scripts/run-tests.js src/__tests__/unit/remove-command.test.js src/__tests__/unit/stack-runtime-detection.test.js` passed in the current worktree; stack cleanup/runtime-detection changes remain separate from the staged package lifecycle commit.
  - `node scripts/run-tests.js packages/env/src/__tests__/unit/env.test.js packages/manifest/src/__tests__/unit/validate.test.js packages/registry-client/src/__tests__/unit/index.test.js src/__tests__/unit/update-command.test.js packages/core/src/__tests__/unit/installer-state-preservation.test.js packages/core/src/__tests__/unit/installer-list-installed.test.js src/__tests__/unit/commands.test.js` passed with 117 tests.
  - `npm run build` passed.
  - `npm test` passed with 664 tests.
  - `node scripts/agent-debt-runner.mjs --edited <staged-js-files>` passed with 0 findings.
  - Temp `RUDI_HOME` smoke for `node src/index.js list workflows --json` passed and returned `workflow:daily-brief`.
  - Temp `RUDI_HOME` smoke for `node src/index.js update stack:__missing_stack__` exited 1 with `Package not installed`.
- Accepted debt: unrelated dirty daemon/runtime/leverage/security/public-readiness work remains in the worktree for later slices.
- Definition of Done: first cleanup commit is isolated, verified, and remaining groups are named.

## Follow-Up Slice: Leverage Command

- Scope: add the standalone `rudi leverage` calculator command, math helper, CLI route, help text, and focused unit test.
- Non-goals: local LLM, runtime, daemon, package lifecycle, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/leverage-command.test.js` passed with 4 tests.
  - `node src/index.js leverage frontend --json` passed and returned the expected `5.33` leverage payload.

## Follow-Up Slice: Codex Integration TOML

- Scope: teach `rudi integrate codex` to patch Codex `config.toml`, replace direct RUDI stack MCP entries with `mcp_servers.rudi`, and make dry-run output show concrete target actions.
- Non-goals: daemon lifecycle, local LLM, runtime commands, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/integrate-codex.test.js` passed with 4 tests.
  - `node scripts/run-tests.js src/__tests__/unit/commands.test.js` passed in the current worktree.

## Follow-Up Slice: Flat Stack Runtime Detection

- Scope: support flat stack layouts in `rudi auth` and `rudi which` while preserving structured `node/` and `python/` stack layouts.
- Non-goals: daemon lifecycle, local LLM, runtime commands, stack removal cleanup, and generated `dist/` output.
- Red command and expected failure:
  - `node scripts/run-tests.js src/__tests__/unit/stack-runtime-detection.test.js` failed for flat Python detection; `which` returned `{ runtime: 'node', entry: null }` instead of `{ runtime: 'python', entry: 'src/index.py' }`.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/stack-runtime-detection.test.js` passed with 6 tests after requiring flat root layouts to contain their matching entry point before detection succeeds.

## Follow-Up Slice: Stack Removal Cleanup

- Scope: after uninstalling a stack, remove its RUDI config entry, remove orphaned secret values only when no remaining stack references them, and prune the cached tool-index entry.
- Non-goals: daemon lifecycle, local LLM, runtime commands, generated `dist/` output, and broader secrets storage hardening.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/remove-command.test.js packages/core/src/__tests__/unit/tool-index.test.js packages/core/src/__tests__/unit/rudi-config.test.js` passed with 3 tests.

## Follow-Up Slice: Shared Secrets Store

- Scope: make runner secret access use the shared `@learnrudi/secrets` store, expose shared load/save helpers, validate secrets storage shape, and preserve restrictive file permissions under configured `RUDI_HOME`.
- Non-goals: daemon lifecycle, local LLM, runtime commands, package publish metadata, root package dependency movement, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js packages/secrets/src/__tests__/unit/secrets.test.js packages/runner/src/__tests__/unit/secrets.test.js` passed with 18 tests.

## Follow-Up Slice: Install Secret Definition Normalization

- Scope: normalize stack secret definitions in `rudi install` across string, `{ name }`, and `{ key }` forms, and skip malformed secret definitions instead of throwing.
- Non-goals: daemon lifecycle, local LLM, runtime commands, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/install-secrets.test.js src/__tests__/unit/commands.test.js` passed with 31 tests.

## Follow-Up Slice: Instructions Routing Coverage

- Scope: cover parsing for `rudi instructions <agent> --install --project`.
- Non-goals: daemon lifecycle, local LLM, runtime commands, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/routing.test.js` passed with 28 tests.

## Follow-Up Slice: Local LLM Runtime CLI

- Scope: add local OpenAI-compatible LLM runtime inspection/env export support, a `rudi runtime status` wrapper for local LLM runtimes, minimal sidecar fallback behavior, and schema-backed local LLM operation results.
- Non-goals: daemon lifecycle management, daemon HTTP route registration, full sidecar OpenAPI updates, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/local-llm.test.js` passed with 13 tests.

## Follow-Up Slice: Sidecar Daemon Probe

- Scope: add a reusable sidecar daemon status probe that reads connection files, calls readiness/status endpoints, and classifies offline, ready, not-ready, and unreachable states.
- Non-goals: daemon lifecycle command, status/doctor/home rendering, daemon HTTP route implementation, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/sidecar-client.test.js` passed with 6 subtests.

## Follow-Up Slice: Daemon Status Reporting

- Scope: surface daemon readiness in `rudi status` and `rudi doctor`, including JSON daemon summaries and informational vs actionable doctor states.
- Non-goals: daemon lifecycle command, home storage map, daemon HTTP route implementation, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/daemon-cli-integration.test.js` passed with 3 tests.

## Follow-Up Slice: Home Storage Map

- Scope: expand `rudi home` JSON/human output into an explicit storage map with lifecycle, sensitivity, cleanup guidance, workflow counts, symlink-safe sizing, and no secret values.
- Non-goals: daemon lifecycle command, daemon HTTP route implementation, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/home-command.test.js` passed with 1 test.

## Follow-Up Slice: Daemon Schema Contracts

- Scope: add daemon schema modules and contract validation helpers for success/error envelopes, request context, events, packages, secrets, tool index, run groups, sessions, jobs, artifacts, and daemon status.
- Non-goals: daemon lifecycle command, daemon HTTP route implementation, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/daemon-schemas-contract.test.js` passed with 11 tests.

## Follow-Up Slice: Daemon Operation Layer

- Scope: add schema-backed daemon operation modules for health/readiness/status, package summaries, sessions, secrets, tool index cache, run group projections, artifact projection helpers, and the package-route projection wiring that exercises the package and secret helpers.
- Non-goals: daemon lifecycle command, broader HTTP route wiring, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/daemon-health-operation.test.js src/__tests__/unit/daemon-packages-operation.test.js src/__tests__/unit/daemon-sessions-operation.test.js src/__tests__/unit/daemon-secrets-operation.test.js src/__tests__/unit/daemon-tool-index-operation.test.js src/__tests__/unit/daemon-run-groups-operation.test.js src/__tests__/unit/daemon-artifacts-operation.test.js` passed with 32 tests.
  - `node scripts/run-tests.js src/__tests__/unit/packages-routes.test.js src/__tests__/unit/daemon-packages-operation.test.js src/__tests__/unit/daemon-secrets-operation.test.js` passed with 14 tests.
  - `node scripts/run-tests.js src/__tests__/unit/daemon-health-operation.test.js src/__tests__/unit/daemon-packages-operation.test.js src/__tests__/unit/daemon-sessions-operation.test.js src/__tests__/unit/daemon-secrets-operation.test.js src/__tests__/unit/daemon-tool-index-operation.test.js src/__tests__/unit/daemon-run-groups-operation.test.js src/__tests__/unit/daemon-artifacts-operation.test.js src/__tests__/unit/packages-routes.test.js` passed with 37 tests.
  - `git diff --cached --check` passed.
  - `node scripts/agent-debt-runner.mjs --edited src/daemon/operations/artifacts.js,src/daemon/operations/health.js,src/daemon/operations/packages.js,src/daemon/operations/run-groups.js,src/daemon/operations/secrets.js,src/daemon/operations/sessions.js,src/daemon/operations/tool-index.js,src/commands/serve/routes/packages.js,src/__tests__/unit/daemon-health-operation.test.js,src/__tests__/unit/daemon-packages-operation.test.js,src/__tests__/unit/daemon-sessions-operation.test.js,src/__tests__/unit/daemon-secrets-operation.test.js,src/__tests__/unit/daemon-tool-index-operation.test.js,src/__tests__/unit/daemon-run-groups-operation.test.js,src/__tests__/unit/daemon-artifacts-operation.test.js` passed with non-blocking orphan warnings for `src/daemon/operations/packages.js` and `src/daemon/operations/secrets.js`; both are exercised by `src/__tests__/unit/packages-routes.test.js`, but the current debt scanner graph still reports the route helpers as orphaned pending the broader daemon route/runtime slice.

## Follow-Up Slice: Operation Consumers

- Scope: wire the operation helpers into existing contract validation, run-group detail/live projections, and session metadata/tag/worktree project projection.
- Non-goals: daemon lifecycle command, daemon route/runtime extraction, package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/contract-validator.test.js src/__tests__/unit/non-code-use-cases.test.js src/__tests__/unit/run-group-routes-contract.test.js src/__tests__/unit/run-group-observability.test.js src/__tests__/unit/serve-sessions-broadcast.test.js src/__tests__/unit/daemon-artifacts-operation.test.js src/__tests__/unit/daemon-run-groups-operation.test.js src/__tests__/unit/daemon-sessions-operation.test.js` passed with 68 tests.
  - `git diff --cached --check` passed.
  - `node scripts/agent-debt-runner.mjs --edited src/commands/agent/contract-validator.js,src/commands/agent/routes/run-group.js,src/commands/serve/sessions.js` passed with no findings.

## Follow-Up Slice: Daemon Route And Runtime Extraction

- Scope: extract public health/status, authenticated env/admin/local-LLM routes, HTTP auth/CORS middleware, WebSocket auth/runtime, bootstrap connection-file helpers, process ownership, graceful shutdown, and wire `serve` through those modules.
- Security invariant: the literal `same-origin` token is not accepted as HTTP or WebSocket authentication; callers must present the generated daemon token.
- Non-goals: LaunchAgent lifecycle command, DB schema/OpenAPI/package metadata, and generated `dist/` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/daemon-routes-contract.test.js src/__tests__/unit/daemon-runtime-contract.test.js src/__tests__/unit/serve-ctx-contract.test.js src/__tests__/unit/serve-health-contract.test.js src/__tests__/unit/local-llm.test.js src/__tests__/unit/packages-routes.test.js` passed with 71 tests.
  - `git diff --cached --check` passed.
  - `node scripts/agent-debt-runner.mjs --edited src/commands/serve.js,src/commands/serve/ctx.js,src/__tests__/unit/serve-ctx-contract.test.js,src/__tests__/unit/serve-health-contract.test.js,src/__tests__/unit/daemon-routes-contract.test.js,src/__tests__/unit/daemon-runtime-contract.test.js,src/daemon/routes/admin.js,src/daemon/routes/env.js,src/daemon/routes/health.js,src/daemon/routes/index.js,src/daemon/routes/local-llm.js,src/daemon/runtime/auth.js,src/daemon/runtime/bootstrap.js,src/daemon/runtime/process-manager.js,src/daemon/runtime/shutdown.js,src/daemon/runtime/websocket.js` passed with no findings.

## Follow-Up Slice: Daemon Lifecycle CLI

- Scope: add `rudi daemon` lifecycle command, detached `serve` process management, per-user macOS LaunchAgent helpers, command routing, help text, and focused tests.
- Non-goals: DB schema/OpenAPI/package metadata, generated `dist/` output, and public-readiness docs.
- Commands run and results:
  - `node --check src/commands/daemon.js` passed.
  - `node --check src/daemon/runtime/launch-agent.js` passed.
  - `node scripts/run-tests.js src/__tests__/unit/daemon-command.test.js src/__tests__/unit/launch-agent.test.js src/__tests__/unit/commands.test.js src/__tests__/unit/routing.test.js` passed with 82 tests.
  - `git diff --cached --check` passed.
  - `node scripts/agent-debt-runner.mjs --edited packages/utils/src/help.js,src/__tests__/unit/commands.test.js,src/__tests__/unit/daemon-command.test.js,src/__tests__/unit/launch-agent.test.js,src/commands/daemon.js,src/daemon/runtime/launch-agent.js,src/index.js` passed with no findings.

## Follow-Up Slice: Session Enrichment Schema

- Scope: ensure fresh and migrated databases have session `description` and `enriched_at` columns before refreshing `sessions_fts`, and verify the FTS columns include `description`.
- Non-goals: daemon route docs/OpenAPI, package metadata, and generated `dist` output.
- Commands run and results:
  - `node scripts/run-tests.js src/__tests__/unit/schema-migrations.test.js` passed with 4 tests.
  - `git diff --cached --check` passed.
  - `node scripts/agent-debt-runner.mjs --edited packages/db/src/schema.js,src/__tests__/unit/schema-migrations.test.js` passed with no findings.

## Follow-Up Slice: Sidecar OpenAPI Daemon Surface

- Scope: document authenticated daemon readiness/version/status routes, local-LLM broker routes, and additive daemon schema components in the generated sidecar OpenAPI artifact.
- Non-goals: package metadata, generated `dist` output, and public-readiness docs.
- Commands run and results:
  - `npm run generate:sidecar-openapi` regenerated `docs/sidecar/openapi.json`.
  - `node --check src/contracts/sidecar-openapi.js` passed.
  - `node scripts/run-tests.js src/__tests__/unit/sidecar-openapi-contract.test.js src/__tests__/unit/daemon-schemas-contract.test.js src/__tests__/unit/daemon-routes-contract.test.js src/__tests__/unit/local-llm.test.js` passed with 38 tests.
  - `git diff --cached --check` passed.
  - `node scripts/agent-debt-runner.mjs --edited src/contracts/sidecar-openapi.js,src/__tests__/unit/sidecar-openapi-contract.test.js` passed with no findings.

## Follow-Up Slice: Codex TOML MCP Discovery

- Scope: prefer Codex `config.toml`, parse `[mcp_servers.*]` entries for MCP discovery, and recognize an existing TOML RUDI router entry before direct stack registration.
- Non-goals: package resolution, generated package manifest, generated `dist` output, and public-readiness docs.
- Commands run and results:
  - `node scripts/run-tests.js packages/mcp/src/__tests__/unit/agents.test.js src/__tests__/unit/integrate-codex.test.js` passed with 25 tests.
  - `git diff --cached --check` passed.
  - `node scripts/agent-debt-runner.mjs --edited packages/mcp/src/agents.js,packages/mcp/src/registry.js,packages/mcp/src/__tests__/unit/agents.test.js` passed with no findings.
