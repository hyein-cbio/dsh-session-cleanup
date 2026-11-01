# Upstream compatibility

This plugin needs both [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) with its DSH backend. Official Harness alone is not enough. GitHub Releases are the only upstream release source.

Results below are Linux x86_64 only. They say nothing about macOS Trash.

## Verified pair

GitHub Latest for dsh-TUI is `v0.18.0`. That commit's `src/dsh-adapter/contract.ts` sets `UPSTREAM_VALIDATED_VERSION` to `0.2.1-rc.5`, and that string is also the greatest entry in `UPSTREAM_VALIDATED_VERSIONS`. npm semver `7.8.5` with `includePrerelease: true` says `0.2.1-rc.5` satisfies all 36 `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer ranges on that commit at once. This is the first verification of this pair. The earlier verified pair, dsh-TUI `v0.17.0` with Harness `0.2.1-rc.3`, is unchanged and is recorded below.

| Cell | Harness | dsh-TUI | Result |
| --- | --- | --- | --- |
| Line named by dsh-TUI `v0.18.0` | `0.2.1-rc.5` tag `dsh-v0.2.1-rc.5` | `0.18.0` tag `v0.18.0` | **VERIFIED** on Linux |

Node `v22.23.4`. Kernel `Linux 6.12.94+ x86_64`. Plugin commit `459d04c992a33ac437897639fb336de789e0002f`. Package version stayed `0.2.1`.

Harness `dsh-v0.2.2-alpha.2` is outside `UPSTREAM_VALIDATED_VERSIONS` and fails every harness peer range on this TUI commit. It was not tested. No DeepSeek Harness GitHub release is newer than `dsh-v0.2.1-rc.5`. Older supported lines (`0.2.1-rc.4`, `0.2.1-rc.3`, and the rest of the explicit list) were not part of this run.

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

macOS Trash was not tested.

### Re-running the live harness

The script expects the already built Harness CLI, the isolated profile, and these variables: `DSH_COMPAT_NODE`, `DSH_COMPAT_BIN`, `DSH_COMPAT_HOME`, `DSH_COMPAT_CWD`, `DSH_COMPAT_HARNESS_ROOT`. It deletes only session directories that already resolve under `DSH_COMPAT_HOME`.

```bash
python3 scripts/live-upstream-tui.py
```

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
