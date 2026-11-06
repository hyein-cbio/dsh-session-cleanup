# Changelog

Current DSH release is **0.3.0**
([GitHub](https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.3.0) ·
[npm](https://www.npmjs.com/package/dsh-session-cleanup/v/0.3.0)).

Versions **0.1.0 and later** are `dsh-session-cleanup`. The **1.x** entries at the bottom are inherited from [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup) and are not DSH releases.

## [0.3.0] - 2026-11-06

### Compatibility verification
Historical live results below predate the safety changes in this release. Version `0.3.0` passed 71 TypeScript and 40 Python regression tests on Node `22.23.4` and `26.13.0`, plus real cached upstream SessionStore and TUI lifecycle checks. The complete live PTY suite for TUI `v0.19.0` was not rerun for `0.3.0`; no new hosted/live compatibility pass is claimed.

- Verified on Linux with published dsh-TUI `v0.19.0` (`224f847d02c2157f43862d2792cf9d7459222f4c`) and the Harness line that commit names, `0.2.2-rc.1` (`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`). `UPSTREAM_VALIDATED_VERSION` is `0.2.2-rc.1`. Live `/nix` and `/nix quit` checks passed. No newer Harness GitHub release was published. `dsh-v0.2.2-alpha.2` and `dsh-v0.2.2-alpha.3` are outside that TUI's supported set and were not tested. macOS Trash was not tested for this pair. This cell is not the final-merge CI pin. See [TESTING.md](TESTING.md).
- Pin the new DSH `0.2.2-rc.1` CI cell to final TUI PR #1886 merge `e7336a62`, retaining the old supported pair and historical candidate pin.
- Check foreign scene-owner refusal across reload; run the final adapter's projection and model lifecycle regressions before real PTY checks. Use the tsx ESM loader for native/host build sources without its CLI IPC socket.
- Record hosted Linux 32/32 real PTY passes for both old and final-merge pairs, final adapter lifecycle 113 checks and model-selection 21 scenarios, and still-queued macOS jobs. Preserve full reports/deletion traces and distinguish the separate TUI `v0.19.0` release. Those historical compatibility checks changed no plugin runtime and performed no release; this release separately includes the safety fixes below.

### Fixed
- Preserve live session attachments, projection cache, pins and workspace references when session-file removal fails. Treat scan/access errors as failures, and refuse deletion after stop/idle/flush failures.
- Bound Trash provider termination with TERM/KILL escalation; do not race a fallback when termination is unconfirmed. Verify actual removal even after a provider exits zero.
- Apply the nix deadline to the full switch operation; handle abort, scene unmount and plugin disposal, isolate jobs by activation, and ignore late success for deletion. Serialize destructive nix commands while a switch is settling.
- Require explicit confirmation even when the questions service is absent; keep picker label identities stable while the user answers.
- Exit forked PTY children with status 127 on setup/exec failure without unwinding the parent's copied Python stack.
- Publish the startup-order and safety fixes together as `0.3.0`; update the installation instructions to select that version rather than the unfixed `0.2.2` artifact.
- Declare `tuiScenes` as a required Cordis service alongside `commands`. Startup now waits for the TUI and registers/opens the `/nix` switch scene from the same activation, rather than registering it in a delayed child activation that the command cannot own.
- Report a refused scene as missing **or owned by another activation**, rather than always claiming it was unregistered.
- Canonicalize live-test sandbox paths so macOS `/tmp` aliases cannot hide real deletion from the observer.

### Testing
- Add real Cordis/TUI lifecycle checks for early/late TUI startup, service removal/reload, and plugin disposal; add filesystem-preservation regression coverage for refused switches.
- Share two exact upstream source pins between preparation, live-test preflight, and CI. Package CI covers Node 22/24; live CI selects the old validated pair on Node 22 and the TUI PR #1886 candidate with DSH `0.2.2-rc.1` on Node 24, on Linux/macOS.
- Local macOS ARM64 live checks pass **33/33** on both pairs. The new pair uses an unreleased TUI candidate, not released TUI `v0.18.0`. No new hosted CI success or blanket DSH `0.2.2` support is claimed. See [TESTING.md](TESTING.md).

## [0.2.2] - 2026-11-02

### Fixed
- Session deletion completes even when the event loop has no other pending work.
- Upstream CI discovers packed tarballs dynamically and validates installed versions against source manifests.
- Deleting a session removes its id from workspace `pinnedSessionIds` as well as `archivedSessionIds`. Other pinned and archived ids stay.

### Compatibility
- Verified on Linux with dsh-TUI `v0.18.0` (`1d0d946f459da5149aba64cc6cc0ef7da304053c`) and the Harness line that commit names, `0.2.1-rc.5` (`b830ec950faba0a46dda564be3e2d854afed94f1`). `UPSTREAM_VALIDATED_VERSION` is `0.2.1-rc.5`. Live `/nix` and `/nix quit` checks passed. Harness `dsh-v0.2.2-alpha.2` is outside that TUI's supported set and was not tested. See [TESTING.md](TESTING.md).
- Verified on Linux with dsh-TUI `v0.17.0` (`103834cb1000a84569a71646fec7162f18a058c8`) and the Harness line that commit names, `0.2.1-rc.3` (`1f81c047fc48fa190a683e469daa699857e9afe8`). Live `/nix` and `/nix quit` checks passed. See [TESTING.md](TESTING.md).
- DeepSeek Harness `dsh-v0.2.2-alpha.2` (`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`) with that dsh-TUI `v0.17.0` commit is **not supported**. The host rejects the TUI checkout before anything is installed. macOS Trash behavior was not tested.

### Added
- Linux and macOS package checks and source-built live upstream PTY checks in GitHub Actions.

### Removed
- Legacy Pi/agent code, configuration, and npm runtime dependencies. The package exposes only the native DSH entry and requires dsh-TUI with its DSH backend.

## [0.2.1] - 2026-10-18

### Removed
- Stopped looking for a `~/.dsh/pi2dsh` sidecar. This plugin is not based on pi2dsh. Deletion is the session directory under `~/.dsh/sessions`.

### Changed
- Docs and fixtures name the current log `session.vN.jsonl.zstd` (this host writes `session.v4.jsonl.zstd`), not `session.jsonl.zstd`.

## [0.2.0] - 2026-09-12

### Changed
- Dropped the `pi-package`, `pi-extension`, and `pi` npm keywords so this DSH plugin is not scraped as a Pi package on pi.dev.
- Narrowed the DSH plugin to `/nix` and `/nix quit`. `/session-cleanup` and `/nix agent` are no longer registered.
- `/nix` now starts the new session through dsh-tui's live switch (`channel.newSession()`), then deletes the previous session. The live view follows the new session.
- Session deletion no longer calls `sessionPersistence.listSnapshots()` / `locate()`, which 0.1.5 removed from the public persistence API.

### Removed
- Interactive `/session-cleanup` listing and `/nix agent` from the native DSH command surface.
- `pi-tui` profile support. This plugin targets `dsh-tui` only, and no longer ships a Pi `extensions` entry.

## [0.1.1] - 2026-08-20

### Changed
- Document support for both the `pi-tui` and `dsh-tui` profiles.

## [0.1.0] - 2026-08-19

First DSH release. This is a port of [pi-session-cleanup](https://github.com/MasuRii/pi-session-cleanup), not a continuation of that package's 1.x line.

### Added
- Native DSH plugin (`apply`/`inject`/`name`) that lists sessions through `sessionPersistence.listSnapshots()` + `locate()` and deletes them with the host cleanup chain: stop/flush/detach, remove the session directory and sidecar (**Trash on macOS**, `rm -rf` elsewhere), then clear projection cache and workspace accounting.
- Ship a compiled `lib/dsh-entry.js` so DSH can load the plugin from `node_modules` (Node will not strip TypeScript there).
- `/session-cleanup delete <id...>` for explicit DSH deletions, plus a user-questions multi-select flow when that service is mounted.
- Slash-command descriptions include the argument grammar so pi-tui's `/` list shows usage even though the host does not forward `input.hint` as `argumentHint`.
- Native DSH `/nix`, `/nix agent [preset]`, and `/nix quit`: create a new session through `ctx.agents.create` (or `ctx.sessions.create`), delete the current one through the host cleanup chain. `/nix quit` then disposes the root fiber and exits the process, matching pi-tui Ctrl+C/Ctrl+D.

### Fixed
- Restored the documented default `/session-cleanup` behavior: list only orphaned sessions, and accept an explicit `orphaned` scope.
- Fall back to the basic selector when `ctx.ui.custom()` is a no-op (pi2dsh RPC/headless).
- Refuse Pi trash/unlink against DSH `session.jsonl.zstd` artifacts so a mapped path cannot punch a hole in DSH persistence.

### Changed
- Clarify that deletion is the whole session directory and sidecar, not a single `session.jsonl.zstd` file.

## Inherited from pi-session-cleanup

These entries shipped on the original Pi package before the DSH port. They are kept for history only.

## [1.2.0] - 2026-07-03

### Added
- Added an `enabled` master toggle to the session-cleanup config so the extension can be disabled without uninstalling. ([bdc1152](https://github.com/MasuRii/pi-session-cleanup/commit/bdc1152f4f8ac7d89517efbe3ed803fb0d448694))

### Changed
- Widened Pi coding-agent and Pi TUI peer dependency ranges through `^0.80.0` and added a `postinstall` patch with npm `overrides` to resolve known vulnerabilities in transitive dependencies. ([cc8d165](https://github.com/MasuRii/pi-session-cleanup/commit/cc8d1655429c7af07694263b32aff9700d216d8d))
- Extracted shared helpers and TUI picker base modules to deduplicate session-cleanup, nix, agent-target, and selection flows. ([bdc1152](https://github.com/MasuRii/pi-session-cleanup/commit/bdc1152f4f8ac7d89517efbe3ed803fb0d448694))
- Extracted shared test helpers and fixtures across the agent-target and nix-command test suites. ([4feaa99](https://github.com/MasuRii/pi-session-cleanup/commit/4feaa9904081387b0eb154fc27840d5d902a27dc))
- Updated README badge styling and added a ko-fi support button. ([1cdcd93](https://github.com/MasuRii/pi-session-cleanup/commit/1cdcd93f5cf90f45e90b19d8d24cd7f97806dfb1))

## [1.1.4] - 2026-06-16

### Fixed
- Added round-trip date validation for parsed calendar timestamps so invalid dates (e.g., month 13 or day 32) no longer produce false-positive sort keys.

## 1.1.3 - 2026-06-01

- Deferred command module loading for `/session-cleanup` and `/nix` handlers while preserving inline completions.
- Widened Pi coding-agent and Pi TUI peer dependency ranges to include `^0.77.0 || ^0.78.0`.

## 1.1.2 - 2026-05-26

- Widened peer dependency ranges to `^0.74.0 || ^0.75.0`.

## 1.1.1 - 2026-05-22

- Sends session files to available desktop trash providers (`trash`, `trash-put`, `gio trash`, or `kioclient move`) before permanent deletion.
- Warns `/nix quit` users when trash providers are unavailable and requires confirmation before permanent current-session deletion fallback.
- Added coverage for trash-provider selection and `/nix` deletion warning behavior.

## 1.1.0 - 2026-05-04

- Added `/nix quit` for confirmed current-session deletion during graceful Pi shutdown
- Added `/nix agent [name]` for starting fresh sessions with persisted target-agent metadata
- Added `/nix` argument completions, explicit help output, and safer compatibility warnings for unsupported Pi builds
- Documented destructive `/nix` safeguards and added targeted release-readiness coverage for the new session flows

## 1.0.0 - 2026-03-05

- Renamed extension from its previous package name to `pi-session-cleanup`
- Renamed primary command to `/session-cleanup`
- Added a deprecated legacy alias for backward compatibility
- Refactored command/picker module names for clarity
- Upgraded custom picker UI with bordered modal layout, title/status/help lines, and responsive overlay sizing
- Added production-ready package metadata and README

[0.3.0]: https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.3.0
[0.2.2]: https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.2.2
[0.2.1]: https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.2.1
[0.2.0]: https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.2.0
[0.1.1]: https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.1.1
[0.1.0]: https://github.com/hyein-cbio/dsh-session-cleanup/releases/tag/v0.1.0
[1.2.0]: https://github.com/MasuRii/pi-session-cleanup/releases/tag/v1.2.0
[1.1.4]: https://github.com/MasuRii/pi-session-cleanup/releases/tag/v1.1.4
