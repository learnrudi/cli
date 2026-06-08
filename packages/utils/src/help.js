/**
 * Help and version display
 */

export function printVersion(version) {
  console.log(`rudi v${version}`);
}

export function printHelp(topic) {
  if (topic) {
    printCommandHelp(topic);
    return;
  }

  console.log(`
rudi - RUDI CLI

USAGE
  rudi <command> [options]

SETUP
  init                  Bootstrap RUDI (download runtimes, optional shims)

REGISTRY
  search <query>        Search registry for packages
  search --all          List all available packages
  install <pkg>         Install a package
  remove <pkg>          Remove a package
  update [pkg]          Update packages

INSTALLED
  list [kind]           List installed packages (stacks, skills, workflows, runtimes, binaries, agents)
  home                  Show ~/.rudi structure and status
  doctor                Check system health and dependencies
  which <cmd>           Show path to a command
  info <pkg>            Show package details
  shims [cmd]           Manage shims in ~/.rudi/bins (list, check, fix, rebuild)

AGENT INTEGRATION
  integrate <agent>     Wire up RUDI router (claude, cursor, gemini, codex, all)
  integrate --list      Show detected agents
  instructions [agent]  Print or install RUDI agent instruction blocks
  index                 Rebuild tool cache for router

RUN
  run <stack>           Run a stack directly
  parallel <tasks...>   Run multiple agent tasks in parallel (grouped)
  run-group <cmd>       Inspect, merge, and cleanup run groups
  lanes <cmd>           Manage the local main/dev lane worktree layout

SECRETS
  secrets set <name>    Set a secret
  secrets list          List configured secrets
  secrets remove <name> Remove a secret

DATABASE
  db stats              Show database statistics
  db search <query>     Search conversation history
  db tables             Show table row counts
  db vacuum             Compact and reclaim space

SESSIONS
  session list          List sessions
  session search <q>    Search session content
  session export <id>   Export a session
  session index         Build search embeddings

OPTIONS
  -h, --help           Show help
  -v, --version        Show version
  --verbose            Verbose output
  --json               Output as JSON

EXAMPLES
  rudi search --all              List all available packages
  rudi install slack             Install Slack stack
  rudi secrets set SLACK_TOKEN   Configure secret
  rudi integrate claude          Wire up Claude Desktop/Code
  rudi instructions codex        Print Codex instruction block
  rudi list                      Show installed packages

PACKAGE TYPES
  stack:<name>         MCP server stack
  runtime:<name>       Node, Python, Deno, Bun
  binary:<name>        ffmpeg, ripgrep, etc.
  agent:<name>         Claude, Codex, Gemini CLIs
  skill:<name>         Skill (prompt with optional stack requirements)
  workflow:<name>      Repeatable workflow definition
`);
}

function printCommandHelp(command) {
  const help = {
    search: `
rudi search - Search the registry

USAGE
  rudi search <query> [options]

OPTIONS
  --stacks         Filter to stacks only
  --skills         Filter to skills only (alias: --prompts)
  --workflows      Filter to workflows only
  --runtimes       Filter to runtimes only
  --binaries       Filter to binaries only
  --agents         Filter to agents only
  --all            List all packages (no query needed)
  --fresh          Refresh registry cache before searching
  --no-cache       Alias for --fresh
  --json           Output as JSON

EXAMPLES
  rudi search pdf
  rudi search deploy --stacks
  rudi search ffmpeg --binaries
  rudi search --all --agents
`,
    install: `
rudi install - Install a package

USAGE
  rudi install <package> [options]

OPTIONS
  --force          Force reinstall
  --json           Output as JSON

EXAMPLES
  rudi install pdf-creator
  rudi install stack:youtube-extractor
  rudi install runtime:python
  rudi install binary:ffmpeg
  rudi install agent:claude
  rudi install workflow:daily-brief
`,
    run: `
rudi run - Execute a stack

USAGE
  rudi run <stack> [options]

OPTIONS
  --input <json>   Input parameters as JSON
  --cwd <path>     Working directory
  --verbose        Show detailed output

EXAMPLES
  rudi run pdf-creator
  rudi run pdf-creator --input '{"file": "doc.html"}'
`,
    parallel: `
rudi parallel - Launch grouped parallel agent sessions

USAGE
  rudi parallel "<task1>" "<task2>" [more tasks] [options]
  rudi parallel --template <name> [options]

OPTIONS
  --name <name>               Group display name
  --provider <provider>       Agent provider (default: claude)
  --model <model>             Model override
  --base-branch <branch>      Base branch for worktrees (default: current branch)
  --cwd <path>                Working directory (default: current dir)
  --permission-mode <mode>    Permission mode passed to provider
  --system-prompt <prompt>    Additional system prompt
  --coordination-mode <mode>  flat, phased, or dependency
  --template <name>           Load a tracked run-group template
  --list-templates            Show available run-group templates
  --allow-validation-commands Allow non-default validator commands
  --no-worktree               Run in shared cwd instead of isolated worktrees

EXAMPLES
  rudi parallel "implement auth" "write tests" "update docs"
  rudi parallel "fix bug A" "fix bug B" --name "Bug batch"
  rudi parallel "task1" "task2" --provider claude --model sonnet
  rudi parallel --list-templates
  rudi parallel --template code-review-3task --coordination-mode dependency
`,
    'run-group': `
rudi run-group - Inspect and manage parallel agent run groups

USAGE
  rudi run-group <command> [args] [options]

COMMANDS
  list                          List run groups
  show <group-id>               Show run-group details and sessions
  stop <group-id>               Stop active sessions in a run group
  merge <group-id>              Merge successful run-group branches
  cleanup <group-id>            Remove worktrees for a run group

OPTIONS
  --json                        Output raw JSON
  --status <status>             Filter list results
  --project-path <path>         Filter list by project path
  --limit <n>                   Limit list results
  --offset <n>                  Offset list results
  --to <branch>                 Merge target branch
  --session-ids <a,b,c>         Explicit session IDs to merge
  --delete-branches             Delete branches during cleanup

EXAMPLES
  rudi run-group list --status running
  rudi run-group show group-123
  rudi run-group merge group-123 --to dev
  rudi run-group cleanup group-123 --delete-branches
`,
    lanes: `
rudi lanes - Manage the local main/dev lane layout for solo-dev parallel work

USAGE
  rudi lanes <command> [options]

COMMANDS
  init                          Create or discover the dev worktree
  sync                          Fast-forward main and dev from upstreams

OPTIONS
  --cwd <path>                  Repository path
  --main <branch>               Main lane branch (default: main)
  --dev <branch>                Dev lane branch (default: dev)
  --dev-path <path>             Override sibling dev worktree path
  --json                        Output raw JSON

EXAMPLES
  rudi lanes init
  rudi lanes init --cwd /path/to/repo
  rudi lanes sync
`,
    list: `
rudi list - List installed packages

USAGE
  rudi list [kind]

ARGUMENTS
  kind             Filter: stacks, skills, workflows, runtimes, binaries, agents

OPTIONS
  --json           Output as JSON
  --detected       Show MCP servers from agent configs (stacks only)
  --category=X     Filter skills by category

EXAMPLES
  rudi list
  rudi list workflows
  rudi list stacks
  rudi list stacks --detected     Show MCP servers in Claude/Gemini/Codex
  rudi list binaries
  rudi list skills --category=coding
`,
    secrets: `
rudi secrets - Manage secrets

USAGE
  rudi secrets <command> [args]

COMMANDS
  set <name>       Set a secret (prompts for value)
  list             List configured secrets (values masked)
  remove <name>    Remove a secret
  export           Export secrets as environment variables

EXAMPLES
  rudi secrets set VERCEL_TOKEN
  rudi secrets list
  rudi secrets remove GITHUB_TOKEN
`,
    db: `
rudi db - Database operations

USAGE
  rudi db <command> [args]

COMMANDS
  stats            Show usage statistics
  search <query>   Search conversation history
  init             Initialize or migrate database
  path             Show database file path
  reset            Delete all data (requires --force)
  vacuum           Compact database and reclaim space
  backup [file]    Create database backup
  prune [days]     Delete sessions older than N days (default: 90)
  tables           Show table row counts

OPTIONS
  --force          Required for destructive operations
  --dry-run        Preview without making changes
  --json           Output as JSON

EXAMPLES
  rudi db stats
  rudi db search "authentication bug"
  rudi db reset --force
  rudi db vacuum
  rudi db backup ~/backups/rudi.db
  rudi db prune 30 --dry-run
  rudi db tables
`,
    import: `
rudi import - Import sessions from AI providers

USAGE
  rudi import <command> [options]

COMMANDS
  sessions [provider]  Import sessions from provider (claude, codex, gemini, or all)
  status               Show import status for all providers

OPTIONS
  --dry-run            Show what would be imported without making changes
  --max-age=DAYS       Only import sessions newer than N days
  --verbose            Show detailed progress

EXAMPLES
  rudi import sessions              Import from all providers
  rudi import sessions claude       Import only Claude sessions
  rudi import sessions --dry-run    Preview without importing
  rudi import status                Check what's available to import
`,
    init: `
rudi init - Bootstrap RUDI environment

USAGE
  rudi init [options]

OPTIONS
  --force            Reinitialize even if already set up
  --skip-downloads   Skip downloading runtimes/binaries
  --with-shims       Create shims in ~/.rudi/bins/ (opt-in)
  --quiet            Minimal output (for programmatic use)

WHAT IT DOES
  1. Creates ~/.rudi directory structure (if missing)
  2. Downloads bundled runtimes (Node.js, Python) if not installed
  3. Downloads essential binaries (sqlite3, ripgrep) if not installed
  4. Optionally creates shims in ~/.rudi/bins/ (use --with-shims)
  5. Initializes the database (if missing)
  6. Creates settings.json (if missing)

NOTE: Safe to run multiple times - only creates what's missing.

EXAMPLES
  rudi init
  rudi init --force
  rudi init --with-shims
  rudi init --skip-downloads
  rudi init --quiet
`,
    home: `
rudi home - Show ~/.rudi structure and status

USAGE
  rudi home [options]

OPTIONS
  --verbose        Show package details
  --json           Output as JSON

SHOWS
  - Directory structure with sizes
  - Installed package counts
  - Database status
  - Quick commands reference

EXAMPLES
  rudi home
  rudi home --verbose
  rudi home --json
`,
    doctor: `
rudi doctor - System health check

USAGE
  rudi doctor [options]

OPTIONS
  --fix            Attempt to fix issues
  --all            Show all available runtimes/binaries from registry

CHECKS
  - Directory structure
  - Database integrity
  - Installed packages
  - Available runtimes (node, python, deno, bun)
  - Available binaries (ffmpeg, ripgrep, etc.)
  - Secrets configuration

EXAMPLES
  rudi doctor
  rudi doctor --fix
  rudi doctor --all
`,
    integrate: `
rudi integrate - Wire RUDI router into agent configs

USAGE
  rudi integrate <agent>     Integrate with specific agent
  rudi integrate all         Integrate with all detected agents
  rudi integrate --list      Show detected agents

AGENTS
  claude       Claude Desktop + Claude Code
  cursor       Cursor IDE
  windsurf     Windsurf IDE
  vscode       VS Code / GitHub Copilot
  gemini       Gemini CLI
  codex        OpenAI Codex CLI
  zed          Zed Editor

OPTIONS
  --verbose    Show detailed output
  --dry-run    Show what would be done without making changes

WHAT IT DOES
  1. Detects agent config files
  2. Creates backup before modifying
  3. Adds RUDI router entry (single MCP server for all stacks)
  4. Cleans up old direct stack entries

EXAMPLES
  rudi integrate claude
  rudi integrate all
  rudi integrate --list
`,
    instructions: `
rudi instructions - Print or install RUDI agent instructions

USAGE
  rudi instructions [agent]
  rudi instructions <agent> --install [--global|--project|--path <file>]
  rudi instructions <agent> --remove [--global|--project|--path <file>]

AGENTS
  claude       CLAUDE.md instructions
  codex        AGENTS.md instructions
  generic      Print a pasteable generic block

OPTIONS
  --install    Write or update a managed RUDI block
  --remove     Remove the managed RUDI block
  --project    Target ./CLAUDE.md or ./AGENTS.md in the current directory
  --global     Target the agent global instruction file (default)
  --path       Target an explicit instruction file
  --dry-run    Preview changes without writing
  --json       Output JSON

EXAMPLES
  rudi instructions claude
  rudi instructions codex --install
  rudi instructions claude --project --install
  rudi instructions codex --remove
`,
    logs: `
rudi logs - Query agent visibility logs

USAGE
  rudi logs [options]

FILTERS
  --limit <n>           Number of logs to show (default: 50)
  --last <time>         Show logs from last N time (5m, 1h, 30s, 2d)
  --since <timestamp>   Show logs since timestamp (ISO or epoch ms)
  --until <timestamp>   Show logs until timestamp (ISO or epoch ms)
  --filter <text>       Search for text in log messages (repeatable)
  --source <source>     Filter by source (e.g., ipc, console, agent-codex)
  --level <level>       Filter by level (debug, info, warn, error)
  --type <type>         Filter by event type (ipc, window, navigation, error, custom)
  --provider <provider> Filter by provider (claude, codex, gemini)
  --session-id <id>     Filter by session ID
  --terminal-id <id>    Filter by terminal ID

PERFORMANCE
  --slow-only           Show only slow operations
  --slow-threshold <ms> Minimum duration for slow operations (default: 1000)

SPECIAL MODES
  --before-crash        Show last 30 seconds before crash
  --stats               Show statistics summary

EXPORT
  --export <file>       Export logs to file
  --format <format>     Export format: json, ndjson, csv (default: json)

OUTPUT
  --verbose             Show detailed event information
  --json                Output events as JSON lines

EXAMPLES
  rudi logs --last 5m
  rudi logs --level error --last 1h
  rudi logs --filter "authentication" --provider claude
  rudi logs --slow-only --slow-threshold 2000
  rudi logs --stats --last 24h
  rudi logs --export debug.json --format ndjson --last 30m
  rudi logs --before-crash
`
  };

  if (help[command]) {
    console.log(help[command]);
  } else {
    console.log(`No help available for '${command}'`);
    console.log(`Run 'rudi help' for available commands`);
  }
}
