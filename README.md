<div align="center">

# dsh-session-cleanup

`/nix` for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), requiring [**dsh-TUI**](https://github.com/ccch1mneyyy/dsh-TUI) by ccch1mneyyy.

[![npm](https://img.shields.io/npm/v/dsh-session-cleanup.svg)](https://www.npmjs.com/package/dsh-session-cleanup)
[![GitHub release](https://img.shields.io/github/v/release/hyein-cbio/dsh-session-cleanup.svg)](https://github.com/hyein-cbio/dsh-session-cleanup/releases/latest)

Inspired by [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup).

</div>

Latest plugin release is **0.2.2** on [npm](https://www.npmjs.com/package/dsh-session-cleanup) and [GitHub](https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.2.2). See [CHANGELOG.md](CHANGELOG.md).

## What this is

A **DSH plugin** for **[ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) only**, using its **DSH backend**. It does not list sessions and it does not replace `/resume`.

**Runtime requirement:** the third-party `@deepseek-harness-tui/dsh-tui` package must be installed in the `dsh-tui` profile. This plugin relies on its TUI services and live session switch; official DeepSeek Harness alone is not sufficient.

`pi-tui`, the web profile, and dsh-TUI's Claude/Codex backends are not supported.

On DSH it:

- **`/nix`** — deletes the current session, starts a new one, and switches the live view to it
- **`/nix quit`** — deletes the current session and exits DSH

Deletion is the whole session directory under `~/.dsh/sessions/<workspace>/` (`session-<uuid>` or `<uuid>`), including its `session.vN.jsonl.zstd` log and `session.lock`. There is no separate sidecar. After dsh-tui has switched away, the previous session is stopped/flushed/detached, the directory goes to **Trash on macOS** (`rm -rf` elsewhere), then projection cache and workspace accounting are cleared, including that session's entries in `archivedSessionIds` and `pinnedSessionIds`.

dsh-tui's `/new` and `/resume` delete keep the previous log. `/nix` is the destructive counterpart.

## Installation

First install DeepSeek Harness and [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI#quick-start) following dsh-TUI's setup instructions. This package does not install dsh-TUI automatically.

Ensure the required TUI package is installed in the same profile, then add this plugin:

```bash
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui
dsh plugin --profile dsh-tui add dsh-session-cleanup
```

From this repo:

```bash
npm run build
dsh plugin --profile dsh-tui add file:$PWD
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

Both destructive commands ask for confirmation when `userQuestions` is mounted (dsh-tui does).

`/nix` needs dsh-tui's scene switch (`channel.newSession()`). The plugin now waits for both `commands` and `tuiScenes` before activating, so the scene and command share the same Cordis owner even when the TUI starts later. Other profiles are unsupported and do not get `/nix`; `/nix quit` is also a command of the supported TUI profile. If a live switch is refused, the old session is not deleted.

## Safety

1. **Confirm before delete**
2. **Switch first** — `/nix` starts and adopts the new session before the old directory is removed
3. **macOS Trash** for session directories; other platforms permanently remove them
4. **Cleanup order** — disk/log removal is confirmed before workspace accounting is stripped
5. **Both id spellings** — `<uuid>` and `session-<uuid>`

## Development

```bash
npm ci           # install TypeScript and Node.js types only
npm run build    # emit lib/dsh-entry.js for DSH
npm run test     # test suite
npm run check    # build + TypeScript/Python tests
```

[GitHub Actions CI](.github/workflows/ci.yml) runs package checks and source-built live PTY checks on Ubuntu and macOS for pull requests, pushes to `main`, and manual runs. Live jobs upload build logs and verification evidence even on failure; package checks alone do not establish upstream compatibility.

Upstream compatibility records live in [TESTING.md](TESTING.md). Harness `0.2.1-rc.5` with released dsh-TUI `v0.18.0` has hosted Linux/macOS verification. The **unreleased plugin fix in this checkout** also passes local macOS ARM64 live checks with that pair on Node `22.23.4` and with Harness `0.2.2-rc.1` plus the historical **TUI PR #1886 candidate** on Node `24.22.1`. CI now pins the final TUI merge `e7336a62` for the new line; its results are recorded separately in `TESTING.md`. The candidate and final merge differ from released TUI `v0.18.0`, despite sharing its package version. TUI `v0.19.0` is a later, separate release commit. DSH `0.2.2-rc.1` requires Node **>=24.9.0**; installing released TUI `v0.18.0` does not establish support for that DSH line. No TUI compatibility gates are bypassed. See the exact source pins, evidence, and limitations in the testing record.

Native DSH entry: `dsh-entry.ts` → `lib/dsh-entry.js`. This package has no npm runtime dependencies; the DSH host supplies the required services.

## Attribution

The `/nix` idea comes from [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup) (MIT © MasuRii). The DSH port uses [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) persistence and workspace accounting, and depends on [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) for the TUI services and live session switch.

## License

[MIT](LICENSE)
