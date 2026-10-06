# Node24 migration — execution checklist

## Phase0: Baseline and manual lookup — complete

High risk: shared interpreter replacement, archive boundaries, native ABI change and persistent lock metadata. Manual index, Master Doctrine AppendicesC/D, Agent Co-Pilot and Horizontal Engineering standards applied. Canonical CLI baseline is `be4593d`, with the earlier runtime-binding slice preserved. No source or machine-local state was discarded.

## Phase1: Scope lock — complete

Default runtime24.21.0; supported CLI majors22/24. Preserve separately versioned identities, Wrangler22.23.2, project runtimes, data, secrets and existing dirty work. Stage official downloads beside the destination; retain the old tree, reject concurrent replacement, and preserve runtime plus lock on failure.

Paths: registry-client downloader/tests; core installer, lockfile and runtime-replacement tests; package/doctor support policy; CI contracts; README; generated CLI distribution. `lockfile.js` was added to the map after the real Node archive proved that bundled npm symlinks and node_modules require an explicit runtime checksum mode. Bundled-skill fault injection was updated to target the lock directory after atomic writes moved to a temporary filename.

Horizontal disposition: resolve shared downloader/installer rollback in this change; reuse deferred-install filesystem rollback, preserving other package semantics. Standardize atomic lock writes across package kinds. No generic transaction framework or broader runtime-manager rewrite.

## Phase2: Red tests — complete

Behavioral red/green pairs cover checksum/download preservation, incomplete extraction, escaped binary links, concurrent installs, runtime-tree checksum, persistent partial lock writes, metadata symlinks, scratch-cleanup failure, support policy and CI/catalog contracts.

Proof commands:

```sh
node --test packages/registry-client/src/__tests__/unit/verified-download.test.js
node --test packages/core/src/__tests__/unit/runtime-replacement.test.js
node --test packages/core/src/__tests__/unit/bundled-skill-install.test.js
node --test src/__tests__/unit/node-support-policy.test.js src/__tests__/unit/quality-workflow-contract.test.js
```

Original and strengthened failing assertions are preserved in task logs. The successful-backup assertion additionally proves exact old bytes survive.

## Phase3: Implementation — complete

- Verify download hash, extract in sibling staging, validate executables and reject archive-owned metadata collisions with exclusive writes.
- Finish scratch-file removal before runtime replacement. Rename the previous tree to a retained backup. Roll back on metadata failure.
- Use a bounded exclusive installation lock and atomic lockfile temp/rename. Persistent partial-write failure leaves exact prior lock bytes intact.
- Runtime locks use `runtime-tree-v1`, hash bundled dependencies and contained links; ordinary packages keep strict link rules.
- Align CLI doctor, engine declaration, README and CI on22/24.

## Phase4: Green and refactor — complete

Focused and adjacent tests passed after each correction; full post-review suites pass838 tests on each major and architecture. Refactoring was limited to correcting documentation placement and fault injection for the atomic boundary. No speculative broad test rewrite.

## Phase5: Full verification — preparation and local activation passed

Both peer distributions and Node22/24 builds agree. Native and router evidence is listed below. Focused SWE scan covers9 migration JS files with0 findings; repository changed-file scans also return0. Fresh `rudi-code-review` independently reproduced3 defects, confirmed the fixes, and passed Standards/Spec; final evidence update passes Standards, Spec and Proof for verified preparation.

## Phase6: Docs, contracts and closure — local activation complete; publication separate

README covers runtime policy, native ABI testing, backup retention, checksum mode and interruption limits. Planned uncommitted slices: runtime safety/tests; policy/CI/docs; generated distribution. Earlier binding work remains intact. All ten canonical and verification worktrees across both Macs have read-back Repo Steward `preservation_required` receipts. The user subsequently approved local activation; both Macs now pass live acceptance. Publication remains a separate unauthorized gate.

## Verification and authority boundary

- Source preparation and authorized local activation are complete. Both Macs now select managed Node 24.21.0; installed CLI/native dependencies and active launchers were refreshed. No commit, push, pull request, registry/npm publication or retained-runtime removal was performed.
- Baselines and raw red/green/acceptance logs are preserved under `$RUDI_HOME/outputs/node24-migration/2026-09-30/` on the corresponding machine. Baseline manifests identify pre-existing runtime-binding and Wrangler work.
- Both Macs: CLI Node22 and Node24 suites each pass 838 tests with `RUDI_CLI_TEST_WRAPPER_ACTIVE=1` and target runtime first in PATH. Each uses a separate frozen-lockfile install and native dependency store. Builds, debt runner, package inventory pass.
- Primary registry: 358 tests pass on Node22 and Node24. Peer Node22 and Node24: 358 tests pass on each. Clean scoped checkouts pass validation, generated-index checks, source hygiene, build, seven release SHA-256 checks, public readiness, debt and package inventory. Intent-to-add for the baseline Node22 catalog file makes its ownership visible in these temporary checkouts; no commit was made.
- Primary canonical registry contains unrelated Google Workspace/map-my-work work and four existing generated directories. Preserve it. The clean release candidate contains only the runtime work plus its pre-existing Wrangler dependency. Do not publish the mixed canonical index.
- Both architectures: official24.21.0 archives verify; fresh packed CLI installation opens in-memory SQLite. Sports Stats builds and discovers3 MCP tools; Audio Tools passes8 tests; Content Extractor passes37. SQLite reads/writes pass for staged CLI, Sports Stats and Audio Tools. No persistent database was opened during preparation. Activation later used the selected Service Desk databases read-only for the active-attempt drain guard; no database was copied or migrated.
- Both architectures: generated staged router launcher initializes, lists4 SWE tools, and calls `swe_manual_list` returning13 documents. Staged HOME/RUDI_HOME are isolated; no live host tool refresh is claimed. Dot's separate hosted-chat exposure issue is not fixed by this migration.
- Primary additional addon probes: fsevents2.3.2/2.3.3, sharp, rspack and rolldown load under24. The old primary Sports Stats SQLite was incompatible; its prepared replacement is now active and passes live SQLite checks. Peer fsevents, sharp and rspack addon loads also pass.
- Transient tests: one primary Node22 local-registry fixture failed during simultaneous runs; targeted and final isolated full runs passed. Two peer Node22 process-reaping tests failed under concurrent stack installs, then the unchanged full suite passed when run separately. No assertions were weakened to suppress these observations.
- Linux/Windows execution and GitHub-hosted CI have not run. Linux descriptor hashes were verified against the official manifest; supported release CI is configured. Native checks do not prove every authenticated provider operation or complete video rendering/transcription workflow.
- Runtime replacements retain backups. Interrupted installs may retain a lock or staging directory; automatic crash recovery is not claimed. Retire evidence only after activation, consumer acceptance, and explicit scoped cleanup approval.
- Publication requires its own authorization and a new CLI release version; the local test tarball retains development version1.10.27 and is not an npm release candidate with a new version.

## Authorized activation — September 30, 2026

The user explicitly approved activating Node 24 on both Macs, installing the verified CLI/native dependencies and rebuilding active launchers with rollback copies. Each Mac independently installed its official archive with the reviewed runtime installer. Runtime lock verification passes. New shell/CLI/router/daemon processes use Node 24.21.0 and npm 11.19.0; pnpm remains 10.22.0. Wrangler remains on Node 22.23.2.

- Both live canonical CLI checkouts: 838 tests pass with wrapper fallback disabled, build/debt/package/diff checks pass, and distribution hashes match the reviewed candidate. No runtime implementation changed during activation.
- Live router acceptance: primary 447 tools, admin 469 tools; initialize, tools/list and swe_manual_list succeed with 13 manual documents each.
- Fresh architecture-specific native dependencies: installed CLI, CLI development checkout, Service Desk, Sports Stats and Audio Tools pass in-memory SQLite reads/writes. Primary 31 and peer 39 native files load with their correct Node/SQLite loaders. Historical app backups remain on their original ABI and are excluded from active-runtime acceptance.
- Service Desk's execution-attempt guard passed read-only. Original workers exited after SIGTERM, a tested temporary entry hold prevented automatic relaunch from starting application work, and exact original entry bytes/mode were restored before bootstrap. Both daemons report ready. The primary's three existing Codex processes remain alive.
- Primary Codex 0.147.0 and Gemini 0.53.1 were preserved at their exact versions outside the replaceable runtime under ~/.local. Their RUDI wrappers now target those installations through explicit managed Node.
- One operational assertion initially checked hold-process disappearance immediately after launchctl bootout; the process was still exiting. This occurred before runtime mutation. The controller verified natural worker exit, unloaded jobs and restored entry before continuing; the peer sequence polls for hold exit. No application worker was force-killed.
- Retained per-Mac rollback journals: outputs/node24-migration/2026-09-30/activation/activation-state.json. Preserve old runtime, CLI/native directories, lock bytes/absence, launchers and evidence together. No credentials, databases or mutable application state were transferred between Macs.

Existing gaps remain separate: Dot hosted-chat tool exposure; primary Service Desk's Codex allowlist 0.146.0 versus preserved CLI 0.147.0; broken Homebrew Node 25 with declared consumers. Existing host processes may retain Node 20 until their normal reconnect. No global host restart, old-runtime deletion, commit or publication occurred.

## Authorized source publication — October 6, 2026

The user approved committing the reviewed CLI source, opening a PR, merging after CI passes, and synchronizing both canonical Mac checkouts to clean `main`. This supersedes the earlier source-publication hold; npm release, deployment, restart and backup removal remain separate.

PR #47's first Linux run passed the complete Node 22 and Node 24 matrix. Main's existing branch protection requires a check named `quality`, so the matrix now feeds a stable final `quality` job without changing branch protection. The final job runs even when a dependency fails and accepts only the matrix result `success`; failure, cancellation, skipped and empty results fail closed.

The focused workflow-contract command `node --test src/__tests__/unit/quality-workflow-contract.test.js` first failed because the stable gate was absent (7 passed, 1 failed), then passed all 8 tests after the workflow correction. The test executes the gate's shell command for each result. No refactor or runtime implementation change was needed. Raw red/green and publication verification logs are retained under `outputs/cli-main-review-20261006-q38zd_d5` on the primary Mac. Windows execution remains unverified.
