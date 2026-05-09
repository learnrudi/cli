# RUDI CLI

Package manager for RUDI - install stacks, manage secrets, run workflows.

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
├── agents/               # Claude, Codex, Gemini CLIs
└── rudi.db               # Shared with Studio
```

## Registry

- Index: `https://raw.githubusercontent.com/learnrudi/registry/main/index.json`
- Binaries: `https://github.com/learnrudi/registry/releases/download/v1.0.0/`
- Local dev fallback: `/Users/hoff/dev/rudi/registry/index.json`

## Development

```bash
cd /Users/hoff/dev/rudi/cli
npm link                  # Add rudi to PATH
rudi search --all         # Test
```

## Run Group Orchestration

When building features that span multiple independent files/modules, you can deploy parallel agents via the sidecar run-group API. See `cli/docs/run-group-orchestration.md` for the full SOP.

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
curl -s "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID/diff" -H "x-rudi-token: $TOKEN"

# Merge
curl -s -X POST "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID/merge" -H "x-rudi-token: $TOKEN"

# Cleanup
curl -s -X POST "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID/cleanup" \
  -H "x-rudi-token: $TOKEN" -H "Content-Type: application/json" -d '{"deleteBranches":true}'
```

### Three-Phase Pattern

1. **Phase 1 (Foundation)**: You do this — shared types, config, .gitignore, commit
2. **Phase 2 (Parallel Build)**: Deploy agents via run-group API — each owns specific files
3. **Phase 3 (Integration)**: Fix imports, type mismatches, wire modules together

### Task Prompt Rules

- Scope boundaries: specify which files/dirs each agent owns
- Type imports: agents import shared types, never redefine them
- Path convention: use `@/` imports for TypeScript projects
- Dependencies: agents must NOT modify package.json (use DEPS.md)
- Commit: every prompt must include "git add -A && git commit"
- Verify: every prompt must include a build/type-check command

### Key Architecture Notes

- CLI sidecar: `cli/src/commands/serve/` (routes) + `cli/src/commands/agent/` (agent lifecycle)
- Lite UI: `lite/src/` (React + Zustand + Tailwind)
- Database: `cli/packages/db/src/schema.js` (SQLite, better-sqlite3)
- Auth header: `x-rudi-token` (NOT Authorization: Bearer)
- Sidecar routes are plain JS (Node), Lite UI is TypeScript (React)
- No shared type definitions between CLI and Lite — API shape is the contract
