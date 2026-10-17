# Compute execution effort and account selection

## Phase 0: Baseline and manual lookup

- Request: add reasoning effort and account selection to Compute execution profiles, with Claude and Codex execution.
- Baseline: CLI 92138e3; Compute 1923d78. Work in local CLI worktree `compute-effort-accounts-20261017`.
- Related active work: chat 01a14be4-87aa-7a12-90a4-de7417c06f5f owns Claude accounts, containment, and recurrence; chat 01a14b7c-ac25-7442-9d7f-9c0af185eebf owns manual Codex worker rc5 deployment. Do not mutate their worktrees or installed workers.
- Manual: index, Master Doctrine principles and Appendix C/D, agent co-pilot operating standard.
- Risk: high (identity/authentication and execution boundaries).
- Horizontal scan: profile validation, task provider plans, preflight, environment, launch/completion receipts. Compute keeps profiles opaque. Account isolation belongs in Agent Host.

## Phase 1: Scope lock

- Add exact provider/model reasoning-effort validation and native argument mapping. Reject unsupported combinations instead of provider fallback.
- Add explicitly selected Codex account state and bounded native identity inspection; integrate the existing Claude account work after ownership coordination.
- Preserve existing v1 profiles and installed workers; new explicit selections must be pinned by profile hash and recorded in receipts.
- Credentials stay in native provider storage. No credential reads, printing, copying, or global login switching.
- Planned commit slices: reviewed effort/account source, tests, and docs; generated build separately. On October 17 the user explicitly authorized commit, push, PR, merge after checks, Admin installation, and both-provider Compute verification. No unrelated worker or schedule cutover is included.
- External actions: read linked chats and provider documentation. User explicitly authorized coordination with both chats; ownership was coordinated before integration.
- Exit: both provider paths proven through Compute; remaining operational gaps reported concretely.

## Phase 2: Red tests

- Run one behavior-level test before each implementation; record commands/results below.

## Phase 3: Implementation

- Bound inputs, preserve provider ownership, no new dependencies, no ambient account fallback when a selection is supplied.

## Phase 4: Green and refactor

- Rerun the same red commands and affected tests after refactoring.

## Phase 5: Full verification

- CLI: pnpm test; pnpm build; focused SWE debt scan; repository debt runner; npm pack --dry-run.
- Compute checks when changed: explicit Python 3.12 unittest, compileall, isolated package install.
- Independent fresh-context Standards/Spec/Proof review required before completion.
- Live proof must use isolated state and the selected account. No unrelated worker/schedule cutover.

## Phase 6: Docs, contracts and closure

- Status: local implementation and independent source review pass. Publication and Admin installation are authorized and proceeding. Selected-account/effort native qualification still requires the accepted candidate and dedicated Codex authentication.
- Existing active work owns Claude integration and worker deployment; no duplicate cutover.

## Evidence

- Integrated the Claude dependency by fast-forwarding this worktree to 1a122c6; the other chat subsequently merged it as CLI PR54 (b2e6783). Preserved this task's changes in `/tmp/rudi-effort-account-before-claude-integration.patch` before applying/resolving its two overlapping source files. No edits to the other chat's worktree.
- Runtime: `/Users/hoff/.rudi/runtimes/node-22-23-2/bin/node` v22.23.2. Homebrew's nominal Node22 path is broken; ambient managed Node24.21 is below the SQLite floor. Installed existing lockfile dependencies offline with pnpm; no dependency changes.
- Red/green commands (all with the explicit Node22 binary): `--test src/__tests__/unit/agent-task-effort.test.js` (unknown field, then invalid values, then Claude combination); `--test src/__tests__/unit/agent-task-codex-account.test.js` (unknown account, config boundary, duplicate JSON keys, UTF-8 split); `--test --test-name-pattern='selected task account' src/__tests__/unit/agent-task-launch.test.js` (ambient auth wrongly used); `--test --test-name-pattern='both providers record' src/__tests__/unit/agent-task-run.test.js` (missing effort receipt); `--test --test-name-pattern='manual admission rejects' src/__tests__/unit/agent-task-run.test.js` (wrong account previously admitted). Each failed for that behavior, then passed unchanged.
- New native metadata RPC module initially used deterministic protocol fixtures and a real empty-home native probe as its first useful verification. Its duplicate-key and UTF-8 boundary corrections subsequently used explicit red/green tests.
- Final `pnpm test` with explicit Node22 PATH: 937 tests, 927 pass, 10 platform skips, 0 failures. Log: `/tmp/rudi-compute-effort-tests-final.log`.
- Final `pnpm build` and `npm pack --dry-run` pass. Package contains ten files. Build reports existing CJS/import.meta warnings; no new dependencies. Logs: `/tmp/rudi-compute-effort-build.log`, `/tmp/rudi-compute-effort-pack.log`.
- Final focused SWE scan using repository `pr-review` profile: 12 edited JS files, zero findings. Repository `node scripts/agent-debt-runner.mjs --changed-since origin/main --no-log` also passes with zero findings; log `/tmp/rudi-compute-effort-debt.log`. An initial scan without the repository profile reported false orphan warnings because it omitted the CLI entrypoints; the correctly configured scan resolves those warnings.
- `git diff --check` passes. Compute Python source was not changed, so its Python test/install commands were not rerun for this CLI-only increment.
- Native read-only proof on RUDI Mac: empty selected home rejects absent authentication; `codex sandbox` denies reading a synthetic `auth.json` under the selected home. No credential bytes copied or exposed; no live inference performed by this task.
- Compatibility: legacy v1 profiles without effort/account remain valid. New fields require an upgraded pinned runner. Claude accounts remain required. Codex selected home uses file storage and validates email through native account/read; workspace ID is not exposed by that protocol and is not asserted.
- Live gap: native selected-account inference and requested-effort acceptance on Admin require the new candidate to be published/adopted and a dedicated Codex home to be authenticated. Existing rc5/manual and Claude rollout workers remain under their chats' ownership.

## Independent review and failure-path corrections

- Fresh-context reviewer `/root/review_effort_accounts` found an inherited-pipe timeout defect. Red command: explicit Node22 `--test --test-name-pattern='cleans up descendants' src/__tests__/unit/agent-task-codex-account.test.js`; failed after 12.47 seconds against the intended ten-second bound.
- Corrected deadline settlement independently of pipe closure and added private process-group cleanup. Follow-up review found that early native exit could still orphan a helper. Red command: explicit Node22 `--test --test-name-pattern='unexpected native exit' src/__tests__/unit/agent-task-codex-account.test.js`; failed with the helper still alive.
- A fixed trusted Node supervisor now retains group ownership across native exit and drains its group on caller disconnect, termination signals, or deadline. Binary and arguments remain separate; no native session or inference is started by inspection. Parent settlement and stream destruction remain bounded even if process closure is absent.
- Green/refactor verification: explicit Node22 `--test` for `agent-task-codex-account.test.js`, `agent-task-effort.test.js`, `agent-task-run.test.js`, and `agent-task-launch.test.js`: 21/21 pass, independently rerun after the final fix. The real inherited-pipe and early-exit cases complete in under half a second on this host. The final full suite/build/debt/package commands above were rerun afterward.
- Review verdict: Standards pass; source Spec pass; overall Proof remains pending native selected-account/effort Compute acceptance on Admin. No additional source findings. Real empty-home native metadata inspection also rejects absent authentication after the supervisor change.
- Remaining native proof must verify requested effort, selected/observed identity, session/output/receipt binding, failure on mismatched identity, and file-store isolation under the actual Admin managed policies. Codex account/read does not expose workspace ID; no workspace identity claim is made.
- Pre-publication work is on `codex/compute-effort-accounts-20261017`. Preserve the source, tests, docs, generated distribution, and evidence through publication and native acceptance.
- Repo Steward closeout receipt `compute-effort-accounts-20261017`, version 3, is `retained`. Readback confirmed the exact worktree, branch, 14 unstaged files and four untracked files; lease released. Ledger: `/Users/hoff/.rudi/state/repo-steward/closeouts/rudi-workspace--worktrees--cli--compute-effort-accounts-20261017/compute-effort-accounts-20261017.json`. Cleanup is ineligible because the worktree is dirty, acceptance is missing, and preservation requirements remain. No cleanup approval exists.
