# Upstream compatibility

This plugin needs both [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) with its DSH backend. Official Harness alone is not enough. GitHub Releases are the only upstream release source.

Results below are Linux x86_64 only. They say nothing about macOS Trash.

## Verified pair

dsh-TUI `v0.17.0` names Harness `0.2.1-rc.3` as `UPSTREAM_VALIDATED_VERSION` in `src/dsh-adapter/contract.ts` on commit `103834cb1000a84569a71646fec7162f18a058c8`. That list ends at `0.2.1-rc.3`. Harness `0.2.1-rc.4` and `0.2.2-alpha.2` are newer releases and are outside that list. The live checks below use only the named pair.

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

Bootstrap attempt against the newest published Harness release. That pair is not the line dsh-TUI `v0.17.0` validates. It is not a regression against the verified pair above. The verified pair was recorded after this attempt.

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
