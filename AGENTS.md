# RUDI CLI — Agent Instructions
<!-- CODEX-AGENTS-LOADED:cli -->

Package manager and sidecar server for RUDI. Node.js, plain JavaScript.
Repo: `/Users/hoff/dev/RUDI/cli` — `@learnrudi/cli`

---

## Commands

Most-used commands (CLI has 25+ total — see `src/index.js` for full inventory):

| Command | Aliases | Purpose |
|---------|---------|---------|
| `rudi search` | | Search registry for stacks/prompts |
| `rudi install` | `i`, `add` | Install a package |
| `rudi run` | `exec` | Run a stack |
| `rudi list` | `ls` | List installed packages |
| `rudi remove` | `rm`, `uninstall` | Remove a package |
| `rudi secrets` | `secret` | Manage secrets |
| `rudi serve` | | Start HTTP + WebSocket sidecar server |
| `rudi parallel` | `par` | Launch parallel run groups from terminal |
| `rudi session` | `sessions` | Session operations |
| `rudi import` | | Import sessions from AI providers |
| `rudi db` | `database` | Database operations |
| `rudi project` | `projects` | Project management |
| `rudi doctor` | | Health check |
| `rudi init` | `bootstrap`, `setup` | Initialize RUDI |
| `rudi update` | `upgrade` | Update packages |
| `rudi auth` | `authenticate`, `login` | Authenticate with providers |
| `rudi mcp` | | MCP operations |
| `rudi studio` | | Open RUDI Studio |
| `rudi home` | | Show ~/.rudi structure and status |
| `rudi status` | | Show status |

**Shortcuts:** `rudi stacks`, `rudi prompts`, `rudi runtimes`, `rudi binaries` (aliases: `bins`, `tools`), `rudi agents`

---

## Architecture

```
~/.rudi/                        # RUDI home directory
├── rudi.db                     # SQLite database (better-sqlite3, single DB for all data)
├── secrets.json                # Secrets file
├── stacks/                     # Installed stacks (MCP servers)
├── runtimes/                   # Installed runtimes
├── binaries/                   # Installed binaries/tools
├── bins/                       # Binary symlinks
├── agents/                     # Agent configurations
├── blobs/                      # Binary blobs
├── .rudi-lite-port             # Sidecar port (written by `rudi serve`)
└── .rudi-lite-token            # Sidecar auth token

cli/
├── src/
│   ├── index.js                # Entry point — all command registrations (parseArgs)
│   ├── commands/               # One file per command
│   │   ├── serve.js            # HTTP + WebSocket sidecar server
│   │   ├── parallel.js         # Terminal-based parallel run groups
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

**Dependency flow:** `index.js` → `commands/*.js` → `packages/*` → `~/.rudi/rudi.db`

---

## Registry

- **Index URL:** `https://raw.githubusercontent.com/learnrudi/registry/main/index.json`
- **Binaries:** GitHub Releases from package repos
- **Local dev fallback:** `file://` paths for local stack development

---

## Sidecar API (Run Groups)

Canonical source: `src/commands/agent/routes/run-group.js`

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

---

## Key Notes

- **DB path:** `~/.rudi/rudi.db` (SQLite via better-sqlite3)
- **Sidecar routes:** All routes defined in `src/commands/serve.js` and `src/commands/agent/routes/`
- **Lite UI paths:** Lite consumes sidecar API via `httpBridge.ts` — see `/Users/hoff/dev/RUDI/lite/AGENTS.md`
- **Type contracts:** CLI returns JSON; Lite types in `src/types/agent.ts` must match CLI response shapes
- **Sessions table columns:** `total_input_tokens` + `total_output_tokens` (NOT `total_tokens`)
- **Run-group canonical source:** Always reference `src/commands/agent/routes/run-group.js` — docs may be stale
