# RUDI CLI

Local capability CLI, daemon lifecycle manager, and MCP router for RUDI.

RUDI owns local tools, secrets, stack/tool index, daemon health, artifacts, and
MCP access. Claude, Codex, Gemini, and other agent hosts own normal agent
execution. Existing run-group and spawn-child surfaces are legacy compatibility
unless the task explicitly asks for them.

## Commands

```bash
rudi search <query>     # Search registry
rudi search --all       # List all available packages
rudi install <pkg>      # Install a stack/runtime/tool
rudi remove <pkg>       # Uninstall a package
rudi list [kind]        # List installed (stacks, runtimes, tools, agents)
rudi run <stack>        # Run a stack
rudi secrets            # Manage secrets
rudi update [pkg]       # Update packages
rudi import sessions    # Import sessions from Claude, Codex, Gemini
rudi doctor             # Check system health
rudi daemon status      # Inspect local daemon lifecycle and readiness
rudi integrate codex    # Wire the RUDI router into agent MCP config
rudi instructions codex # Print or install the managed instruction block
rudi index --json       # Rebuild and inspect the router tool cache
```

## Architecture

```
src/index.js → commands/*.js
      ↓
@learnrudi/env         # PATHS, platform detection
@learnrudi/core        # db, installer, resolver
@learnrudi/registry-client  # fetch from GitHub
      ↓
~/.rudi/
├── stacks/               # Installed MCP stacks
├── runtimes/             # Node, Python, Deno
├── binaries/             # ffmpeg, ripgrep, etc.
├── agents/               # Agent integration metadata
└── rudi.db               # Shared with Studio
```

Storage is separate from daemon lifecycle. The daemon may call storage
repositories and report storage health, but database repair/import policy is
not daemon ownership.

## Registry

- Index: `https://raw.githubusercontent.com/learnrudi/registry/main/index.json`
- Binaries: `https://github.com/learnrudi/registry/releases/download/v1.0.0/`
- Local dev fallback: `/Users/hoff/dev/RUDI/apps/registry/index.json`

## Development

```bash
cd /Users/hoff/dev/RUDI/apps/cli
npm link                  # Add rudi to PATH
rudi search --all         # Test
```

## Agent Integration

MCP config and instruction config are separate layers:

```bash
rudi integrate <agent>              # Configure the RUDI MCP router
rudi instructions <agent>           # Print the instruction block
rudi instructions <agent> --install # Write/update the managed block
```

Discover installed stacks with `rudi list stacks --json` or inspect
`~/.rudi/cache/tool-index.json`. Rebuild the router cache with
`rudi index --json`. Do not use or document `rudi mcp --list`; it is not a
supported command.

## Legacy Run Group Compatibility

Run-group APIs are compatibility debt for the older RUDI-as-agent-runner
direction. Do not build new daemon-owned agent execution features unless the
task explicitly says to work on legacy run-group compatibility. See
`apps/cli/docs/run-group-orchestration.md` for the old SOP when needed.

### Quick Reference

```bash
PORT=$(cat /Users/hoff/.rudi/.rudi-lite-port)
TOKEN=$(cat /Users/hoff/.rudi/.rudi-lite-token)

# Create a run group
curl -s -X POST "http://127.0.0.1:$PORT/agent/run-group" \
  -H "x-rudi-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"group-name","cwd":"/path/to/project","tasks":[{"prompt":"...","label":"task-1"},{"prompt":"...","label":"task-2"}]}'

# Poll status
curl -s "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID" -H "x-rudi-token: $TOKEN"

# View diffs
curl -s "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID/diffs" -H "x-rudi-token: $TOKEN"

# Merge
curl -s -X POST "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID/merge" -H "x-rudi-token: $TOKEN"

# Cleanup
curl -s -X POST "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID/cleanup" \
  -H "x-rudi-token: $TOKEN" -H "Content-Type: application/json" -d '{"deleteBranches":true}'
```

### Three-Phase Pattern

1. **Phase 1 (Foundation)**: You do this — shared types, config, .gitignore, commit
2. **Phase 2 (Parallel Build)**: Use native agent subagents by default; use the run-group API only when legacy compatibility is explicitly in scope
3. **Phase 3 (Integration)**: Fix imports, type mismatches, wire modules together

### Task Prompt Rules

- Scope boundaries: specify which files/dirs each agent owns
- Type imports: agents import shared types, never redefine them
- Path convention: use `@/` imports for TypeScript projects
- Dependencies: agents must NOT modify package.json (use DEPS.md)
- Commit: every prompt must include "git add -A && git commit"
- Verify: every prompt must include a build/type-check command

### Key Architecture Notes

- CLI daemon: `apps/cli/src/commands/serve/` (legacy route entrypoint), `apps/cli/src/commands/daemon.js` (lifecycle), and `apps/cli/src/router-mcp.js` (MCP router)
- Lite UI: `apps/lite/src/` (legacy/control-panel candidate, not the target product UI)
- Database: `apps/cli/packages/db/src/schema.js` (SQLite, better-sqlite3)
- Auth header: `x-rudi-token` (NOT Authorization: Bearer)
- Sidecar routes are plain JS (Node), Lite UI is TypeScript (React)
- No shared type definitions between CLI and Lite — API shape is the contract
