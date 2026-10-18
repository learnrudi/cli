# Trusted Compute workspaces

This is an opt-in Agent Host profile for authorized operator work. Add
`"access_mode": "trusted"` to a registered execution profile, retain its exact
account/model/effort, and set `network` to `enabled`. Omission or `restricted`
retains the original file-task behavior. The installed runner must include this
contract before a trusted task can be admitted.

## Files and outputs

Include the project in `read_roots` and `write_roots`. Add each approved shared
directory to both arrays. Roots must exist on the execution host and be canonical;
no missing mount is replaced with a new empty directory. Descendants inherit
access. Normal repository links are accepted; the native command sandbox still
restricts resolved targets to approved paths. Codex receives explicit permission
for `.git`, `.codex`, `.agents` and `AGENTS.md` entries inside approved
roots, because a parent write grant otherwise leaves native metadata protection
in place. Linked worktrees may need their external Git metadata directory added
to the declared roots too.

`outputs.deliverables` remains a list of output locations, each covered by a
write root. It no longer has to equal every write root for trusted tasks. Output
manifests are checked against deliverables, including real paths and regular
files, before hashes are recorded. The project and deliverables must remain
disjoint from `outputs.runtime` in the Compute definition.

Trusted write roots may include the RUDI runtime tree, which also contains
accounts, job control files and receipts. This explicitly gives up protection
against a malicious job modifying that tree. Hashes are checked before execution;
they are not an immutable custody guarantee against a trusted operator with
runtime access. Native account selection, version pins, job deadlines, process
cleanup and failure receipts remain in effect. Do not use trusted tasks to run
untrusted instructions or treat MCP-side effects as filesystem-sandboxed.

## Tools and native configuration

The host's `~/.rudi/bins/rudi-router` must exist and be executable. Trusted tasks
add that one server; the router discovers its installed tools dynamically. They
do not maintain a per-stack tool list or copy secrets into profiles. The native
process gets the installed RUDI and user executable directories in PATH, but
does not inherit ambient API keys or change the selected native account.

Codex loads configuration from the selected account home, retains native MCP,
app and plugin support, enables web search, and pins the OpenAI provider. An
optional `rudi-trusted.config.toml` in that home is loaded as a native profile.
For shared host integrations, an operator can link that file to the host's
existing Codex config. This references configuration without copying credentials,
replacing the account home, or adding `config.toml` to an otherwise restricted
account. Restricted tasks never select this named profile. Existing files must
be inspected and preserved; do not replace a different profile silently.

Claude exposes its default native tool set and configured MCPs, adds the RUDI
router, and uses noninteractive native tool permissions inside the existing OS
filesystem sandbox. Trusted mode additionally grants the execution host's
`~/.rudi` read/write access for router runtimes, secret mediation, caches and
outputs, plus read access to `~/.local`, `/opt/homebrew` and `/usr/local` for
installed executables. These runtime grants apply even if a declared shared
runtime root is a mount of another computer. Native account/temp/system runtime
grants also remain. Hooks remain disabled. Native user/project configuration is
available; only connections actually configured and authenticated for that
identity can be used. Do not share `.claude.json` across identities: it contains
account state. Configure additional MCPs with the native per-account management
surface. Cloud connections and desktop-only plugins depend on native CLI and
account support; file access alone does not provision them.

Native MCP servers can have service authority beyond command filesystem roots.
Each tool's own authorization and the task's instructions continue to govern
external actions. Availability does not authorize sending messages, publishing,
deploying, deleting records or changing permissions.

## Host selection and rollout

Choose the execution host separately from the native identity. Do not silently
move jobs between computers. Shared names resolve as follows on the verified
two-Mac setup (substitute the actual host user):

| Workspace | RUDI Mac | Admin Mac |
| --- | --- | --- |
| Clients records | `/Volumes/Clients` | `~/Clients` |
| Shared RUDI | `/Volumes/RUDI` | `~/RUDI` |
| RUDI Runtime | `/Volumes/RUDI Runtime` | `~/.rudi` |
| Personal | `~/Personal` | Requires a separately verified location |

Personal-account preferences belong in private host configuration. Always bind
and verify the selected host-local catalog entry; never change global login or
fall back to another account. A Personal task
requires the chosen execution host to have the intended files; Admin cannot
read the workstation's Personal files while the workstation is down. The
workstation's current native versions differ from the qualified Admin worker,
so local scheduling also requires worker qualification before activation.

Before adoption: publish/review the source, update the clean accepted Admin
checkout, build a new immutable bundle, verify provider identities, exercise
project and child writes plus Git metadata, enumerate MCPs and router tools,
and verify native supported connections. Then deliberately revise each selected
task with its broader roots and trusted mode. Preserve old bundles and task
revisions for rollback; do not rewrite active pinned profile files or switch
worker services implicitly. No existing task gains access from this source
change alone.
