# Scheduled-agent source preservation — October 16, 2026

The user authorized dedicated Admin Mac branches, review, local commits and reconciliation with main. No push, deployment or NFL cutover is part of this operation. Earlier October 15 records retain their historical authority scope; local commits are now authorized without changing release acceptance.

## Review and retained limits

All 26 original changed/untracked files match the final October 15 package source manifest exactly. Reviewed permission-profile boundaries, pinned requests/native binaries, migrations, native terminal/receipt validation, process ownership, quarantine, and supporting tests. Original source snapshots and path/hash manifests are retained under `/Users/admin/.rudi/outputs/compute-git-preservation-20261016/`.

**Release verdict remains revise:** a detached descendant can survive normal custody close. Quarantine covers supervisor loss but does not prove full containment. Native execution remains restricted to the documented qualified host/version; live launchd/boot acceptance and NFL migration remain separate. No production execution behavior was changed during preservation.

## Verification

- CLI source build, changed-file debt scan and package dry run passed. The package includes `dist/task-custody-worker.cjs`; this generated file was previously ignored and is explicitly preserved in the dedicated build commit alongside `dist/index.cjs`.
- The first full suite passed 889/890 tests. The unchanged Windows-descendant mock in `packages/core/src/__tests__/unit/tool-index.test.js` also failed focused reruns: its fixed one-second sleep raced completion of the shell/Node sweep. Diagnostics were performed in copies under the evidence directory.
- A separate test-only correction waits for the existing sweep receipt with a three-second bound, below the fixture descendant's five-second lifetime. Existing assertions still require sweep invocation, correct exit reporting and actual descendant death. All five tests in the affected file passed afterward. No production implementation changed.
- Red: `pnpm test -- --test-name-pattern='discoverStackTools sweeps Windows descendants' packages/core/src/__tests__/unit/tool-index.test.js`. Green: `pnpm test -- packages/core/src/__tests__/unit/tool-index.test.js`. Final full-suite evidence is `cli-tests-final.log`; no refactor-only phase was needed.
- Final full suite: **890/890 passed**, zero failures or skips. The prescribed debt scan and focused SWE tool scan reported zero findings; the latter completed asynchronously after the router deadline.
- Source feature preservation, test correction and generated distribution use separate commits. Existing task-feature red/green evidence remains in the October 15 compliance records.

Fetched main is `ac898b7d0a723fa6f4bcabd9829c270bc2a99e8c`, already the branch base. Reconciliation requires no incoming changes. All three NFL automation TOMLs matched their prior recorded hashes before work; final readback is retained with the evidence. Installed packages, databases, launchd and schedules are outside this Git operation. Peer source remains unchanged pending an authorized GitHub delivery workflow.
