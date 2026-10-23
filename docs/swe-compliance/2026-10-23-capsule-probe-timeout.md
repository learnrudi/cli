# Capsule status probe timeout correction

## Phase 0: Baseline and diagnosis

User scope: make the existing scheduled review finish correctly and report its true status in Compute. Existing publication and Admin deployment authority apply to the necessary correction; mailbox, model, account, task permissions and notification policy remain unchanged.

Observed failure: a healthy native task was interrupted when its capsule creator exited on `spawnSync /bin/launchctl ETIMEDOUT`. The two-second `launchctl print` poll throws out of `waitForCapsuleResult`; the independent creator monitor then quarantines custody and terminates native execution. Durable evidence records creator loss, a drained audit session and failed completion. This differs from a task runtime deadline or output limit.

Base: CLI main `510dee13a803e772023d87fe55f9b6ef5c3dfdd2`. Owning paths: `src/agent-host/task-capsule.js`, capsule worker and custody supervision, existing capsule tests. Manual: Master Engineering Doctrine failure behavior, concurrency, observability and Appendices C/D. High risk because native supervision and an immutable production task runner are involved.

Horizontal scan: capsule worker identity monitoring and custody cleanup are separate protections. Preserve both. The narrow change handles transient timeout observations in the creator's polling loop; no shared-contract extraction or broader scheduler changes.

## Phase 1: Scope lock

- Allow at most two consecutive status-probe timeouts; a third fails with a clear diagnostic and existing quarantine behavior. A successful probe resets the allowance. Other errors and observed worker exit still fail immediately.
- Recheck a durable completion result after a probe error, preserving the existing result-versus-exit race contract. Validate the result through the same regular-file/JSON reader.
- Preserve finite task deadlines, unlimited-task supervision, process identity checks, watchdogs, audit-session drain, receipt validation and no automatic replay or quarantine clearing.
- Touch capsule implementation/test, current execution guide and this record. Refresh tracked generated bundles in a separate build commit.
- Existing interrupted task requires separate evidenced operator reconciliation; source changes must not erase custody or repair historical status.
- Commit slices: behavior/tests/docs, then generated build. Required checks: red/green, capsule and adjacent custody/task suite, repository tests/build/package/debt, fresh independent Standards/Spec/Proof review. Qualified Admin immutable package and browser completion remain deployment gates.

## Phase 2: Red tests

Command: `/Users/hoff/.rudi/runtimes/node-22-23-2/bin/node --test src/__tests__/unit/agent-task-capsule.test.js`. First red: transient status timeout escaped as ETIMEDOUT (five prior tests passed). After the minimal retry change, six passed. Second red: a completion published during the third timed-out probe was discarded (six passed, one failed); after rechecking the result in the error path, seven passed. Four adjacent regressions then passed for the retry bound, reset, actual exit and finite deadline (eleven total).

## Phase 3: Implementation

Implemented the bounded consecutive-timeout allowance and completion recheck. No global timeout expansion, new dependency, identity relaxation or automatic replay. No refactor was needed.

## Phase 4: Green and refactor

The unchanged red assertions pass. Focused final suite: 11/11. Full repository suite at the same production source: 959 tests, 949 passed, 10 host-specific skips, zero failures. The full run includes the first two new tests; the focused final run covers all six new tests. Local ARM cannot prove Darwin x64 audit containment; Admin-native qualification remains required.

## Phase 5: Verification

Local `pnpm build`, `npm pack --dry-run`, repository changed-file debt runner and `git diff --check` pass. Build uses Node22.23.2; it refreshes only tracked `dist/index.cjs`. Existing esbuild CJS/import.meta warnings remain; deployed CJS paths explicitly use sibling worker paths. The packaged SWE debt scanner with actual CLI/capsule entrypoints reports zero findings, as does the repository pr-review profile. Its default schema-only entrypoints initially reported an orphan warning; selecting the actual owning entrypoints resolved that scope mismatch without changing code.

Independent read-only review passed Standards and Spec and independently reran all11 capsule tests. The review correctly retains Admin-native containment, immutable package and browser completion as deployment gates. Build/package/debt evidence was subsequently supplied for pre-merge source acceptance. No production-success claim yet. Consumer inspected: Compute0088e1797833d0c42fad6f844afa81a3f19ce50a; request, completion and qualification interfaces are unchanged.

## Phase 6: Closure

Pending source publication, peer adoption, current-guide update, run evidence and worktree preservation receipt. Historical failed attempts remain failed. No credentials or mail content belong in this source record.
