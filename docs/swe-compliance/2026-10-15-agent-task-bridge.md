# Agent Host task bridge — 2026-10-15

## Phase 0: Baseline and manual lookup
High risk: filesystem permissions and launch-store migration. Compute baseline 3245388926710ee298dc1565ed12542596882d3e retains the earlier task-contract increment. CLI baseline bf1fe62d2ebd03af522e1857cd38ec5348bc4dcb is clean on codex/cli-onboarding-fixes-20261015. Evidence: /Users/admin/.rudi/outputs/rudi-compute-agent-bridge/2026-10-15.
Manual: Master Doctrine, Appendix C, co-pilot standard, security F13, quick reference. Existing launchAgent/provider adapters/stream supervision and JobStore own execution; no second provider launcher or queue.

## Phase 1: Scope lock and change-impact map
Confirmed CLI paths: commands/agent-host.js -> agent-host/task-run.js and task-profile.js -> launch.js -> workspace.js, providers/common.js and codex.js -> events/stream.js -> launch-store.js. Resume and workspace lifecycle must reject shared-workspace promotion/deletion/resume. Tests, README/contract and tracked dist follow these callers. Existing daemon routes and group/detached APIs do not gain shared-mode admission.
Confirmed Compute paths: task_cli.py -> task_bridge.py -> existing JobStore.enqueue with transactional admission guard; executor environment carries spec hash; worker.py -> task_receipts.py validates the provider-neutral completion envelope before JobStore.succeed records its reference. Job payload stores task revision/request reference; Agent Host receipts store launch/session/output hashes. No new task queue/table/status authority. Tests and task contract/README require updates.
Conditional: migration fixtures and command-surface tests if additive CLI help requires them. No registry/runtime/sports source changes.
Contract: strict v1 hash-pinned request, registered shared project, canonical read/write roots, exact Codex model, fresh foreground session, bounded timeout, explicit network policy. Outputs and Agent Host runtime/control files cannot overlap. Native completed event + native session + valid final manifest + verified files required before success; exit 0 alone fails. Native flags belong only in CLI.
Authorization: source implementation and isolated fixtures only. Three live NFL automations must retain exact hashes. Deployment, cutover, commits/push/PR, active package/database changes and peer installation remain separate. Planned publish slices: CLI behavior+tests; Compute bridge+tests; docs; generated build. No publishing authorized.
Horizontal disposition: standardize task request/receipt contract; reuse stream supervision and enqueue. Defer scheduler concurrency, recurring admission, NFL domain receipt validation, notifications, Claude and resume to later slices. Native capabilities must fail closed outside qualified versions.

## Phase 2: Red tests
One observable test at a time: profile validation/shared paths; native permission plan and launch migration; completion evidence/failure; process group shutdown; Compute admission/idempotency and bridge fixture. Record commands and expected failures in evidence.

## Phase 3: Implementation
Preserve dirty/untracked shared inputs. No copying project, no shell provider launcher. Bound external JSON/file sizes, hashes, paths, model IDs, timeouts and receipt writes. Immutable request/launch/completion records; missing receipt is failure.

## Phase 4: Green tests and refactor
Run the same focused test after each implementation; regression suites for old workspace/private automation behavior. No broad unrelated refactor.

## Phase 5: Full verification
CLI test/build/pack/debt runner and focused SWE debt scan; Compute unittest/compileall/Ruff/mypy/isolated wheel. Isolated process fixture through real Compute executor and source CLI. Native sandbox command demonstrates permitted writes and denied sibling/project/control writes without model invocation. Required fresh-context review: Standards/Spec/Proof independently. Rehash all three NFL schedules.

## Phase 6: Docs and closure
Implemented in source. Final evidence is in `/Users/admin/.rudi/outputs/rudi-compute-agent-bridge/2026-10-15/IMPLEMENTATION-REPORT.md`.

- CLI: 887 tests passed; build, package dry run and changed-source debt runner passed. Explicit SWE scan covered 16 edited/new JS files with zero errors or warnings.
- Compute: 118 tests passed; Ruff, strict mypy (17 source modules), compileall and installation into an isolated verification venv passed. No active package was installed.
- Native Codex 0.160.1 sandbox fixture read dirty/untracked shared inputs, allowed only declared output writes, denied project/control/symlink writes and creation of a hardlink to a read-only source, and preserved shared bytes. Deterministic provider fixture exercised the real queue/worker/executor/Agent Host: completed receipt -> succeeded; exit zero without terminal completion -> dead. No inference was invoked.
- Review-driven red/green corrections cover FIFO reads, pre-existing hardlinks, launch-receipt I/O failure with native process-group cleanup, unrelated zero-exit preflight runners, missing completion receipts and null/missing/incorrect/malformed reference hashes. Five focused bridge tests and nine focused Agent Host tests passed; final suites rerun after corrections. No broad refactor.
- Fresh-context reviewer `/root/bridge_review`: Standards pass, Spec pass, Proof pass for source and isolated execution; no open findings. Root verified packaging and final schedule readback.
- All three live NFL automation files retained exact SHA-256, identity, ACTIVE status and RRULE. Fixture databases contain zero schedule rows.
- Optional repository-wide `ruff format --check .` exposed existing formatting drift in 14 files; no unrelated reformat performed. Required Ruff lint passes; newly corrected receipt/test files pass formatting. This is documented non-blocking formatting debt.

Both repositories remain dirty and unpublished. Preserve the first task-contract increment, this bridge increment and the CLI branch's existing history. Closeout disposition is preservation required; no cleanup authorized. No deployment or cutover claim; actual NFL research and launchd acceptance remain later approved gates. Source synchronization awaits accepted/published Git history and conflict inspection on primary Mac.
