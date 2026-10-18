# Compute trusted workspace access

## Phase 0: Baseline and manual lookup
- Request: allow Compute agents to read/write project roots and children, use RUDI router tools, configured MCPs and supported native connections, and access Clients, RUDI, RUDI Runtime and Personal.
- Baseline: CLI `87d8f90`, local feature worktree. Compute delegates provider permissions to Agent Host.
- Standards: manual index, Master Doctrine (boundaries and Appendix C), Agent Co-Pilot Operating Standard, formal Standards/Spec/Proof review.
- High risk: expands filesystem and integration authority. The user explicitly authorized commit, push, PR merge, pinned-native Admin acceptance and runner rollout after passing checks. Acceptance uses the selected Codex account, Astra and Extra High reasoning.
- Horizontal scan: shared profile validator, both provider argument/environment adapters, native admission, output verification, Compute opaque-profile bridge, preparation docs.
- Host evidence: workstation shares `/Volumes/Clients`, `/Volumes/RUDI`, `/Volumes/RUDI Runtime` map to Admin `/Users/admin/Clients`, `/Users/admin/RUDI`, `/Users/admin/.rudi`. `/Users/hoff/Personal` exists only on workstation; no Admin mount. Do not invent a substitute.

## Phase 1: Scope lock
- Add explicit `access_mode: trusted` to existing registered profiles; omission retains restricted behavior. Trusted profiles require a pinned account and enabled network.
- Trusted profiles allow project and declared supporting roots, without recursive rejection of normal repository symlinks. These are trusted operators, not isolation from hostile code. MCP servers retain their own service authority.
- Keep identity checks, exact model/effort, native version pins, timeout/custody, hash verification and output manifest validation. Deliverables stay separate from broader write access.
- Enable provider-native configured integrations and one dynamically resolved RUDI router entry. Never copy credentials or serialize integration secrets into task arguments/receipts.
- Authorized commit slices: profile and provider behavior/tests with docs and proof; generated distributions separately. Reconcile accepted upstream history without rewriting it. Worker cutover follows pinned-native acceptance.
- Exit: both providers accept explicit trusted profiles, restricted regression tests pass, native smoke exercises project writes/router discovery, missing host paths remain explicit.

## Phase 2: Red tests
- Explicit interpreter: `/Users/hoff/.rudi/runtimes/node-22-23-2/bin/node` (22.23.2).
- Repeated command: `node --test src/__tests__/unit/agent-task-trusted.test.js`.
- Observed red -> green, each with unchanged behavior assertions: new profile rejected as unknown fields; Codex cleared MCPs; Claude rejected enabled network; runtime control references rejected; named integration profile absent; protected Git metadata absent; nested read roots masking trusted write; Claude host runtime absent.
- Review regression: `node --test --test-name-pattern='retain explicit read exceptions' src/__tests__/unit/agent-task-trusted.test.js` failed when existing restricted read exceptions were widened. Gating promotion to trusted made it green. Both omitted and explicit restricted modes are covered.
- Native smoke first failed `.git/HEAD` writes; explicit metadata grants close it, including creation before `.git` exists. Expected outside writes still fail.

## Phase 3: Implementation
- Touch task profile, Codex/Claude adapters/capabilities, integration discovery, task result checks, focused tests and contract docs only as needed.
- No new runtime dependency. Reject invalid access mode, unavailable router or undeclared deliverable writes. Do not silently expand existing profiles.

## Phase 4: Green tests and refactor
- Focused suite: `node --test src/__tests__/unit/agent-task-trusted.test.js src/__tests__/unit/agent-task-profile.test.js src/__tests__/unit/agent-task-claude.test.js src/__tests__/unit/agent-task-run.test.js` passed 24 tests after review corrections.
- Small refactors only while focused tests remained green; no dependencies or lockfile changes. Existing restricted permissions are preserved.

## Phase 5: Full verification
- `PATH=/Users/hoff/.rudi/runtimes/node-22-23-2/bin:$PATH RUDI_CLI_TEST_NODE=/Users/hoff/.rudi/runtimes/node-22-23-2/bin/node pnpm test`: first full run had missing workspace package dependency links (setup failure); after linking existing locked dependencies, 935 passed / 10 skipped / 0 failed. Final rerun after review corrections pending below.
- `pnpm build` with the same explicit PATH passed; existing CJS/import.meta warnings remain. Final generated refresh pending below.
- Focused `swe_debt_scan` using repository `pr-review` profile: zero findings. Initial default-profile orphan warnings were caused by its unrelated daemon-schema entrypoints; correct repository profile resolves them.
- `node scripts/agent-debt-runner.mjs --changed-since origin/main --no-log`: passed. Explicit file scan includes untracked new source/test files omitted by the Git-based runner.
- `node scripts/verify-task-trusted-access.mjs /Users/hoff/.local/bin/codex /Users/hoff/.local/bin/claude`: passed root/child/Git metadata creation and writes, outside-write denial, and native MCP configuration enumeration using a separate CODEX_HOME and shared named profile. No inference or login performed. Reviewer independently reproduced it.
- Live read-only MCP initialization/tools-list: Admin router 473 tools; local router under generated Claude sandbox 501 tools. No external mutating tool calls.
- Native version limitation: local smoke uses 0.162.1 / 2.1.301; production admission still pins Admin 0.160.1 / 2.1.294. No claim of selected-account production acceptance until a new bundle and native acceptance are authorized.
- Independent review: fresh-context subagent using formal rudi-code-review. Found and closed missing Claude host runtime grant and accidental widening of restricted child-read exceptions. Standards pass; Spec pass for source scope; Proof revise until pinned-native selected-account acceptance. No remaining source findings.
- Final verification after isolated locked dependency installation and SQLite rebuild: full `pnpm test` passed **937 / 947 tests, 10 skipped, zero failures**. `pnpm build`, `npm pack --dry-run`, repository debt runner, explicit nine-file debt scan, and `git diff --check` all passed. New native smoke script is registered as a debt-scan entrypoint. Final source/build uses this worktree's own package links; no dependency/lockfile changes.

## Phase 6: Docs, contracts and closure
- Contract updated in `docs/compute-trusted-access.md` and linked from `docs/agent-task-execution.md`. Private identity/path preferences and rollout steps remain outside the public repo in the task's local output record.
- No Compute Python change: its provider profile is opaque; the existing bridge/hash/task revision and deliverable separation contracts are retained.
- Horizontal disposition: standardize the existing shared profile contract; retain provider-specific argument/sandbox adapters. No additional scheduler or execution path introduced.
- Commit slices remain uncommitted: source/tests/docs, then generated distribution. Publication, Admin adoption, new bundle qualification and chosen task revisions remain pending.
- User selected the computer they are using for execution and the personal account preference. The native worker on this workstation still needs qualification; Admin cannot read workstation-only Personal data while it is offline.
- Admin publication/cutover and pinned-native selected-account acceptance remain explicit delivery gates; no active job has changed.
- Source verdict: **ready for authorized publication**. Source implementation and local checks complete; production acceptance is not claimed. Preserve this worktree and its artifacts until accepted Git delivery and deployment checks finish.
- Repo Steward closeout receipt `compute-trusted-access-20261017`, version 2, state `preservation_required`, read back successfully; lease released. Base pinned to `87d8f90`; no cleanup authorized or performed. Remote-tracking main advanced four commits during this task; reconcile that history through the authorized publication workflow before merge.
