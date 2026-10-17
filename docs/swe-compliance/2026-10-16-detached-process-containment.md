# Detached process containment — fixture-only work

## Phase 0: Baseline and manual lookup

High risk: process ownership, signaling and crash recovery. The existing group-only cleanup can release custody while a detached descendant remains alive. Baseline, source preimages and protected-file hashes are under `/Users/admin/.rudi/outputs/rudi-compute-containment/2026-10-16/`.

This continues unfinished Admin implementation in an isolated feature worktree. The original dirty CLI and Compute checkouts remain preserved. Admin is used for this continuation because the unpublished prerequisite implementation and target native runtime exist here. Git publication, peer adoption and deployment remain separate; no source is copied to the RUDI Mac.

Manual: Engineering Operating Manual index, Master Doctrine testing/failure boundaries, Engineering Quick Reference, Agent Copilot standard. Adjacent callers: task-run, custody/watchdog, foreground event stream, native provider plan, standalone worker packaging, Compute recovery and release manifest. Private automation retains its separate contract; this change must not silently alter it.

## Phase 1: Scope lock

In scope: an isolated macOS audit session for each real task invocation, the pinned native host's command sandbox preventing session escape, token-bound descendant cleanup, independent watchdog, package contents, isolated regression fixtures and documentation.

Non-goals: production launch agents, NFL configuration, scheduler changes, deployment eligibility, commits, publication, cutover, privileged provisioning or remote execution.

Interfaces: the task capsule starts one standalone worker in a launchd job with SessionCreate; native descendants inherit that audit session. A native helper reads kernel audit tokens and signals exact process generations. Custody excludes only verified supervisor/watchdog identities and itself. Unknown ownership, inaccessible candidate processes, lost anchors or failed cleanup retain quarantine. Prompt delivery remains gated on watchdog readiness.

Expected files: native/task-audit.c, build helper, task capsule/worker, task-custody, task-run, foreground task spawning, package manifest, task tests, execution documentation and this checklist. Compute source need not change; release manifests remain ineligible.

Commit slices (uncommitted, no publication authority): (1) containment and regression tests, (2) capsule/native package build, (3) docs and generated artifacts. Independent read-only review required after implementation.

## Phase 2: Red tests

`node scripts/verify-task-containment.mjs` failed against group-only custody: closed=true but descendantGone=false; canary unchanged (`red-detached.log`). The same command passed after the audit-session implementation (`green-detached.log`, `green-refactor.log`).

Review regression: `node scripts/verify-task-containment.mjs prequarantined-crash` failed because an existing quarantine stopped watchdog cleanup (`red-prequarantine.log`); the unchanged command passed after idempotent quarantine/drain (`green-prequarantine.log`). Public capsule injection test failed before the explicit rejection and passed afterward (`red-injection.log`, `green-injection.log`). The census-race and guardian-before-spawn cases were added during review after the initial implementation; their proof is behavioral regression coverage, not a separately preserved red implementation run.

## Phase 3: Implementation

Implemented in the isolated feature worktree. A temporary launchd job with SessionCreate creates the audit-session capsule. The watchdog is ready before preflight/spawn; native prompt delivery also verifies the current guardian identity. Creator loss, owner loss and guardian loss stop work and retain unresolved custody.

The native helper reads kernel audit tokens, creation IDs and PID versions and uses generation-bound signals. PID 0 proves the qualified Darwin live-list traversal reached its end. Missing/reused/executed candidate identities make a scan uncertain; two complete certain empty sweeps are required. Creation IDs remain uint64/decimal text, bounded below 2^63; wall-clock start times are not used for census exclusions. Cleanup completes before output hashing.

Qualification is limited to Darwin 24 x64 / native Codex 0.160.1 and trusted same-user supervisors/native host. Native command sandbox probes deny foreign session access, session creation and supervisor signaling; a fixture rejects launchd job creation. An outer nested sandbox was rejected after a preserved native failure. Both anchors lost, inaccessible identities, uncertain census past budget and unresolved business outcomes retain quarantine. No automatic replay or quarantine clear exists.

## Phase 4: Green tests and refactor

Passed: normal detach, double-fork, owner SIGKILL, pre-existing quarantine plus owner loss, unrecorded-spawn crash, guardian loss, guardian loss before spawn, and creator SIGKILL. Each custody fixture preserves an unrelated canary. The controlled census fixture forces a parent to fork and exit after enumeration: first sweep members=0/uncertain=1, next sweep discovers the child. Missing PID-0 sentinel, unknown PID and stale anchor are rejected/uncertain. Fault injection is compiled only into a fixture executable; packaged helper has no injection interface.

Source native run `job_nativecontainment4` passed with the canonical pinned executable. The packaged Compute job `job_f88dc27b8c344af98ccf290dace58fdd` also succeeded, native session `01a14772-75f4-70c2-a485-7cd6cc2877cb`; the task double-forked a harmless sleeper, both declared output hashes matched, and the descendant was gone after audit-session drain. Fixture schedule count was zero. Proof: `packaged-native2/proof.json` under the evidence root.

## Phase 5: Full verification

`pnpm build`, `npm pack --dry-run`, frozen offline fixture bundle construction and manifest verification passed. Both workers and the executable native helper are present in the package. Core and fixture SWE debt scans: zero errors/warnings/info. Repository changed-file debt runner passed.

Full `pnpm test`: 871 tests, 867 passed, 4 failed (`full-tests3.log`). The Windows descendant test passed its isolated rerun (5/5 in `tool-index-recheck.log`). Three adjacent Agent Host files aborted in native better-sqlite3/Node `RemoveEnvironmentCleanupHook` teardown. A control copy of the preserved implementation using the same frozen dependency build reproduces that native failure in lifecycle and private-automation (`sqlite-baseline-control.log`); targeted current tests also reproduce it (`sqlite-recheck.log`). A minimal SQLite GC loop passed, so the exact native teardown trigger remains unresolved. Do not claim a green full suite or release acceptance. Earlier runs with a shared dependency symlink/missing native build are retained as setup failures, not acceptance evidence.

Independent review found and verified fixes for quarantine, census, pre-spawn guardian and silent fixture-injection defects; no remaining containment source blocker was identified. Final Standards/Spec/Proof verdict: PASS for scoped containment (`independent-review.md` in the evidence root). Full-release verification stays BLOCKED by the native-addon failure class and deferred release gates.

## Phase 6: Documentation and closure

Execution documentation updated. All 41 protected file hashes match; all three NFL schedules remain ACTIVE and byte-for-byte unchanged. Original CLI 26 and Compute 32 preimage files remain unchanged. Their repository HEADs advanced concurrently through another preservation workflow; this task performed no Git publication or integration of those commits. Reconcile that source lineage before later publication.

Repo Steward closeout `detached-containment-20261016`, version 2, state `preservation_required`, retains this dirty feature worktree and evidence. No cleanup, deployment, cutover, commit, push, PR, merge or peer adoption was performed by this task.

Later release gates: resolve the native-addon full-suite failures; migrate Compute's old deterministic fixture to the explicit in-session interface (public dispatch now rejects its overrides); update the npm publication workflow, which currently builds on Ubuntu and allowlists the old package files; qualify additional OS/architecture hosts; reconcile accepted Git lineage and peer adoption; refresh release manifest eligibility only after review; perform isolated service launchd acceptance and rollback checks. Deployment and NFL cutover remain separate approvals. Existing package manifest eligibility flags remain false.
