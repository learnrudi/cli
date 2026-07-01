# RUDI CLI — Agent Instructions
<!-- CODEX-AGENTS-LOADED:cli -->

Local capability CLI, daemon lifecycle manager, and MCP router for RUDI.
Node.js, plain JavaScript.
Repo: `/Users/hoff/dev/RUDI/apps/cli` — `@learnrudi/cli`

RUDI owns local tools, secrets, stack/tool index, daemon health, artifacts, and
MCP access. Claude, Codex, Gemini, and other agent hosts own normal agent
execution. Existing run-group and spawn-child surfaces are legacy compatibility
unless the task explicitly asks for them.

---

## Commands

Most-used commands (CLI has 25+ total — see `src/index.js` for full inventory):

| Command | Aliases | Purpose |
|---------|---------|---------|
| `rudi search` | | Search registry for stacks, skills, workflows, and packages |
| `rudi install` | `i`, `add` | Install a package |
| `rudi run` | `exec` | Run a stack |
| `rudi list` | `ls` | List installed packages |
| `rudi remove` | `rm`, `uninstall` | Remove a package |
| `rudi secrets` | `secret` | Manage secrets |
| `rudi project` | `projects` | Project management |
| `rudi doctor` | | Health check |
| `rudi init` | `bootstrap`, `setup` | Initialize RUDI |
| `rudi update` | `upgrade` | Update packages |
| `rudi auth` | `authenticate`, `login` | Authenticate with providers |
| `rudi mcp` | | MCP operations |
| `rudi index` | | Rebuild MCP router tool cache |
| `rudi integrate` | | Wire the RUDI router into agent MCP configs |
| `rudi instructions` | | Print/install managed agent instruction blocks |
| `rudi daemon` | | Start, stop, restart, install, or inspect daemon lifecycle |
| `rudi studio` | | Open RUDI Studio |
| `rudi home` | | Show ~/.rudi structure and status |
| `rudi status` | | Show status |

**Shortcuts:** `rudi stacks`, `rudi prompts`, `rudi workflows`, `rudi runtimes`, `rudi binaries` (aliases: `bins`, `tools`), `rudi agents`

Legacy compatibility commands remain callable for existing Lite/session-era
workflows, but they are not the default RUDI product surface:

| Command | Aliases | Purpose |
|---------|---------|---------|
| `rudi serve` | | Legacy HTTP + WebSocket sidecar entrypoint |
| `rudi parallel` | `par` | Legacy terminal-based run groups |
| `rudi run-group` | `run-groups` | Legacy run-group inspection, merge, and cleanup |
| `rudi session` | `sessions` | Legacy imported-session operations |
| `rudi import` | | Legacy session import from AI providers |
| `rudi db` | `database` | Legacy session database operations |

---

## Architecture

```
~/.rudi/                        # RUDI home directory
├── secrets.json                # Secrets file
├── stacks/                     # Installed stacks (MCP servers)
├── skills/                     # Installed skills
├── workflows/                  # Installed workflow definitions
├── runtimes/                   # Installed runtimes
├── binaries/                   # Installed binaries/tools
├── bins/                       # Binary symlinks
├── agents/                     # Agent integration metadata
├── blobs/                      # Binary blobs
├── rudi.db                     # Legacy session/run-group SQLite database
├── .rudi-lite-port             # Legacy daemon port filename
└── .rudi-lite-token            # Legacy daemon auth token filename

cli/
├── src/
│   ├── index.js                # Entry point — all command registrations (parseArgs)
│   ├── commands/               # One file per command
│   │   ├── serve.js            # HTTP + WebSocket daemon entrypoint
│   │   ├── daemon.js           # Lifecycle command and LaunchAgent wrapper
│   │   ├── integrate.js        # Agent MCP router config integration
│   │   ├── instructions.js     # Managed CLAUDE.md/AGENTS.md instruction block
│   │   ├── parallel.js         # Legacy terminal-based run groups
│   │   ├── agent/
│   │   │   └── routes/
│   │   │       └── run-group.js  # Run-group REST API (canonical source)
│   │   └── ...
│   └── ...
├── packages/
│   ├── core/                   # @learnrudi/core — installer, resolver
│   ├── db/                     # @learnrudi/db — SQLite database layer
│   ├── env/                    # @learnrudi/env — paths, platform detection
│   ├── registry-client/        # @learnrudi/registry-client — GitHub registry
│   ├── mcp/                    # @learnrudi/mcp — MCP protocol
│   ├── runner/                 # @learnrudi/runner — stack execution
│   └── secrets/                # @learnrudi/secrets — secret management
└── dist/index.cjs              # Built output (bin: rudi)
```

**Dependency flow:** core commands use `index.js` -> `commands/*.js` ->
`packages/*` -> package/config files under `~/.rudi/`. Legacy DB/session
commands additionally use `~/.rudi/rudi.db`.

Storage is separate from daemon lifecycle. The daemon may call storage
repositories and report storage health, but database repair/import policy is
not daemon ownership.

---

## Registry

- **Index URL:** `https://raw.githubusercontent.com/learnrudi/registry/main/index.json`
- **Binaries:** GitHub Releases from package repos
- **Local dev fallback:** `file://` paths for local stack development

---

## Agent Integration

MCP config and instruction config are separate layers:

- `rudi integrate <agent>` writes one `rudi` MCP server entry that points at
  `~/.rudi/bins/rudi-router`.
- `rudi instructions <agent>` prints the managed instruction block.
- `rudi instructions <agent> --install` writes or updates that block in the
  agent's global or project instruction file.
- `rudi skills sync codex` creates native `~/.codex/skills/<skill>/` wrappers
  for installed RUDI skills so Codex can surface them in its skill/slash UI.
  This is separate from MCP router integration and from the managed AGENTS.md
  instruction block.

Discover installed stacks with `rudi list stacks --json` or inspect
`~/.rudi/cache/tool-index.json`. Rebuild the router cache with
`rudi index --json`. Do not use or document `rudi mcp --list`; it is not a
supported command.

## Legacy Sidecar API (Run Groups)

Canonical source: `src/commands/agent/routes/run-group.js`

These routes are compatibility debt for the older RUDI-as-agent-runner
direction. Do not build new daemon-owned agent execution features unless the
task explicitly says to work on legacy run-group compatibility.

**Auth:** All requests require `x-rudi-token` header.
**Base URL:** `http://localhost:<port>` (port from `~/.rudi/.rudi-lite-port`)

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/agent/run-group` | Create and launch a run group |
| GET | `/agent/run-groups` | List all run groups (filters: projectPath, status, limit, offset) |
| GET | `/agent/run-group/:id` | Get group detail + sessions |
| GET | `/agent/run-group/:id/live` | Live session activity (real-time status, turn counts, costs) |
| GET | `/agent/run-group/:id/diffs` | Per-session diff stats (files, insertions, deletions) |
| POST | `/agent/run-group/:id/stop` | Stop all active sessions in a group |
| POST | `/agent/run-group/:id/merge` | Sequential merge of selected sessions (worktree mode) |
| POST | `/agent/run-group/:id/cleanup` | Remove worktrees + optionally delete branches |

**Note:** The diffs endpoint is `/diffs` (plural). Some older docs incorrectly reference `/diff` (singular).

### Three-Phase Pattern

```
Phase 1: Create group
  POST /agent/run-group
  Body: {
    cwd,                          // working directory (NOT projectPath)
    tasks: [{ prompt, ... }],
    executionMode: "worktree"|"shared_cwd",  // (NOT isolation)
    useWorktree: true|false,      // fallback if executionMode not set
    name?,                        // optional group name
    provider?,                    // defaults to "claude"
    model?,
    baseBranch?,
    permissionMode?,
    systemPrompt?,
    coordinationMode?,
    sequentialPhases?
  }
  Returns: { groupId, status, sessionIds, startedSessionIds, errors }

Phase 2: Monitor
  GET /agent/run-group/:id/live    # Poll for status updates
  GET /agent/run-group/:id/diffs   # Check diff stats

Phase 3: Merge + Cleanup
  POST /agent/run-group/:id/merge    # Body: { sessionIds: [...], targetBranch? }
  POST /agent/run-group/:id/cleanup  # Body: { deleteBranches?: boolean }
```

### `rudi parallel` Usage

```bash
rudi parallel "task one" "task two" [--name "Batch"] [--provider claude] [--model sonnet]
```

- Requires 2-10 tasks
- Requires `rudi serve` running
- Creates run-group, polls every 2s, renders live progress
- Exits on terminal status (completed/partial/failed/stopped)
- Legacy compatibility command; prefer native Claude/Codex/Gemini agent
  orchestration unless this surface is explicitly in scope.

---

## Key Notes

- **Legacy DB path:** `~/.rudi/rudi.db` (SQLite via better-sqlite3, used by legacy session/run-group surfaces)
- **Daemon routes:** Legacy routes are still defined in `src/commands/serve.js` and `src/commands/agent/routes/` while migration proceeds.
- **MCP router:** `src/router-mcp.js` exposes installed stack tools over MCP and must remain independent of Lite being open.
- **Legacy Lite paths:** Lite consumes the daemon API via `httpBridge.ts` — see `/Users/hoff/dev/RUDI/apps/lite/AGENTS.md`
- **Type contracts:** CLI returns JSON; Lite types in `src/types/agent.ts` must match CLI response shapes
- **Sessions table columns:** `total_input_tokens` + `total_output_tokens` (NOT `total_tokens`)
- **Run-group canonical source:** Always reference `src/commands/agent/routes/run-group.js` — docs may be stale
