# Private native skill naming

## Phase 0: Baseline and manual lookup

- Scope: durable native names and host restrictions, with stable package IDs.
- Baseline: main at 60c78b09c6f2c6204c4b3349eeb6fa2fb523300b. Preserve the existing npm runtime binding work, README additions, and generated bundle changes. Baseline patch retained in the calling task's work directory.
- Manual: index, Master Engineering Doctrine, Agent Co-Pilot Operating Standard, testing doctrine, horizontal stewardship standard.
- Risk: high, because ownership receipts are persistent state used by removal.
- Horizontal scan: install, related install, update, sync, check, and removal already share src/native-skills/lifecycle.js. Resolve the shared naming contract here; do not add parallel command implementations.

## Phase 1: Scope lock

- In scope: private ~/.rudi/native-skills.json, strict policy validation, rendered names and invocations, receipt compatibility, preservation and reporting of conflicts, command integration tests, documentation, build and verification on both Macs.
- Non-goals: public package renames, registry edits, changes to private skill bodies, unrelated runtime binding work, automatic deletion of old or customized folders.
- Interface: schemaVersion 1 with skills keyed by package ID; each entry can specify name and hosts. Missing policy preserves defaults. Receipt filenames remain keyed by stable package ID; schema 3 separates skillId from skillName and reads schema 2 safely.
- Trust boundaries: JSON configuration, symlinks, names, host names, native trees, receipts. Invalid or ambiguous ownership fails closed. Exact rendered trees may be adopted; differing custom trees remain unmanaged.
- Rollback: preserve prior receipts on failure; stage tree writes with existing guarded promotion and rollback. Existing old targets block renaming until deliberately reconciled.
- Commit slices: (1) policy and lifecycle behavior with tests; (2) docs and verification evidence; (3) generated build. Commits, publication, and installed CLI activation are not authorized by the execution skill alone.
- Review: fresh-context Standards/Spec/Proof review after tests; high-risk migration proof before live receipt changes.

## Phase 2: Red tests

- One behavior at a time: native alias, invalid policy, excluded host, old receipt migration, collision/drift preservation, metadata invocation, discovery/removal and command paths.
- Record red/green commands below as performed.

## Phase 3: Implementation

- Allowed paths: src/native-skills/, affected unit tests and necessary command adapters, README.md, AGENTS.md, this checklist, generated dist output.
- No new dependency; structured lifecycle results retain package ID, native name, state/action, error, and restart requirement.

## Phase 4: Green tests and refactor

- Rerun unchanged red command, then affected lifecycle and command tests. Preserve existing safety tests.

## Phase 5: Full verification

- Implementation verification completed: targeted and full suites, build, focused SWE debt scan, repository debt runner, package dry-run, isolated real-state rehearsal, independent review, and admin Mac source reconciliation. Clean release verification is recorded below; publication and live activation remain delivery steps.

## Phase 6: Docs, contracts, and closure

- Pending: evidence, exact delivery boundary, closeout receipt, final verdict. Goal remains active until the full approved outcome is verified or a remaining gate is explicitly reported.

## Implementation execution evidence

- Red/green: `pnpm test src/__tests__/unit/native-skill-policy.test.js` first failed on the old folder name, then passed after policy wiring. Subsequent unchanged tests failed then passed for excluded hosts, schema-2 adoption, mapped discovery/removal, bundled metadata invocation, cross-package ownership collision, and missing skill namespace.
- Regression: 95 focused lifecycle/command tests passed before additional boundary coverage. A separate child-process integration test exercises actual native adapters for direct install, related install, update, sync, check and removal with an isolated HOME; package fetching is injected, native lifecycle is real.
- Runtime provenance: Homebrew's default Node failed to launch (missing simdjson dylib). Node 20.10 runs focused tests but lacks import.meta.dirname needed by two existing router tests. Node 22.23.2 then exposed an existing native-addon ABI mismatch. Final verification uses checksum-verified Node 20.19.0 with `RUDI_CLI_TEST_NODE` set explicitly because the repository runner prefers bundled Node 20 over PATH.
- Focused debt: `swe_debt_scan` using `pr-review` profile reports 0 findings for the two implementation files and two new test files. The default daemon-only entrypoints reported false orphan warnings; the repository's CLI profile resolves them without code changes.
- Isolated installed-state rehearsal on primary Mac: 10 native trees copied, all retained byte/mode-identically, all retired folders remain absent after two syncs. Three exact Claude trees were adopted; seven customized variants remained unmanaged with prior receipts preserved. No live native files or receipts changed.
- Build and `npm pack --dry-run` passed; tracked bundle includes preserved pre-existing runtime binding work. No commits, publication, or installed executable activation performed.

## Verified implementation boundary

- Final full suite: **827 passed, 0 failed** on both primary arm64 and admin x64 Macs, using checksum-verified Node 20.19.0 in isolated diagnostic directories. This provides import.meta.dirname while retaining the native addon ABI; installed runtimes/dependencies were unchanged.
- Final focused debt: 0 errors, 0 warnings, 0 informational findings using the CLI `pr-review` profile. Repository changed-file debt runner passed on both Macs.
- Build and package dry-run passed on both Macs. Source and build checksum parity verified; no installed CLI, native naming policy, native tree, or receipt was activated/modified during this implementation phase.
- Independent review: initially revise for duplicate schema-3 receipts claiming one removal target. A regression first observed unsafe removal, then passed after ownership checks were added to removal and host summary. Focused confirmation: Standards pass, Spec pass, Proof pass, overall pass. Explicit host-exclusion removal behavior is documented and covered.
- Admin source reconciliation: exact seven-file patch applied only after baseline SHA-256 checks, preserving its existing dirty work. Both repos retain main at the baseline revision; nothing staged, committed, pushed, published, or released.
- Real-state rehearsals: 20 native trees across both Macs retained their exact bytes/modes through dry-run, apply, and repeated sync in temporary copies. Seven exact trees adopted; 13 customized trees preserved as unmanaged. No old-name folder was recreated. Canonical package IDs remained unchanged.
- Horizontal disposition: standardize contract, resolved in this change through one shared lifecycle. No duplicate command-specific implementation or registry/package-ID migration.
- Planned slices remain uncommitted: implementation/tests; docs; generated bundle. Existing runtime-binding work is preserved and must remain separately attributable during any later commit/release preparation.
- Final verdict at this boundary: **ready for authorized rollout**, not activated. Remaining: authorize and carry out installed CLI delivery plus the exact private policy on both Macs, retain receipt backups, run exact non-forced syncs and verify live checks. A public release/commit/push is a separate authorization gate. Reverting only the executable cannot read new schema-3 receipts; rollback must preserve paired receipt state.
- Goal remains active until authorized delivery and live verification are complete.

## Authorized release preparation

- User explicitly approved commit, PR/merge, release, and installation on both Macs after the implementation review.
- Release version: 1.10.27 (npm latest observed as 1.10.26 before preparation).
- Isolated release branch starts from accepted origin/main; only the task-owned source/test/docs patch is transferred. Generated output is rebuilt here. Unrelated runtime-binding edits remain in the original checkouts and are excluded from this release.
- Managed worktree creation was unavailable for the projectless chat (not a Git repository); a named Git worktree under RUDI/worktrees/cli is used as the documented fallback.
- Fresh release tests, build, production audit, package inventory, PR CI, npm trusted publication, peer source reconciliation, installed checksums and live policy verification are required before completion.

- Release audit red: production dependency audit rejected fast-uri 3.1.6 for GHSA-qw65-cvwx-89v3 and GHSA-58mr-gqgx-xq4g. The existing override and lock resolution advance narrowly to 3.1.8; the dependency-floor contract test follows the patched floor. Production audit then passed with zero vulnerabilities. No other dependency resolution changed.
- Clean release baseline excluded two tests belonging to unrelated runtime work: the initial isolated suite passed 825/825, compared with 827 in the original mixed checkout. The isolated suite is rerun after dependency remediation.

- Final isolated release proof: 825/825 tests passed after remediation, production audit has zero vulnerabilities, focused CLI debt scan has zero findings, six-file package inventory matches the publishing contract, and nine direct compiled-CLI invocations pass the policy/alias/preservation/removal checks.

- Fresh independent release review: Standards pass, Spec pass, Proof pass, no actionable findings. Reviewer reran 21 tests, reproduced the generated artifacts byte-for-byte, and explicitly scanned all five changed JavaScript files with zero findings. Reviewed bundle SHA-256: 237bd3a7efa0ec90c73ecfdfa7033d97238d233bf24eb72bce3cdedc68ef8b3a. PR CI and live rollout remain delivery proof.
