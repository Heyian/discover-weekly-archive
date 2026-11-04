# CLAUDE.md

A [Spicetify](https://spicetify.app) v3 **module** that copies the user's Discover Weekly into a
"Discover Weekly Archive" playlist, adding only songs not already there. Published to the
Spicetify module store.

## Commands

```bash
bun install          # install dependencies
bun run build        # build into <config>/modules/discover-weekly-archive/
bun run build:local  # build into ./dist/discover-weekly-archive@<version>/, without installing
bun run watch        # rebuild on change
bun run check        # typecheck + tests — the full quality gate
bun run check:dist   # check the build:local folder; add --tag <tag> to also check release metadata
bun run test         # vitest only
bun run typecheck    # tsc --noEmit only
spicetify apply      # required after any build; restarts Spotify
```

There is no linter. `bun run check` is the whole gate.

Commit subjects start with a Conventional Commit prefix (`feat:`, `fix:`, `docs:`, `chore:`,
`test:`, `refactor:`, `ci:`, `build:`) — release-please reads them to pick the version.

## Documentation

- [Design spec](docs/specs/2026-11-04-discover-weekly-archive-design.md) — decisions, acceptance
  criteria, Live verification rules.
- [Implementation plan](docs/superpowers/plans/2026-11-04-discover-weekly-archive.md)
- [Spicetify v3 platform notes](docs/spicetify-v3-platform.md) — read before relying on how the
  CLI, loader or stdlib behave, and for the Live-verified API findings. Record new findings there.
- [README](README.md) — install, settings, build from source.

## Build

- `build.ts` runs `spicetify-kit build src` (`@spicetify/kit`, pinned) **under Node ≥ 22**, then
  copies the result into the modules folder (`build`, `watch`) or `dist/` (`build:local`, the
  folder releases zip). Tooling and release follow `~/DEV/spicetify/track-playlist-preview`.
- `src/metadata.json` is the only source of module metadata.
- Kit does **not** typecheck. A green build says nothing about types — run `bun run check`.
- Kit warns `stdlib-boundary.ambient-client` on `src/index.ts`, `src/platform/*` and
  `src/ui/notifications.ts`. Expected: those files are the only ones allowed to read `Spicetify`.

## Architecture

The core (`archiveRun`, `resolve`, `scheduler`, `notices`, `storage`) is pure and receives ports by
injection. Adapters over `Spicetify.Platform` live in `src/platform/` (`library`, `playlist`);
`src/index.ts` wires everything in `load(ctx)`, and `src/ui/` holds the Settings section and
toasts.

## Non-obvious constraints

Load-bearing; violating any is a defect. Rationale is in the spec.

- **Only `src/ui/settingsSection.tsx` imports `/modules/stdlib/`** (plus the ambient
  `src/types/stdlib.d.ts`).
- **Only `src/index.ts`, `src/platform/*` and `src/ui/notifications.ts` read a `Spicetify` global;**
  only `src/platform/*` reads `Spicetify.Platform`.
- **Never copy a GraphQL `sha256Hash` or an `e-<digits>` encore class into source.**
- **Account safety (spec Q6).** Probes and dev runs use the user's real account.
  - Probes that write create `DWA test <timestamp>` playlists and delete them in a `finally`.
  - Never unsave, edit or reorder an existing playlist, or write to the real archive.
  - During development the `discover-weekly-archive:archiveUri` storage key must point at the
    `DWA dev` playlist. Re-check it after any storage reset. Pointing it back is the user's step.
- **Dedupe by track URI only** — never by name or artist.
- **Live-verified facts the adapters rely on** (details in the platform notes):
  - The edit flag on a Rootlist item is `canAdd`, not `canEditItems` (always false there).
  - The user's own Discover Weekly is told apart by `formatListData.attributes["madeFor.username"]`.
  - `RootlistAPI.createPlaylist` returns `null` on failure; treat it as an error.
  - `PlaylistAPI.add` needs `{ after: "end" }`; without a location it throws.
  - `PlaylistAPI.getContents` needs both `offset` and `limit`; `offset` alone returns nothing.
- **Detection is by playlist name.** The user declined the language-independent
  `formatListData.type === "discover-weekly"` lookup (2026-11-04). Do not add it unasked.

## Debugging against the live client

Spotify is built on Chromium (CEF) and exposes the Chrome DevTools Protocol on `127.0.0.1:8088`
when launched with `--remote-debugging-port=8088`. Driving `Runtime.evaluate` over that socket is
much faster than clicking through the UI.

`spicetify apply` restarts Spotify without the debug port. After each apply, relaunch it:
`pkill -x spotify; sleep 3; setsid /opt/spotify/spotify --remote-debugging-port=8088 >/dev/null 2>&1 &`,
then confirm `curl -s 127.0.0.1:8088/json/version` answers. This interrupts playback.

The committed harness is `scripts/cdp-eval.mjs`:
`node scripts/cdp-eval.mjs 'Spicetify.Platform.username'`.

- `Spicetify.Modules.report` shows which modules loaded and why any failed;
  `Spicetify.Modules.list()` shows the loaded version.
- A probe that registers UI or creates a playlist must clean up in a `finally`.
