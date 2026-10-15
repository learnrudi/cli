# Node 24 follow-up and authorized local commits

## Scope and authority

The user authorized updating the registry default to Node 24, rerunning
fresh-install checks on both Macs and committing the completed work. Prior
cleanup and CLI init/list fixes are task-owned and verified; this turn adds
registry metadata and paired proof. No push, PR, merge, public release, or
installed-user upgrade is authorized.

CLI source base: 65c36efffdeb93c165da5abb3dbaac57725a9ae4. The earlier review
accepted 878 tests per host and the current bundle with no unresolved findings.
Registry base: bb257decedf7f2313ccbc9ab6c9daad43ac12c1a. Unrelated canonical
content-extractor changes on both Macs remain untouched. An isolated registry
branch contains only the default Node descriptor, test, generated index and
ledger. The earlier Wrangler/runtime draft remains preserved separately.

## Verification contract

Use the built CLI npm tarball, a fresh isolated home/prefix/cache and allowlisted
environment. Serve the exact candidate index over loopback HTTP via
RUDI_REGISTRY_URL; do not enable USE_LOCAL_REGISTRY or copy machine runtimes.
Download Node/Python/ripgrep from public URLs; detect the OS SQLite executable.
In addition to the previous init/list lifecycle assertions, require Node24.21.0
and its npm/npx shims, native SQLite read/write under the downloaded runtime,
and disposable daemon health/readiness with controlled process teardown.

Both hosts build CLI packages independently. Registry history is reconciled
using Git; installed state, databases, credentials, logs and caches remain
host-local. Linux descriptors are hash-checked but not executed here.

## Commit plan

1. CLI package documentation cleanup and historical audit.
2. CLI init/list fixes, regressions, annotated guide and verification documentation.
3. CLI generated distribution in its own commit.
4. Registry default runtime, contract test and ledger.
5. Registry generated index in its own commit.

Stage explicit paths and inspect complete staged diffs; preserve all unrelated
work and old worktrees. Reconcile exact commits to the admin peer and verify
source/build hashes before completion. Commit IDs and results follow below.

## Results

Both Macs passed all 52 expanded assertions in fresh-primary-verified/report.json
and fresh-admin-verified/report.json under `.rudi/outputs/node24-default-20261015/`.
Managed Node reports 24.21.0 and PATH selects that exact new executable. Native
better-sqlite3 reads/writes return 24. Disposable daemon health/readiness pass;
its exact child exits 0 on SIGTERM and removes its connection files. npm/npx,
Python, SQLite and ripgrep shims execute; TypeScript inventory/removal and
idempotent initialization pass. All four temporary install roots were removed.

Both registry suites pass 356 tests and required validation/index/hygiene/build/
pack/debt gates. One admin compiler test hit its existing 5-second timeout while
other test activity ran; unchanged isolated compiler and full-suite reruns pass.
The first smoke attempt failed only a raw /var versus /private/var comparison;
realpath equality fixes the harness without weakening the executable identity
check. The original failed logs are preserved.

Both CLI bundles match SHA-256
8f7753e9ca2ed1f68359a91cc084bbd9a225c1394bed05480d01978e035ad702.
Both npm tarballs match
c8d372d2d6b031b6d68f1af95309096d17b35e6e361415af35871b26d3dde7c6.
Both tested registry indexes match
f6c60cb471294e2f430107d33aabbdfb20f18e32a9db7376c0f525ef9160e08f.
CLI code is unchanged from the prior independent review and 878-test-per-host
runs. New docs/local links, build reproducibility, package inventory and exact
source-to-peer correspondence are verified for committing.

Local commit slices and peer history verification are recorded in commits.json
in the task evidence directory and final delivery report. Commits do not update
the public npm package or registry. The candidate closes the Node 20 compatibility
gap for the tested onboarding flow; it does not certify every stack/provider,
Linux/Windows, a fresh OS account or production service activation.
