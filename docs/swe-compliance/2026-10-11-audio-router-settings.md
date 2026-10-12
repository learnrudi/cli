# Audio model configuration and transcription timeout

## Phase 0: Baseline And Manual Lookup

- Request: make the installed audio model configuration survive stack updates and allow long transcription calls to finish through the local RUDI MCP router.
- Baseline: CLI `ccb59a3`; primary and admin canonical checkouts clean at the same revision. Worktree: `codex/audio-router-settings`. Registry has unrelated changes and is out of scope.
- Evidence: `addStack` reconstructs launch metadata; router gives every downstream request 30 seconds; audio-tools allows 120 seconds for conversion and 600 seconds for Whisper.
- Standards: manual index, Master Doctrine principles and Appendix C, Agent Co-Pilot, Horizontal Engineering standard; SWE compliance and formal review skills.
- Risk: medium, because this adds an optional persistent runtime contract. No dependency, secret, database, or hosted-router change. The user subsequently authorized CLI release 1.10.28 and installation on both Macs; publication must use the existing trusted-publishing workflow after PR acceptance.

## Phase 1: Scope Lock

- Add optional `$RUDI_HOME/router-settings.json`, schema version 1, separate from generated `rudi.json` and installed stack files.
- Contract: `stacks[stackId].env` is a non-secret string map; `stacks[stackId].toolTimeoutMs[toolName]` is a positive integer <= 900000. Missing settings retain existing behavior. Invalid settings fail startup with an actionable error that does not print values.
- Environment precedence: inherited environment, selected stack settings, declared secrets, then existing managed PATH setup. Settings cannot leak between stacks or override declared secrets.
- Router loads settings at startup. Reconnect is required; hot reload is not in scope. Tool deadlines are per tool; initialization/discovery and unconfigured calls remain 30 seconds.
- Timeout failure: no retry or false cancellation claim; identify the tool and deadline and explain that downstream work may still run. Do not kill a shared stack or unrelated calls.
- Files: `src/router-mcp.js`, new router settings module, focused tests/fixture, README, this record, generated `dist/router-mcp.js` if tracked.
- Horizontal scan: installer owns generated launch metadata; local stdio router owns subprocess environment/deadlines; shared dispatcher and hosted transport stay unchanged. Existing `rudi run`/`rudi mcp` routes are outside this router-specific contract. Disposition: standardize the local router contract here, no new shared env implementation.
- Planned commit slices: runtime + regression tests; documentation/evidence; generated build output. The user explicitly authorized committing and releasing the CLI fix and updating both Macs. Use the feature branch, required PR checks, normal merge commit, and existing npm trusted-publishing workflow; never push directly to main. Include package version 1.10.28 and its generated CLI bundle.
- Authorized activation: bounded local runtime repair and matching admin-Mac configuration/verification under the user's request. Preserve originals, do not restart other active routers or services.
- Exit: settings survive re-registration; model is selected without a launch wrapper; actual transcription can exceed 30 seconds and return; negative input/deadline tests, full CLI checks, focused debt scan, independent review, and peer verification recorded.

## Phase 2: Red Tests

- Sequential tests: persistent model environment after real stack re-registration; per-tool deadline routing; invalid configuration and isolation/precedence; bounded timeout behavior.
- Record exact red/green commands and observed failures below as executed.
- `pnpm test src/__tests__/unit/router-settings.test.js`: model test first failed because the spawned process received `inherited-model`, then passed after settings environment wiring.
- Same command: after timeout fields were accepted, deadline test failed because a 200 ms operation succeeded despite a 50 ms configured limit; passed after per-tool routing. An earlier unsupported-field failure was setup for that field and is not the behavioral red evidence.
- Setup-only interruption: the fresh checkout initially lacked the native SQLite binding; `npm rebuild better-sqlite3` restored the repository test runner. No dependency versions changed.

## Phase 3: Implementation

- Small validated settings reader and two router integration points: environment and tool deadline.
- Preserve protocol stdout; diagnostics on stderr. Never log environment values.
- No new packages, registry changes, broad timeout increase, or background-job system.

## Phase 4: Green Tests And Refactor

- Run focused tests unchanged after each behavior. Rerun existing router characterization tests after wiring/refactoring.
- Publish only after the verified source and separate generated build commits pass PR quality checks. Preserve the peer worktree until its changes are represented in accepted Git history.

## Phase 5: Full Verification

- Completed on final source: 25 focused tests (settings validation/integration and existing router characterization); full `pnpm test` **862/862 pass**; `pnpm build`; `npm pack --dry-run --json`; `git diff --check`.
- Admin Mac: the same 25 focused tests and build pass; relevant source, tests, README and router build are synchronized in an isolated matching worktree. No unrelated source, credentials, media, database, cache, or log transfer.
- Fresh-context review: `audio_review`, using `rudi-code-review`, returned **Standards pass / Spec pass / Proof pass / Overall pass**, no open findings. It independently reran 25 focused tests, inspected the full-suite log, verified the generated build and installed hashes, and inspected both live receipts.
- Review correction: native tool names may contain dots. The first validation pattern incorrectly rejected them. The dotted-name timeout test failed, then passed after accepting nonblank original names without control characters. The earlier dot-rejection assertion was corrected to match the existing dispatcher contract, not weakened to conceal an implementation failure.
- Repository debt runner exit 0, zero findings. It only includes tracked changes, so a separate `swe_debt_scan` explicitly included all five edited/new JS/MJS files and `src/router-mcp.js` as an entrypoint: zero errors/warnings. The initial daemon-only scan reported the standalone router as unreachable; correcting the scan entrypoint resolved that scope error.
- Both installed routers and each CLI distribution's router now have SHA-256 `9e8ca64cb094d03340e0dcde2ddd00beaf2ea98992bb715131fb24c7848486e4`. Original routers were verified against the baseline and backed up locally before an atomic replacement.
- Both Macs now use `~/.rudi/router-settings.json` with the local installed model and a 900000 ms `audio_transcribe` deadline. The old `/usr/bin/env` launch wrapper was removed. Only Codex's RUDI `tool_timeout_sec` changed from 660 to 960; parsed read-back proved other host settings unchanged.
- Final live primary proof: original 1351.68-second recording, 2265 words, **65.48 seconds** elapsed. The ending is retained; JSON and Markdown content agree. Actual installed `~/.rudi/bins/rudi-router`, no launch wrapper, no parent model override.
- Final live admin proof: locally generated 42.72-second audio, 109 words, **47.1 seconds** elapsed. The ending marker, JSON and Markdown are verified. Uses the same installed router hash and normal entrypoint.
- Rerun on primary: `python3 ~/.rudi/outputs/audio-tools/router-debt-fix-2026-10-11/verify-installed-router.py original`.
- Rerun on admin: `ssh admin-mac 'zsh -lc "python3 ~/.rudi/outputs/audio-tools/router-debt-fix-2026-10-11/verify-installed-router.py synthetic"'`.
- Machine-local evidence directory on each Mac: `~/.rudi/outputs/audio-tools/router-debt-fix-2026-10-11/`. Receipts: `installation.json`, `original-installed-verification.json` (primary), `synthetic-installed-verification.json` (admin), retained `verify-installed-router.py`. Primary also retains `cli-tests.log`, `dotted-tool-red.log`, and `pack-dry-run.json`.

## Phase 6: Docs, Contracts, And Closure

- Final source files: README; this record; `src/router-mcp.js`; `src/router-settings.js`; settings integration/validation tests and their subprocess fixture; tracked `dist/router-mcp.js`. No registry or dependency changes. Release metadata bumps the root CLI package to 1.10.28 and regenerates dist/index.cjs.
- Risk-tier gate: medium; explicit user approval for this repair plus independent passing review. Installed only the bounded local router repair and host-specific settings on both Macs. Existing sessions/services were not restarted.
- Release plan: runtime/tests, documentation/release metadata, then a dedicated generated-build commit on `codex/audio-router-settings`, base `ccb59a3`. Local and PR gates precede merge; dispatch `publish-npm.yml` on accepted main with version 1.10.28. Verify npm integrity/provenance, install that exact version on both Macs, rebuild router shims, and rerun both live audio checks. Stack updates already preserve the separate settings file.
- Horizontal obligations: local router settings/deadlines resolved in this change. Direct `run`/`mcp` and hosted transports retain their existing contracts. No background-job or shared cancellation system added. The test harness is intentionally local to this focused integration suite; reassess sharing if another new suite needs its pending-response lifecycle.
- Preservation: both task worktrees remain under `~/RUDI/worktrees/cli/audio-router-settings`. Repo Steward receipts `audio-router-settings-20261011-primary` and `audio-router-settings-20261011-admin` are both version 2, state `preservation_required`; each was read back and its lease released. Ledgers remain local under `~/.rudi/state/repo-steward` on their respective hosts. No cleanup authorized.
- Accepted limits: reconnect existing MCP sessions to use the new router/settings. Whisper's own 10-minute processing limit is unchanged. A downstream timeout is not cancellation; callers must inspect artifacts before retrying. The live tests establish runtime/model/output behavior, not word-by-word transcription accuracy.
- Pre-publication verdict: **repair verified; release authorized**. Publish and paired-install receipts will record the accepted commit, workflow, package identity, and post-upgrade checks. Rollback uses the retained local router backup; a published npm version is immutable and requires a new patch release for corrections.
