<div align="center">

# dsh-session-cleanup

`/nix` for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), requiring [**dsh-TUI**](https://github.com/ccch1mneyyy/dsh-TUI) by ccch1mneyyy.

[![npm](https://img.shields.io/npm/v/dsh-session-cleanup.svg)](https://www.npmjs.com/package/dsh-session-cleanup)
[![GitHub release](https://img.shields.io/github/v/release/hyein-cbio/dsh-session-cleanup.svg)](https://github.com/hyein-cbio/dsh-session-cleanup/releases/latest)

Inspired by [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup).

</div>

Latest plugin release is **0.3.1** on [npm](https://www.npmjs.com/package/dsh-session-cleanup/v/0.3.1) and [GitHub](https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.3.1). It fixes the closed-writer cleanup regression in `0.3.0`. See [CHANGELOG.md](CHANGELOG.md).

## What this is

A **DSH plugin** for **[ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) only**, using its **DSH backend**. It does not list sessions and it does not replace `/resume`.

**Runtime requirement:** the third-party `@deepseek-harness-tui/dsh-tui` package must be installed in the `dsh-tui` profile. This plugin relies on its TUI services and live session switch; official DeepSeek Harness alone is not sufficient.

`pi-tui`, the web profile, and dsh-TUI's Claude/Codex backends are not supported.

On DSH it:

- **`/nix`** — deletes the current session, starts a new one, and switches the live view to it
- **`/nix quit`** — deletes the current session and exits DSH

Deletion is the whole session directory under `~/.dsh/sessions/<workspace>/` (`session-<uuid>` or `<uuid>`), including its `session.vN.jsonl.zstd` log and `session.lock`. There is no separate sidecar. After dsh-tui has switched away, the previous session is stopped and flushed, the directory goes to **Trash on macOS** (`rm -rf` elsewhere), and only after removal is verified is the live session detached and projection cache and workspace accounting cleared, including that session's entries in `archivedSessionIds` and `pinnedSessionIds`.

dsh-tui's `/new` and `/resume` delete keep the previous log. `/nix` is the destructive counterpart.

## Installation

First install DeepSeek Harness and [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI#quick-start) following dsh-TUI's setup instructions. This package does not install dsh-TUI automatically.

**Use plugin `0.3.1` or later.** It includes the startup-order and safety fixes and handles an old writer closing during `/nix`. Version `0.3.0` can start a new session without deleting the previous one because of that closed-writer race; `0.2.2` lacks the startup-order and safety fixes.

Ensure the required TUI package is installed in the same profile, then install this release:

```bash
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui
dsh plugin --profile dsh-tui add dsh-session-cleanup@0.3.1
```

Alternatively, from the root of this repository, build and install the local plugin:

```bash
npm ci
npm run build
dsh plugin --profile dsh-tui add "file:$PWD"
```

Restart the profile. Confirm it loaded:

```bash
dsh --profile dsh-tui --dump-config | grep session-cleanup
dsh --profile dsh-tui
```

## Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `/nix` | — | Delete the current session, start a new one, switch the live view |
| `/nix quit` | — | Delete the current session and exit DSH |
| `/nix help` | — | Usage |

Both destructive commands require explicit confirmation through `userQuestions` (dsh-tui supplies it). If the service is absent or the request is aborted, nothing is deleted.

`/nix` needs dsh-tui's scene switch (`channel.newSession()`). The plugin now waits for both `commands` and `tuiScenes` before activating, so the scene and command share the same Cordis owner even when the TUI starts later. Other profiles are unsupported and do not get `/nix`; `/nix quit` is also a command of the supported TUI profile. If a live switch is refused, the old session is not deleted.

## Safety

1. **Confirm before delete**
2. **Switch first** — `/nix` starts and adopts the new session before the old directory is removed
3. **macOS Trash** for session directories; other platforms permanently remove them
4. **Cleanup order** — disk/log removal is confirmed before workspace accounting is stripped
5. **Both id spellings** — `<uuid>` and `session-<uuid>`
6. **Fail closed** — scan/access, stop, and flush errors refuse deletion. A failed removal does not detach the live session or clear its cache/workspace references. Removal is not atomic across multiple files/directories; an error may follow a partial removal, which is reported as incomplete rather than “deleted nothing”.
7. **Bounded waits** — Trash providers receive TERM then KILL; unconfirmed termination stops fallback. The switch deadline covers the entire host call. Aborted/timed-out/disposed switches never authorize deletion. The host has no switch cancellation API, so a late view switch can still finish without deleting the old session; another nix operation is refused until it settles.

Version `0.3.1` retains fail-closed cleanup. Only the target session's `SessionHandleClosedError` is recovered through the host persistence barrier; an ordinary flush error or a failed barrier still refuses deletion. The complete CI matrix below verifies the fixed runtime.

## Development

```bash
npm ci           # install TypeScript and Node.js types only
npm run build    # emit lib/dsh-entry.js for DSH
npm run test     # test suite
npm run check    # build + TypeScript/Python tests
```

CI follows [pi-codemode-bench](https://github.com/hyein-cbio/pi-codemode-bench): [GitHub Actions](.github/workflows/ci.yml) dispatches Ubuntu checks to credential-free Modal Sandboxes; [CircleCI](.circleci/config.yml) runs macOS checks on managed Apple silicon VMs. No self-hosted runner is needed. One Modal app owns all four Ubuntu Sandbox cells per CI run (at most two concurrently), rather than creating an app for each cell. Both providers retain Node 22/24 package checks and the two pinned source-built upstream PTY cells, with failure evidence. See [CI setup and security](docs/CI.md) for secrets, event policy, CircleCI pipeline configuration and local validation. Package checks or valid YAML alone do not establish cloud compatibility.

Upstream compatibility records live in [TESTING.md](TESTING.md). Harness `0.2.1-rc.5` with released dsh-TUI `v0.18.0` has hosted Linux/macOS verification.

| DSH source | dsh-TUI source | Hosted CI evidence |
| --- | --- | --- |
| `0.2.1-rc.5` | Released `v0.18.0`, `1d0d946f` | Self-hosted macOS ARM64 **33/33**, Ubuntu x86_64 **32/32** |
| `0.2.2-rc.1` | Final PR #1886 merge, `e7336a62` | Self-hosted macOS ARM64 **33/33**, Ubuntu x86_64 **32/32** |

[CI run 42270528944](https://github.com/hyein-cbio/dsh-session-cleanup/actions/runs/42270528944) passed **all eight jobs** on runtime commit `4c1ccd8`, package version `0.3.1`, with zero live failures or skips. Package checks passed 73 TypeScript and 41 Python tests on both operating systems and both Node versions. Release preparation changes documentation only. Earlier failures and compatibility results remain historical records in [TESTING.md](TESTING.md).

Exact source commits matter: released TUI `v0.18.0`, candidate `fb0b5325`, and final merge `e7336a62` all report package version `0.18.0` but differ in source. Published TUI `v0.19.0` (`224f847d`) with Harness `0.2.2-rc.1` (`66491b05`) is the line that TUI commit names as `UPSTREAM_VALIDATED_VERSION`. On 2026-11-07 that pair was verified again on Linux x86_64, Node `24.22.1`, plugin `386e238` / package `0.3.1`: 32/32 live PTY assertions, plus early and late Cordis lifecycle checks. The cell is not in the CI matrix. macOS Trash was not retested for `v0.19.0`. DSH `0.2.2-rc.1` requires Node **>=24.9.0**. See [TESTING.md](TESTING.md).

Native DSH entry: `dsh-entry.ts` → `lib/dsh-entry.js`. This package has no npm runtime dependencies; the DSH host supplies the required services.

## Attribution

The `/nix` idea comes from [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup) (MIT © MasuRii). The DSH port uses [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) persistence and workspace accounting, and depends on [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) for the TUI services and live session switch.

## License

[MIT](LICENSE)
