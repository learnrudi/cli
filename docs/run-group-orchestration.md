# Parallel Agent Orchestration

Two ways to deploy parallel agents. Choose based on risk and isolation needs.

| | **Task Tool (Subagents)** | **Run-Group API (Worktrees)** |
|---|---|---|
| How | Built-in `Task` tool in Claude Code | `curl` to sidecar run-group API |
| Git isolation | None — all edit same working tree | Each agent gets its own worktree branch |
| Merge step | No merge needed | Must merge branches after |
| Conflict risk | High if agents touch same files | Zero — isolated branches |
| Session review | Output returned inline to orchestrator | `curl /sessions/:id/messages` |
| Rollback | `git checkout -- .` (nuclear) | Delete the branch |
| Speed | Fast — sub-conversations | Slower — full process spawn per agent |
| Best for | Different files, low risk, same repo | Risky changes, cross-cutting edits, rollback needed |

---

## Option A: Task Tool (Subagents)

This is what Claude Code uses natively. Launch parallel subagents via the `Task` tool — each runs as a sub-conversation sharing the same filesystem.

### When to use

- Agents edit **different files** (no overlap)
- Changes are **low risk** (build errors are easy to fix)
- You want **speed** (no process spawn overhead)
- Working in a **single repo** (or separate repos with separate Task calls)

### Pattern

```
Phase 1: Foundation (you, inline)
  - Read codebase, understand patterns
  - Do small tasks directly (< 200 lines)
  - Identify independent work units

Phase 2: Parallel Build (Task tool)
  - Launch multiple Task() calls in a single message
  - Each agent gets a detailed prompt with file scope + done criteria
  - Agents run concurrently, return results

Phase 3: Integration (you, inline)
  - Run the build, fix any issues
  - Verify all agents' output works together
  - Commit
```

### Example: 4-Feature Build

```python
# Launch 5 agents in one message — they run in parallel
Task(subagent_type="general-purpose", prompt="Feature 2: Create useSessionReplay.ts hook...")
Task(subagent_type="general-purpose", prompt="Feature 3 CLI: Add /live endpoint...")
Task(subagent_type="general-purpose", prompt="Feature 3 Lite: Create LiveSessionCard...")
Task(subagent_type="general-purpose", prompt="Feature 4 CLI: Add worktree status endpoint...")
Task(subagent_type="general-purpose", prompt="Feature 4 Lite: Create WorkspacePanel...")
```

### Task Tool Prompt Rules

All the prompt rules below (Rules 1-9) apply to Task tool prompts too, with these adjustments:

- **Skip Rule 5** (commit) — subagents can't commit, you do that after
- **Add build verification** — include `tsc --noEmit` or `pnpm build` in the prompt so the agent self-corrects
- **Scope is critical** — since there's no git isolation, two agents editing the same file will clobber each other. Be explicit: "You own `src/components/Foo/`. Do NOT touch any other directory."

### Task Tool Limitations

- **No rollback per agent** — if agent B breaks something agent A wrote, you can't undo just B
- **No session history** — subagent output is returned inline, not stored as a reviewable session
- **Shared filesystem** — agents can accidentally overwrite each other's work if scoping is sloppy
- **No live monitoring** — you see results when the agent finishes, not while it's working

### When to upgrade to Run-Group API

Switch to Option B when:
- Two agents need to edit the **same file** (even different sections — risky without git isolation)
- You want to **review each agent's session** before merging (tool calls, errors, decisions)
- The work is **risky** and you want per-agent rollback
- You need **live monitoring** in the RUDI Lite dashboard

---

## Option B: Run-Group API (Worktrees)

The sidecar spawns separate Claude CLI processes, each on an isolated git worktree branch. Full process isolation, git isolation, reviewable sessions.

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
| GET | `/agent/run-group/:id/live` | Lightweight live data (alive, turnCount, lastSnippet) |
| GET | `/agent/run-group/:id/diff` | Git diff per session branch |
| POST | `/agent/run-group/:id/merge` | Merge branches into base |
| POST | `/agent/run-group/:id/cleanup` | Remove worktrees, optionally delete branches |
| GET | `/sessions/:sessionId/messages` | Full message history for any session |

The `/live` endpoint returns per-session `alive`, `turnCount`, `costTotal`, `lastSnippet`, and `lastError`. The sidecar also broadcasts `run-group:session-activity` over WebSocket on each turn completion.

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

### Three-Phase Pattern

#### Phase 1: Foundation (You Do This)

Before spawning agents, prepare the repo so they have a clean base:

1. Ensure `.gitignore` exists with: `node_modules/`, `.next/`, `dist/`, `build/`, `*.db`, `.env`, `.rudi/`
2. Define shared types/interfaces that agents will import (not reinvent)
3. Configure path aliases (tsconfig paths, import maps)
4. Install base dependencies
5. Commit everything — agents branch from this commit

#### Phase 2: Parallel Build (Run Group)

Spawn agents via the API. Each task prompt MUST include:

- What files/directories the agent owns
- What files it must NOT modify (especially package.json, tsconfig, shared types)
- What types to import and from where
- **Exact store/API method signatures** agents will need (don't let them guess — see Rule 7 below)
- **Wire every action** to a real store method or API call — no `console.log` stubs
- A verification command (`npm run build`, `tsc --noEmit`, etc.)
- "Commit your changes before finishing"

The create response returns `sessionIds` for each spawned agent. **Save these** — you'll use them in Phase 3 to review what each agent did.

#### Phase 3: Integration

After agents complete but **before merging**, review what each agent did:

```bash
# Review agent session — see every tool call, file edit, and decision
curl -s "http://127.0.0.1:$PORT/sessions/$SESSION_ID/messages" \
  -H "x-rudi-token: $TOKEN" | python3 -c "
import json,sys
data = json.load(sys.stdin)
for m in data['messages']:
  role = m['role']
  tc = m.get('toolCalls', [])
  if tc:
    tools = ', '.join(t['name'] for t in tc)
    errors = [t for t in tc if t.get('status') == 'error']
    print(f'  [{role}] tools: {tools}' + (f' ERRORS: {len(errors)}' if errors else ''))
  elif role == 'assistant':
    snippet = m['content'][:120].replace(chr(10), ' ')
    print(f'  [{role}] {snippet}...')
"

# Check diffs per agent branch
curl -s "http://127.0.0.1:$PORT/agent/run-group/$GROUP_ID/diff" \
  -H "x-rudi-token: $TOKEN"
```

**What to look for in session review:**
- Tool call errors (agent hit a wall and may have left incomplete work)
- `console.log` stubs instead of real wiring
- Wrong store method names (agent guessed instead of using what you specified)
- Files modified outside the agent's scope

Then merge and fix remaining issues:

- Run the build, read the errors
- Fix import mismatches, type incompatibilities, unwired actions
- Verify build passes

### Polling Pattern

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

## Task Prompt Rules (Both Options)

These prevent merge/integration problems. Apply to both Task tool and run-group prompts.

1. **Scope boundaries**: "Only create/modify files in `src/lib/`. Do NOT touch `package.json`, `tsconfig.json`, or files outside your scope."
2. **Type imports**: "Import types from `src/types/` — do NOT create your own definitions for [X, Y, Z]."
3. **Path convention**: "Use `@/` prefix for all imports (e.g., `@/types`, `@/lib/db`)."
4. **Dependencies**: "Do NOT modify package.json. List needed packages in a `DEPS.md` file."
5. **Commit**: "When finished, run `git add -A && git commit -m 'description'`." *(Run-group only — Task tool agents can't commit)*
6. **Verify**: "Run `[build command]` and fix any errors before committing."
7. **Exact API references**: Give agents the exact method signatures they'll need. Don't let them guess.
   - Bad: "Open the session when the user clicks Open"
   - Good: "Call `useSessionsStore.getState().loadSessionMessages(sessionId)` to open a session — see `Chat.tsx` line 45 for reference."
8. **Wire every action**: Every button/handler in the prompt must specify what store method or API call it triggers. No `console.log` placeholders — if the wiring isn't known yet, say "flag as TODO with a comment `// TODO: wire to X`" so Phase 3 can find them.
9. **Shared file sections**: If two agents modify the same file, specify which object/section each owns. Example: "Add your method to the `git` object in `httpBridge.ts` — do NOT modify the `agent` object."

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

---

## Session Log: 4-Feature Build (Feb 2026)

**Method used: Task Tool (Option A)** — 5 subagents, not run-group API.

Deployed 5 agents for 4 features (CLI + Lite). Zero merge conflicts, zero type errors, clean build on first try.

### What Worked Well

1. **Split CLI and Lite agents per feature.** Features 3 and 4 each had a CLI agent and a Lite agent running in parallel. Because they touch completely different codebases (Node.js vs React/TS), there was zero overlap. This is the ideal split pattern.

2. **Agents touching different sections of the same file.** Both Feature 3 Lite and Feature 4 Lite modified `httpBridge.ts`, but one added a method to the `agent` object and the other added methods to the `git` object. Different sections = no conflict. When assigning shared files, scope agents to different objects/sections.

3. **`tsc --noEmit` in the agent prompt.** Both Lite agents ran the type checker before finishing. This caught the one error (wrong store method name) inside the agent's own session, so it self-corrected without needing Phase 3 fixup.

4. **Orchestrator doing Feature 1 directly.** Small, single-file changes (< 200 lines) aren't worth the agent spawn overhead. Doing Feature 1 inline while agents handled Features 2-4 was the right call.

5. **Explicit "done criteria" per agent.** The plan listed exactly what each agent should produce. This made verification trivial — check file exists, check method exists, check build.

### What Could Be Improved

> Items 1, 2, 4, 5 have been incorporated into the SOP above (Rules 7-9, Phase 2 prompt guidance, Phase 3 session review).

1. ~~Agent prompts should reference exact existing patterns~~ → **Rule 7** (exact API references)
2. ~~Wire every action, no console.log stubs~~ → **Rule 8** (wire every action)
3. ~~Shared file coordination~~ → **Rule 9** (shared file sections)
4. ~~Store API guessing~~ → **Rule 7** (exact method signatures in prompts)
5. **No integration test script** (still open) — After all agents complete, there's no automated way to verify beyond `pnpm build`. Consider adding a quick curl-test script for new CLI endpoints and a Playwright smoke test for new UI panels.
6. **No session review step** was done before merging (still open) — Now documented in Phase 3 for run-group. For Task tool, review is limited to reading the returned output.
