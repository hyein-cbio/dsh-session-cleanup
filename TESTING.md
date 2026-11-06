# Upstream compatibility

This plugin needs both [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) with its DSH backend. Official Harness alone is not enough. GitHub Releases are the only upstream release source.

The hosted run recorded below verifies macOS ARM64 Trash operations and Linux x86_64 permanent deletion for the pinned upstream pair. Earlier local and Linux-only results remain separate historical records.

## Version 0.3.1 release verification (2026-11-06)

[CI run 42270528944](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42270528944), runtime commit `4c1ccd873e3672490078b57f016f8e8fc06a2999`, package version `0.3.1`, completed successfully with **all eight jobs passing** on the first attempt. Release preparation updates documentation only; no runtime, dependency, test-driver or workflow changes follow that verified commit.

| CI check | Result |
| --- | --- |
| Ubuntu package checks, Node `22.23.4` and `24.22.1` | each: 73 TypeScript + 41 Python tests passed |
| Self-hosted macOS ARM64 package checks, same Node versions | each: 73 TypeScript + 41 Python tests passed |
| Ubuntu PTY, `validated` and `merged-022` | each: **32/32**, no failures/skips |
| Self-hosted macOS ARM64 PTY, `validated` and `merged-022` | each: **33/33**, no failures/skips |

The four uploaded `upstream-compat-<pair>-<os>-1` artifacts contain `live-full.json` and real deletion traces. These verify adoption before deletion, macOS Trash, projection/workspace/pin cleanup, preservation of the control session, `/nix quit`, and restart without recreating deleted ids. Both upstream pair identities remain pinned in `scripts/upstream_pairs.py`; the published TUI `v0.19.0` opt-in cell was not rerun. The initial closed-writer regression and the self-hosted setup failures below are historical failures, not the final release result.

## CI runner routing and fork policy

Both CI jobs route matrix `macOS` to `[self-hosted, macOS]`, and `ubuntu-24.04` to the GitHub-hosted Ubuntu runner. Job-level guards allow only this repository's push/manual events and PRs whose head repository is this repository. Fork PRs and copies of this workflow in other repositories skip both jobs before runner allocation.

pnpm itself is installed under `$RUNNER_TEMP/setup-pnpm`, avoiding stale `~/setup-pnpm/node_modules` across matrix cells (`ENOTEMPTY` on persistent runners). npm cache is isolated under `$RUNNER_TEMP/npm-cache` for every job. Remote npm cache restore/save is enabled only on GitHub-hosted runners; self-hosted jobs use the local job cache instead of downloading a multi-gigabyte archive of the runner owner's personal `~/.npm`. Existing personal caches are not deleted.

Python setup differs by runner environment: GitHub-hosted runners use `actions/setup-python` with Python 3.12; self-hosted macOS uses its pre-provisioned `python3` on PATH. Both jobs reject Python older than 3.10 and log the interpreter path/version before tests (and before upstream selection in live jobs). No sudo, system Python installation or `/Users/runner` permission changes are performed. Live jobs leave `runner.txt` evidence even if tool setup fails. Run [42266412844](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42266412844) passed all four Ubuntu jobs but failed the four macOS jobs before testing because the old unconditional setup-python step tried to create `/Users/runner/hostedtoolcache`.

These YAML guards are not a security boundary against a PR that edits its own workflow. Before relying on a self-hosted runner in this public repository, set **Settings → Actions → General → Fork pull request workflows from outside collaborators → Require approval for all outside collaborators** (`all_external_contributors`). Review workflow changes and code before approving; approval can authorize malicious code even if the normal fork guard would have skipped it. Read-only tokens do not isolate the runner's files, credentials or network. Dedicated/isolated runners are still recommended. The workflow change does not itself update GitHub repository settings.

## Closed-writer regression reproduction (before 0.3.1 release)

Hosted run [42262514184](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42262514184) failed both Ubuntu live cells at `switch: deletion summary missing`. The captured terminal showed a successful new-session adoption followed by a failure flushing the previous session. A local reproduction against the exact `validated` sources exposed `SessionHandleClosedError`: the previous write handle was closing while its live session was still registered.

The fix uses `sessionPersistence.flush()` only for that public error identity and the exact target id. Harness's backend barrier drains routed events and accounts for handles closing during the sweep. A normal I/O failure, another session's error, an aggregate failure, or an unavailable/failing backend barrier still refuses deletion; attachment, projection cache, membership and pins remain intact. The live driver also excludes unpublished `*.jsonl.zstd.<nonce>.tmp` files from log hashes after a separate reproduction caught one disappearing between listing and reading.

Local verification before the version-only bump from `0.3.0` to the unreleased `0.3.1` (no release or upload):

| Check | Result |
| --- | --- |
| `npm run check`, Node `22.23.4` | 73 TypeScript + 41 Python tests, no failures/skips |
| `npm run check`, Node `24.22.1` | 73 TypeScript + 41 Python tests, no failures/skips |
| Local macOS ARM64 PTY, `validated`: Harness `b830ec95`, TUI `1d0d946f`, Node `22.23.4` | **33/33**, no failures/skips |
| Local macOS ARM64 PTY, `merged-022`: Harness `66491b05`, TUI `e7336a62`, Node `24.22.1` | **33/33**, no failures/skips |
| Real Cordis/TUI lifecycle, `merged-022` | early/late startup, foreign refusal, reload and disposal passed |
| Final merged adapter regressions | plugin lifecycle 113 checks; durable-model-selection passed |

Both PTY runs used the working-tree driver without diagnostic monkeypatches, at its normal 120-column width, a freshly packed plugin, separate disposable HOME/DSH_HOME/XDG trees and no model calls. Cached source-built Harness checkouts were reused; the old TUI tarball was reused from its matching source build, and the final-merge TUI was freshly checked out, compiled and packed. Both source pins and installed package identities passed driver preflight. The deletion traces show real macOS Trash operations only after a new id was published, with control logs retained; quit and restart confirm deleted ids stay gone. Full local reports are `/tmp/dsh-ci-fix-20261106/fixed-old-evidence/live-full.json` and `/tmp/dsh-ci-fix-20261106/fixed-merged-evidence/live-full.json` with sibling `switch-deletions.jsonl` files. These temporary paths are local evidence, not hosted artifacts.

**These local reports do not establish a hosted Linux CI pass for `0.3.1`; check the push-triggered CI result separately.** The published TUI `v0.19.0` opt-in cell was not rerun; `merged-022` remains the separate merge commit whose manifest says `0.18.0`. Historical results below do not substitute for those checks.

## Version 0.3.0 safety changes (release-time record)

Version `0.3.0` adds fail-closed deletion, delayed detach/accounting commit, bounded Trash provider termination, switch deadline/cancellation/disposal handling, mandatory confirmation, stable legacy picker labels, and fork-child failure isolation. Historical PTY results below verify earlier runtime artifacts, not these safety changes. A new source-built live PTY pass is still required before extending upstream compatibility claims.

Local safety verification on this checkout:

- `npm run check` passed on Node `26.13.0` and `22.23.4`: **71 TypeScript tests and 40 Python tests**, zero failures or skips. New tests cover retained live attachments/accounting on removal failure, scan/access errors, stop/flush refusal, non-retryable providers, full switch deadlines, abort/unmount/disposal, late-result suppression, activation isolation, command serialization, mandatory confirmation, label boundaries, provider TERM/KILL escalation and fork-child exit isolation.
- A separate probe against the cached source-built DSH `66491b05` real `SessionStore` confirmed that failed removal retains the session and permits `flush`, unreadable storage fails closed, and successful removal commits detach.
- `check-upstream-lifecycle.mjs` passed early/late startup, ownership, foreign refusal, removal/reload and disposal against the cached TUI candidate `fb0b5325`. This is a lifecycle check on that candidate, **not** a new live TUI `v0.19.0` pass.
- `npm pack --dry-run` and `git diff --check` passed. The safety checks were performed before release preparation; `0.3.0` packages these changes without claiming a new full live PTY pass.

## Published dsh-TUI v0.19.0 (2026-11-06)

GitHub Latest for dsh-TUI is `v0.19.0` (non-draft, non-prerelease). On that commit, `src/dsh-adapter/contract.ts` sets `UPSTREAM_VALIDATED_VERSION` to `0.2.2-rc.1`, which is also the greatest entry in `UPSTREAM_VALIDATED_VERSIONS` (alpha < beta < rc). npm semver `7.7.4` with `includePrerelease: true` says that version satisfies all 36 `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer ranges at once. The versions in the explicit list that also satisfy every harness peer range and have a published non-draft Harness release are `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.3`, `0.2.1-rc.4`, `0.2.1-rc.5`, and `0.2.2-rc.1`. This run tested only the greatest, `0.2.2-rc.1`.

No DeepSeek Harness GitHub release is newer than `dsh-v0.2.2-rc.1`. `dsh-v0.2.2-alpha.2` and `dsh-v0.2.2-alpha.3` are outside `UPSTREAM_VALIDATED_VERSIONS`, fail all 36 harness peer ranges, and are not pending work. This is the first verification of this published pair. It is not the `merged-022` cell: that cell packs TUI `e7336a62`, whose manifest still says `0.18.0`.

| Cell | Harness | dsh-TUI | Result |
| --- | --- | --- | --- |
| Line named by published dsh-TUI `v0.19.0` | `0.2.2-rc.1`, tag `dsh-v0.2.2-rc.1` | `0.19.0`, tag `v0.19.0` | **VERIFIED** on Linux |

Node `v24.22.1`. Kernel `Linux 6.12.113+ x86_64`. Plugin runtime is `main` at `39e21b1` (no `src/` change since `31966db`). Package version stayed `0.2.2`. macOS Trash was not tested. CI was not changed, so this cell stays opt-in via `DSH_COMPAT_PAIR=released-019`.

### Release identity

- Harness: `deepseek-ai/deepseek-harness`, release `433935433`, tag `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, published `2026-11-04T13:07:14Z`, https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1. Source manifests `@deepseek-ai/dsh` and `@deepseek-ai/dsh-root` are `0.2.2-rc.1`.
- dsh-TUI: `ccch1mneyyy/dsh-TUI`, release `436069606`, tag `v0.19.0`, annotated tag object `c7aec055dffee85de7688ab9f1ba77b53a0905d4`, commit `224f847d02c2157f43862d2792cf9d7459222f4c`, published `2026-11-06T03:32:50Z`, https://github.com/ccch1mneyyy/dsh-TUI/releases/tag/v0.19.0. Manifest `@deepseek-harness-tui/dsh-tui` is `0.19.0`.
- Both disposable checkouts' HEADs matched those commits. Submodule `vendor/dsh-std` gitlink `614dfa1ac168db79fcf4577cf0ebb34e2e3b944b` was checked out and bundled into the TUI tarball.
- Before compiling the TUI, its `@deepseek-ai/*` installs were replaced with symlinks into the Harness checkout (230 packages). Left on their own lines: `@deepseek-ai/dsh-invariants@0.1.1-rc.2`, `@deepseek-ai/dsh-session-persistence-sqlite@0.1.1-rc.2`, and the LibreOffice kit packages. They are not the Harness release under test. The isolated profile dependencies are `file:` tarballs of that TUI pack and this plugin.
- The live host was `node apps/cli/lib/bin.js` from the Harness checkout. `/proc/<pid>/maps` showed `native/system/packages/linux-x64/bin/glibc/system.node` from that tree. A resolve probe during boot recorded `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-session-persistence`, and the other logged `@deepseek-ai/*` requests under that checkout. None resolved to a registry copy. JavaScript sources do not appear as file mappings in `/proc/<pid>/maps`.

### Support rule

Read from commit `224f847d02c2157f43862d2792cf9d7459222f4c` only. `UPSTREAM_VALIDATED_VERSION` itself passed the peer intersection, so it was the version installed. `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, and `@anthropic-ai/claude-agent-sdk` are not the harness version line. pnpm workspace overrides were not the support ceiling.

### Change analysis

The closest Linux-verified record on main is `merged-022`: the same Harness commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` and TUI `e7336a62030064daa2e4593f0ec7311c9c362b71`. `git diff` of those TUI commits changes documentation, release notes, `package.json` version `0.18.0` to `0.19.0`, and the same version string in `tui-profile/feed/first-party.json`. `src/`, `scripts/`, the lockfile, and `cordis.patch.yml` are unchanged. There is no Harness delta from that record. The existing live assertions cover the unchanged integration. `test_released_019_pair_checks_published_sources` is the added check that a `0.18.0` manifest or the merge SHA is refused when this pair is selected.

The last dual-platform verified pair remains Harness `b830ec950faba0a46dda564be3e2d854afed94f1` with TUI `1d0d946f459da5149aba64cc6cc0ef7da304053c`. From that baseline, scene registration and `channel.newSession()` are unchanged; question and projection-cache type moves do not change the confirm payload or the `session_projcache` table; workspace pin and archive fields are unchanged; `/update` planning is outside `/nix quit`. Those paths were exercised again on the published pair below. No production source change was required.

### Live `/nix` checks

Isolated `HOME` / `DSH_HOME` / XDG tree under `/tmp/compat-sandbox/home`. `DSH_TUI_NO_LAUNCHPAD=1`. No model calls. `python3 scripts/live-upstream-tui.py` with `DSH_COMPAT_PAIR=released-019` drives a real PTY.

| Check | Result |
| --- | --- |
| Source HEADs and manifests match the releases above | pass |
| Profile dependencies are `file:` tarballs; installed plugin `0.2.2` and TUI `0.19.0` | pass |
| Packed plugin loads; `/nix help` shows usage | pass |
| Host cmdline is the Harness checkout; native addon is that checkout's `system.node` | pass |
| Cancelling confirmation keeps the original session log | pass |
| Confirmed `/nix` adopts a different session id while the old directory still exists, then removes it with `rmSync` | pass |
| Projection cache, workspace membership, pins, and archive references drop the deleted id and keep the control id | pass |
| The new session accepts `/nix help` | pass |
| `/nix quit` exits 0 and removes the adopted session directory | pass |
| Restart does not recreate either deleted session | pass |
| The unrelated control session directory and pin remain | pass |

A fresh profile passed 32 assertions, 0 failed, 0 skipped, including workspace initialization. The same driver was run again on that already-initialized sandbox after this tree's package checks: 31 passed, 0 failed, 0 skipped. The only assertion absent from the rerun is `initialize-workspace`, which the driver skips when storage already exists. The switch scene was present, so both runs exercised the real switch. Refusal without deletion remains the unit test `DSH /nix does not delete when the TUI refuses to switch`. Linux permanent removal was observed. macOS Trash was not tested.

`node scripts/check-upstream-lifecycle.mjs` against this TUI build passed early and late startup, including foreign-owner refusal, removal, reload, and disposal.

### Package checks

On this tree, Node `v24.22.1`: `npm ci` exit 0, `npm run check` exit 0 (48 TypeScript tests passed, 0 failed, 0 skipped; 39 Python tests OK), `npm pack --dry-run` exit 0 for `dsh-session-cleanup@0.2.2`. Unit tests do not replace the live checks above.

## GitHub Actions CI

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests, and manual dispatch. It does not use Pullfrog, model-provider credentials, or a paid review service. Its token has read-only repository access, and checkout credentials are not persisted.

Both jobs use an independent `ubuntu-24.04` / `macos-15` matrix with `fail-fast: false` and Python `3.12`. Package checks cover Node `22.23.4` and `24.22.1`. Live checks use the `validated` pair on Node `22.23.4` and the `merged-022` pair on Node `24.22.1`. `scripts/upstream_pairs.py` supplies their exact repository/commit/version pins to checkout and driver preflight. The new cell pins the final PR #1886 merge, separately from the later v0.19.0 release:

- **Package checks**: `npm ci`, `npm run check` (TypeScript tests and Python driver/bootstrap regressions), `npm pack --dry-run`, and a tracked-file/whitespace check.
- **Live upstream PTY**: after that live cell's own package checks pass, check out the exact Harness and TUI commits selected by the named pair (including the TUI submodule), build the native addon and host libraries, build/pack the TUI, build/pack this plugin, and install both tarballs through the real Harness plugin manager in a new disposable HOME. `scripts/prepare-upstream-ci.py` performs this preparation, refuses an existing HOME, and exports the paths for the driver. Upstream lockfiles and compatibility gates are not bypassed. TUI installation/packing uses the hoisted linker required for its bundled dependencies.

Tarball filenames are not version-pinned: the TUI is packed into a fresh package-specific directory and preparation requires exactly one generated `.tgz`; the plugin filename comes from `npm pack --json`. Lifecycle-script output does not affect TUI artifact discovery. Installed package identities and versions are checked against this checkout's `package.json` and the selected TUI source manifest. The upstream commit/version compatibility gates remain pinned intentionally.

Before the PTY run, `scripts/check-upstream-lifecycle.mjs` uses the source-built TUI's real Cordis and `TuiSceneRuntime` to check both startup orders, owner-bound opening, service removal/reload, and plugin disposal. Only its command registry is a fixture; it is not a renderer/session-deletion test. It must fail against the old delayed-child-registration implementation. The PTY suite still separately tests the real host, command registry, renderer, and deletion.

The driver initializes missing workspace storage by booting and cleanly exiting the real host. It dismisses the first-run guide and Sessions screen through Escape, without configuring credentials or making model calls. Linux process provenance uses `/proc`; macOS uses `ps` and `lsof`. Deletion evidence records actual permanent removal on Linux and real Trash provider/rename operations on macOS. The macOS check rejects permanent `rmSync` removal; headless hosts can use the plugin's filesystem Trash fallback under the disposable HOME.

Each live job is bounded to 45 minutes. Build/install logs and PTY evidence are uploaded even on failure as `upstream-compat-<pair>-<runner>-<attempt>` artifacts, retained for 14 days. A successful build or package-check job is **not** a live compatibility pass: require the live job to succeed, `LIVE_OK`, and `live-full.json` with no failed or skipped assertions. Failures such as a missing switch scene remain failures; the workflow does not disable the switch assertion to make CI green.

Manual run after the workflow reaches the default branch: GitHub **Actions → CI → Run workflow**, or `gh workflow run ci.yml --ref main`. Inspect both OS jobs and download their artifacts. The hosted verification below records the successful run, platform details, and reviewed artifacts; future runs need the same evidence before extending that record.

During workflow development, local macOS arm64 source builds and isolated tarball installation completed with Node `26.13.0`. The real PTY run passed boot, help, cancellation, native-addon provenance, resume, and the cache-existence precondition, but failed confirmed `/nix`: the TUI reported `dsh-tui has no nix switch scene registered.` This is a failing integration result, not a macOS compatibility pass. The hosted Node `22.23.4` results are recorded separately below.

## Final TUI merge review (2026-11-06)

The current CI new-line cell is `merged-022`: DSH `0.2.2-rc.1` at `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, TUI at [`e7336a62030064daa2e4593f0ec7311c9c362b71`](https://github.com/ccch1mneyyy/dsh-TUI/commit/e7336a62030064daa2e4593f0ec7311c9c362b71), Node `24.22.1`. The `validated` cell keeps its original DSH `0.2.1-rc.5` / released TUI `v0.18.0` pins on Node `22.23.4`. The historical `candidate-022` cell remains available for reproducing the November 5 evidence, but no longer runs in CI.

### Execution-path comparison

The range [`fb0b5325...e7336a62`](https://github.com/ccch1mneyyy/dsh-TUI/compare/fb0b5325be7704fbdd09a7d7d8d642fca4d42f77...e7336a62030064daa2e4593f0ec7311c9c362b71) changes 22 files. PR head `3bb0c26cf252751c5659e598f672a76ef065545f` and squash merge `e7336a62` have identical Git trees. The candidate's 33 macOS assertions remain evidence for `fb0b5325` only.

| Changed code | Effect on `/nix` and verification |
| --- | --- |
| `src/dsh-adapter/host-access.ts` | Root projection registrations now retain their callable and lazy `then`/`catch`/`finally` interfaces, modern reader handles, and legacy async disposers. Release is idempotent; rejected readiness and completed async owner teardown release the exact registration and watcher. This can affect session setup/disposal indirectly. It does not grant root access to plugin scenes. |
| `src/dsh-adapter/backend/session.ts` | Live `request/context` events with a known provider/model that differs from the Agent's current selection no longer update the new route's capacity. Raw history remains intact. This is separate from session IDs, scene ownership, and filesystem removal. |
| `src/dsh-adapter/plugin.ts`, `src/update.ts` | Update restart proves launcher/engine identity and carries an engine-skip report to a surviving mount. The added mount effect has a disposer. `/nix` does not invoke `/update`; the PTY quit/restart checks cover ordinary exit and fresh launch, not a real global upgrade. |
| Unchanged scene and switch paths | `scenes.ts`, the channel session-switch implementation, and this plugin's `src/` are unchanged. `/nix` still confirms, opens its owner-bound scene, awaits `channel.newSession()`, and only then deletes the previous session. A refused switch returns before deletion. |

The lifecycle checker now explicitly rejects a foreign activation's scene open and checks that refusal leaves no active scene, both before and after TUI service reload. It retains both startup orders and command/scene disposal checks. Driver preflight tests reject exchanging candidate and final commits even though both TUI manifests say `0.18.0`. Each live cell repeats the full package checks before building upstreams, so Linux can proceed while macOS runners are queued. The separate four-cell package matrix remains intact. Package-test fixtures explicitly select their historical baseline and temporary log directory; they do not inherit the surrounding live cell's pair or write synthetic failures into its evidence directory. The merged CI cell also runs upstream `verify-plugin-lifecycle.ts` and `verify-durable-model-selection.ts` in temporary HOME directories, saving their output with the PTY evidence.

### Verification status and limits

The local Linux attempt installed frozen upstream dependencies and built both native addons using Node `22.23.4` / `24.22.1`. The original `tsx` CLI failed because this environment rejects its auxiliary IPC socket. Preparation now executes the same native and host build sources through `node --import tsx/esm`, retaining native compilation, checked host compilation, lockfiles, and all compatibility gates.

Local package checks passed 48 TypeScript and 38 Python tests before the final CI-only addition; the modified pin/bootstrap Python tests were rerun and all 38 passed. The execution server disconnected during upstream compilation and became unavailable. Neither local PTY suite completed, and the attempted upstream lifecycle scripts initially lacked unbuilt vendor outputs. These interrupted attempts are **not compatibility passes**. Hosted results must be assessed from the new PR's actual jobs, `LIVE_OK`, and complete reports. Earlier candidate results do not supply a verdict for the merge.

Every runtime profile uses a new disposable HOME with local source-built tarballs and scrubbed credentials. The PTY suite covers cancellation, adoption before removal, projection/pin/archive cleanup, preservation of an unrelated session, post-switch command use, `/nix quit`, and restart without resurrection. Foreign-owner refusal is a real Cordis/TUI lifecycle check; refusal-preserves-files also has unit coverage. The PTY suite does not deliberately remove the scene or run authenticated/model-backed activity. Linux deletion and macOS Trash are distinct assertions.

### Latest CI status after the pipeline failure fix

[Run 42243600083](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42243600083) tests head `a225aba0f2b7cc6cdb2330ff4b0a4e3d90947245`. The final adapter step now declares `shell: bash`, so a failed Node process cannot be hidden by a successful `tee`. The observed job results are separate from the older successful Linux jobs below.

| Cell and platform | Job result | Observed evidence |
| --- | --- | --- |
| `validated`, Ubuntu x86_64, Node `22.23.4` | [**Failed**](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42243600083/job/127979961119) | `live-full.json`: **18 passed / 1 failed**; stopped at `control-stable-before-resume`: `control log changed while stopped` |
| `merged-022`, Ubuntu x86_64, Node `24.22.1` | [**Success**](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42243600083/job/127979961073) | `LIVE_OK`; **32 passed / 0 failed / 0 skipped**; upstream projection lifecycle **113 checks** and durable model selection **21 scenarios** passed with pipeline failure propagation enabled |
| Both cells, macOS | **Queued; no new verdict** | No completed macOS job for this run at the time of review |

Both Linux package jobs passed. Both live jobs also passed their early/late scene ownership, foreign-owner refusal, removal/reload, and disposal checks before the PTY suite. The old-line PTY failure occurs before resume and confirmed switch/deletion; its later switch, quit, and restart checks did not run. The failed report's `skipped: 0` is the driver's default counter, not evidence that those later checks executed. The cause of the changed control-log digest is unresolved; this docs update does not diagnose it as a harness race or a product regression and does not alter or retry the check.

This run is **not a full CI success**, and the PR must not merge on these results. Retain the historical macOS-15 ARM64 and Ubuntu verification of Harness `0.2.1-rc.5` plus released TUI `v0.18.0` in [run 41524817863](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/41524817863); the failed current attempt is recorded separately. The final TUI merge has a new Linux pass only. Require CI success, then update this record and README to the successful evidence before merging. No branch deletion, force-push, or new PR is part of this update.

### Hosted Linux verification

[Run 42238899327](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42238899327) directly tested branch head `cdb2ce98bdf4c809cf5fc57257a766a4ff3e8002` against the unchanged plugin runtime from `main@31966db`. Both Linux live jobs succeeded, with `LIVE_OK`, all 32 assertions true, and zero failed/skipped assertions. The complete reports and deletion traces were parsed from their job logs and are preserved in [`test/evidence/2026-11-06-final-tui-merge.json`](test/evidence/2026-11-06-final-tui-merge.json).

| Cell and platform | Node | Real PTY passed / failed / skipped | Lifecycle |
| --- | --- | --- | --- |
| `validated`, Ubuntu 24.04 x86_64 | `22.23.4` | [**32 / 0 / 0**](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42238899327/job/127963796656) | Early/late TUI, owner open, foreign-owner refusal, removal/reload, plugin disposal passed |
| `merged-022`, Ubuntu 24.04 x86_64 | `24.22.1` | [**32 / 0 / 0**](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42238899327/job/127963796443) | Same plugin lifecycle checks; upstream projection lifecycle **113 checks** and durable model selection **21 scenarios** passed |
| Both cells, macOS | Planned Node 22/24 | **Queued; no new verdict** as of 15:05 UTC | Not executed |

Both Node lines also passed 48 TypeScript and 38 Python tests, packing, and clean-tree/whitespace checks. All actual removal targets were under the disposable HOME. The traces show the adopted ID in workspace membership **before** `rmSync` removed the doomed directory. Cancellation preserved the old session; projection/pin/archive references were cleaned; the unrelated control session and its log survived switch, quit, and restart unchanged. The new session accepted `/nix help`, `/nix quit` exited 0, and restart did not resurrect deleted IDs/directories.

No `/nix` regression was observed on Linux at these pins, so this PR changes verification and records only. It makes no new macOS Trash claim and does not claim the whole workflow is green. The November 5 macOS candidate results retain their original scope.

Earlier hosted attempts are not passes: run `42237828839` stopped in the package fixture checks because the surrounding live pair leaked into old-line fixtures; run `42238111746` built/installed the old pair but the new foreign-owner fixture predated TUI composition tracking. The fixtures now select their own pair/log directory and create the foreign activation after the real TUI establishes tracking. The passing run retains the same foreign-owner refusal assertion and all PTY checks.

### Merge and release identities

[TUI PR #1886](https://github.com/ccch1mneyyy/dsh-TUI/pull/1886) merged at 03:14 UTC. GitHub subsequently published [`v0.19.0`](https://github.com/ccch1mneyyy/dsh-TUI/releases/tag/v0.19.0) at **03:32:50 UTC**, pointing to `224f847d02c2157f43862d2792cf9d7459222f4c`. Its `src/`, `scripts/`, lockfile, and `cordis.patch.yml` match the merge; the release changes the package version, documentation, and feed metadata. This CI cell tests the exact merge tarball, whose manifest still says `0.18.0`. Source equality does not replace testing a separately packed or published release artifact.

Plugin runtime remains the unreleased fix merged in [PR #6](https://github.com/hyein-cbio/dsh-session-cleanup/pull/6). This review does not bump its `0.2.2` package version, tag a release, or publish to npm. Published plugin `0.2.2` must not be assumed to contain PR #6.

## Local dual-line verification (2026-11-05, unreleased fix)

This checkout fixes an ownership bug, not a missing DSH session-creation feature. When `tuiScenes` arrived after plugin startup, `ctx.inject()` registered `dsh-nix-switch` under a **child** Cordis activation, but the command called `open()` under the **parent** activation. The real TUI listed the scene yet returned `false` to the parent's open call. Its ownership fence is intentional. Making both `commands` and `tuiScenes` required dependencies lets Cordis schedule and reload the entire plugin with one owner. No version sniffing, root-context borrowing, private channel access, or upstream gate bypass is used in production.

The unreleased runtime files were built, packed, and installed by the real checkout CLI into disposable profiles. Every installed `lib/**/*.js` file was compared with this checkout's output and matched on both successful runs. Package version remains `0.2.2`; these changes are **not** claimed to exist in the already published 0.2.2 package. Runtime SHA-256 identities and normalized assertion reports/deletion traces are saved in [`test/evidence/2026-11-05-dual-dsh.json`](test/evidence/2026-11-05-dual-dsh.json).

| Cell | Exact Harness source | Exact TUI source | Node | Local real PTY |
| --- | --- | --- | --- | --- |
| `validated` | `0.2.1-rc.5`, `b830ec950faba0a46dda564be3e2d854afed94f1` | released `v0.18.0`, `1d0d946f459da5149aba64cc6cc0ef7da304053c` | `22.23.4` | **33 passed / 0 failed / 0 skipped**, `LIVE_OK` |
| `candidate-022` | `0.2.2-rc.1`, `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` | [TUI PR #1886](https://github.com/ccch1mneyyy/dsh-TUI/pull/1886), `fb0b5325be7704fbdd09a7d7d8d642fca4d42f77` | `24.22.1` | **33 passed / 0 failed / 0 skipped**, `LIVE_OK` |

Both source builds kept their upstream lockfiles and native addons. The candidate TUI tarball was built during the failing baseline and reused unchanged for the successful fresh profile; only this plugin was rebuilt/repacked. The old pair was built separately on Node 22. Neither source manifest/peer range nor the installer's compatibility gate was overridden. Both TUI sources report package version `0.18.0`; their commits, not that shared version string, distinguish the released and candidate implementations. DSH `0.2.2-rc.1`'s CLI requires Node **>=24.9.0**.

Platform: macOS **27.2 (26B123), ARM64**, Darwin 27.2.0, Python **3.15.2**. The initial pnpm launcher was 11.28.5; upstream `packageManager` selection actually used **11.21.0** for TUI installs. No model calls were made and no real user profile was modified. Both runs observed real `trash` provider operations during `/nix`, with the adopted ID already present **before** old-directory removal. They also passed cancellation, projection/pin/archive cleanup, unrelated control-session preservation, `/nix help` after switching, `/nix quit` exit 0, and restart without resurrection. They do not inspect Trash contents or test restoration.

### Negative controls and lifecycle coverage

- The unmodified runtime from `main@9837e1f` reproduced the new-pair failure locally: **23 passed / 1 failed**, `deletion summary missing`, with `dsh-tui has no nix switch scene registered.` on screen. The baseline stops there; its `skipped: 0` field does not mean later quit/restart checks executed.
- The new lifecycle checker fails against that old runtime and passes both early/late startup scenarios against the fixed runtime on **both** TUI source builds. It also requires command/scene teardown when the TUI disappears, a single fresh registration after reload, and cleanup on plugin disposal.
- An intermediate fixed-plugin run switched/deleted successfully but failed deletion-order evidence because `/tmp` and `/private/tmp` spellings did not match. The driver now canonicalizes HOME/CWD before spawning, with an alias regression test. The fresh-profile run above retains all ordering/Trash assertions and passes them; the intermediate evidence failure is not counted as a compatibility pass.
- A redundant new-TUI dependency reinstall was stopped during optional cross-platform package-download retries. The successful run reused the already source-built baseline TUI tarball; it did not substitute a registry TUI or relax lockfiles.
- `npm run check` passes on Node **22.23.4** and **24.22.1**: **48 TypeScript tests** and **38 Python tests** each. The new refusal test checks that an actual session directory/log survives missing/refused scenes. `npm pack --dry-run` and `git diff --check` pass.

### Reproduction and limits

Use `DSH_COMPAT_PAIR=validated` (default) or `DSH_COMPAT_PAIR=candidate-022` consistently for both preparation and the driver. `python3 scripts/upstream_pairs.py` prints the selected immutable pins; unknown names are refused. Check out that pair and the TUI submodule, select its Node line, and follow the preparation flow above with a **new, nonexistent** sandbox HOME. After preparation, use its exported `DSH_COMPAT_NODE`, `DSH_COMPAT_BIN`, and `DSH_COMPAT_CWD` paths:

```bash
node scripts/check-upstream-lifecycle.mjs
python3 scripts/live-upstream-tui.py
```

For a baseline negative control, the lifecycle checker also accepts `DSH_COMPAT_PLUGIN_ENTRY=/absolute/path/to/baseline/lib/dsh-entry.js`; normal CI leaves that unset and checks the just-built local entry.

These are **local macOS** results, not a new hosted Linux/macOS CI success. The CI matrix has been extended but was not pushed or dispatched during this work. They cover the two exact upstream commits and slash-command flows, not every DSH release before/after 0.2.2, released TUI support for the new DSH, real model activity, or other platforms. The original historical local failure below remains a failure of the old implementation/environment, not a pass retroactively.

## Hosted verification (2026-11-02)

[CI run 41524817863](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/41524817863) finished successfully at **2026-11-02 22:43:35 UTC** (final attempt 5). The two package jobs and two live PTY jobs are successful in the final run view. This is verification of the pinned pair below on the two recorded platforms.

| Component | Version | Exact source commit |
| --- | --- | --- |
| dsh-session-cleanup | `0.2.2` | [`111702f6b25c4f73bce7e087e1d58c316d81b77c`](https://github.com/hyein-cbio/dsh-session-cleanup/commit/111702f6b25c4f73bce7e087e1d58c316d81b77c) |
| DeepSeek Harness | `0.2.1-rc.5` (`dsh-v0.2.1-rc.5`) | [`b830ec950faba0a46dda564be3e2d854afed94f1`](https://github.com/deepseek-ai/deepseek-harness/commit/b830ec950faba0a46dda564be3e2d854afed94f1) |
| dsh-TUI | `0.18.0` (`v0.18.0`) | [`1d0d946f459da5149aba64cc6cc0ef7da304053c`](https://github.com/ccch1mneyyy/dsh-TUI/commit/1d0d946f459da5149aba64cc6cc0ef7da304053c) |

Both live reports record Node `v22.23.4` and the exact upstream HEADs above. The jobs used Python `3.12.10` on macOS and `3.12.15` on Ubuntu, with pnpm `11.28.5` on both. Harness was built from source, including its native addon; the real checkout CLI installed the source-built TUI and plugin tarballs into a disposable profile. No model calls were made.

### Platform results and attempts

| Platform | Package checks | Real upstream PTY | `live-full.json` passed / failed / skipped | Deletion observed during confirmed `/nix` |
| --- | --- | --- | --- | --- |
| `macos-15`: macOS 15.8.2 (24H232), ARM64; Darwin 24.6.0 | [success](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/41524817863/job/125594448515) | [success, `LIVE_OK`](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/41524817863/job/125594446888) | **33 / 0 / 0** | `trash` provider; `switch-trash` passed; no observed `rmSync` removal |
| `ubuntu-24.04`: Ubuntu 24.04.5 LTS, x86_64; Linux 7.0.0-1017-azure | [success](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/41524817863/job/125594500088) | [success, `LIVE_OK`](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/41524817863/job/125594449700) | **32 / 0 / 0** | `rmSync` permanent removal; no Trash assertion on Linux |

These successes accumulated across retries of the same plugin commit. Ubuntu package checks first passed in attempt 1; macOS package checks and Ubuntu live PTY passed in attempt 3; macOS live PTY passed in attempt 5. Successful jobs were carried forward into the final attempt's job view, rather than all four being executed afresh in attempt 5. The macOS `LIVE_OK` timestamp is 22:43:24 UTC; Ubuntu's is 21:45:34 UTC. Earlier macOS package attempts 1–2 and live attempts 3–4 were cancelled; they are not compatibility passes. The skipped live jobs in attempts 1–2 are also not passes. Zero skipped assertions refers to the two successful live reports, not to the entire run history.

Both package jobs passed `npm ci`, `npm run check`, `npm pack --dry-run`, and `git diff --exit-code && git diff --check`. Each reported **45 TypeScript tests passed, 0 failed, 0 skipped**, plus **35 Python driver/bootstrap regression tests, OK**. Those counts are separate from the live assertions. Expected negative-case `[FAIL]` messages in the regression-test output are not failures of the successful live suite.

### Assertion review

On 2026-11-03, both ZIP artifacts were downloaded, their SHA-256 digests matched the Actions metadata, and every entry in `live-full.json` was checked against its totals, notes, and `switch-deletions.jsonl`. All 32 shared assertions have `ok: true`; the only additional macOS assertion is `switch-trash`, also true.

| Assertions (same names in both reports unless noted) | What passed |
| --- | --- |
| `source-roots`, `harness-commit`, `tui-commit`, `source-versions`, `host-checkout` | Required source roots, exact upstream commits/versions, and the checkout CLI path |
| `profile-file-deps`, `installed-versions` | Profile dependencies are local tarballs; installed plugin `0.2.2` and TUI `0.18.0` match their source manifests |
| `initialize-workspace`, `boot`, `host-cmdline`, `flock-addon` | Real host startup and CLI provenance; loaded native addon comes from the Harness checkout (`darwin-arm64/bin/system.node` or `linux-x64/bin/glibc/system.node`) |
| `help`, `confirm-dialog`, `cancel` | `/nix help`, confirmation, and cancellation preserving existing session IDs, directories, and logs |
| `rename-control`, `new`, `rename-doomed`, `exit-setup`, `control-stable-before-resume`, `switch-targets`, `resume` | Distinct control/doomed sessions, clean setup exit, unchanged control log, existing deletion target, and resumed pinned/archived state |
| `switch-dialog`, `switch-proj-before`, `switch-order` | Confirmation and existing projection cache before deletion; the ultimately adopted session ID is already present at the real deletion boundary |
| `switch-trash` (macOS only) | Observed Trash operations and no permanent `rmSync` removal |
| `switch-proj`, `switch`, `usable` | Old directory, projection cache, workspace membership, pins, and archive references removed; control session preserved; adopted session accepts `/nix help` |
| `quit-dialog`, `quit`, `quit-cleanup` | Confirmed `/nix quit` exits 0 and removes the adopted session and deleted IDs/references while retaining the control session and its pin |
| `restart`, `restart-exit` | Restart does not recreate either deleted directory/ID, control log remains unchanged, and the restarted host exits 0 |

In both deletion traces, the doomed directory exists in `before-delete`, the new adopted ID is already in workspace `sessionIds`, and the directory is absent in `after-delete`. macOS records operation `trash` for both events; Ubuntu records `rmSync`. This directly supports the switch-before-removal ordering and distinguishes Trash from permanent removal.

### Evidence and limits

| Artifact | ID | Created (UTC, 2026-11-02) | Expires (UTC, 2026-11-16) | ZIP SHA-256 |
| --- | --- | --- | --- | --- |
| [`upstream-compat-macos-15-5`](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/41524817863/artifacts/13186605337) | `13186605337` | 22:43:27 | 22:43:24 | `86ab5506edc0cf2046df68291acc46c2737938bceb7132c253adf55849516343` |
| [`upstream-compat-ubuntu-24.04-3`](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/41524817863/artifacts/13180923845) | `13180923845` | 21:45:35 | 21:45:34 | `be4bd68b9818ff3f10ef612ff30d76f48a2e8176accf53ded378b9f780722542` |

Each artifact contains `live-full.json`, `switch-deletions.jsonl`, `prepared.json`, and source build/pack/install logs. Artifact links are subject to retention; the counts, assertion inventory, provenance, and operation summary above record what was reviewed.

The live switch scene was present on both platforms. Neither run disabled it to exercise refusal without deletion; that branch remains covered by a stubbed unit test, as both reports' notes state. The macOS deletion trace observes the doomed session during confirmed `/nix`; it does not inspect Trash contents, test restoration, or establish which deletion provider `/nix quit` used. The `trash` provider succeeded during the observed switch, so the headless filesystem Trash fallback and other providers were not exercised there. Linux verifies permanent removal, not Linux Trash integration.

This record covers these source commits, Node version, hosted architectures, and slash-command flows only. It does not verify other upstream versions, Intel macOS, Linux ARM64, authenticated/model-backed conversations, or every failure/recovery path. Reviewing this evidence did not rerun the PTY suite.

The earlier local macOS Node `26.13.0` missing-switch-scene failure remains a failure in its own environment. The hosted Node `22.23.4` successes do not turn that local result into a pass or establish its cause. The older Linux runs and incompatible upstream pair below remain historical records with their original versions and counts.

## Historical Linux verification (dsh-TUI v0.18.0)

At the time of this original Linux verification, GitHub Latest for dsh-TUI was `v0.18.0`. That commit's `src/dsh-adapter/contract.ts` sets `UPSTREAM_VALIDATED_VERSION` to `0.2.1-rc.5`, and that string is also the greatest entry in `UPSTREAM_VALIDATED_VERSIONS`. npm semver `7.8.5` with `includePrerelease: true` says `0.2.1-rc.5` satisfies all 36 `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer ranges on that commit at once. This was the first verification of this pair. The earlier verified pair, dsh-TUI `v0.17.0` with Harness `0.2.1-rc.3`, is unchanged and is recorded below.

| Cell | Harness | dsh-TUI | Result |
| --- | --- | --- | --- |
| Line named by dsh-TUI `v0.18.0` | `0.2.1-rc.5` tag `dsh-v0.2.1-rc.5` | `0.18.0` tag `v0.18.0` | **VERIFIED** on Linux |

Node `v22.23.4`. Kernel `Linux 6.12.94+ x86_64`. Plugin commit `459d04c992a33ac437897639fb336de789e0002f`. Package version stayed `0.2.1`.

Harness `dsh-v0.2.2-alpha.2` is outside `UPSTREAM_VALIDATED_VERSIONS` and fails every harness peer range on this TUI commit. It was not tested. At the time of this original run, no DeepSeek Harness GitHub release was newer than `dsh-v0.2.1-rc.5`. Older supported lines (`0.2.1-rc.4`, `0.2.1-rc.3`, and the rest of the explicit list) were not part of this run.

### Harness `dsh-v0.2.1-rc.5`

- Repository: `deepseek-ai/deepseek-harness`
- Release id: `428584211`
- Tag: `dsh-v0.2.1-rc.5` (lightweight tag)
- Commit: `b830ec950faba0a46dda564be3e2d854afed94f1`
- Published: `2026-10-30T02:12:26Z`
- URL: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5
- Source manifests: `@deepseek-ai/dsh` and `@deepseek-ai/dsh-root` `0.2.1-rc.5`
- Checkout HEAD matched the commit. The live host was `node apps/cli/lib/bin.js` from that checkout. `/proc/<pid>/maps` showed `native/system/packages/linux-x64/bin/glibc/system.node` from the same tree, built with the checkout's `pnpm run build:native-system` (`tsx native/system/scripts/build.ts --host-addon-only`).

### dsh-TUI `v0.18.0`

- Repository: `ccch1mneyyy/dsh-TUI`
- Release id: `430342600`
- Tag: `v0.18.0` (annotated tag object `d6cc02f3d294e6aea60638c3e9aa4400e7de36ad`, tagger `2026-11-01T03:30:42Z`)
- Commit: `1d0d946f459da5149aba64cc6cc0ef7da304053c`
- Published: `2026-11-01T03:37:37Z`
- URL: https://github.com/ccch1mneyyy/dsh-TUI/releases/tag/v0.18.0
- Manifest: `@deepseek-harness-tui/dsh-tui` `0.18.0`
- Checkout HEAD matched the commit. The profile dependency is the tarball packed from that checkout (`file:`), not a registry release. Installed files match that tarball. Packed files other than the publish `package.json` match the checkout.

### Support rule

Read from commit `1d0d946f459da5149aba64cc6cc0ef7da304053c` only:

- Contract symbol: `UPSTREAM_VALIDATED_VERSION = '0.2.1-rc.5'`.
- Explicit list greatest, under the contract's semver order (alpha < beta < rc): `0.2.1-rc.5`.
- Peer intersection with a published non-draft Harness release: `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.3`, `0.2.1-rc.4`, `0.2.1-rc.5`. `primaryFailCount` for `0.2.1-rc.5` is 0.
- Ignored on their own lines: `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `@anthropic-ai/claude-agent-sdk`.
- pnpm workspace overrides were not the support ceiling.

### Live `/nix` checks

Isolated `HOME` / `DSH_HOME` / XDG tree under `/tmp/compat-sandbox`. `DSH_TUI_NO_LAUNCHPAD=1`. No model calls. The driver is `scripts/live-upstream-tui.py` (PTY, real TUI, no mocked scenes).

| Check | Result |
| --- | --- |
| Profile dependencies are `file:` tarballs of this plugin and the packed TUI | pass |
| Packed plugin loads; `/nix help` shows usage | pass |
| Host cmdline is the Harness checkout `apps/cli/lib/bin.js` | pass |
| Cancelling confirmation keeps the original session log | pass |
| Confirmed `/nix` adopts a different session id while the old directory still exists, then removes it | pass |
| Projection cache, `sessionIds`, `pinnedSessionIds`, and `archivedSessionIds` drop the deleted id and keep the control id | pass |
| The new session accepts `/nix help` | pass |
| `/nix quit` exits 0 and removes the adopted session directory | pass |
| Restart does not recreate either deleted session | pass |
| The unrelated control session directory and pin remain | pass |

24 passed, 0 failed, 0 skipped. `/nix quit` was the process exit code 0.

The switch scene was present, so this run exercised the real switch. It did not disable that scene. When the scene is missing, `/nix` is supposed to refuse without deleting; that branch is the unit test `DSH /nix does not delete when the TUI refuses to switch` and was not re-enacted live.

macOS Trash was not tested in this historical Linux run.

### Re-running the live harness

The script expects Linux or macOS, the already built Harness CLI, the isolated profile, and these variables: `DSH_COMPAT_NODE`, `DSH_COMPAT_BIN`, `DSH_COMPAT_HOME`, `DSH_COMPAT_CWD`, `DSH_COMPAT_HARNESS_ROOT`, `DSH_COMPAT_TUI_ROOT`. Both source roots are required. Before changing the profile, it checks their HEADs against the exact Harness and TUI commits above, checks source versions `0.2.1-rc.5` / `0.18.0`, and requires `DSH_COMPAT_BIN` to resolve to the Harness checkout's `apps/cli/lib/bin.js`. It deletes only session directories that already resolve under `DSH_COMPAT_HOME`.

```bash
python3 scripts/live-upstream-tui.py
```

The resumed host loads the test-only `scripts/observe-session-delete.cjs` preload. It records the current workspace IDs and target-directory existence immediately before and after real `rmSync`, Trash-provider process, or `renameSync` operations on the doomed session in `DSH_COMPAT_LOG/switch-deletions.jsonl`. It does not mock deletion, commands, or scenes. `switch-order` requires the ultimately adopted ID in the before-delete event and successful directory removal in the after-delete event, so even a switch completed between observer reads is testable. Missing or out-of-order events fail the check.

Immediately before accepting the switch confirmation, `switch-proj-before` requires the doomed session's projection cache file to exist. If the host did not create it, the run fails without confirming deletion; absence afterward alone is not evidence of cleanup.

The 24-assertion result above is the original recorded run, not a rerun of this hardened driver. Driver regressions run with `npm run test:live-driver` (Python 3 and Node required), also included in `npm run check`. They exercise immediate real Node deletion with ESM imports, reversed/missing deletion evidence, cache-present/cache-missing confirmation, and source identity/version checks before profile mutation. These tests do not establish upstream compatibility; the later hosted runs above provide separate results for the hardened driver on both recorded platforms.

Hardening checks on macOS with Node `v26.13.0` and Python `3.15.2`: `npm ci`, `npm run check` (75 plugin tests + 14 driver regression tests; no failures or skips), `npm pack --dry-run`, and `git diff --check` passed. The Linux live PTY run was not repeated in this environment.

### Package checks on this repo

On commit `459d04c992a33ac437897639fb336de789e0002f`, with Node `v22.23.4`:

| Command | Exit |
| --- | --- |
| `npm ci` | 0 |
| `npm run check` | 0 (75 passed, 0 failed, 0 skipped) |
| `npm pack --dry-run` | 0, package `dsh-session-cleanup@0.2.1` |

Unit tests do not replace the live checks above.

## Previous verified pair (dsh-TUI v0.17.0)

dsh-TUI `v0.17.0` names Harness `0.2.1-rc.3` as `UPSTREAM_VALIDATED_VERSION` in `src/dsh-adapter/contract.ts` on commit `103834cb1000a84569a71646fec7162f18a058c8`. That list ends at `0.2.1-rc.3`. Harness `0.2.1-rc.4`, `0.2.1-rc.5`, and `0.2.2-alpha.2` were outside that list when this pair was verified. The live checks below use only that named pair.

| Cell | Harness | dsh-TUI | Result |
| --- | --- | --- | --- |
| Line named by dsh-TUI `v0.17.0` | `0.2.1-rc.3` tag `dsh-v0.2.1-rc.3` | `0.17.0` tag `v0.17.0` | **VERIFIED** on Linux |

Node `v22.23.4`. Kernel `Linux 6.12.94+ x86_64`. Package version stayed `0.2.1`.

### Harness `dsh-v0.2.1-rc.3`

- Repository: `deepseek-ai/deepseek-harness`
- Release id: `422003676`
- Tag: `dsh-v0.2.1-rc.3`
- Commit: `1f81c047fc48fa190a683e469daa699857e9afe8`
- Published: `2026-10-23T15:26:39Z`
- URL: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3
- CLI manifest: `@deepseek-ai/dsh` `0.2.1-rc.3`
- Checkout HEAD matched the commit. `apps/cli/lib/bin.js` is the process the live suite spawned.

### dsh-TUI `v0.17.0`

- Repository: `ccch1mneyyy/dsh-TUI`
- Release id: `422656740`
- Tag: `v0.17.0` (annotated tag object `b1719950a2929c7d3df20be7b4817a178c6c1fb7`)
- Commit: `103834cb1000a84569a71646fec7162f18a058c8`
- Published: `2026-10-24T10:14:57Z`
- URL: https://github.com/ccch1mneyyy/dsh-TUI/releases/tag/v0.17.0
- Manifest: `@deepseek-harness-tui/dsh-tui` `0.17.0`
- Checkout HEAD matched the commit.

### Live `/nix` checks

Isolated `HOME` / `DSH_HOME` / XDG tree. The host was `node apps/cli/lib/bin.js --profile dsh-tui` from the Harness checkout, driven through a PTY. Slash commands only. No model calls. The screen showed `dsh-tui v0.17.0` and `dsh-core v0.2.1-rc.3`.

| Check | Result |
| --- | --- |
| Packed plugin loads and `/nix help` works | pass |
| Cancelling confirmation keeps the original session and the control session | pass |
| Confirmed `/nix` switches to a different live session and removes the old directory during that switch | pass |
| Projection cache row for the old session is gone | pass |
| Workspace `sessionIds` drop the old id and keep the control id | pass |
| `pinnedSessionIds` and `archivedSessionIds` drop the deleted id | pass |
| The new session accepts `/nix help` | pass |
| `/nix quit` exits with code 0 and removes the adopted session directory | pass |
| Restart does not recreate either deleted session | pass |
| The unrelated control session directory remains | pass |

27 passed, 0 failed. `/nix quit` was observed as process exit code 0. The exit listener was armed when the PTY was spawned.

This run also fixed deletion so a removed session is taken out of `pinnedSessionIds`. The unit test keeps a second pinned id in place.

On this branch, with Node `v22.23.4`:

| Command | Exit |
| --- | --- |
| `npm run check` | 0 (75 passed, 0 failed, 0 skipped) |
| `npm pack --dry-run` | 0, package `dsh-session-cleanup@0.2.1` |

Unit tests do not replace the live checks above. The three classifier tests only read installer logs.

## Earlier matrix

Bootstrap attempt against the newest published Harness release at that time. That pair is not the line dsh-TUI `v0.17.0` validates. It is not a regression against the v0.17.0 pair above. The v0.17.0 verification was recorded after this attempt. dsh-TUI `v0.18.0` later named Harness `0.2.1-rc.5`; that newer pair is the current verified cell and is not this matrix.

| Cell | Harness | dsh-TUI | Result |
| --- | --- | --- | --- |
| Newest published pair | `0.2.2-alpha.2` tag `dsh-v0.2.2-alpha.2` | `0.17.0` tag `v0.17.0` | **INCOMPATIBLE** |

Plugin commit under test: `ffdf4b4cb99b755c3777f007f18abbdcdfc9a727`. Node `v24.22.2`. Kernel `Linux 6.12.94+ x86_64`.

A later rebuild on the same commits installed Harness with its lockfile intact, including the SheetJS tarball. The host still rejected the dsh-TUI checkout. That rebuild does not change the result below.

### Harness `dsh-v0.2.2-alpha.2`

- Repository: `deepseek-ai/deepseek-harness`
- Release id: `426210803`
- Tag: `dsh-v0.2.2-alpha.2` (lightweight tag, commit object)
- Commit: `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`
- Published: `2026-10-28T02:50:54Z`
- URL: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2
- Manifest: `@deepseek-ai/dsh-root` `0.2.2-alpha.2`; CLI `@deepseek-ai/dsh` `0.2.2-alpha.2`
- Checkout HEAD matched the commit.

### dsh-TUI `v0.17.0`

- Repository: `ccch1mneyyy/dsh-TUI`
- Release id: `422656740`
- Tag: `v0.17.0` (annotated tag object `b1719950a2929c7d3df20be7b4817a178c6c1fb7`)
- Commit: `103834cb1000a84569a71646fec7162f18a058c8`
- Published: `2026-10-24T10:14:57Z`
- URL: https://github.com/ccch1mneyyy/dsh-TUI/releases/tag/v0.17.0
- Manifest: `@deepseek-harness-tui/dsh-tui` `0.17.0`
- Checkout HEAD matched the commit. Submodule `vendor/dsh-std` gitlink `614dfa1ac168db79fcf4577cf0ebb34e2e3b944b` was checked out and not built.

## What failed

The Harness installer reads the dsh-TUI checkout `package.json` and compares every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer with the running app-boot version (`0.2.2-alpha.2`). dsh-TUI `0.17.0` peers stop at `0.2.1-rc.3`. The host rejected the install and printed `nothing was installed`. The profile manifest stayed an empty `dsh-tui` profile whose only bundle is `@deepseek-ai/dsh-base` from that Harness checkout. No registry copy of either upstream was installed.

Command, from an isolated `HOME` / `DSH_HOME` / XDG tree, with `dsh` pointing at `apps/cli/lib/bin.js` from the Harness checkout:

```bash
dsh plugin --profile dsh-tui add /path/to/dsh-TUI
```

Exit code: `1`.

```text
dsh: installation rejected: Plugin @deepseek-harness-tui/dsh-tui@0.17.0 is incompatible with dsh 0.2.2-alpha.2: requirements { ... peers through 0.2.1-rc.3 ... }.
dsh: nothing was installed.
dsh: to accept the risk, run: dsh plugin --profile dsh-tui allow-version @deepseek-harness-tui/dsh-tui@0.17.0 --dsh-version 0.2.2-alpha.2 --accept-risk
```

`allow-version` was not used. Bypassing the host gate would not show that this pair is supported.

## Integration assertions

None of these ran. A skipped assertion is not a pass.

- Packed plugin loads into the isolated dsh-TUI/DSH composition
- `/nix` is registered and `/nix help` works
- Cancelling confirmation preserves the original session
- Confirmed `/nix` adopts a different live session before removing the old directory
- The new session remains usable after the switch
- Old session directory, projection cache, and workspace references are removed
- `/nix quit` exits without recreating the deleted session
- Restarting the isolated host does not resurrect the deleted session
- An unrelated control session remains untouched
- Missing TUI switch capability refuses `/nix` without deleting the session

Passed / failed / skipped integration counts: no integration tests launched.

## Package checks on this repo

On commit `ffdf4b4cb99b755c3777f007f18abbdcdfc9a727`, with Node `v24.22.2`:

| Command | Exit |
| --- | --- |
| `npm ci` | 0 |
| `npm run check` | 0 (72 passed, 0 failed, 0 skipped) |
| `npm pack --dry-run` | 0 |

`test/upstream-compat.test.ts` classifies installer logs only. It does not talk to Harness or dsh-TUI. After that file was added, `npm run check` reported 75 passed, 0 failed, 0 skipped. Those three extra tests are not the integration assertions above.

The same three commands were run again on this report update, with Node `v24.22.2`: `npm ci` exit 0, `npm run check` exit 0 (75 passed, 0 failed, 0 skipped), `npm pack --dry-run` exit 0. Package version stayed `0.2.1`.

Unit tests do not prove upstream compatibility.

## Source builds

Harness, in the disposable checkout of `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`. HEAD matched that commit. Node `v24.22.2`. pnpm `11.28.5`.

- `pnpm install --frozen-lockfile` (exit 0). The lockfile was not edited. `xlsx@0.20.3` was installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` into `packages/client/ui-sidebar-documentpreview`. No Harness package was taken from npm as a substitute for this commit.
- `pnpm exec tsx scripts/compile-referenced-projects.ts host-libraries` (exit 0). This is the checked-in host-library step. `apps/cli/lib/bin.js` printed `0.2.2-alpha.2`.

Loaded from that checkout, not from a global install:

- `@deepseek-ai/dsh-app-boot` → `packages/boot/app-boot/lib/index.js` (`0.2.2-alpha.2`)
- `@deepseek-ai/dsh-plugin-manager` → `packages/boot/plugin-manager/lib/index.js`
- `@deepseek-ai/dsh-base` → `packages/bundle/base/lib/index.js`

dsh-TUI was not compiled. `dsh plugin add` of the checkout reads `package.json` and rejects it before installation. The checkout has no `engines.dsh`. Its 36 `@deepseek-ai/dsh-*` peers stop at `0.2.1-rc.3` and none name `0.2.2`. Compiling it would require either those peers or a registry copy of Harness `0.2.1-rc.3`. Neither was used. `allow-version` was not used. There is no TUI runtime module path to record.

The isolated profile `package.json` kept `"dependencies": {}` and the base bundle `@deepseek-ai/dsh-base`. Nothing from either upstream was installed from a registry.

## Suggested fix (unverified)

In dsh-TUI, extend the `@deepseek-ai/dsh-*` peer ranges (or set `engines.dsh`) so they include Harness `0.2.2-alpha.2`, then rebuild that checkout and re-run the isolated `dsh plugin add` plus the live `/nix` checks. This repo cannot make that upstream declaration, and this run did not try it. Do not treat `dsh plugin allow-version` as compatibility.

## Re-running the gate

With the selected `dsh` on `PATH` and `DSH_COMPAT_TUI` set to the dsh-TUI checkout:

```bash
node scripts/upstream-compat.mjs
```

Exit `2` means the host rejected the checkout. Exit `3` means the attempt was blocked or the install was accepted before the live TUI checks, which are not a verification.
