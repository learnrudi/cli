# Live native task bridge proof — 2026-10-15

## Scope and authority

User authorized a real native Codex run in an isolated fixture, preserving all three live NFL schedules and reserving deployment/cutover. Evidence root: `/Users/admin/.rudi/outputs/rudi-compute-native-bridge/2026-10-15/native-ju83i8_w`.

High risk: native execution capability boundary. The prior bridge implementation and its preservation receipts remain active. No new queue or permission model; no active installation, deployment, schedule edit, publication or primary-Mac synchronization.

## Diagnosis and correction contract

Fixture revisions 1/2 failed before session startup because the native sandbox could not traverse the vendor executable's symlink chain. Isolated native `--version` probes identified required read roots: `~/.local/bin` and `~/.codex/packages/standalone`. These are fixture profile settings, with no grant to the full Codex home or credentials and no write-root expansion.

Revision 3 started real native session `01a1407c-364d-74d1-9373-59b94178032f` and performed inference, but both command-tool calls returned `code-mode host is disabled`. The task adapter inherited this disabled feature from the tool-free private-automation profile. Task execution intentionally permits command tools and therefore requires their native transport.

Confirmed path: `taskCodexArgs` -> existing provider plan -> stream supervisor -> installed Codex 0.160.1 -> native Code Mode transport -> command tools under the existing native permission profile. Private-automation's separate disabled-feature list remains unchanged. Scope: task-codex.js, focused plan test, task execution contract, this record, rebuilt dist/index.cjs. No Compute behavior changes. Horizontal disposition: retain distinct tool-free private and command-capable task profiles; reuse native transport rather than add a tool runner.

## Red-green and proof gates

1. Extend the real task-plan test to require explicitly enabled `code_mode_host` while apps/browser/plugins/subagents stay disabled. Confirm red, correct only task feature selection, rerun unchanged green.
2. Build CLI, admit a new immutable job/request with the new runner hash, and execute via actual Compute CLI -> built RUDI CLI -> unmodified native binary. Preserve all failed attempts.
3. Verify unseen input values, file output, denied sentinel writes, native session/terminal/receipt bindings, idempotent admission, empty worker queue and unchanged input/NFL hashes.
4. Run CLI full suite/build/package/debt and focused SWE scan; fresh-context read-only review. Update docs and read-back preservation closeout.

Planned unpublished slices: narrow behavior/test fix; documentation; generated bundle. No commit/push authorized. Source synchronization deferred pending accepted/published Git history and peer conflict inspection.

## Closure

Live proof passed with native Codex 0.160.1, model `gpt-5.6-sol`, session `01a1407e-ee0d-7331-9a5e-5a68867aaca8`, job `job_664359e5b38945968821a679f861bab6`, in 31.52 seconds. Native transcript records both sandbox denials; output values and all request/launch/completion/output/event hashes were independently checked. Same-key replay returns the succeeded job; a subsequent run-once finds no queued work. Three failed attempts remain preserved. Zero fixture schedule rows; all three ACTIVE NFL files match their exact starting hashes.

Red command: `node --test src/__tests__/unit/agent-task-profile.test.js` failed once for disabled command transport (exit 1). The unchanged test command passed after the two-line adapter correction. No refactor. Final `pnpm test`: 887 passed; build, package dry run, changed-source debt and explicit two-file SWE scan passed with zero findings. No Compute source change; prior 118-test evidence remains bound to unchanged files. Fresh-context review: `/root/native_bridge_review`; final verdict and closeout receipt are in the evidence report. Both command transport and native runtime read roots must be qualified for later deployment; the empty-stdin preflight alone is not that proof.

Final report: `/Users/admin/.rudi/outputs/rudi-compute-native-bridge/2026-10-15/native-ju83i8_w/REPORT.md`. Preserve all uncommitted source, generated bundle, preimages and failed/successful receipts. No acceptance of launchd, recurring scheduling, NFL domain behavior, notifications, deployment or cutover is implied. Source publication and primary-Mac synchronization remain deferred.
