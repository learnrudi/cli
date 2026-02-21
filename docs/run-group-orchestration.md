# Run Group Orchestration

## How to Deploy Parallel Agents

The sidecar exposes a run-group API. You (Claude CLI) can call it via curl to spawn parallel agents on isolated worktrees.

### Connection

```bash
PORT=$(cat /Users/hoff/.rudi/.rudi-lite-port)
TOKEN=$(cat /Users/hoff/.rudi/.rudi-lite-token)
# Auth header: x-rudi-token: $TOKEN
```

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/agent/run-group` | Create group, spawn agents |
| GET | `/agent/run-group/:id` | Status, cost, tokens, per-session detail |
| GET | `/agent/run-group/:id/diff` | Git diff per session branch |
| POST | `/agent/run-group/:id/merge` | Merge branches into base |
| POST | `/agent/run-group/:id/cleanup` | Remove worktrees, optionally delete branches |

### Create Request Shape

```json
{
  "name": "group-name",
  "cwd": "/absolute/path/to/project",
  "tasks": [
    {"prompt": "...", "label": "short-name"},
    {"prompt": "...", "label": "short-name"}
  ]
}
```

Min 2 tasks, max 10. Each gets its own worktree branch.

---

## Three-Phase Pattern

### Phase 1: Foundation (You Do This)

Before spawning agents, prepare the repo so they have a clean base:

1. Ensure `.gitignore` exists with: `node_modules/`, `.next/`, `dist/`, `build/`, `*.db`, `.env`, `.rudi/`
2. Define shared types/interfaces that agents will import (not reinvent)
3. Configure path aliases (tsconfig paths, import maps)
4. Install base dependencies
5. Commit everything — agents branch from this commit

### Phase 2: Parallel Build (Run Group)

Spawn agents via the API. Each task prompt MUST include:

- What files/directories the agent owns
- What files it must NOT modify (especially package.json, tsconfig, shared types)
- What types to import and from where
- A verification command (`npm run build`, `tsc --noEmit`, etc.)
- "Commit your changes before finishing"

### Phase 3: Integration

After merge, either fix issues yourself or spawn an integration agent:

- Run the build, read the errors
- Fix import mismatches, type incompatibilities, placeholder→real wiring
- Verify build passes

---

## Task Prompt Rules

These prevent the merge/integration problems we discovered:

1. **Scope boundaries**: "Only create/modify files in `src/lib/`. Do NOT touch `package.json`, `tsconfig.json`, or files outside your scope."
2. **Type imports**: "Import types from `src/types/` — do NOT create your own definitions for [X, Y, Z]."
3. **Path convention**: "Use `@/` prefix for all imports (e.g., `@/types`, `@/lib/db`)."
4. **Dependencies**: "Do NOT modify package.json. List needed packages in a `DEPS.md` file."
5. **Commit**: "When finished, run `git add -A && git commit -m 'description'`."
6. **Verify**: "Run `[build command]` and fix any errors before committing."

---

## Polling Pattern

After creating a group, poll until done:

```bash
# Create
GROUP_ID=$(curl -s -X POST "http://127.0.0.1:$PORT/agent/run-group" \
  -H "x-rudi-token: $TOKEN" -H "Content-Type: application/json" \
  -d "$PAYLOAD" | python3 -c "import json,sys; print(json.load(sys.stdin)['groupId'])")

# Poll
while true; do
  STATUS=$(curl -s "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID" \
    -H "x-rudi-token: $TOKEN" | python3 -c "import json,sys; print(json.load(sys.stdin)['group']['status'])")
  echo "Status: $STATUS"
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "partial" ] && break
  sleep 10
done
```

---

## Applying to Existing Codebases

When working on an existing project (not greenfield), Phase 1 is different:

1. **Read the existing code** — understand the architecture, patterns, conventions
2. **Identify independent work units** — features, modules, or fixes that don't overlap
3. **Note the conventions** — import style, file naming, test patterns, state management
4. **Write task prompts that reference existing code**: "The project uses [pattern X] — follow the same pattern. See `src/foo/bar.ts` for an example."
5. **Be specific about existing files**: "The API routes are in `src/app/api/`. Add new routes following the same pattern as `src/app/api/bookmarks/route.ts`."

---

## Lessons Learned

| Problem | Cause | Prevention |
|---------|-------|------------|
| node_modules merge conflicts | No .gitignore, agents committed deps | Always create .gitignore in Phase 1 |
| Type mismatches after merge | Each agent invented its own types | Define shared types in Phase 1, agents import only |
| Import path inconsistency | Some used @/, some used relative | Configure path aliases in Phase 1, specify in prompts |
| package.json conflicts | Multiple agents added dependencies | One owner for package.json, others use DEPS.md |
| Agent work not on branch | --print mode doesn't commit | Prompt must include "git add && git commit" |
| Integration takes longer than build | Independent code doesn't wire itself | Budget Phase 3, integration is the real work |
