<div align="center">

# dsh-session-cleanup

Interactive session cleanup for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Inspired by [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup), ported to DSH so sessions can be listed and removed through official host services instead of Pi JSONL files.

</div>

## What this is

This is a **DSH plugin**, verified on the `pi-tui` profile. It is inspired by MasuRii's Pi extension, but it is not a drop-in Pi package.

On DSH it:

- lists sessions with `sessionPersistence.listSnapshots()` + `locate()`
- deletes through the host cleanup chain: stop / flush / detach, then the session directory, projection cache, workspace accounting, and pi2dsh sidecar
- sends the session directory to **Trash on macOS**, and uses `rm -rf` on other platforms

It does **not** trash or unlink a single `session.jsonl.zstd` file.

## Installation

```bash
dsh plugin --profile pi-tui add file:/path/to/dsh-session-cleanup
```

The package must ship compiled JS (`lib/dsh-entry.js`). From this repo:

```bash
npm run build
dsh plugin --profile pi-tui add file:$PWD
```

Restart the profile. Confirm it loaded:

```bash
dsh --profile pi-tui --dump-config | grep session-cleanup
dsh --profile pi-tui
```

Currently tested on **`pi-tui`**. Other terminals or the web profile are not guaranteed. The web profile already has a dedicated session-delete plugin.

## Commands

| Command | Arguments | Description |
|---------|-----------|-------------|
| `/session-cleanup` | — | List orphaned sessions (cwd directory is gone) |
| `/session-cleanup orphaned` | — | Same as default |
| `/session-cleanup current` | — | Sessions from the current working directory |
| `/session-cleanup all` | — | All persisted sessions |
| `/session-cleanup delete` | `<id...>` | Delete those session ids after confirmation |
| `/session-cleanup help` | — | Usage |
| `/nix` | — | Create a new DSH session, then delete the current one |
| `/nix agent` | `[preset]` | Same, with a selected or named agent preset |
| `/nix quit` | — | Delete the current session and exit DSH |
| `/nix help` | — | `/nix` usage |

With a `userQuestions` service (pi-tui has one), `/session-cleanup` opens a multi-select + confirm flow. Without one, it prints the list and you delete by id.

`/` autocomplete in pi-tui shows the argument grammar in the command description. After-space completions (`orphaned`, `quit`, …) need a host-side `argumentHint` hook and are not wired yet.

## `/nix` on DSH

`/nix` is destructive and asks for confirmation.

- **`/nix`** creates a new session with `ctx.agents.create` (or `ctx.sessions.create`) using the current cwd and preset, then deletes the previous session.
- **`/nix agent [preset]`** does the same with a DSH agent preset. Without `[preset]`, it opens a picker.
- **`/nix quit`** deletes the current session, disposes the root fiber, and `process.exit(0)`.

DSH has no host-level “current session pointer”. After `/nix`, the TUI may keep showing the old conversation until you resume the new id:

```text
dsh --profile pi-tui --resume <new-id>
```

## Safety

1. **Active session excluded** from the cleanup list
2. **Confirm before delete**
3. **macOS Trash** for session directories; other platforms permanently remove them
4. **Cleanup order** — disk/log removal is confirmed before workspace accounting is stripped
5. **Both id spellings** — `<uuid>` and `session-<uuid>`

## Development

```bash
npm run build    # emit lib/dsh-entry.js for DSH
npm run test     # test suite
npm run check    # build + test
```

Native DSH entry: `dsh-entry.ts` → `lib/dsh-entry.js`. That graph does not import Pi packages.

Stock **pi2dsh** (remote main) is enough for this plugin. A patched pi2dsh is only needed if you load the leftover Pi extension path instead of the native DSH commands.

## Attribution

Command names, scopes, and the `/nix` idea come from [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup) (MIT © MasuRii). The DSH port uses DeepSeek Harness persistence, workspace accounting, and agent presets.

## License

[MIT](LICENSE)
