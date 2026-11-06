# Cloud CI: GitHub Actions + Modal Ubuntu, CircleCI macOS

This configuration follows `hyein-cbio/pi-codemode-bench`: the GitHub Actions
runner is a Modal dispatcher, not the Ubuntu test machine; CircleCI executes
macOS checks directly in managed Apple silicon VMs. No self-hosted runner is
used. CI does not release, publish, deploy, or call a model provider.

## Execution matrix

Each provider runs four isolated cells. GitHub Actions invokes the Modal
dispatcher once: **one ephemeral app owns all four Sandboxes**, with at most two
cells running concurrently by default. CircleCI retains four managed macOS jobs:

| Suite | Node | Upstream pair |
| --- | --- | --- |
| Package | 22.23.4 | none |
| Package | 24.22.1 | none |
| Live PTY, including its own package gate | 22.23.4 | validated |
| Live PTY, including its own package gate | 24.22.1 | merged-022 |

`ci/settings.py` pins Node versions and official Linux x64 archive SHA-256s,
allowed cell combinations, and pnpm 11.28.5. The upstream repositories,
commits and manifest versions remain in `scripts/upstream_pairs.py`.
The separate `released-019` and historical `candidate-022` cells are not added
to this matrix. Provider migration is not evidence of a new compatibility pass.

## What each cell checks

`ci/run_ci.py` is the shared worker. Every cell installs this package's locked
dev dependencies, builds the checked-in JavaScript, runs all TypeScript and
Python regressions, checks `npm pack --dry-run`, and rejects tracked changes
or whitespace defects. A live cell repeats this gate independently rather
than waiting for a package job on the other provider.

A live cell then fetches the exact public upstream commits (and TUI submodule),
installs pnpm into a disposable directory, and calls
`scripts/prepare-upstream-ci.py` to build the native addon, host libraries,
TUI and plugin tarballs and a fresh isolated profile. The handoff is
`prepared.json`, not a GitHub-specific environment file. Optional
`DSH_COMPAT_ENV_FILE` / legacy `GITHUB_ENV` exports remain supported for local
callers. No upstream lockfile, peer gate, source pin or live assertion is bypassed.

The final-merge cell also runs the upstream projection lifecycle and durable
model-selection regressions. Both cells run real Cordis/TUI ownership checks
and the real PTY suite. A complete fresh run requires 32/32 Ubuntu or 33/33 macOS
assertions, no failures/skips, adoption before deletion, projection/pin/workspace
cleanup, control preservation, quit and restart. macOS still verifies Trash;
Ubuntu verifies permanent removal. The PTY child explicitly pins `DSH_TUI_LANG=en`
because minimal cloud images may have no locale and would otherwise start the
TUI in Chinese, while the driver asserts English UI strings. Headless macOS can use the filesystem
Trash fallback under the disposable profile HOME.

## GitHub and Modal

Keep GitHub Actions **enabled**. `.github/workflows/ci.yml` only checks out full
source history with `persist-credentials: false`, installs Python 3.11 and
`modal==1.6.3`, calls the dispatcher, and uploads its remote reports. It never
installs Node or runs product tests on the GitHub runner.

Set `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` as Actions secrets, preferably
from a dedicated minimally privileged Modal workspace. They are scoped to the
single dispatch step. The remote worker receives no Modal Secrets, GitHub
credentials, or forwarded local environment. Do not copy tokens into this
repository, CircleCI, the image, or a Git bundle.

`ci/modal_ci.py` exports only committed HEAD and its ancestry to a Git bundle;
ignored/untracked files, local `.git/config`, credentials, local dependencies
and existing reports are not copied. Dirty tracked files and shallow checkouts
are rejected. Package metadata forms a separate cached image layer, while the
bundle is mounted after dependency installation. Ubuntu 24.04 includes Python
3.12, checksum-verified Node and native build tools. A dedicated image user
(`dsh-ci`, UID 10001) owns the workspace; `runuser` executes the worker without
root privileges so filesystem-permission regressions run instead of skipping.
The container launcher first restores standard sticky `/tmp` permissions (1777)
because the source-file mount can leave that directory at 0755. This changes
only the disposable container, never the host. The worker rejects UID 0.
One invocation creates exactly one ephemeral app, not one app per cell. Each
selected cell receives its own Sandbox and private filesystem. The two Node
image definitions are reused within the app. No app or cell is automatically
retried, and no persistent deployment is created.

Package Sandboxes get 2 CPUs / 2 GiB and 10 minutes; live Sandboxes get 4 CPUs /
8 GiB and 45 minutes, plus one minute of lifecycle headroom. The GitHub job has
a 75-minute cap for package/live phases and initial image builds. There is no
GitHub job matrix: an internal bounded pool runs at most two Sandbox cells at a
time (`--max-parallel 1..4`, default 2). One failed cell does not cancel the others;
all selected results are collected before the app exits. Starting a Sandbox is
not success: nonzero exits, missing/mismatched summaries, incomplete coverage,
image errors and timeouts fail the check. Each cell terminates its own Sandbox
in `finally`, while the shared app remains alive until every cell settles.

Reports are retrieved before termination even for an unsuccessful worker.
Only normalized relative text-report paths are accepted: no archives, symlinks,
source trees or profile directories. Raw terminal reports retain their original
bytes. Collection is capped at 128 files, 8 MiB per file and 64 MiB total;
exceeding a limit fails the check rather than silently dropping evidence.
GitHub uploads one `modal-ubuntu-<attempt>` artifact, retained for 14 days. Its
root `summary.json` records the shared app ID and every selected cell's status;
subdirectories such as `package-node22/` and `live-merged-022/` retain separate
manifests, reports and logs. Successful summaries include their Sandbox IDs.
Any failed or unrun cell fails the aggregate check. Dispatcher failures retain
partial evidence and per-cell `dispatcher-error.json`; an app startup failure
records all cells as unrun without attempting to create another app. A launch
or image failure can precede worker report creation and remains visible in logs.

## CircleCI

`.circleci/config.yml` copies the reference project's node orb `7.2.1`,
Xcode `26.4.1` image and `m4pro.medium` managed macOS resource class. It uses
neither a Linux executor nor a self-hosted resource class. Confirm the CircleCI
organization has macOS credits and access to that resource class.

The connected project must use its own repository as **both config and checkout
source**, with config type **CircleCI** and file path `.circleci/config.yml`.
Do not select GitHub Actions configuration or `.github/workflows/ci.yml`.
The initial connection selected the latter; the migration corrects that pipeline
definition in place rather than adding a duplicate pipeline.

Use one GitHub App trigger with preset **PR opened or pushed to, default branch
and tag pushes** (`only-build-prs`), as in pi-codemode-bench. Keep config and
checkout refs unpinned so they follow the triggering revision. The workflow
expression rejects automatic tag pushes and non-main pushes, but accepts API
runs and same-repository PR opened/synchronize/reopened events. Fork PR exclusion
is provided by the GitHub App integration; verify that integration policy before
making checks mandatory. The workflow expression alone is not a fork gate.

CircleCI's fresh VMs may cache npm downloads under `~/.npm`, keyed by OS,
architecture, Node version and lockfile checksum. Locked installation always
runs. Upstream build resources and test profiles are disposable, not cached.
No secret context or Modal token is attached to the macOS jobs.

The two package jobs use `circleci testsuite run "node tests"`, matching the
reference's Smarter Testing setup. Compilation first emits `.test-dist/test`;
the suite discovers every compiled test-file atom. Its custom JUnit reporter
publishes relative compiled file identities, ordinals and timing only, not test
payloads, stdout, absolute paths or stack traces. Test impact analysis, dynamic
splitting/parallelism and automatic reruns are **not** enabled. TypeScript output
is cleaned even after suite failure, and Python regressions run independently.
`test-reports/` is uploaded as test results; `ci-results/` is the build/PTy
artifact directory. Logs from failed cells are retained; checkout trees and
profile HOME directories are never uploaded.

## Events and security

Both routes accept main pushes, own-repository PR opened/synchronize/reopened,
and manual/API runs. Other branch pushes, automatic tags and fork PR execution
are excluded. GitHub additionally checks the canonical repository identity;
a fork's copied dispatcher cannot use this repository's credentials.
Keep Actions' approval policy set to **all external contributors**.
Never use `pull_request_target` to run fork code with Modal credentials.

Writers who can edit a trusted CI branch can edit its authenticated dispatcher,
just as they can edit the workflow itself. Review `.github/`, `.circleci/` and
`ci/` accordingly. A fork contribution requires a reviewed trusted-branch run
before merge; a skipped check is not validation.

GitHub PR checks may use a synthetic merge commit while CircleCI may check the
PR head; merge-queue/result validation is a separate policy. After both providers
report actual checks, replace old self-hosted matrix names in branch protection
with the new Modal and CircleCI check names. Connecting the service or validating
YAML is not proof of a successful remote test run.

## Local checks and remote diagnostics

```sh
npm run check
circleci config validate .circleci/config.yml
npm run lint
node node_modules/typescript/bin/tsc -p tsconfig.test.json
circleci testsuite doctor "node tests"
circleci testsuite run "node tests"
npm run test:clean
```

Modal is imported only by the dispatcher; offline regressions do not require
its SDK, credentials or network. For a real billable remote run, authenticate
Modal separately, install the pinned SDK in an isolated virtual environment,
commit the desired source and choose a fresh output directory:

```sh
# Normal CI path: one app, all four cells, at most two concurrent Sandboxes.
python ci/modal_ci.py
# Debug a subset without creating one app per selected cell.
python ci/modal_ci.py --cell package-node22 --cell live-merged-022 --output ci-results/subset
```

Neither command publishes anything. Inspect `summary.json`, `manifest.json`,
all step logs, `upstream/live-full.json`, and `upstream/switch-deletions.jsonl`.
Do not claim cloud compatibility until the real remote cells succeed.

## Single-app validation (2026-11-06)

Temporary source snapshot `8a6ffce5937721aa609c559bea8ba894d6922b82` ran the complete
matrix in **one app**, [ap-30sJ42gzIcN8Jmrt5Q208k](https://modal.com/apps/hyein-sophia-cho/main/ap-30sJ42gzIcN8Jmrt5Q208k),
with default parallelism 2 and four distinct credential-free Sandboxes:

| Cell | Sandbox | Result |
| --- | --- | --- |
| package-node22 | `sb-01M6SJ4SKA9TZRJ7JV5BH3C258` | pass |
| package-node24 | `sb-01M6SJ4SKABKRA46E8HFYJCG9T` | pass |
| live-validated | `sb-01M6SJ54A4ENNJVSHY9XBK5YQ3` | **32/32**, no failures/skips |
| live-merged-022 | `sb-01M6SJ56T31CM7YKGTV7NMWATD` | **32/32**, no failures/skips |

Every cell ran as UID 10001 and its package gate passed **76 TypeScript and
66 Python tests**, zero failures/skips. The root aggregate reported exit code 0,
the same source revision for all cells, and one shared app ID. Per-cell reports,
logs, manifests and both real deletion traces were retrieved before each
Sandbox terminated. The app completed after all four cells settled.

Offline regressions additionally verify a single app factory/context, four
separate Sandbox creations under that app, the two-cell concurrency cap, complete
collection after one cell fails, no automatic retries, and failure aggregation
when app startup or shutdown fails. Later edits only add failure-path regression
coverage and documentation; the remotely exercised dispatcher and worker are
unchanged. This used local dispatcher authentication and an unpublished snapshot,
not a GitHub-triggered run or a hosted CircleCI macOS run. These pre-push
results do not verify the provider entrypoints; assess those from the actual
commit's GitHub Actions and CircleCI runs after the migration is pushed.

## Initial per-cell prototype validation (2026-11-06)

These records predate the single-app orchestration change. They verify the
worker, images and upstream checks, not the current shared-app lifecycle.

The working changes were exported to an unpublished temporary Git snapshot
`ecaeff8f3ddf07278ed2410c60a20ee23a3c267a` for verification, without committing
or pushing the actual repository. The worker, dispatcher, pins, locale fix,
non-root execution and serialized GitHub dispatch policy were exercised with
the pinned Modal SDK. The dispatcher was subsequently consolidated into one
app with multiple Sandboxes; that orchestration requires its own verification.

| Execution | Result | Modal app |
| --- | --- | --- |
| Ubuntu package, Node 22.23.4 | pass | [ap-LeEerWyg49z6cp8ZjhONGC](https://modal.com/apps/hyein-sophia-cho/main/ap-LeEerWyg49z6cp8ZjhONGC) |
| Ubuntu package, Node 24.22.1 | pass | [ap-Bjhia0CSmgjg91OHmxJjjl](https://modal.com/apps/hyein-sophia-cho/main/ap-Bjhia0CSmgjg91OHmxJjjl) |
| Ubuntu live, validated | **32/32**, no failures/skips | [ap-HZzegIVhuS7Y5rT8SWXAYc](https://modal.com/apps/hyein-sophia-cho/main/ap-HZzegIVhuS7Y5rT8SWXAYc) |
| Ubuntu live, merged-022 | **32/32**, no failures/skips | [ap-cuPYZMCim1PkjuXXzhRdju](https://modal.com/apps/hyein-sophia-cho/main/ap-cuPYZMCim1PkjuXXzhRdju) |

All four cells ran as UID 10001 and passed **76 TypeScript and 62 Python tests
with zero failures/skips**. Both live cells built their pinned native upstreams,
installed real local tarballs and passed Cordis/TUI lifecycle checks;
merged-022 also passed both upstream model and projection batteries. Complete reports and deletion traces were retrieved
before Sandbox termination. These are direct Modal runs using local dispatcher
authentication, **not** GitHub Actions runs proving the configured Actions
secrets work.

The initial live attempts failed at fresh onboarding because an unset locale
selected Chinese. They are not counted as passes; pinning English fixed that
actual environmental difference. One subsequent concurrent merged-022 launch
hit Modal's app-create rate limit before any worker started. It was manually
invoked after the other apps finished and then passed; the dispatcher has no
hidden automatic CI retry. The original GitHub concurrency cap was an initial
mitigation; the current design removes per-cell app creation altogether. Initial root-based package checks
also exposed one skipped permission-denial regression; the final non-root runs
above execute that test. The first unprivileged bootstrap caught the 0755 `/tmp`
mount permission issue, corrected before these final four runs.

CircleCI config compilation, testsuite doctor, and the exact package worker
with `--circleci` passed locally on macOS ARM64 for both Node versions, including
JUnit generation and cleanup. This is **not a hosted CircleCI macOS PTY pass**.
The CircleCI pipeline definition and trigger were corrected to native config
`.circleci/config.yml` and preset `only-build-prs`. At that pre-push checkpoint,
the new files had not reached GitHub; real GitHub-triggered and CircleCI runs
must be assessed separately for end-to-end validation. No package version,
release or npm publication was changed by this migration.
