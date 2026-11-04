# Discover Weekly Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Spicetify v3 module that copies the user's Discover Weekly into a "Discover Weekly Archive" playlist at launch and every 6 hours, adding only songs not already there, published to the module store.

**Architecture:** A pure core (`resolve.ts`, `archiveRun.ts`, `scheduler.ts`, `storage.ts`, `messages.ts`, `notices.ts`) receives its ports by injection. Thin adapters under `src/platform/` are the only code that touches `Spicetify.Platform`; `src/index.ts` wires them; `src/ui/settingsSection.tsx` is the only file that imports `/modules/stdlib/`. Tooling, build, CI and release copy `~/DEV/spicetify/track-playlist-preview` (below: **TPP**).

**Tech Stack:** TypeScript, Bun, vitest (+ happy-dom where a DOM is needed), `@spicetify/kit` 0.4.4 under Node ≥ 22, release-please, `spicetify/actions/publish@v1`.

**Spec:** [docs/specs/2026-11-04-discover-weekly-archive-design.md](../../specs/2026-11-04-discover-weekly-archive-design.md) — executors read it alongside this plan. AC numbers below are the spec's.

## Global Constraints

- Module ID, repo, folder, store ID, `package.json` and `metadata.json` `name`: `discover-weekly-archive`.
- `DISCOVER_WEEKLY_NAME = "Discover Weekly"`, `ARCHIVE_NAME = "Discover Weekly Archive"`, `READY_TIMEOUT_MS = 10_000`, `RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000`.
- `metadata.json`: `authors: ["Heyian"]` (strings), no `tags`, no `kind`, `license: "MIT"`, `dependencies: { "stdlib": "^1.13.0" }`.
- Kit runs under Node ≥ 22, never Bun. Kit does not typecheck: `bun run check` is the gate.
- Only `src/platform/*` reads `Spicetify.Platform`; only `src/index.ts`, `src/platform/*` and `src/ui/notifications.ts` read any `Spicetify` global. Only `src/ui/settingsSection.tsx` imports `/modules/stdlib/` (type imports included).
- `load()` never awaits client readiness or a run. Every wait is capped. Everything started is disposed on unload; partial load work is undone before re-throwing.
- Never copy a GraphQL `sha256Hash` or an `e-<digits>` encore class into source.
- Account safety (Q6, AC41, AC42): write probes create `DWA test <timestamp>` and delete it in a `finally`; no probe edits, reorders or unsaves an existing playlist; nothing touches the real "Discover Weekly Archive"; before any `spicetify apply` of a build that runs Archive runs, storage key `discover-weekly-archive:archiveUri` holds the URI of `DWA dev`.
- A Live verification finding that contradicts the spec stops work and goes back to the user.
- Commits: Conventional Commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`, `build:`), one focused commit per task, no AI attribution, never `--no-verify`.
- **Pre-commit gate (every commit):** dispatch a verification subagent that runs `bun run check` at the repo root and replies `STATUS: PASS` or `STATUS: FAIL` with a terse per-issue list. Commit only on PASS. Every task follows `superpowers:test-driven-development` and ends with `superpowers:verification-before-completion`.
- Workflow actions pinned to current majors, verified on the day with `gh api repos/OWNER/ACTION/releases --jq '.[].tag_name' | head` (spec: `actions/checkout@v7`, `actions/setup-node@v7`, `oven-sh/setup-bun@v2`, `googleapis/release-please-action@v5`, `spicetify/actions/publish@v1`).
- `/usr/bin/find`, not `find`. In zsh, quote `echo '==='` (bare `===` is equals-expansion).

## Plan decisions (not fixed by the spec)

- Storage goes through `Spicetify.LocalStorage` with key prefix `discover-weekly-archive:` (TPP's `settings.ts` pattern), not stdlib `createStorage`, so the stdlib-import rule holds. Keys: `discover-weekly-archive:sourceUri`, `…:archiveUri`, `…:lastRun` (JSON). `lastRun.at` is epoch ms.
- The Archive dropdown shows a first option `Automatic ("Discover Weekly Archive")` with value `""` **only while no Archive URI is saved** (a `<select>` needs a selected value). Picking it is a no-op.
- A saved Source or Archive URI that is missing from a successfully loaded list still appears in its dropdown, selected, labelled by its URI.
- Playlist-list load error line: `Couldn't load your playlists.`
- Short reason for `error`: the thrown value's message (`String(x)` for non-`Error`), first line only, cut to 80 characters with a trailing `…` when longer.
- `<time>` in the status line: `new Date(at).toLocaleString()`, injected as `formatTime` so tests pass their own.
- No stylesheet: `metadata.json` `entries` is `{ "js": "index.js" }` unless kit 0.4.4 refuses to build without `src/index.scss` (Task 3 decides, both branches spelled out).
- First release: `package.json`, `metadata.json` and the manifest start at `0.0.0`; with `bump-minor-pre-major`, the first `feat:` releases `0.1.0`.

## Review Focus

1. **Source and Archive are the same playlist** (user picks the archive in the Source dropdown): every Source track is already present → nothing added, nothing created, `lastRun` = `added`/0, no notice. Test: Task 10.
2. **Corrupt or foreign stored values** (`lastRun` not JSON, unknown `outcome`, missing `at`; `sourceUri` absent): treated as absent → "Not run yet" / automatic detection, never a throw. Test: Task 7.
3. **Rootlist entries the adapter does not expect** (unknown `type`, playlist without `owner` or `name`): unknown types are skipped; a missing owner means not Spotify-owned and not user-owned; a missing name is `""`. No throw. Test: Task 12.
4. **Region-restricted / unplayable Source items:** archived like any `spotify:track:` URI; the adapter does not filter on `isPlayable` (shuffle-plus does — don't copy that). Test: Task 12.
5. **Saved Archive URI absent from the editable list** (user lost edit rights, or the list loaded without it): the dropdown still shows it selected, labelled by URI, instead of silently showing another playlist. Test: Task 13.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/constants.ts` | Names, timeouts, intervals, storage prefix, `ADD_BATCH_SIZE` (Task 6 sets it) |
| `src/types/domain.ts` | `PlaylistEntry`, `RunOutcome`, `RunRecord`, `TimerPort`, port interfaces |
| `src/storage.ts` | `createStore(StoragePort)`: `sourceUri`, `archiveUri`, `lastRun` |
| `src/messages.ts` | Every user-visible string: notices, status line, `shortReason` |
| `src/notices.ts` | `createNotices(NotifyPort)`: once-per-load guards |
| `src/resolve.ts` | Pure: source/archive resolution, track filtering, missing tracks, batches |
| `src/archiveRun.ts` | `runArchive(deps, signal)`: one Archive run, abort-aware |
| `src/scheduler.ts` | Single-flight trigger, interval, launch run, change listeners |
| `src/waitForClient.ts` | Capped, abortable readiness wait (TPP copy + `signal`) |
| `src/teardown.ts` | `createDisposer` (TPP copy) |
| `src/timer.ts` | `realTimer` over `globalThis` timers |
| `src/platform/library.ts` | `RootlistAPI` adapter: list (flattened), create |
| `src/platform/playlist.ts` | `PlaylistAPI` adapter: read all pages, add one batch |
| `src/ui/notifications.ts` | `Spicetify.showNotification` adapter (TPP copy) |
| `src/ui/settingsSection.view.ts` | Pure: dropdown options |
| `src/ui/settingsSection.tsx` | Settings section, registrar; only stdlib importer |
| `src/types/stdlib.d.ts` | stdlib types (TPP copy + `SettingsButtonRow`) |
| `src/index.ts` | `load(ctx)`: wiring, launch run, disposal |
| `build.ts`, `scripts/kitBuild.ts`, `scripts/checkDist.ts`, `scripts/cdp-eval.mjs` | Build, dist check, CDP harness |

Tests sit next to their file as `*.test.ts` (TPP convention).

---

### Task 1: Isolated workspace

- [ ] **Step 1:** Run `git branch --show-current` (expect `main`), then create an isolated workspace via `superpowers:using-git-worktrees` on branch `feat/discover-weekly-archive`.
- [ ] **Step 2:** In the worktree, `git log --oneline -1` shows `882d610 docs: add the design spec and a CLAUDE.md pointer`.

### Task 2: Scaffold — update `package.json`, `tsconfig.json`, `bun.lock`, `.gitignore`, `.gitattributes`, `LICENSE`, `src/constants.ts`

**Files:**
- Create: `package.json`, `tsconfig.json`, `bun.lock` (generated), `.gitignore`, `.gitattributes`, `LICENSE`, `src/constants.ts`
- Test: `src/constants.test.ts`

**Interfaces:**
- Produces: `src/constants.ts` exports `MODULE_ID = "discover-weekly-archive"`, `DISCOVER_WEEKLY_NAME`, `ARCHIVE_NAME`, `READY_TIMEOUT_MS`, `RECHECK_INTERVAL_MS`, `STORAGE_PREFIX = "discover-weekly-archive:"`, `ADD_BATCH_SIZE` (placeholder `100` here; Task 6 replaces it with the verified limit).

- [ ] **Step 1: Copy and adapt the config files.** From TPP: `package.json` (name `discover-weekly-archive`, version `0.0.0`, description = the store description draft, repository `git+https://github.com/Heyian/discover-weekly-archive.git`, same scripts, `@spicetify/kit` pinned to `0.4.4`, other devDependencies at TPP's ranges); `tsconfig.json` verbatim; `.gitignore` and `.gitattributes` verbatim; `LICENSE` MIT with `Copyright (c) 2026 Heyian`.
- [ ] **Step 2: Write the failing test** `src/constants.test.ts`:

```ts
it("pins the spec values", () => {
  expect(DISCOVER_WEEKLY_NAME).toBe("Discover Weekly");
  expect(ARCHIVE_NAME).toBe("Discover Weekly Archive");
  expect(READY_TIMEOUT_MS).toBe(10_000);
  expect(RECHECK_INTERVAL_MS).toBe(21_600_000);
  expect(STORAGE_PREFIX).toBe("discover-weekly-archive:");
});
```

- [ ] **Step 3:** `bun install` then `bun run test` → FAIL (module not found).
- [ ] **Step 4:** Create `src/constants.ts`.
- [ ] **Step 5:** `bun install && bun run check` → typecheck clean, 1 test passes. `bun.lock` exists.
- [ ] **Step 6: Commit** (pre-commit gate) — `chore: scaffold the package, TypeScript and licence`.

### Task 3: Build — update `build.ts`, `scripts/kitBuild.ts`, `scripts/checkDist.ts` (+ tests), `src/metadata.json`, `src/index.scss`

**Files:**
- Create: `build.ts`, `scripts/kitBuild.ts`, `scripts/kitBuild.test.ts`, `scripts/checkDist.ts`, `scripts/checkDist.test.ts`, `src/metadata.json`, `src/metadata.test.ts`, `src/index.ts` (stub)
- Maybe create: `src/index.scss` (Step 6)

**Interfaces:**
- Produces: `bun run build`, `build:local` (→ `dist/discover-weekly-archive@<version>/`), `watch`, `check:dist [--tag <tag>]`. `checkDist(dir, source, tag?) => string[]`.

- [ ] **Step 1: Read kit 0.4.4's changes since 0.3.1** (`node_modules/@spicetify/kit` CHANGELOG/README, and `npm view @spicetify/kit@0.4.4`). List anything that breaks TPP's `kitCommand` (`build src --out <dir>`), its scratch layout `<out>/<name>@<version>/`, the react-shim rewrite or the sidecar name. If anything breaks, adapt the copies below and note it for Task 6's platform-notes section.
- [ ] **Step 2: Copy TPP's `scripts/kitBuild.ts`, `scripts/kitBuild.test.ts`, `build.ts`, `scripts/checkDist.ts`, `scripts/checkDist.test.ts`.** Set `NAME = "discover-weekly-archive"`. In `checkDist`, drop TPP's CSS rule checks (`ROW_RULES`, `PANEL_RULES`); keep folder name, tag, required files, metadata equality and the react-shim import. `FILES` = `index.js`, `index.js.map`, `metadata.json`, `spicetify-module.json` (+ `index.css` only if Step 6 adds a stylesheet). Adapt the test fixtures to match.
- [ ] **Step 3: Write the failing test** `src/metadata.test.ts` (AC44):

```ts
const m = JSON.parse(readFileSync("src/metadata.json", "utf8"));
expect(m.name).toBe("discover-weekly-archive");
expect(m.authors).toEqual(["Heyian"]);
expect(m).not.toHaveProperty("tags");
expect(m).not.toHaveProperty("kind");
expect(m.description).toMatch(/Creates that playlist/);
expect(m.description).toMatch(/while Spotify is\s+open/);
expect(m.license).toBe("MIT");
expect(m.preview).toBe("https://raw.githubusercontent.com/Heyian/discover-weekly-archive/main/docs/preview.png");
```

- [ ] **Step 4:** `bun run test` → metadata test FAILs; kitBuild/checkDist tests pass.
- [ ] **Step 5: Create `src/metadata.json`** with TPP's shape: version `0.0.0`, the spec's description draft (tighten only if kit's check reports a length limit, keeping both facts), `entries: { "js": "index.js" }`, `hasMixins: false`, `dependencies`, `preview`, `repository: "https://github.com/Heyian/discover-weekly-archive"`, `license`. Create stub `src/index.ts`: `export async function load(): Promise<void> {}` (Task 14 replaces it).
- [ ] **Step 6:** `bun run build:local && bun run check:dist` → `dist/discover-weekly-archive@0.0.0 passes`. If kit refuses to build without a stylesheet: create an empty `src/index.scss`, set `entries.css = "index.css"`, add `index.css` back to `FILES`, re-run. If the react-shim check fails because the stub imports no React, move that check into Task 14's Step 9 (it will pass once the settings section imports React) and note it.
- [ ] **Step 7:** `bun run check` → PASS.
- [ ] **Step 8: Commit** (pre-commit gate) — `build: build with spicetify-kit 0.4.4 and check the dist folder`.

### Task 4: CI and release — update `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`

**Files:**
- Create: the four files above, `scripts/releaseConfig.test.ts`

- [ ] **Step 1: Verify action majors** — for each of `actions/checkout`, `actions/setup-node`, `oven-sh/setup-bun`, `googleapis/release-please-action`, `spicetify/actions`, run `gh api repos/<owner>/<repo>/releases --jq '.[].tag_name' | head`. If a newer major than the spec's exists, read its release notes for breaking changes before using it.
- [ ] **Step 2: Copy TPP's `scripts/releaseConfig.test.ts`** unchanged → `bun run test` FAILs (files missing).
- [ ] **Step 3:** Create `release-please-config.json` as TPP's with `bootstrap-sha: "882d610068ceecd7a51e4f438cc67484cf910616"`; `.release-please-manifest.json` = `{".":"0.0.0"}`.
- [ ] **Step 4:** Create `ci.yml` (AC46) and `release.yml` (AC47) from TPP's, replacing `track-playlist-preview` with `discover-weekly-archive` in the publish `dist:` path. No other change.
- [ ] **Step 5:** `bun run test` → PASS. `grep -rn track-playlist-preview .github` → no output.
- [ ] **Step 6: Commit** (pre-commit gate) — `ci: add CI, release-please and store publishing`.

### Task 5: Hand the operator Manual Operator Steps 1–2

- [ ] **Step 1:** Generate a wizard with `mattpocock-skills:wizard` covering spec Manual Operator Steps 1 (create the repo; skip if `gh repo view Heyian/discover-weekly-archive` succeeds — check it first) and 2 (relaunch Spotify with `--remote-debugging-port=8088`). Save it in the scratchpad, not the repo.
- [ ] **Step 2:** Give the operator the script path and wait for confirmation. Then confirm: `curl -s 127.0.0.1:8088/json/version` returns JSON. Do not relaunch Spotify yourself.

### Task 6: Live verification — update `scripts/cdp-eval.mjs`, `docs/spicetify-v3-platform.md`, `src/constants.ts`

**Files:**
- Create: `scripts/cdp-eval.mjs` (TPP copy, unchanged), `docs/spicetify-v3-platform.md`
- Modify: `src/constants.ts` (`ADD_BATCH_SIZE`), `src/constants.test.ts`

**Interfaces:**
- Produces, for Tasks 12 and 14, recorded under a `## Discover Weekly Archive findings` section: Rootlist item and folder shapes; how a Spotify owner and the current user's ownership show; the edit flag; the own-Discover-Weekly field or "none"; `getContents` result shape and paging options; `add` argument shape and batch limit; `createPlaylist` arguments, return value and placement; how to delete a playlist (for probe cleanup); the readiness globals the adapters need.

Rules (AC41): read-only probes freely. Every write probe has this shape, with cleanup in `finally`, and never targets an existing playlist:

```js
const uri = await /* create "DWA test " + Date.now() */;
try { /* probe */ } finally { /* delete uri */ }
```

Find the create and delete calls first (read `/opt/spotify/Apps/xpui/xpui-modules.js` and the `RootlistAPI` prototype over CDP) and confirm the delete with a create→delete pair before any other write probe. If no reliable delete exists, stop and ask the user.

- [ ] **Step 1:** Record versions: `spicetify --version`, `Spicetify.Platform.version` (or the client's equivalent), `Spicetify.Modules.list()` (stdlib), kit from `node_modules`.
- [ ] **Step 2: Item 1.** `RootlistAPI.getContents()` — the Discover Weekly item's `name`, `owner.{username,uri,displayName}`, `type`, any other fields; the folder shape (`type: "folder"`, `items`). Answer "appears when not saved?" from the shape and the code, without unsaving.
- [ ] **Step 3: Item 2.** Look for a language-independent field and an own-vs-followed Discover Weekly field (e.g. a `formatListData`/`madeFor`/attribute on the item, or `PlaylistAPI.getMetadata`). Record what exists. A language-independent field is recorded only — the user decides. An own-DW field joins the detection test (Agent's Call 10).
- [ ] **Step 4: Item 3.** `PlaylistAPI.getContents(uri, opts)` on Discover Weekly and on a large read-only playlist: result shape (`items[].uri`, `type`, `isPlayable`, `totalLength`), whether `limit` caps, which `offset`/`limit` pages correctly.
- [ ] **Step 5: Items 4–5.** On a `DWA test <timestamp>` playlist: `createPlaylist` args, return value, where it lands; `PlaylistAPI.add(uri, uris, opts)` with `{ after: "end" }` (stdlib's call shape), the per-call limit (add increasing batches of public track URIs until it fails or 500 succeeds), and its behaviour on a playlist the user cannot edit — answered from the code in `xpui-modules.js` only. Never call `add` on a playlist the probe did not create.
- [ ] **Step 6: Item 6.** How "owns and can edit" shows on Rootlist items (`canEditItems`, `owner.username` vs the current username — find where the current username lives, e.g. `Spicetify.Platform.username`).
- [ ] **Step 7: Item 7.** Re-check TPP notes sections "Module entry and readiness", "Unload, enable and reload", "Settings page", "stdlib surface", "Module store and packaging" against CLI 3.0.0-rc.3, Spotify 1.3.4.258, stdlib 1.13.2 and kit 0.4.4 (re-read the cited sources). Include Task 3 Step 1's kit findings.
- [ ] **Step 8: Write `docs/spicetify-v3-platform.md`** — TPP's intro paragraph, then only the sections this module relies on (re-verified, each with "Checked <date> — <versions>" and its source), then the findings section. Each item names the versions it was checked on (AC43).
- [ ] **Step 9:** Compare findings to the spec. Any contradiction (e.g. `createPlaylist` cannot place in the root or returns no way to find the new URI, Rootlist omits owner) → stop and report to the user.
- [ ] **Step 10:** Set `ADD_BATCH_SIZE` to the verified limit (or `100` if no limit was found up to 500 — record that) and update its test.
- [ ] **Step 11: Dev archive (AC42).** Create a playlist named `DWA dev` (kept, not deleted) and write its URI: `Spicetify.LocalStorage.set("discover-weekly-archive:archiveUri", "<uri>")`. Read it back. Record the URI in the scratchpad, not the repo.
- [ ] **Step 12:** Confirm no `DWA test` playlist remains in the Rootlist.
- [ ] **Step 13: Commit** (pre-commit gate) — `docs: record live Platform API findings`.

### Task 7: Storage

**Files:** Create `src/types/domain.ts`, `src/storage.ts`, `src/storage.test.ts`

**Interfaces:**
- Produces in `src/types/domain.ts`:
  - `type RunOutcome = "added" | "source-missing" | "source-empty" | "source-unreadable" | "error"`
  - `interface RunRecord { at: number; outcome: RunOutcome; addedCount: number; error?: string }`
  - `interface StoragePort { get(key: string): string | null; set(key: string, value: string): void }`
- Produces in `src/storage.ts`: `createStore(port: StoragePort): Store` with `getSourceUri(): string` (`""` = automatic), `setSourceUri(uri: string): void`, `getArchiveUri(): string | null`, `setArchiveUri(uri: string): void`, `getLastRun(): RunRecord | null`, `setLastRun(record: RunRecord): void`. `type Store = ReturnType<typeof createStore>`.

- [ ] **Step 1: Write failing tests** with an in-memory `StoragePort`:
  - round-trips each value; keys written are exactly `discover-weekly-archive:sourceUri`, `…:archiveUri`, `…:lastRun`;
  - `getSourceUri()` is `""` and `getArchiveUri()` is `null` when unset, and `getArchiveUri()` is `null` for a stored `""`;
  - `setSourceUri("")` stores `""` (AC36 "cleared");
  - `setLastRun({ at: 1, outcome: "added", addedCount: 2 })` then `getLastRun()` has no `error` key (AC28: an `added` record written after an `error` one holds no error);
  - Review Focus 2: `getLastRun()` is `null` for `"not json"`, `{"outcome":"bogus","at":1,"addedCount":0}`, `{"outcome":"added"}` (missing `at`), and a non-numeric `addedCount`.
- [ ] **Step 2:** `bun run test src/storage.test.ts` → FAIL.
- [ ] **Step 3:** Implement. `getLastRun` validates every field and drops `error` unless `outcome === "error"`.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5: Commit** — `feat: store the source, archive and last run`.

### Task 8: Messages and notices

**Files:** Create `src/messages.ts`, `src/messages.test.ts`, `src/notices.ts`, `src/notices.test.ts`

**Interfaces:**
- Consumes: `RunRecord` (Task 7).
- Produces in `src/messages.ts`:
  - `statusLine(record: RunRecord | null, formatTime: (at: number) => string): string`
  - `archivedNotice(count: number, archiveName: string, created: boolean): string`
  - `SOURCE_MISSING_NOTICE: string`, `errorNotice(reason: string): string`
  - `shortReason(error: unknown): string`
- Produces in `src/types/domain.ts`: `interface NotifyPort { info(message: string): void; error(message: string): void }`
- Produces in `src/notices.ts`: `createNotices(notify: NotifyPort): Notices` with `archived(count: number, archiveName: string, created: boolean): void`, `sourceMissing(): void`, `error(reason: string): void`; `type Notices = ReturnType<typeof createNotices>`.

- [ ] **Step 1: Write failing tests** — exact strings, `formatTime = () => "T"`:

```ts
expect(statusLine(null, f)).toBe("Not run yet");
expect(statusLine({ at: 1, outcome: "error", addedCount: 0, error: "boom" }, f)).toBe("Last run: T · failed: boom");
expect(statusLine({ at: 1, outcome: "source-missing", addedCount: 0 }, f)).toBe("Last run: T · Discover Weekly not found — pick it below");
expect(statusLine({ at: 1, outcome: "source-empty", addedCount: 0 }, f)).toBe("Last run: T · Discover Weekly was empty, will retry");
expect(statusLine({ at: 1, outcome: "source-unreadable", addedCount: 0 }, f)).toBe("Last run: T · couldn't read Discover Weekly, will retry");
expect(statusLine({ at: 1, outcome: "added", addedCount: 1 }, f)).toBe("Last run: T · 1 song added");
expect(statusLine({ at: 1, outcome: "added", addedCount: 0 }, f)).toBe("Last run: T · 0 songs added");
expect(archivedNotice(3, "My Arch", false)).toBe("Archived 3 songs from Discover Weekly to My Arch");
expect(archivedNotice(1, "Discover Weekly Archive", true)).toBe("Created Discover Weekly Archive. Archived 1 song from Discover Weekly to Discover Weekly Archive");
expect(SOURCE_MISSING_NOTICE).toBe("Discover Weekly Archive couldn't find Discover Weekly. Save it to your library, or pick it in Spicetify Settings.");
expect(errorNotice("boom")).toBe("Discover Weekly Archive failed: boom");
expect(shortReason(new Error("a\nb"))).toBe("a");
expect(shortReason("plain string")).toBe("plain string");
expect(shortReason(new Error("x".repeat(100)))).toBe("x".repeat(79) + "…");
```

  `notices.test.ts` (AC21, AC27, AC34): `archived` calls `notify.info` every time; `sourceMissing` calls `notify.info(SOURCE_MISSING_NOTICE)` once across two calls; `error("r")` calls `notify.error(errorNotice("r"))` once across two calls; the two guards are independent; a second `createNotices` instance (a new load) shows each again.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat: add notice and status-line copy`.

### Task 9: Resolution

**Files:** Create `src/resolve.ts`, `src/resolve.test.ts`; modify `src/types/domain.ts`

**Interfaces:**
- Produces in `src/types/domain.ts`:

```ts
export interface PlaylistEntry {
  uri: string;
  name: string;
  ownedBySpotify: boolean;
  ownedByUser: boolean;
  canEdit: boolean;
  /** From Live verification's own-Discover-Weekly field; null when none exists (AC17). */
  isOwnDiscoverWeekly: boolean | null;
}
```

- Produces in `src/resolve.ts` (all pure; `playlists` is depth-first Rootlist order, folders flattened):
  - `resolveSource(playlists: PlaylistEntry[], savedUri: string): PlaylistEntry | null`
  - `resolveArchive(playlists: PlaylistEntry[], savedUri: string | null): PlaylistEntry | null`
  - `isArchiveCandidate(p: PlaylistEntry): boolean` — `ownedByUser && canEdit`
  - `trackUris(itemUris: string[]): string[]` — `spotify:track:` only, first occurrence order
  - `missingTracks(source: string[], archive: string[]): string[]`
  - `batches<T>(items: T[], size: number): T[][]`

- [ ] **Step 1: Write failing tests** using a `pl(overrides)` factory (defaults: user-owned, editable, not Spotify, `isOwnDiscoverWeekly: null`):
  - AC14: Spotify-owned "Discover Weekly" is chosen (flattened list stands in for root and folder positions).
  - AC15: a user-owned "Discover Weekly" is not chosen → `null`.
  - AC16: two Spotify-owned matches → the first in the array.
  - AC17: `isOwnDiscoverWeekly: false` first, `true` second → the second; both `null` → the first.
  - Name match is exact: "discover weekly" and "Discover Weekly " are not chosen.
  - AC18: saved URI present → that entry, even with a Discover Weekly match earlier. AC19: saved URI absent → automatic result.
  - AC24: saved archive URI present with name "Renamed", owned by someone else, `canEdit: false` → that entry.
  - AC25: saved absent (or `null`), two candidates named `ARCHIVE_NAME` → the first.
  - AC26: only `{ownedByUser: true, canEdit: false}` and `{ownedByUser: false, canEdit: true}` named `ARCHIVE_NAME` → `null`.
  - AC3/AC4: `trackUris(["spotify:track:A","spotify:local:x","spotify:track:B","spotify:episode:E","spotify:track:A","spotify:track:C"])` → `["spotify:track:A","spotify:track:B","spotify:track:C"]`.
  - AC1/AC5: `missingTracks([A,B,C],[B])` → `[A,C]`; `missingTracks([A2],[A1])` → `[A2]`.
  - `batches([1,2,3,4,5], 2)` → `[[1,2],[3,4],[5]]`; `batches([], 2)` → `[]`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat: resolve the source and archive playlists`.

### Task 10: Archive run

**Files:** Create `src/archiveRun.ts`, `src/archiveRun.test.ts`; modify `src/types/domain.ts`

**Interfaces:**
- Consumes: Tasks 7–9.
- Produces in `src/types/domain.ts`:

```ts
export interface LibraryPort {
  /** Every playlist in the Rootlist, depth-first, folders flattened. */
  listPlaylists(): Promise<PlaylistEntry[]>;
  /** Creates `name` in the library root; resolves to its URI. */
  createPlaylist(name: string): Promise<string>;
}
export interface PlaylistPort {
  /** Every item URI on every page, in playlist order. */
  readItemUris(uri: string): Promise<string[]>;
  /** One add call appending `trackUris` (≤ ADD_BATCH_SIZE) at the end. */
  addTracks(uri: string, trackUris: string[]): Promise<void>;
}
```

- Produces in `src/archiveRun.ts`:

```ts
export interface ArchiveRunDeps {
  library: LibraryPort; playlists: PlaylistPort; store: Store; notices: Notices;
  log: (message: string, detail?: unknown) => void;
  now: () => number; batchSize: number;
}
/** One Archive run (spec Design § Archive run). Never throws. Resolves null when aborted. */
export function runArchive(deps: ArchiveRunDeps, signal: AbortSignal): Promise<RunRecord | null>;
```

Order is the spec's steps 1–8. `listPlaylists()` is called once per run and its result serves both resolutions. Both reads go through `trackUris` (AC4 on both sides). After every `await`, if `signal.aborted`, return `null` before any further create, add, `store.set*` or notice (AC29). Archive name for the notice: the resolved entry's `name`, or `ARCHIVE_NAME` when created. `setArchiveUri` is called on every resolution, saved or found or created.

- [ ] **Step 1: Write failing tests** with in-memory fakes (`fakeLibrary(playlists)`, `fakePlaylists(contents: Record<string,string[]>)` recording `addTracks` calls; a fake `Notices` recording calls). One test per criterion:
  - AC1: Source [A,B,C], Archive [X,B] → one add `[A,C]`; record `added`/2; `archived(2, name, false)`.
  - AC2: all present → no add, no notice, record `added`/0.
  - AC7: `batchSize: 2`, 5 missing → adds `[A,B]`,`[C,D]`,`[E]` in order.
  - AC8: second batch throws → record `error`, `addedCount` 2, `notices.error(shortReason(err))`; a second run on the same fakes adds only the rest and records `added` with no `error` (AC28).
  - AC20: no source → record `source-missing`, `sourceMissing()` called, `createPlaylist` and `readItemUris` not called.
  - AC22: source items only `spotify:local:…` → `source-empty`; `readItemUris(source)` throws → `source-unreadable`; in both, `setArchiveUri` and `createPlaylist` not called, Archive not read, no add, no notice, `log` called.
  - AC23: no saved archive, no candidate → `createPlaylist("Discover Weekly Archive")` once, URI saved, Archive read skipped, all Source tracks added, `archived(n, "Discover Weekly Archive", true)`.
  - AC24/AC25: saved archive used / name lookup saves the found URI and creates nothing.
  - AC27: `listPlaylists`, Archive read, `createPlaylist` or `addTracks` throws → record `error` with `shortReason`, `log` called with the error, `notices.error` called.
  - AC29: for each await point (list, Source read, create, Archive read, an add batch) — abort while it is pending via a deferred promise, then resolve it → `runArchive` resolves `null`; no later create/add, `setLastRun` not called, no notice.
  - Review Focus 1: Source URI = Archive URI (saved for both) → no add, no create, `added`/0, no notice.
  - Record `at` equals `now()` at the end.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat: run one archive pass`.

### Task 11: Scheduler, readiness wait, timer

**Files:** Create `src/scheduler.ts`, `src/scheduler.test.ts`, `src/waitForClient.ts`, `src/waitForClient.test.ts`, `src/timer.ts`; modify `src/types/domain.ts`

**Interfaces:**
- Produces in `src/types/domain.ts`: `type TimerId = ReturnType<typeof setTimeout>`; `interface TimerPort { setTimeout(cb: () => void, ms: number): TimerId; clearTimeout(id: TimerId): void; setInterval(cb: () => void, ms: number): TimerId; clearInterval(id: TimerId): void }`.
- Produces in `src/timer.ts`: `realTimer: TimerPort` over `globalThis` timers.
- Produces in `src/waitForClient.ts`: TPP's `waitForClient({ missing, timer, timeoutMs, pollMs? })` plus `signal?: AbortSignal` — on abort, clears both timers and rejects.
- Produces in `src/scheduler.ts`:

```ts
export interface Scheduler {
  /** Starts a run unless one is active; returns whether it started. */
  trigger(): boolean;
  isRunning(): boolean;
  /** Called when a run starts and when it ends; returns unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Clears the interval, aborts the active run, drops listeners. Idempotent. */
  dispose(): void;
}
export function createScheduler(opts: {
  run: (signal: AbortSignal) => Promise<unknown>;
  timer: TimerPort; intervalMs: number; log: (message: string, detail?: unknown) => void;
}): Scheduler;
/** Launch run: trigger once `waitReady` resolves, unless `signal` aborted; log on rejection. */
export function startLaunchRun(opts: {
  waitReady: () => Promise<void>; trigger: () => void; signal: AbortSignal;
  log: (message: string, detail?: unknown) => void;
}): void;
```

The interval starts inside `createScheduler`. `run` rejections are caught and logged; the guard is released in `finally`.

- [ ] **Step 1: Write failing tests** with `vi.useFakeTimers()` and `realTimer`:
  - AC9: `trigger()` while a run's promise is pending → `false`, `run` called once; after it resolves, no further call.
  - AC10: after a run resolves, and after one rejects, `trigger()` → `true` and `run` called again.
  - AC13: `vi.advanceTimersByTime(RECHECK_INTERVAL_MS - 1)` → no run; `+1` → one run; another `RECHECK_INTERVAL_MS` → second run.
  - AC31: after `dispose()`, advancing 2 intervals → no run; `vi.getTimerCount()` is 0; the active run's signal is aborted.
  - AC38 support: listener fires on start and end; `isRunning()` true between, false after resolve and after reject.
  - `startLaunchRun`: AC11 trigger after `waitReady` resolves; AC12 rejection → no trigger, `log` called; AC30 abort before resolve → no trigger.
  - `waitForClient`: TPP's tests (copy and adapt), plus: abort → rejects and `vi.getTimerCount()` is 0.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat: schedule launch, interval and manual runs`.

### Task 12: Platform adapters

**Files:** Create `src/platform/library.ts`, `src/platform/library.test.ts`, `src/platform/playlist.ts`, `src/platform/playlist.test.ts`, `src/types/spicetify.d.ts` (copy TPP's)

**Interfaces:**
- Consumes: `LibraryPort`, `PlaylistPort`, `PlaylistEntry` (Tasks 9–10); the shapes recorded in `docs/spicetify-v3-platform.md` § Discover Weekly Archive findings.
- Produces: `createLibrary(platform = Spicetify.Platform): LibraryPort`, `createPlaylists(platform = Spicetify.Platform): PlaylistPort`. Each parses only the fields it uses, reading `platform` at call time.

Parsing follows the findings exactly: owner tests, the edit flag, the own-DW field (`isOwnDiscoverWeekly` = `null` if none was found), paging options, the add call's `opts`, `createPlaylist`'s arguments and how its URI is obtained.

- [ ] **Step 1: Write failing tests** against a fake `platform` object built from the recorded shapes:
  - Flattening (AC14, AC16): root playlist, folder → [playlist, nested folder → playlist], root playlist → four entries in depth-first order.
  - Ownership: a Spotify-owned item → `ownedBySpotify: true, ownedByUser: false`; a user's own editable item → `ownedByUser: true, canEdit: true`.
  - Review Focus 3: an item of unknown `type` is skipped; a playlist without `owner` → both owner flags `false`; without `name` → `""`; no throw.
  - `listPlaylists` rejects when `getContents` rejects (AC40 "fails partway" = failed).
  - AC6: `readItemUris` on a fake that serves 3 pages (by the verified paging scheme) returns all items in order, and stops at `totalLength`/the last short page.
  - Review Focus 4: items with `isPlayable: false` are returned.
  - `addTracks(uri, [A,B])` calls `PlaylistAPI.add` with the verified argument shape (incl. append-at-end option).
  - `createPlaylist("Discover Weekly Archive")` calls the verified API with the root placement and resolves the new URI.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Live check (read-only)** — bundle-free: paste the adapter's `listPlaylists` logic as a CDP expression and confirm it returns Discover Weekly with `ownedBySpotify: true`, and `DWA dev` with `ownedByUser: true, canEdit: true`. `readItemUris` on Discover Weekly returns the track count the client shows.
- [ ] **Step 6: Commit** — `feat: read and write playlists through the Platform APIs`.

### Task 13: Settings section

**Files:** Create `src/ui/settingsSection.view.ts`, `src/ui/settingsSection.view.test.ts`, `src/ui/settingsSection.tsx`, `src/types/stdlib.d.ts` (TPP copy + `SettingsButtonRow`)

**Interfaces:**
- Consumes: `Store` (Task 7), `Scheduler` (Task 11), `LibraryPort` (Task 10), `statusLine` (Task 8), `isArchiveCandidate` (Task 9).
- Produces in `settingsSection.view.ts`:

```ts
export interface Option { value: string; label: string }
export type PlaylistList = { ok: true; playlists: PlaylistEntry[] } | { ok: false };
export const AUTOMATIC_SOURCE_LABEL = "Automatic (Discover Weekly)";
export const AUTOMATIC_ARCHIVE_LABEL = 'Automatic ("Discover Weekly Archive")';
export const LIST_ERROR_LINE = "Couldn't load your playlists.";
export function sourceOptions(list: PlaylistList | null, savedUri: string): Option[];
export function archiveOptions(list: PlaylistList | null, savedUri: string | null): Option[];
```

  `list === null` means still loading: same as failed but without the error line.
- Produces in `settingsSection.tsx`: `registerSettingsSection(ctx: ModuleRuntimeContext, deps: { store: Store; scheduler: Scheduler; library: LibraryPort; formatTime: (at: number) => string }): void` and re-exports `type ModuleRuntimeContext`.
- `stdlib.d.ts` adds: `SettingsButtonRow(props: { label: string; description?: string; buttonLabel: string; disabled?: boolean; onClick(): void; variant?: string }): ReactElement` (verified against `~/.config/spicetify/modules/stdlib/lib/primitives.js`).

- [ ] **Step 1: Write failing view tests:**
  - AC35: `sourceOptions({ok:true, playlists:[a,b]}, "")` → `[{value:"",label:AUTOMATIC_SOURCE_LABEL},{value:a.uri,label:a.name},{value:b.uri,label:b.name}]`.
  - AC37: `archiveOptions` lists only `isArchiveCandidate` entries; with a saved candidate, no automatic option; with `null` saved, the automatic option first.
  - Review Focus 5 / plan decision: a saved URI missing from an ok list is appended as `{value: uri, label: uri}` (both dropdowns).
  - AC40: `ok: false` → source: `[automatic]` when saved `""`, else `[{value: saved, label: saved}]`; archive: `[automatic]` when `null`, else `[{value: saved, label: saved}]`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the view.
- [ ] **Step 4: Implement `settingsSection.tsx`.** `SettingsSection` titled `Discover Weekly Archive`, rows in order: Source playlist (`SettingsRow` + `Select`), Archive playlist (same), Archive now (`SettingsButtonRow`, `disabled={running}`, `onClick={() => scheduler.trigger()}`), status line (`SettingsRow` label `Status`, text `statusLine(store.getLastRun(), formatTime)`), and `LIST_ERROR_LINE` when the load failed. On mount: `library.listPlaylists()` → `{ok:true}` / `{ok:false}`; subscribe `scheduler.onChange` to refresh `running` and the status line, unsubscribe on unmount. Source change → `store.setSourceUri(value)`. Archive change → `store.setArchiveUri(value)` unless `value === ""`. A failed load never writes the store.
- [ ] **Step 5:** View tests PASS; `bun run check` PASS.
- [ ] **Step 6: Commit** — `feat: add the Settings section`.

### Task 14: Wiring and live run

**Files:** Replace `src/index.ts`; create `src/index.test.ts`, `src/teardown.ts` + `src/teardown.test.ts` (TPP copies), `src/ui/notifications.ts` (TPP copy)

**Interfaces:**
- Consumes: everything above.
- Produces: `export async function load(ctx: ModuleRuntimeContext): Promise<void>`.

`load` builds, in order: `store = createStore(localStorageAdapter)` (adapter over `Spicetify.LocalStorage`, defined in `index.ts`), `notices = createNotices(notifications)`, `library = createLibrary()`, `playlists = createPlaylists()`, `scheduler = createScheduler({ run: (signal) => runArchive({...}, signal), timer: realTimer, intervalMs: RECHECK_INTERVAL_MS, log })`, a launch `AbortController`, `startLaunchRun({ waitReady: () => waitForClient({ missing, timer: realTimer, timeoutMs: READY_TIMEOUT_MS, signal }), … })`. `missing()` lists the globals the adapters need per the findings (at least `Spicetify.Platform.RootlistAPI`, `Spicetify.Platform.PlaylistAPI`, `Spicetify.showNotification`). `dispose = createDisposer([abort launch, scheduler.dispose])`; `ctx.defer(dispose)`; then `registerSettingsSection`; on its throw, `dispose()` then re-throw (TPP pattern). `log` prefixes `[discover-weekly-archive]` and uses `console.info`/`console.error`.

- [ ] **Step 1: Write failing tests** (`vi.mock` the settings section and `./platform/*`, stub `globalThis.Spicetify` with `LocalStorage` and `showNotification`, `vi.useFakeTimers()`):
  - AC11: `load(ctx)` resolves while `waitForClient` never settles; once it resolves, `runArchive` runs once.
  - AC12: readiness times out → no launch run; advancing `RECHECK_INTERVAL_MS` → one run; `registerSettingsSection` was called.
  - AC30: `ctx`'s deferred disposer runs during the wait, then the wait resolves → no run.
  - AC31: after the deferred disposer, `vi.getTimerCount()` is 0.
  - AC32: load → dispose → load → exactly one interval (`vi.getTimerCount()` 1 after readiness), `registerSettingsSection` called twice total, one launch run on the second load.
  - AC33: `registerSettingsSection` throws → `load` rejects with that error and `vi.getTimerCount()` is 0.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `bun run check` → PASS.
- [ ] **Step 5:** `grep -rn "Spicetify\." src --include=*.ts --include=*.tsx | grep -v -e '^src/platform/' -e '^src/index.ts' -e '^src/ui/notifications.ts' -e '\.test\.ts' -e '^src/types/'` → no output. `grep -rln "/modules/stdlib/" src | grep -v -e settingsSection.tsx -e types/stdlib.d.ts` → no output. `grep -rn "e-[0-9]" src` → no output.
- [ ] **Step 6: AC42 gate.** Over CDP: `Spicetify.LocalStorage.get("discover-weekly-archive:archiveUri")` equals the `DWA dev` URI from Task 6. If not, stop and re-run Task 6 Step 11.
- [ ] **Step 7:** `bun run build && spicetify apply`, then ask the operator to relaunch with the debug port (Manual Operator Step 2) and wait.
- [ ] **Step 8: Live checks over CDP** (record results in the task report):
  - `Spicetify.Modules.report` lists `discover-weekly-archive` as loaded, none failed.
  - Within ~30 s, `discover-weekly-archive:lastRun` holds a record; `DWA dev` holds this week's Discover Weekly tracks; the real "Discover Weekly Archive" track count is unchanged (read it before Step 7).
  - Trigger again via Settings → Archive now (or `Spicetify.Modules.disable`/`enable` then wait) → `lastRun` `added`/0, `DWA dev` count unchanged (AC2 live).
  - `Spicetify.Platform.History.push("/bespoke/settings")`, then read the section's DOM: title, two selects with expected first options, `DWA dev` selected in Archive, enabled button, status line text.
  - `Spicetify.Modules.disable("discover-weekly-archive")` → section gone; `enable` → one section, one new `lastRun.at` (AC31, AC32).
- [ ] **Step 9:** `bun run build:local && bun run check:dist` → passes (incl. react-shim import if deferred from Task 3).
- [ ] **Step 10: Commit** — `feat: wire the module entry`.

### Task 15: Update `README.md`

**Files:** Create `README.md`, `scripts/readme.test.ts`

- [ ] **Step 1: Write failing test** (AC45): the text before the second `## ` heading matches `/creates?\b.*"Discover Weekly Archive"|"Discover Weekly Archive".*creat/s`, `/only while Spotify is open/i`, `/never opened?.*can(no|')t be recovered/is`, `/one computer/i`, `/non-English/i` and `/Source playlist/`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `README.md`** following TPP's README shape: first section with the four AC45 facts; then Install (store, and `spicetify pkg install` from a release zip), Settings (Source, Archive, Archive now, status line), Build from source (`bun install`, `bun run build`, `spicetify apply`, `bun run check`), Licence.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `docs: add the README`.

### Task 16: Update `CLAUDE.md`

- [ ] **Step 1:** Replace the Status section with TPP's shape, ≤ 250 lines: what this is (2 sentences), Commands (TPP's list), Documentation (pointers to the spec, this plan, `docs/spicetify-v3-platform.md`), Build (kit under Node ≥ 22, kit doesn't typecheck), Architecture (≤ 3 sentences: pure core with injected ports, adapters under `src/platform/`, file list), Non-obvious constraints (stdlib-import rule, `Spicetify` access rule, Q6 account-safety rules incl. the `archiveUri` dev key, dedupe by URI only, the Live-verified facts the adapters rely on as 1-line pointers), Debugging against the live client (TPP's section, `cdp-eval.mjs`).
- [ ] **Step 2:** `wc -l CLAUDE.md` ≤ 250; every linked path exists (`grep -o '](\([^)]*\))' CLAUDE.md` → check each).
- [ ] **Step 3: Commit** — `docs: describe commands, architecture and constraints in CLAUDE.md`.

### Task 17: Hand the operator Manual Operator Step 4, then update `docs/preview.png`

- [ ] **Step 1:** With the Settings section open over CDP, capture a 16:9 screenshot (CDP `Page.captureScreenshot` with a 1600×900 `clip` around the section; a throwaway script in the scratchpad). Save to the scratchpad.
- [ ] **Step 2:** Give the operator the full path; wait for approval (Manual Operator Step 4). Re-take on request.
- [ ] **Step 3:** Copy the approved image to `docs/preview.png`. The `metadata.json` `preview` URL from Task 3 already points at it.
- [ ] **Step 4: Commit** — `docs: add the store preview image`.

### Task 18: Confirm Deferred Items

- [ ] **Step 1:** The spec's Deferred Items section says "None" and references no issue: confirm with `grep -n "#[0-9]" docs/specs/2026-11-04-discover-weekly-archive-design.md` restricted to that section. For every deferral that came up during Tasks 1–17 and was filed in `Heyian/discover-weekly-archive`, run `gh issue view <#> --json body | jq -r .body` and grep for `Context`, `Required`, `Integration Points`, `Priority`; fix any missing heading.

### Task 19: Hand the operator Manual Operator Steps 3, 5–8 and 10

- [ ] **Step 1:** Generate a wizard (`mattpocock-skills:wizard`) for step 3 (allow Actions to open PRs — before the branch merges, since `release.yml` lands on `main` with it) and the post-merge steps 5 (merge the release PR), 6 (clean-install check), 7 (hand-opened store PR), 8 (`SPICETIFY_SUBMIT_TOKEN`), 10 (switch Archive to "Discover Weekly Archive", Archive now, delete `DWA dev`). Save it in the scratchpad.
- [ ] **Step 2:** Hand it over; wait for confirmation of step 3 only. The rest happen after merge.

### Task 20: Post-implementation check

- [ ] **Step 1:** `git diff 882d610..HEAD --stat` and read the diff. Confirm each Required Task output exists and is non-trivial: every Config & Infrastructure Impact file (`package.json`, `build.ts`, `scripts/kitBuild.ts`, `scripts/checkDist.ts` + tests, `scripts/cdp-eval.mjs`, `tsconfig.json`, `bun.lock`, `ci.yml`, `release.yml`, `release-please-config.json`, `.release-please-manifest.json`, `scripts/releaseConfig.test.ts`, `src/metadata.json`, `.gitignore`, `.gitattributes`, `LICENSE`; `src/index.scss` only if Task 3 needed it), every Documentation Update (`CLAUDE.md`, `README.md`, `docs/spicetify-v3-platform.md`, `docs/preview.png`). No glossary or ADR work was required (spec).
- [ ] **Step 2:** Map AC1–AC47 to a test or a recorded live check; list any without one and add it.
- [ ] **Step 3:** Fix any gap in its owning area, gate, commit.

### Task 21: Final build

- [ ] **Step 1:** `bun run build:local && bun run check:dist` → `dist/discover-weekly-archive@0.0.0 passes`. Fix and re-run until it does; gate and commit any fix.
- [ ] **Step 2:** `bun run check` → PASS.
- [ ] **Step 3 (advisory):** If the Codex plugin is available, run its adversarial review with the focus: *"Judge correctness against the spec's acceptance criteria (AC1–AC47) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."* It never gates the merge. Then `superpowers:finishing-a-development-branch`.
