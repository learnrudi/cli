# Account-aware scheduled workspace tasks

## Phase 0: Baseline and manual lookup
Risk: high (identity, filesystem boundaries, unattended execution). User authorizes completing account selection, containment qualification and recurring task setup on Admin. Baselines: CLI 92138e3, Compute 0c909ed. Existing Admin Claude fixture worktree remains untouched; prerequisite source patch imported into isolated local CLI worktree for review. Consulted manual index, existing task contracts and repository instructions.

## Phase 1: Scope lock
Agent Host owns explicit account selection, native environment and session persistence, auth verification, sandbox, custody and receipts. Compute owns recurring admission using existing jobs/leases. Accounts live only on Admin, with native per-account config/session directories. No credentials in service/profile/request files. Preserve unrelated live services/schedules and dirty Admin work.
Commit slices: (1) existing Claude fixture prerequisite; (2) explicit account/session and native sandbox; (3) recurring task admission; (4) generated builds and Admin delivery. User authorizes Admin setup; follow repository Git review delivery, record publication separately. No migration of unrelated production databases without a recoverable rollout. Horizontal disposition: standardize existing task contracts; reuse queue and custody, no second scheduler authority.

## Phase 2: Red tests
One behavior at a time: account binding and mismatch rejection; native session directory; filesystem/audit sandbox; activation and deduplication/pause/revision drift. Record exact red/green commands as executed.

## Phase 3: Implementation
Pending. Bound all inputs, fail closed on auth/version/profile drift, preserve evidence, allow only explicit output roots and native runtime state. Each run starts fresh; native transcripts stay with selected account.

## Phase 4: Green and refactor
Pending targeted checks. No speculative broad refactors.

## Phase 5: Full verification
Required: repository suites/build/package checks, focused JS debt scan, Admin native allow/deny/symlink/audit escape/supervisor signal/cancellation/recovery checks, recurring queue smoke, fresh read-only Standards/Spec/Proof review.

## Phase 6: Closure
Pending. Do not claim activation until qualification, recurring integration and Admin validation complete. Preserve worktree lineage and exact evidence; no credential synchronization.


## Implementation and verification ledger

Implemented explicit Claude account binding (email, organization, canonical private
config directories), scrubbed environment, native version/seat/kernel preflight,
Read/Write/Edit-only file tools, OS file/audit/signal sandbox, fresh persisted
native sessions, and account/session completion receipts. Compute schema4 adds
revision/runner-bound activation, minute admission through the existing queue,
stable occurrence keys, pause/replace/retire disablement and a 100-activation
capacity guard. No second job queue or provider argument construction was added.

Red/green commands: CLI `node scripts/run-tests.js
src/__tests__/unit/agent-task-account.test.js
src/__tests__/unit/agent-task-claude.test.js`; failures first demonstrated absent
account fields, incorrect auth environment, missing sandbox/session persistence,
fixture-only gate and missing receipt account. Final targeted15 passed.
Compute `PYTHONPATH=src python3.12 -m unittest discover -s tests
-p test_task_schedules.py -v`: observable failures for activation, recurrence,
controller dispatch, repeated pause, timeout change and capacity; same8 tests green.
The initial scheduled-qualification test was an interface failure, not behavioral
red evidence. Its launcher/account pin and drift tests now pass; fixture Claude
pin test failed on CODEX environment then passed unchanged. Legacy launcher
hash test remains green.

Full local CLI suite922:912 passed,10 skipped,0 failed (platform-specific gaps).
Build and npm package dry-run passed; changed-file debt runner has0 findings.
Focused MCP scan using real index/capsule/custody entrypoints has no changed-file
findings; two pre-existing lifecycle re-export reachability warnings are outside
this change. Full Compute174 passed before the final fixture-pin addition;
compileall and isolated pinned-setuptools83 package install passed. Latest source
includes origin/main1923d78 to preserve the accepted malformed-lease fix.

Admin native evidence: `/Users/admin/.rudi/outputs/claude-qualification-20261017-2/`.
`report.json` proves three account identities, overlapping native file tasks,
allowed outputs, denied OS reads/writes/symlinks/audit/supervisor signals and saved
native sessions. Its `custody_qualified:false` scopes that script alone; separate
`custody-tests.json` passes8 generic modes and `native-custody-tests.json` passes
normal/owner-crash cleanup of the native executable for all3 accounts. No claim
that a mocked provider or timeout waiting for stdin proves inference completion.
The extra exec-closed experiment passed but is not the delivered policy.

Independent review `/root/review_accounts`: two scheduling P2s closed by regression
tests. New bundle schema mismatch corrected to packaged SCHEMA_VERSION; historical
fixture bytes stay unchanged. Scheduled release reuses hash-bound qualification,
adds accounts/recurrence evidence, pins Python/Node/Claude, and preserves the
manual-only scope. No retained fixture eligibility flags were changed.

Delivery remains pending final Git authorization and Admin package/recurrence
acceptance. No existing Admin service, state database, account credentials or
unrelated dirty source was changed. Worktrees retained with uncommitted source,
tests, docs and generated CLI bundles. Closeout ledger remains pending delivery;
owner is this task, trigger is release acceptance, proof is stored/read-back
Repo Steward receipt. Do not archive either worktree.


## Git delivery authorization

User explicitly approved committing/pushing both repositories, opening and
merging PRs after checks, and the separate Admin scheduled worker rollout.
Final local Compute175 tests passed plus compile/install. Independent reviewer
confirmed Standards PASS with all three findings closed;17 focused tests passed.
Deployment Spec/Proof remain pending target-host packaged recurrence acceptance.
Commit slices are task source/tests/docs followed by generated CLI bundles;
no credentials, client records or machine-local runtime state are staged.
