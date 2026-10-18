# Unlimited scheduled repository delivery

## Phase 0: Baseline and scope
User acceptance: remove runtime ceilings for morning/evening delivery, independently review and merge, deploy on Admin; preserve 06:30/22:00 America/New_York and prevent overlapping runs. High risk: execution control and production deployment. Authorized in this chat October 18, 2026.
Manual: operating index, Agent Co-Pilot, Testing Doctrine (red/green), Infrastructure H1/H4; inherited AGENTS apply.
Baseline: Compute 0ffcc84; CLI 5d7873a. Isolated local feature worktrees. No unrelated source edits.

## Phase 1: Contract
Explicit integer zero means unlimited native timeout_ms and Compute timeout_seconds; both must agree. Existing positive limits/defaults stay unchanged. No infinite numeric values or implicit missing timeout. Native capsule must also omit its elapsed-time ceiling. Preserve cancellation, custody, output limits, leases and bounded startup/shutdown calls. No retries/identity/permission/cadence changes.
Compute schema migration must preserve old schedules, history and jobs, allow zero, and keep old invalid values invalid. Same-workspace max_parallel=1 and controller lock remain mandatory. Test a live first job preventing a second claim across distinct tasks while lease renews; cancellation/lease loss still terminates processes.
Prompt revisions remove phase ceilings and retain operational holds. Deploy only the Codex worker after drain and state backup; preserve the old bundle and original control revisions. Do not restart other workers or bypass their state locks.
Commit plan: verified behavior/tests/docs in each repository; CLI generated build separate commit. Independent fresh-context review before merge, existing CI/protections, then native Admin source adoption and guarded release deployment. Rollback is drain/pause and compatible release repair; never reopen upgraded state with an older schema reader or discard post-cutover history.

## Phases 2–4: Red/green implementation
Implemented and checked. Tests at profile/request/executor/migration/concurrency boundaries, including finite regression and unlimited cancellation. No arbitrary long fake timeout replacing unlimited semantics.

## Phase 5: Verification
Source gates passed: relevant full suites, compile/typecheck, install/build/package, focused JS debt. Pending release gates: exact-head independent Standards/Spec/Proof review, Admin qualification and smoke.

## Phase 6: Closure
Pending: merged revisions, immutable bundle hashes, healthy loaded worker, both revised schedules enabled with timeout zero, no overlap; native finite-duration smoke exercises unlimited path (cannot prove infinite future execution). Preserve runtime per host. Worktree closeout receipt required, no cleanup authorized.
Horizontal disposition: standardize explicit zero across existing shared contract; no extra scheduler or duplicate executor. All existing bounded tasks unchanged.

## Source verification evidence
Red: schedule activation with zero rejected by the old 21..3620 check; executor virtual +7200 seconds killed the unlimited process; profile zero rejected; launch installed the fallback 900000ms timer; capsule returned timeout instead of later completion. Green: unchanged behavioral assertions pass after implementation. Cancellation reports the existing `stopped` terminal status, and lease-loss cleanup drains its child.
Commands: `PYTHONPATH=src python3.12 -m unittest discover -s tests -k unlimited -v`; migration suite `-p test_database.py`; installed full Compute suite using the isolated verify-venv; strict `python -m mypy` passes 20 source files; compileall and no-dependency package install. CLI supported Node22.23.2: `pnpm test` (953 tests: 943 pass, 10 platform skips), focused final launch/capsule regressions; `pnpm build`; `npm pack --dry-run`; repository debt runner and SWE scan with actual src/index.js entrypoint (zero findings). Default daemon-only scanner entrypoints produce unrelated orphan warnings; no allowlist or rules changed.
Logs on originating host: ~/.rudi/outputs/compute-unlimited-20261018. Native Admin deployment qualification and review remain explicit downstream gates. Source tests do not claim an infinitely long live run.

Review repair: a missing capsule result after supervisor exit initially hung under unlimited runtime. Red command `node --test src/__tests__/unit/agent-task-capsule.test.js` observed ETIMEDOUT in the bounded child fixture. Green now detects observed worker exit, failed startup and probe failure while retaining unresolved custody; runtime itself remains unlimited. A live unlimited Compute subprocess renews its lease while a second DB connection cannot claim the evening job; after process cleanup the second claim succeeds. Migration tests preserve a real schema4 row and reject invalid finite values.
Exact source verification commands: supported Node22 PATH + `pnpm test`, `pnpm build`, `node scripts/agent-debt-runner.mjs --changed-since origin/main --no-log`, `npm pack --dry-run`; Compute isolated installed Python3.12 `-m unittest discover -s tests -v`, `-m compileall -q src tests`, no-deps/no-build-isolation pip install, strict mypy. Runtime artifacts contain full observed logs; initial source-only Compute test run had one isolated-import setup failure plus the expected version-pin mismatch, fixed before the installed full run. New cancellation assertion corrected to the existing stopped contract rather than changing runtime status.

Review repair: unlimited bridge failure now requires pinned native custody confirmation before Compute releases the workspace claim, including executor exceptions. Unresolved custody leaves the job running and existing fail-closed recovery holds subsequent tasks even when their runtime directories differ. Red `python3.12 -m unittest discover -s tests -p test_worker.py -k unlimited_bridge -v` showed premature dead transition; green covers clear/quarantined custody with normal nonzero exit and executor failure. Capsule completion-vs-exit race also reproduced red and now reads completion again before reporting worker exit. Finite tasks retain existing finalization behavior.

Full CLI rerun named unlimited-cli-full-final overlapped the deliberately red completion-race test (946 passed, 1 expected new-race failure, 10 skips); final corrected verification is unlimited-cli-full-accepted.log. Do not use the former run as green evidence.
