# Changelog

## [Unreleased]

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
