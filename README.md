<div align="center">

# dsh-session-cleanup

`/nix` for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) on **dsh-tui**.

Inspired by [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup).

</div>

## What this is

A **DSH plugin** for **dsh-tui only**. It does not list sessions and it does not replace `/resume`.

`pi-tui` and the web profile are not supported.

On DSH it:

- **`/nix`** — deletes the current session, starts a new one, and switches the live view to it
- **`/nix quit`** — deletes the current session and exits DSH

Deletion is the whole session directory (and sidecar), not a single `session.jsonl.zstd`. After dsh-tui has switched away, the previous session is stopped/flushed/detached, the directory goes to **Trash on macOS** (`rm -rf` elsewhere), then projection cache and workspace accounting are cleared.

dsh-tui's `/new` and `/resume` delete keep the previous log. `/nix` is the destructive counterpart.

## Installation

```bash
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

`/nix` needs dsh-tui's scene switch (`channel.newSession()`). On any other profile it refuses rather than leaving you on a deleted conversation. Use `/nix quit` to delete and exit.

## Safety

1. **Confirm before delete**
2. **Switch first** — `/nix` starts and adopts the new session before the old directory is removed
3. **macOS Trash** for session directories; other platforms permanently remove them
4. **Cleanup order** — disk/log removal is confirmed before workspace accounting is stripped
5. **Both id spellings** — `<uuid>` and `session-<uuid>`

## Development

```bash
npm run build    # emit lib/dsh-entry.js for DSH
npm run test     # test suite
npm run check    # build + test
```

Native DSH entry: `dsh-entry.ts` → `lib/dsh-entry.js`.

## Attribution

The `/nix` idea comes from [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup) (MIT © MasuRii). The DSH port uses DeepSeek Harness persistence, workspace accounting, and dsh-tui's live session switch.

## License

[MIT](LICENSE)
