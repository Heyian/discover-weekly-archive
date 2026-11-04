# Spicetify v3 platform notes

Verified facts about how the Spicetify v3 CLI, module loader and stdlib behave. Each section names
the version it was checked against and the source that proves it. When the installed version is
newer (`spicetify --version`, `Spicetify.Modules.list()`), re-read the cited source before relying on
the fact, then update the section.

Last full check: 2026-11-04 — Spotify 1.3.4.258, CLI 3.0.0-rc.3, stdlib 1.13.2, manager 1.5.1,
kit 0.4.4. Only the sections this module relies on are kept. The starting facts came from
`Heyian/track-playlist-preview`'s
[platform notes](https://github.com/Heyian/track-playlist-preview/blob/main/docs/spicetify-v3-platform.md)
(checked on CLI 3.0.0-beta.19, Spotify 1.2.96, kit 0.3.1), and each was re-read here.

Probes run over the DevTools Protocol with `node scripts/cdp-eval.mjs '<expression>'` (Spotify
launched with `--remote-debugging-port=8088`).

## Module entry and readiness

Checked 2026-11-04 — Spotify 1.3.4.258, CLI 3.0.0-rc.3, kit 0.4.4.

- `entries.js` is an ES module exporting any of `mixin(transformer, ctx)`, `preload(ctx)`,
  `load(ctx)`. `preload`/`load` may return a dispose function.
- `ctx` is `{ spotifyVersion, identifier, defer }`; `defer(fn)` pushes `fn` onto the module's
  disposer list.
- Before any `load`, the loader waits up to 15 s for `main` and `Spicetify.Platform`, then for
  `Spicetify.Events.webpackLoaded` within the same 15 s. **On timeout it runs `load()` anyway** and
  logs "client did not come up in time; running module loads anyway". New in rc.3: it then waits up
  to a further 30 s to capture webpack's require before running loads.
- The loader awaits `load()` module by module; an unbounded wait inside it blocks every later
  module. Cap waits.
- `Spicetify.LocalStorage` (`get`, `set`, `remove`, `clear` over `window.localStorage`) is set
  synchronously by the wrapper. `Spicetify.showNotification` is set later by a retry loop once
  `Spicetify.Snackbar` is found, so read it at call time.
- New in rc.3: an unhandled rejection whose stack mentions `/modules/` is logged ("module code caused
  an unhandled rejection") and suppressed.

Source: installed `/opt/spotify/Apps/xpui/hooks/modularLoader.js` (generated payload of CLI
3.0.0-rc.3; `we(15e3)`, `be(3e4)`, `runLoads`); `/opt/spotify/Apps/xpui/hooks/spicetifyWrapper.js`
(`Spicetify.LocalStorage=`, `Spicetify.showNotification=`); CDP probe of
`Spicetify.LocalStorage` and `Spicetify.showNotification`.

## Unload, enable and reload

Checked 2026-11-04 — Spotify 1.3.4.258, CLI 3.0.0-rc.3.

- **Disposers.** Each module has one disposer list, which `unload()` runs in **reverse order** of
  registration. Each disposer is awaited inside its own `try/catch`: a failure is logged
  ("error unloading …") and the rest still run. Registration order: preload's `ctx.defer`s,
  preload's return value, the `entries.css` disposer, load's `ctx.defer`s, load's return value.
  New in rc.3: `unload(id)` first unloads loaded modules that depend on `id`.
- `Spicetify.Modules.disable(id)` records the module as disabled and unloads it; `reload(id)` is
  unload then enable. Quitting Spotify runs no disposer.
- **Enable does not re-import.** The loader caches the module namespace; `enable()` runs
  `preload`/`load` again on the cached object, so module-scope state survives disable → enable.
- **Partial load leaks.** If `load()` throws, the disposers it already registered never run (boot:
  the module is marked failed; `enable`: it returns `false`). `unload()` returns early when the
  module is not loaded. A module must undo its own partial work before re-throwing. The one
  exception, new in rc.3: at boot, a load that fails with "Failed to fetch" has its disposers run
  and is retried once.

Source: installed `/opt/spotify/Apps/xpui/hooks/modularLoader.js` (`runLoads`, `enable`,
`unload`, `reload`).

## Settings page

Checked 2026-11-04 — Spotify 1.3.4.258, CLI 3.0.0-rc.3, stdlib 1.13.2, manager 1.5.1.

- stdlib serves the **Spicetify Settings** page at `/bespoke/settings` (`SPICETIFY_SETTINGS_ROUTE`):
  registered `settingsSection` items, then the CORS proxy section, then `settingsAction` items.
- The `manager` module adds the profile-menu item **Spicetify Settings**, which pushes that route.
- Module-wide settings belong on this page (`settingsSection`).

Source: `~/.config/spicetify/store/stdlib/1.13.2/src/registers/settingsSection.js`;
`~/.config/spicetify/store/manager/1.5.1/index.js` (`SpicetifyMenuItem`); CDP probe of
`(await import(location.origin + "/modules/stdlib/mod.js")).SPICETIFY_SETTINGS_ROUTE`.

## stdlib surface

Checked 2026-11-04 — Spotify 1.3.4.258, CLI 3.0.0-rc.3, stdlib 1.13.2.

- Public import paths: `/modules/stdlib/mod.js` and `/modules/stdlib/lib/primitives.js`. Imports of
  `stdlib/src/*` are private.
- `createRegistrar(ctx)` returns a registrar whose `dispose()` is registered with `ctx.defer`, so
  everything registered through it is removed when the module unloads.
- stdlib's `React` export is the client's React (`createElement` is identical to
  `Spicetify.React.createElement`).
- `createStorage(ctx)` prefixes keys as `module:<identifier>:<key>`.
- TypeScript never matches `declare module "/modules/stdlib/mod.js"`, because it treats a name that
  starts with `/` as a relative path. Declare `"*/modules/stdlib/mod.js"` instead.
- Between stdlib 1.13.0 and 1.13.2, `src/registers/index.js`, `settingsSection.js` and `storage.js`
  are unchanged.

Source: `~/.config/spicetify/store/stdlib/1.13.2/{mod.js,src/registers/index.js,src/storage.js}`;
`diff -rq` against `1.13.0`; CDP probe of `(await import(location.origin + "/modules/stdlib/mod.js"))`.

## Module store and packaging

Checked 2026-11-04 — CLI 3.0.0-rc.3, kit 0.4.4.

- **`authors` must be strings.** The CLI deserializes `metadata.json` as
  `ModuleMetadata { authors: Vec<String> }`. An object author fails the parse, and `apply` skips the
  whole module (`skipping module <id>: unreadable metadata`).
- **Declare neither `tags` nor `kind`.** This repo keeps the track-playlist-preview rule. Kit 0.4.4's
  `vault-metadata.js` (`kindOfMeta`) now derives a store `kind` from `kind` or legacy `tags`; the
  publish action and validator were not re-checked end to end, so neither field is declared.
- **The `spicetify-module.json` sidecar is only a marker.** The CLI skips it when staging
  (`SKIPPED_FILES`).
- **Kit 0.4.4** (no breaking change found against 0.3.1; there is no changelog, so this comes from
  reading `dist/build.js` and a real build):
  - `spicetify-kit build src --out <dir>` still writes `<out>/<name>@<version>/`; the sidecar is
    still `spicetify-module.json` (`installed_version`, `classmap_base`, `allow_stale`).
  - Rewrites `react` → `/modules/stdlib/src/expose/react-shim.js`, `react/jsx-runtime` →
    `.../jsx-runtime.js`, `react-dom` and `react-dom/client` → `.../react-dom-shim.js`;
    `react-dom/server` → esm.sh (external).
  - The classmap resolves from vendored `vendor/classmaps/<key>` (works offline). New flags:
    `--classmap`, `--refresh`, `--no-check`, `--watch`. It still writes `src/classmap.d.ts` every
    build.
  - An error-tier check finding aborts the build. Sass is compiled only if `src/index.scss` (or
    `index.css`) exists; otherwise no CSS is emitted. Single-entry builds use
    `codeSplitting: false`; a `src/mod.ts` barrel becomes a second entry. `assets/`, `public/` and
    `color.ini` are copied.
  - `check.js` has no limit on the metadata description's length.
  - Still requires Node ≥ 22.6. Under Bun, sass fails with `Invalid protobuf`.

Source: `~/DEV/spicetify/cli` (workspace version `3.0.0-rc.3`)
`rust/crates/spicetify/src/module/stage.rs` (l.24, l.39, l.443);
`node_modules/@spicetify/kit/dist/{build,check,vault-metadata}.js` and `README.md`; a
`bun run build:local` run.

## Discover Weekly Archive findings

Every item: checked 2026-11-04 — Spotify 1.3.4.258, CLI 3.0.0-rc.3, kit 0.4.4 (stdlib 1.13.2).
Source for code facts: `/opt/spotify/Apps/xpui/xpui-modules.js` and the prototypes read over CDP
(`String(Object.getPrototypeOf(Spicetify.Platform.RootlistAPI).<method>)`). Live facts come from
CDP probes on the user's account; write probes used only throwaway `DWA test <timestamp>`
playlists, each deleted in a `finally`.

### Readiness globals

- The adapters need `Spicetify.Platform.RootlistAPI`, `Spicetify.Platform.PlaylistAPI` and
  `Spicetify.Platform.username` (a plain string, the account username; `Platform.initialUser.username`
  holds the same). All are properties of `Spicetify.Platform` itself.
- `Spicetify.LocalStorage` is ready before any module code runs. `Spicetify.showNotification`
  arrives later (see Module entry and readiness); the notifications adapter reads it at call time.

Source: CDP `Object.keys(Spicetify.Platform)`, `Spicetify.Platform.username`.

### `RootlistAPI.getContents()` — Rootlist and folder shapes (item 1)

- Takes no argument and returns the whole tree at once: a root folder
  `{ type: "folder", addedAt, items, name: "<root>", uri: "spotify:user:<username>:folder:0000000000000000", totalItemCount }`.
  `totalItemCount` was `0` live; do not use it.
- A folder is `{ type: "folder", addedAt, items, name, uri }`; `items` holds playlists and nested
  folders in library order.
- A playlist is `{ type: "playlist", uri, name, owner, isOwnedBySelf, canAdd, canRemove,
  canEditItems, canEditMetadata, formatListData, totalLength, madeFor, isSaved, … }`.
- A playlist the server reports missing or forbidden becomes
  `{ type: "placeholder", uri, addedAt, isNotFound, isForbidden }`: no `name`, no `owner`. Skip it.
- Discover Weekly live:
  `name: "Discover Weekly"`, `uri: "spotify:playlist:<id>"` (per account),
  `owner: { type: "user", uri: "spotify:user:spotify", username: "spotify", displayName: "Spotify", images: [] }`,
  `isOwnedBySelf: false`, `canAdd: false`, `canEditItems: false`, `totalLength: 30`,
  `madeFor: null`, `isSaved: false`.
- **Not saved → not listed.** The tree is built only from the rootlist service's `data.root`
  (`_rootlistDataClient.get`); nothing adds Discover Weekly to it. An unsaved Discover Weekly is
  absent, which gives `source-missing`. Answered from the code, not by unsaving.
- `isSaved` is not requested by the Rootlist's decoration policy, so it reads `false` even for
  saved items. Do not use it. `madeFor` is also `null` in the Rootlist (it is set only by
  `PlaylistAPI.getMetadata`).

### Spotify-owner test

- `owner.username === "spotify"` (equivalently `owner.uri === "spotify:user:spotify"`). `owner.type`
  is `"user"` for every playlist, Spotify's included, so it tells nothing. Live, all 18
  Spotify-made playlists in the library (Discover Weekly, Release Radar, Your Top Songs, editorial)
  matched.

### Current-user ownership and the edit flag (item 6)

- **Owns:** `isOwnedBySelf === true`. It agreed with `owner.username === Spicetify.Platform.username`
  on all 88 playlists live. Use `isOwnedBySelf`; the username comparison is the equivalent fallback.
- **Can edit: use `canAdd`, not `canEditItems`.** In the Rootlist, `canEditItems` and
  `canEditMetadata` are always `false`: they come from `userCapabilities`, which the Rootlist
  mapper never receives. `canAdd` (`allows.canInsert`) and `canRemove` (`allows.canRemove`) are
  requested and are `true` on all 66 of the user's own playlists and on a freshly created one.
  `PlaylistAPI.getMetadata(uri)` does return a real `canEditItems` (`true` for an owned playlist),
  but it costs one call per playlist.
- Adapter: `ownedByUser = item.isOwnedBySelf === true`, `canEdit = item.canAdd === true`.

### Language-independent and own-Discover-Weekly fields (item 2)

- **Language-independent:** `formatListData.type === "discover-weekly"` on the Rootlist item (and in
  `getMetadata`). Other values seen: `release-radar`, `inspiredby-mix`, `editorial`,
  `format-shows-shuffle`, `wrapped-<year>-top100`, `""` for user playlists. Recorded only; the
  design does not use it (the user decides).
- **Own vs followed:** `formatListData.attributes["madeFor.username"]`. On the user's Discover
  Weekly it is the account username, equal to `Spicetify.Platform.username`. `getMetadata` also returns
  `madeFor.username` with the same value, but the Rootlist's `madeFor` is `null`. A followed
  friend's Discover Weekly was not available to probe; that it would carry the friend's username
  is inferred from the field's name and its values on the 14 playlists that carry it.
- The attribute also appears on non-Discover-Weekly playlists (editorial ones carry the listener's
  username), so it narrows only the name and owner match; it does not identify Discover Weekly
  alone.
- Adapter: `const mf = item.formatListData?.attributes?.["madeFor.username"];`
  `isOwnDiscoverWeekly = typeof mf === "string" && mf !== "" ? mf === Spicetify.Platform.username : null`.

### `PlaylistAPI.getContents(uri, opts)` — shape and paging (item 3)

- Returns `{ items, offset, limit, totalLength }`. Each item has `uri`, `uid`, `type` (`"track"`
  for songs), `name`, `isPlayable`, `addedAt`, … Track URIs are `spotify:track:…`.
- `offset` in the result is always `0` and `limit` is the number of items returned, whatever was
  asked; use only `items.length` and `totalLength`.
- No `opts` returns every item: 30/30 on Discover Weekly, 269/269 and 431/431 on larger playlists.
- `{ limit: n }` caps the result at `n`. `{ offset, limit }` pages correctly: pages of 100 over 269
  items and pages of 7 over Discover Weekly gave every item once, in order. **`{ offset }` without
  `limit` returns no items.** Always pass both.
- Paging scheme: request `{ offset, limit: PAGE }` and stop when a page returns fewer than `PAGE`
  items or the running count reaches `totalLength`.
- Items with `isPlayable: false` are returned (3 of 269 live). Recommendation rows are excluded by
  default (`includeRecommendations` unset adds a `NOT_RECOMMENDATION` filter).

### `PlaylistAPI.add(uri, uris, location, options?)` — shape and batch limit (item 4)

- Signature `add(playlistUri, uris, location, { silent?, sourceContext?, saveSource? })`.
  `location` is `{ after: "end" }` to append (stdlib's `storage.js` uses the same shape),
  `{ before: "start" }`, or `{ before | after: { uri } | { uid } }`.
- `location` is required: without it the call throws
  `TypeError: Cannot destructure property 'before' of 'e' as it is undefined.` (live).
- `{ after: "end" }` appends in the given order (live: `[A]` then `[B, C]` gave `A, B, C`). It
  resolves `undefined`.
- **Batch limit: none found up to 500.** Single calls of 100, 101, 250 and 500 URIs each succeeded
  and `totalLength` grew by exactly that count (954 total). The batches repeated Discover Weekly's
  30 public track URIs; duplicates are accepted. `ADD_BATCH_SIZE` stays `100`.
- **Non-editable playlist (from the code only, not probed):** there is no client-side check of
  `canAdd`. The call sends a playlist `modify` request; a non-2xx status throws
  `Error(status.reason ?? "Unknown error!")`, and `add` re-throws after emitting the failure. The
  adapter must not rely on that: resolution already requires `canAdd`.
- If an event listener cancels the operation (`emitAddSync` returns `defaultPrevented`), `add`
  resolves without adding anything.

### `RootlistAPI.createPlaylist(name, location, options?)` (item 5)

- `location` uses the same shape as `add`. `{ before: "start" }` (what the client's own "Create
  playlist" passes) puts the playlist first in the root; `{ after: "end" }` puts it last in the
  root (live: index 0, resp. index 41 of 42 root items, outside every folder).
- Returns the new URI as a string (`spotify:playlist:…`). Owned, `canAdd: true`, `totalLength: 0`.
- **It never throws; on any failure it returns `null`.** Without `location` it returns `null` and
  creates nothing (live). The adapter must treat `null` as an error.
- `options` (third argument) is passed only to the create events.

### Deleting a playlist (probe cleanup)

- `RootlistAPI.remove([{ uri }])` — the client's own "Delete" confirm dialog calls the same thing
  (`xpui-root-dialogs.js` → the library-toggle hook → `RootlistAPI.remove([{ uri }])` in
  `xpui-modules.js`). Spotify has no hard
  delete: removing an owned playlist from the library is the delete.
- `remove` swallows errors (it emits a failure event and resolves). Confirm by re-reading
  `getContents()` or `RootlistAPI.contains([uri])` (live: `[false]` right after the call).

Source: three CDP write probes on `DWA test <timestamp>` playlists (create → delete; create →
add batches → delete; create without `location`), each confirmed deleted afterwards.
