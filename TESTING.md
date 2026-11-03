# Upstream compatibility

This plugin needs both [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) with its DSH backend. Official Harness alone is not enough. GitHub Releases are the only upstream release source.

The hosted run recorded below verifies macOS ARM64 Trash operations and Linux x86_64 permanent deletion for the pinned upstream pair. Earlier local and Linux-only results remain separate historical records.

## GitHub Actions CI

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests, and manual dispatch. It does not use Pullfrog, model-provider credentials, or a paid review service. Its token has read-only repository access, and checkout credentials are not persisted.

Both jobs use an independent `ubuntu-24.04` / `macos-15` matrix with `fail-fast: false`, Node `22.23.4`, and Python `3.12`:

- **Package checks**: `npm ci`, `npm run check` (TypeScript tests and Python driver/bootstrap regressions), `npm pack --dry-run`, and a tracked-file/whitespace check.
- **Live upstream PTY**: after package checks pass, check out the exact Harness and TUI commits in the compatibility record (including the TUI submodule), build the native addon and host libraries, build/pack the TUI, build/pack this plugin, and install both tarballs through the real Harness plugin manager in a new disposable HOME. `scripts/prepare-upstream-ci.py` performs this preparation, refuses an existing HOME, and exports the paths for the driver. Upstream lockfiles and compatibility gates are not bypassed. TUI installation/packing uses the hoisted linker required for its bundled dependencies.

Tarball filenames are not version-pinned: the TUI is packed into a fresh package-specific directory and preparation requires exactly one generated `.tgz`; the plugin filename comes from `npm pack --json`. Lifecycle-script output does not affect TUI artifact discovery. Installed package identities and versions are checked against this checkout's `package.json` and the selected TUI source manifest. The upstream commit/version compatibility gates remain pinned intentionally.

The driver initializes missing workspace storage by booting and cleanly exiting the real host. It dismisses the first-run guide and Sessions screen through Escape, without configuring credentials or making model calls. Linux process provenance uses `/proc`; macOS uses `ps` and `lsof`. Deletion evidence records actual permanent removal on Linux and real Trash provider/rename operations on macOS. The macOS check rejects permanent `rmSync` removal; headless hosts can use the plugin's filesystem Trash fallback under the disposable HOME.

Each live job is bounded to 45 minutes. Build/install logs and PTY evidence are uploaded even on failure as `upstream-compat-<runner>-<attempt>` artifacts, retained for 14 days. A successful build or package-check job is **not** a live compatibility pass: require the live job to succeed, `LIVE_OK`, and `live-full.json` with no failed or skipped assertions. Failures such as a missing switch scene remain failures; the workflow does not disable the switch assertion to make CI green.

Manual run after the workflow reaches the default branch: GitHub **Actions → CI → Run workflow**, or `gh workflow run ci.yml --ref main`. Inspect both OS jobs and download their artifacts. The hosted verification below records the successful run, platform details, and reviewed artifacts; future runs need the same evidence before extending that record.

During workflow development, local macOS arm64 source builds and isolated tarball installation completed with Node `26.13.0`. The real PTY run passed boot, help, cancellation, native-addon provenance, resume, and the cache-existence precondition, but failed confirmed `/nix`: the TUI reported `dsh-tui has no nix switch scene registered.` This is a failing integration result, not a macOS compatibility pass. The hosted Node `22.23.4` results are recorded separately below.

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
