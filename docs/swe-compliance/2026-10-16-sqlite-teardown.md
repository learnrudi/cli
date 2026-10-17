# SQLite / Node teardown correction

## Scope and authority

Continue the preserved Admin containment feature worktree, where the native failure was reproduced. Keep the original CLI/Compute checkouts, installed runtimes, live services and all three NFL schedules unchanged. Deployment, cutover, publication and peer adoption remain separate approvals. Evidence: `/Users/admin/.rudi/outputs/rudi-compute-sqlite-teardown/2026-10-16`.

Medium risk: native runtime compatibility affects database finalization. In scope: allocation-driven SQLite regression, isolated corrected Node runtime, shared runtime policy and diagnostics, package validation, docs. No schema or database migration. Commit plan if later authorized: runtime contract and tests; documentation; generated build separately.

## Diagnosis and red-green plan

Expected: closed database/statement objects can be collected and the process exits normally. Observed: Node 24.21.0 aborts in RemoveEnvironmentCleanupHook during automatic GC. The first incorrect boundary is the Node ObjectWrap destructor's cleanup-hook removal without an active Environment. Header/runtime versions agree; the same error reproduces without containment changes. Explicit global.gc() was a false-negative probe.

Ranked hypotheses: (1) upstream Node cleanup regression: confirmed source match with nodejs/node#65446 and 24.21.0 headers; (2) application close ordering: disfavored by direct adapter-only reproduction; (3) ABI mismatch: disfavored by matching module version and successful queries. Node 24.22.0 adds the cleanup-hook registry and use-after-free correction. Verify the unchanged native addon on a checksum-verified private runtime before accepting the cause.

Red/green command: `node scripts/run-tests.js src/__tests__/unit/sqlite-teardown.test.js`. Regression uses automatic allocation pressure, never forced GC. Then prove normal Agent Host database close/reopen and worker shutdown; run previously failing files, full suite, build, package, focused debt scan and fresh Standards/Spec/Proof review.

Manual: engineering index, master Appendix C/C7A and D; SWE compliance and diagnosis skills. Horizontal scan: Compute uses Python sqlite3 independently; Agent Host uses better-sqlite3; packages/db is preserved Studio compatibility. Correct runtime policy in one shared module rather than changing database storage. No existing database files are test inputs.

## Verification and closure

Passed on Darwin 24 x64: 901 full-suite tests, zero failures/skips; 35 targeted tests; source build; npm pack dry-run; frozen offline dependency/package rebuild and bundle verification; packaged teardown probe; packaged Agent Host list on a new temporary home. The package rejects installed Node 24.21 with a structured error and creates no database; private Node 24.22 succeeds. Double-fork containment and owner-crash recovery both pass, with unrelated canaries unchanged. Node 22 remains an existing supported line but was not executed in this task; CI retains its Node 22/24 matrix.

The A/B comparison used the same native addon SHA-256 `64b9e7c2daf1f3ce5f4b38207626991c6d17bf965b3c97ec759a73a0c1cc85e0`. `red-gc.log` failed in Node cleanup on 24.21, `green-gc.log` passed on 24.22 before changing runtime policy. `red-policy.log` failed admission/doctor expectations, `green-policy.log` passed after the shared policy change. The later extended regression covers worker environment teardown and WAL integrity across 30 reopen/rollback cycles (`targeted.log`, `packaged-sqlite.log`). No application lifecycle rewrite or dependency upgrade was required.

Reproduction commands (from this worktree):

```sh
SQLITE_EVIDENCE=/Users/admin/.rudi/outputs/rudi-compute-sqlite-teardown/2026-10-16
SQLITE_NODE="$SQLITE_EVIDENCE/node-v24.22.0-darwin-x64/bin/node"
# Red native reproduction; still intentionally fails on the old runtime.
/Users/admin/.rudi/runtimes/node/bin/node scripts/run-tests.js src/__tests__/unit/sqlite-teardown.test.js
# Green/refactor regression, then complete repository verification.
"$SQLITE_NODE" scripts/run-tests.js src/__tests__/unit/sqlite-teardown.test.js src/__tests__/unit/node-support-policy.test.js src/__tests__/unit/agent-host-launch.test.js src/__tests__/unit/agent-host-lifecycle.test.js src/__tests__/unit/agent-host-private-automation.test.js
env PATH="$(dirname "$SQLITE_NODE"):$PATH" pnpm test
env PATH="$(dirname "$SQLITE_NODE"):$PATH" pnpm build
env PATH="$(dirname "$SQLITE_NODE"):$PATH" npm pack --dry-run --json
"$SQLITE_NODE" scripts/agent-debt-runner.mjs --changed-since origin/main --no-log
"$SQLITE_NODE" --max-semi-space-size=1 "$SQLITE_EVIDENCE/package-bundle/cli/scripts/verify-sqlite-teardown.mjs"
"$SQLITE_NODE" scripts/verify-task-containment.mjs double-fork
"$SQLITE_NODE" scripts/verify-task-containment.mjs owner-crash
```

The full-suite receipt is `full-suite.log` (exit 0, 146.1 seconds). Focused SWE debt scan with `pr-review` profile reports zero findings; the default scan profile had reported false orphan warnings because it omitted CLI entrypoints. The existing source/packaged CJS import.meta warnings remain: the separately bundled worker path is exercised by the containment fixtures. Native compilation emits its existing module registration cast warning. These warnings were not introduced here.

All 41 protected file hashes match and the three NFL schedules remain ACTIVE. The installed Node binary remains SHA-256 `7abcf39bd37ab251015337ff75304d7555f0d8e88c6e0fbf04bce8ce34636f49`. `preservation-final.json` records hashes and the unchanged A/B addon. A private official Node 24.22.0 archive was checked against upstream SHASUMS256 before extraction (`runtime-provenance.json`). Package manifest flags remain fixture=true and deployment_eligible/unattended_eligible/containment_qualified=false; no schedules or services were bundled.

Upstream diagnosis sources: [Node issue 65446](https://github.com/nodejs/node/issues/65446), [24.21 cleanup implementation](https://github.com/nodejs/node/blob/v24.21.0/src/api/hooks.cc), [24.22 corrected implementation](https://github.com/nodejs/node/blob/v24.22.0/src/api/hooks.cc). Final evidence and independent review live beside `REPORT.md` in the evidence directory. This ledger is updated after package construction; runtime source remains identical to the packaged snapshot.

No commit, push, PR, merge, deployment, service restart, installed-runtime replacement, cutover or peer adoption was performed. Preserve the dirty worktree and prior containment work. Later gates still include accepted Git lineage/peer adoption, registry/runtime delivery, native publication workflow, launchd service acceptance, other-host qualification and separately approved deployment/cutover. This change closes the SQLite teardown/full-suite blocker only.

Independent read-only review: Standards/Spec/Proof PASS, no remaining findings.
Repo Steward receipt `sqlite-teardown-20261016`, version 2, state
`preservation_required`, saved as `closeout-receipt.json` in the evidence root.
The preserved original CLI and Compute source preimages also remain unchanged.
