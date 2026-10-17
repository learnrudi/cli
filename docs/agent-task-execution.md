# Registered shared-workspace task execution v1

Unpublished source capability. The supported host is **macOS with native Codex
0.160.1**. Other versions/providers fail closed pending qualification. This is
not deployment, launchd acceptance, or proof of NFL research.

Compute owns jobs, leases and manual admission. Agent Host owns native arguments,
authentication checks, session pointers, permission enforcement and launch
artifacts. The provider owns inference and native transcripts. The bridge uses
foreground execution; no daemon, desktop, detached acknowledgement, copied
project or replacement queue is required.

## Execution profile

A Compute task revision pins this UTF-8 JSON file by path and SHA-256. Only these
keys are accepted; directories must exist and be canonical, without symlink or
glob spellings. Replace the illustrative paths with isolated fixture paths.

```json
{
  "schema_version": 1,
  "provider": "codex",
  "model": "gpt-5.6-sol",
  "workspace_mode": "registered-shared",
  "working_directory": "/absolute/shared/project",
  "read_roots": ["/absolute/shared/project"],
  "write_roots": ["/absolute/shared/project/reports"],
  "network": "disabled",
  "timeout_ms": 300000
}
```

Model IDs must be exact configured IDs, not aliases. The only session mode is
fresh. Read roots explicitly include the working directory. Write roots exactly
match the task's deliverable roots; they cannot grant the entire working
directory or overlap Agent Host runtime. Include any approved external domain
state folder in deliverables rather than granting a parent home directory.
The task request, instruction file and profile cannot be writable outputs.

The permission plan grants minimal native runtime reads plus declared roots.
It does not automatically make the working directory writable. Add interpreter
or tool installation directories as explicit read roots when required (for
example, the resolved Python installation used by a project). Network is an
explicit enabled/disabled policy for native commands; enabled means unrestricted
command network access, not a domain allowlist. MCP, apps, plugins, browser,
subagents and native web search are disabled in this bounded slice. Research
integration/tool qualification remains a later step.

The qualified native release requires `code_mode_host` for command-tool
execution, so task plans enable that transport explicitly. Command permissions
still come from the registered filesystem/network profile; private automation
retains its separate tool-free policy. Native helper startup also needs read
access through the vendor executable's entire symlink chain. On the verified
standalone installation, explicit read roots include `/Users/admin/.local/bin`
and `/Users/admin/.codex/packages/standalone`; the resolved version's `bin`
directory alone is insufficient when the launcher traverses `current`. Resolve
the actual installation on each host instead of granting its whole home.

Native user config and rules are ignored. Ancestor project configs and system
Codex config are rejected pending explicit qualification; the adapter performs
an empty-stdin native configuration probe before launching. The child inherits
only operational environment fields, not API-key environment variables, and
uses native authentication. No provider/model fallback or permission override
is accepted. The empty-stdin probe does not start a session: live qualification
must also prove helper read access and command-tool availability. Capability
validation does not prove successful inference or subscription availability.

Permission profiles use Codex's native sandbox. See the official
[permission profile semantics](https://learn.chatgpt.com/docs/permissions).
This implementation deliberately qualifies one release and proves the generated
policy with `scripts/verify-task-permissions.mjs`; it does not infer support from
a version number alone.

Writable trees are checked at validation and immediately before spawn. Existing
symlinks, special files and multiply-linked files are rejected; the scan is
bounded at 100,000 entries. This prevents a pre-existing hardlink from exposing a
read-only inode through a writable name. Native tests also prove that creation
of a new hardlink from a read-only source is denied. These controls assume
trusted same-user operators; they are not isolation from malicious concurrent
processes running under the same OS identity.

## Request, admission and supervision

`rudi agent task-check <request-path> <sha256>` validates the closed request and
profile. It returns a versioned `agent-task-check` response bound to that exact
reference. `rudi agent task-run <request-path> <sha256>` additionally requires
Compute's job ID, spec hash and first-attempt environment bindings. It accepts
no permission/passthrough flags or alternate session. References are bounded
regular files, read without following links or blocking on FIFOs; duplicate JSON
keys and non-finite numbers are rejected.

The request contains `schema_version`, `task` (id/revision/definition_sha256),
`instructions`, `execution_profile`, `working_directory`, `outputs`, and
`timeout_seconds`. The profile's native timeout must leave 20 seconds inside
Compute's timeout. Compute additionally retains its 10-second shutdown grace.
The provider runs in a separate process group with TERM/KILL escalation. Startup
receipt failure, output overflow, timeout and signals enter supervised cleanup.
Resume, promote and discard reject registered shared launches: the shared
workspace belongs to its operator.

## Completion and evidence

A zero provider exit is insufficient. Agent Host requires a native session
pointer, `turn.completed`, no native terminal failure, and a final JSON object:

```json
{"outcome":"complete","outputs":["/absolute/shared/project/reports/report.txt"]}
```

Outcomes are `complete`, `no_work`, `partial`, `needs_evidence`, or `failed`.
Complete requires at least one file; no_work requires none. Partial and
needs_evidence preserve a valid checkpoint and are not claims of completed
research. Failed exits nonzero. Outputs are at most 64 canonical regular files
under declared write roots, at most 32 MiB each, without symlinks/hardlinks. The
host hashes actual bytes and detects file changes during verification. It does
not certify domain truth or NFL eligibility.

Each attempt creates an exclusive `<runtime>/<job-id>-attempt-1/` directory.
`launch.json` records the request/task/job/profile/model/workspace bindings;
`completion.json` binds that receipt, native session pointer, application outcome,
and verified output hashes. Existing directories or receipts are never replaced.
Agent Host's launch projection is in `<runtime>/agent-hosts.db`; its CHECK
migration preserves old launches and parent/native pointers. Native transcripts
remain provider-owned. Normalized host events stay in the host subdirectory;
Compute receives receipt metadata, not duplicated provider output.

Compute verifies the completion envelope and its launch-receipt hash/bindings
before recording success, then stores the completion receipt path/hash/outcome
in the existing succeeded event. Missing/mismatched receipts cause
`task_receipt_invalid`; an exhausted single attempt is `dead`. Abrupt loss of
the bridge or storage can leave incomplete evidence and must be reconciled,
never silently replayed in the same directory. A hard-killed supervisor cannot
promise full descendant cleanup. The task watchdog now records process identity,
waits for readiness before prompt delivery, and cleans only a verified native
process group on supervisor loss. Crash recovery retains a durable quarantine;
subsequent execution fails closed. `rudi agent task-recover REQUEST SHA256` is the
bounded provider-neutral reconciliation interface used by Compute before lease
recovery. There is no automatic quarantine-clear operation.

The standalone `dist/task-custody-worker.cjs` is part of the package contract.
Normal close verifies only the original process group: a detached descendant
can survive. This is a confirmed unattended-release blocker, not a cleanup
guarantee. See Compute's `docs/bridge-release-prerequisites.md` for packaging,
isolated launchd acceptance and rollback gates. No production eligibility is
claimed by the fixture candidate `1.11.0-rc.1`.
The guarded package runner supplies `RUDI_AGENT_TASK_CODEX_PATH` and
`RUDI_AGENT_TASK_CODEX_SHA256`. Task validation checks that canonical executable
and its bytes, and task execution selects it instead of the ambient provider
search path. These pins are launcher inputs, not credentials or profile fields.

## Repeatable isolated proof

From the CLI checkout:

```bash
node --test src/__tests__/unit/agent-task-profile.test.js src/__tests__/unit/agent-task-launch.test.js src/__tests__/unit/agent-task-run.test.js
node scripts/verify-task-permissions.mjs /absolute/native/codex /absolute/artifact-root
```

The native sandbox probe uses a disposable home and no inference. The Compute
script `scripts/verify_agent_task_bridge.py` calls the real queue, worker,
executor and Agent Host source with a deterministic provider fixture. It proves
success and missing-terminal failure, not live provider authentication, NFL
receipts, schedules, notification delivery or unattended deployment.
