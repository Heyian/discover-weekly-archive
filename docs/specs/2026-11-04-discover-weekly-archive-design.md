# Discover Weekly Archive — Design Spec

Date: 2026-11-04 · Status: approved 2026-11-04, Codex AC critique folded in · Author: Heyian (with Claude)

A Spicetify v3 extension that copies the songs from the user's Discover Weekly into a playlist named
"Discover Weekly Archive", adding only the songs that are not already there. Published to the
Spicetify module store from this repo.

Prior art this builds on:

- `~/DEV/spicetify/track-playlist-preview` (`Heyian/track-playlist-preview`) — the tooling, build,
  release and store-publishing setup this repo copies. Its
  [store-publishing spec](https://github.com/Heyian/track-playlist-preview/blob/main/docs/specs/2026-09-28-store-publishing-design.md)
  and [platform notes](https://github.com/Heyian/track-playlist-preview/blob/main/docs/spicetify-v3-platform.md)
  are the starting facts.
- `spicetify/modules` — `modules/shuffle-plus` (reads playlist contents and walks the rootlist,
  folders included) and `modules/new-releases` (a "fetched at" timestamp that decides when to
  refresh). Local checkout: `~/DEV/spicetify/modules`.

## Intent

The user runs an IFTTT applet that adds every new Discover Weekly song to "Discover Weekly Archive".
This module replaces it inside the Spotify client, so the archive no longer depends on a third-party
service, and other Spicetify users can install the same behaviour from the store.

Success: on a normal week, with Spotify opened at least once between two Monday refreshes, every
song from that week's Discover Weekly ends up in the Archive playlist exactly once, without the user
doing anything after install.

Goals:

- Archive Discover Weekly automatically, with no setup for an English-language user who has
  Discover Weekly in their library.
- Work for any user from the store: a non-English client, or a library without an existing archive
  playlist.
- Never add a song that is already in the Archive playlist.

Non-goals:

- Tracking Discover Weekly changes live, or reacting the moment it refreshes.
- Archiving other generated playlists (Release Radar, Daily Mixes). The Source playlist setting
  happens to allow any playlist, but nothing is designed or tested for that.
- Running while Spotify is closed. A week in which Spotify never opens is lost, and the README says so.
- Per-week archive playlists, or any history kept outside the Archive playlist.
- Coordinating several computers (Q5). Settings are per client. Two clients running Archive runs in
  the same window can add the same songs twice, or each create an Archive playlist on first
  install. The README tells users to enable the module on one computer only.

Anti-goals (a failure even if it technically works):

- Duplicates in the Archive playlist.
- Silently doing nothing: when the module cannot find a Source playlist, the user must be told what
  to do.
- Adding a playlist to the user's library without the store description saying so beforehand.
- Slowing Spotify's startup or blocking other modules from loading.
- Anything left running after the module is disabled.

## Terms

| Term | Meaning |
| --- | --- |
| **Source playlist** | The playlist whose songs get archived. By default the user's Discover Weekly. |
| **Archive playlist** | The user-owned playlist songs are copied into. By default named "Discover Weekly Archive". |
| **Archive run** | One pass: resolve both playlists, read both, add the Source songs missing from the Archive. |
| **Automatic detection** | Finding the Source playlist without a saved choice: a Spotify-owned playlist in the user's library named exactly "Discover Weekly". |
| **Rootlist** | The user's library playlist tree (`Platform.RootlistAPI`), folders included. |

## Constraints

- **Client-only.** The module runs only while the Spotify desktop client is open. Discover Weekly
  replaces its whole content every Monday, so the design relies on frequent Archive runs, not on a
  schedule.
- **No Web API.** Spotify blocked new Web API apps from reading Spotify-generated playlists in late
  2024. Use the client's internal Platform APIs (`PlaylistAPI`, `RootlistAPI`), as
  `modules/shuffle-plus/mod.tsx:191-214` and stdlib `src/storage.ts:58-100` do.
- **Per-account Discover Weekly URI.** No constant URI exists. The name is localized ("Découvertes
  de la semaine" in French).
- **Untyped Platform APIs.** `spicetify.d.ts` reduces every Platform method to `(...args) => any`;
  `platform.d.ts` gives only argument counts. Every call shape must be verified live (see
  Live verification).
- **Loader rules** (track-playlist-preview platform notes, "Module entry and readiness"): `load()` is
  awaited by the loader, so it must not wait on an Archive run. Every wait is capped. Everything
  started is disposed in `ctx.defer` or the returned disposer. Partial load work is undone before
  re-throwing.
- **Store metadata rules** (same notes, "Module store and packaging"): `authors` are strings. Declare
  neither `tags` nor `kind`. Build with spicetify-kit under Node ≥ 22.
- **Version drift.** The platform notes were checked against CLI 3.0.0-beta.19, Spotify 1.2.96 and
  kit 0.3.1. Today's machine runs CLI 3.0.0-rc.3 and Spotify 1.3.4.258, and npm's latest kit is
  0.4.4. Re-check every fact this module relies on before building on it.

## Approaches

| Approach | Verdict |
| --- | --- |
| **Archive run at launch, then every `RECHECK_INTERVAL` while open; idempotent by comparing with the Archive contents** | **Chosen.** Stateless. A repeated run adds nothing. It survives missed runs, restarts and a user who never closes Spotify. |
| Listen for changes to Discover Weekly and archive the difference | Dropped. No reliable change event exists for a playlist the user is not viewing, and the content check is needed anyway. |
| A weekly timer keyed to Monday | Dropped. The client is often closed at the scheduled moment, and the refresh time varies by region. |
| Spotify Web API through `CosmosAsync` | Dropped. Blocked for generated playlists (see Constraints). |
| An external cron or server job | Dropped. It would not be a module. |

User decisions (2026-11-04):

| # | Decision |
| --- | --- |
| Q1 | Name `discover-weekly-archive`: the repo, the folder and the store ID. |
| Q2 | Automatic detection first, with an override in Settings. The override is a **Source playlist dropdown of all the user's playlists**, not a pasted link. |
| Q3 | When no Archive playlist exists, **create it automatically**, and say so plainly in the store description. |
| Q4 | Archive run at launch, then on an interval while Spotify stays open. |
| — | Publish to the module store. Copy track-playlist-preview's setup. |
| Q5 | Running on several computers at once is **accepted, not guarded**. The README says to enable the module on one computer. |
| Q6 | Live verification and development run on the user's own account, using **throwaway playlists only**. The real "Discover Weekly Archive" is not touched until the final check. |
| Q7 | **Read Discover Weekly before resolving the Archive**, so the Archive playlist is only created when there is a song to add. |
| Q8 | **Every run records its outcome**, early stops included, and the Settings status line shows it. |
| — | Codex critique of the ACs (2026-11-04): 23 of 24 findings accepted. The rejected one asked for an AC on code layout, which Design § Code layout and Constraints already cover. |

## Design

### Archive run

The steps run in this order. The Source is read before the Archive is resolved, so an Archive
playlist is only created when there is at least one song to put in it (Q7).

1. **Resolve the Source playlist.**
   - The saved choice wins, if it is still in the Rootlist.
   - Otherwise, use Automatic detection. Walk the Rootlist depth-first, folders included. Take the
     first playlist whose name is exactly `DISCOVER_WEEKLY_NAME` ("Discover Weekly"), whose owner is
     Spotify, and which passes the own-Discover-Weekly test if Live verification found one
     (Agent's Call 10). Verify live how a Spotify owner shows up.
   - If there is a saved choice but it is gone from the Rootlist, fall back to Automatic detection.
2. **No Source playlist.** End the run with outcome `source-missing`, and show the Source-missing
   notice (see Notices).
3. **Read the Source contents in full,** every page. Keep only `spotify:track:` URIs. Drop repeats
   and keep the order in which each URI first appears.
   - If the read throws, end with outcome `source-unreadable`.
   - If no tracks are left, end with outcome `source-empty`.
   - Neither shows a notice; both log to the console.
4. **Resolve the Archive playlist.**
   - The saved Archive URI wins whenever it is still in the Rootlist, whatever its current name,
     owner or edit flag. No name lookup or creation happens.
     A Rootlist entry the server reports missing or forbidden (a placeholder) counts as still in
     the Rootlist: the run ends with outcome `error` ("Archive playlist unavailable"), and no name
     lookup or creation happens (ruled 2026-11-04).
   - Otherwise, take the first playlist in Rootlist order (depth-first) that the user owns, can edit
     and is named exactly `ARCHIVE_NAME` ("Discover Weekly Archive"). Both "owns" and "can edit"
     must hold.
   - Otherwise, create a playlist named `ARCHIVE_NAME` in the root of the library.
   - Save the resolved URI either way. A later rename of the playlist then keeps working.
5. **Read the Archive contents in full,** every page. Keep only `spotify:track:` URIs. Skip this
   step for a playlist just created.
6. **Compute the missing songs:** the Source tracks whose URI is not in the Archive, in Source order.
7. **Add them** to the end of the Archive in Source order. Split them into batches if the add call
   has a size limit (verify live).
8. **Record the run** (see Storage). Then show the Archived notice if anything was added.

Any throw from a Rootlist call, the Archive read, creation or an add call ends the run with outcome
`error`. A batch that already succeeded stays in the Archive. The next run re-reads both playlists
and adds only what is still missing.

Only one Archive run happens at a time. A launch, interval or manual trigger that fires while a run
is active is dropped. It is not queued, and the end of the active run does not start it. The guard
is released on every outcome.

After dispose, a run still in flight issues no further add or create call, writes no storage and
shows no notice. An add request already sent when dispose runs may still complete.

A "song already there" is decided by track URI only. Spotify sometimes relinks the same recording
under a different URI, and that case is accepted: the song may be added twice.

### Triggers

- **At launch:** once the client is ready, using a capped wait of `READY_TIMEOUT` (10 s, as in
  track-playlist-preview's `waitForClient`). It is started without awaiting, so `load()` returns
  promptly. If the cap is reached, the launch run is skipped. If the module is disposed during the
  wait, no launch run starts.
- **Every `RECHECK_INTERVAL` (6 hours)** while the module is loaded. The interval starts at load,
  whether or not the client was ready in time, and is cleared on unload.
- **"Archive now"** button in Settings.

If `load()` throws after registering anything, it disposes what it registered before re-throwing.

### Settings section

On the Spicetify Settings page (stdlib `settingsSection`), titled "Discover Weekly Archive":

- **Source playlist** — a dropdown. The first entry is "Automatic (Discover Weekly)", the default.
  After it come every playlist in the Rootlist, folders flattened, labelled by name. A selection is
  saved immediately and takes effect on the next Archive run, whatever its trigger.
- **Archive playlist** — a dropdown of the playlists the user owns and can edit (the same test as
  Archive run step 4). It is preselected to the saved Archive playlist. Changing it saves the new
  URI, which wins on the next run. (Agent's Call 2.)
- **Archive now** — a button that starts an Archive run. It is disabled while any run is active,
  whatever started it.
- **Status line** — built from the stored run record. The first match wins:

  | Record | Line |
  | --- | --- |
  | none | "Not run yet" |
  | `error` | "Last run: <time> · failed: <error>" |
  | `source-missing` | "Last run: <time> · Discover Weekly not found — pick it below" |
  | `source-empty` | "Last run: <time> · Discover Weekly was empty, will retry" |
  | `source-unreadable` | "Last run: <time> · couldn't read Discover Weekly, will retry" |
  | `added` | "Last run: <time> · N songs added" ("1 song added" when N is 1) |

  The status line updates after every run, whatever its trigger, while the section is open.

The playlist list is loaded when the section mounts. If that fails, each dropdown offers only its
saved value, labelled by its URI when the name is unknown, and an error line is shown. A list that
fails partway through is treated as failed. Saved values are never changed by a failed load.

### Notices

These use `Spicetify.showNotification`, through stdlib's `client.notify` or the repo's notifications
adapter.

- **Archived:** "Archived N songs from Discover Weekly to <Archive name>" ("1 song" when N is 1).
  <Archive name> is the Archive playlist's current name. It is shown on every run with N > 0. When
  the Archive playlist was just created, it is prefixed with "Created <Archive name>. ".
- **Source-missing:** "Discover Weekly Archive couldn't find Discover Weekly. Save it to your
  library, or pick it in Spicetify Settings." Shown at most once per load.
- **Error:** "Discover Weekly Archive failed: <short reason>", with error styling (`isError`), at
  most once per load. Details go to the console.

The Source-missing and Error allowances are counted separately, and both reset when the module
loads again. The `source-empty` and `source-unreadable` outcomes show no notice.

### Store and README wording

The metadata `description` must say that the module creates a playlist. Draft (the builder may tighten
it to fit the store's limit, keeping both facts):

> Copies each week's Discover Weekly into a "Discover Weekly Archive" playlist, skipping songs
> already there. Creates that playlist in your library if you don't have one. Runs while Spotify is
> open.

The README's first section repeats both facts. It adds that a week in which Spotify is never opened
can't be recovered, and explains the Source playlist setting for non-English clients.

### Storage

Stored per module through stdlib `createStorage(ctx)`, or the same pattern track-playlist-preview's
`settings.ts` uses:

- `sourceUri`: the URI, or empty for automatic;
- `archiveUri`;
- `lastRun`, a single record written at the end of every run on every outcome (Q8):
  - `at`: when the run ended;
  - `outcome`: `added` | `source-missing` | `source-empty` | `source-unreadable` | `error`;
  - `addedCount`: the songs actually added, including any before a failure, 0 otherwise;
  - `error`: the short reason, present only when `outcome` is `error`.

### Code layout

The layout follows track-playlist-preview's architecture rule: only adapters touch `Spicetify`
globals, and the core is pure and receives its ports by injection. Builder's call on file names.

- A pure core does source resolution, archive resolution, the missing-songs computation and
  run-state transitions. Rootlist, playlist and storage access arrive as injected ports.
- Thin Platform adapters cover `RootlistAPI` and `PlaylistAPI` calls, each parsing only the fields
  it uses.
- A scheduler (launch, interval, manual) has an injectable timer and a single-flight guard.
- A settings section is the only file that imports `/modules/stdlib/`, matching
  track-playlist-preview.

### Live verification (first implementation task)

Before writing adapters, launch Spotify with `--remote-debugging-port=8088` (a Manual Operator Step).
Using a copy of track-playlist-preview's `scripts/cdp-eval.mjs`, record the following in
`docs/spicetify-v3-platform.md`, each with the version it was checked on.

Rules for the user's real account (Q6):

- Probes that write create playlists named `DWA test <timestamp>` and delete them in a `finally`,
  including when the probe fails.
- Probes never unsave, edit or reorder an existing playlist, and never write to the real "Discover
  Weekly Archive".
- Item 1's "not saved" case is answered from the Rootlist shape and the code, not by unsaving
  Discover Weekly.
- During development, the module must never resolve the real archive. Before the first
  `spicetify apply` of a build that runs Archive runs, create a playlist named `DWA dev`. Then write
  its URI to the module's `archiveUri` storage key over CDP, because the launch run happens before
  Settings can be opened. Re-check the key after any storage reset.
- Pointing the Archive playlist setting back at "Discover Weekly Archive" is the user's step, done
  once the work is finished (operator step 10).

The items:

1. How Discover Weekly appears in `RootlistAPI.getContents()`: its name, its `owner` fields
   (`username`, `uri`, `displayName`), and whether it appears when the user has not saved it.
2. Whether any field or API identifies Discover Weekly regardless of language. If one is found,
   record it, and the user decides whether to use it. The current design does not depend on it.
   Also check whether any field tells the user's own Discover Weekly apart from someone else's that
   the user follows (both are Spotify-owned and share the name). If one exists, add it to the
   Automatic detection test without asking, since it only narrows the match (Agent's Call 10).
3. `PlaylistAPI.getContents(uri, opts)`: the result shape, whether `limit` caps the results, and how
   to page through them.
4. `PlaylistAPI.add(uri, uris, opts)`: the argument shapes, the per-call batch limit, and its
   behaviour on a non-editable playlist.
5. `RootlistAPI.createPlaylist(...)`: the arguments, the return value (does it return the new URI?),
   and where the playlist lands in the library.
6. How "the user owns and can edit this playlist" shows in Rootlist items (`canEditItems`,
   `owner.username` compared with the current user).
7. Re-check the platform-notes sections this module relies on against CLI 3.0.0-rc.3, Spotify
   1.3.4.258 and kit 0.4.4: entry and readiness, unload, the Settings page and store metadata.

A finding that contradicts this spec stops the work and goes back to the user.

## Acceptance Criteria

Unit-testable criteria are checked with fake ports and a fake clock. Criteria marked *(live)* are
checked against the running client under the Q6 rules.

### Archive run

- **AC1** — Given a Source playlist with tracks A, B and C and an Archive playlist containing B, when
  an Archive run completes, then A and C are added after the Archive's existing items, in that
  order, and B is not added again.
- **AC2** — Given every Source track is already in the Archive playlist, when an Archive run
  completes, then nothing is added, no notice is shown, and `lastRun` records outcome `added` with
  `addedCount` 0.
- **AC3** — Given a Source playlist listing A, B, A, C (A repeated, with another track between),
  and none of them in the Archive, when an Archive run completes, then A, B and C are added once
  each, in that order.
- **AC4** — Given Source or Archive items that are not `spotify:track:` URIs (local files,
  episodes), when an Archive run completes, then they are neither added nor counted as present.
- **AC5** — Given two different `spotify:track:` URIs for the same recording, one in the Source and
  one in the Archive, when an Archive run completes, then the Source URI is added.
- **AC6** — Given Source and Archive contents that each span more than one page, and a Source track
  that is in the Archive only on a later page, when an Archive run completes, then every page of
  both was read, every missing track is added once in Source order, and that track is not added.
- **AC7** — Given more missing tracks than one add call accepts, when an Archive run completes, then
  all of them are added, in Source order, across as many calls as needed.
- **AC8** — Given an add batch succeeds and a later batch throws, when the run ends, then it ends
  as in AC27, and `lastRun.addedCount` is the number of songs actually added. When the next trigger
  runs, it adds only the tracks still missing, and its success writes outcome `added`.

### Single run and triggers

- **AC9** — Given an Archive run is active, when a launch, interval or manual trigger fires, then no
  second run starts. When the active run ends, no run starts on behalf of the dropped trigger.
- **AC10** — Given a run ends with any outcome (`added`, `source-missing`, `source-empty`,
  `source-unreadable`, `error`), when the next trigger fires, then a new run starts.
- **AC11** — When the module loads, then `load()` returns without awaiting the client or an Archive
  run, and one Archive run starts once the client is ready.
- **AC12** — Given the client does not become ready within `READY_TIMEOUT`, when the cap is
  reached, then no launch run starts. The interval and the Settings section still work, and "Archive
  now" starts a run.
- **AC13** — Given the module is loaded, when `RECHECK_INTERVAL` (6 hours) elapses on the fake
  clock, then an Archive run starts. Another starts after each further `RECHECK_INTERVAL`, and none
  starts earlier.

### Source playlist

- **AC14** — Given no saved Source choice and a Spotify-owned playlist named `DISCOVER_WEEKLY_NAME`
  in the Rootlist, at the root or inside a folder, when an Archive run starts, then that playlist is
  the Source playlist.
- **AC15** — Given no saved Source choice and a playlist named `DISCOVER_WEEKLY_NAME` that is not
  owned by Spotify, when an Archive run starts, then that playlist is not chosen.
- **AC16** — Given several playlists pass Automatic detection at different folder depths, when an
  Archive run starts, then the first one in depth-first Rootlist order is chosen.
- **AC17** — Given Live verification recorded an own-Discover-Weekly field, when Automatic detection
  runs, then a Spotify-owned "Discover Weekly" that fails that test is skipped, even if it comes
  first. Given no such field was recorded, the first Spotify-owned match is taken, including one
  that belongs to someone else.
- **AC18** — Given a saved Source choice that is in the Rootlist, when an Archive run starts, then
  the saved playlist is used, even if a playlist named `DISCOVER_WEEKLY_NAME` also exists.
- **AC19** — Given a saved Source choice that is no longer in the Rootlist, when an Archive run
  starts, then Automatic detection is used, following AC14–AC17.
- **AC20** — Given no Source playlist can be resolved, when an Archive run starts, then nothing is
  added, no Archive playlist is created, `lastRun` records outcome `source-missing`, and the
  Source-missing notice is shown.
- **AC21** — Given the Source-missing notice was already shown since the module loaded, when a later
  Archive run also ends `source-missing`, then the notice is not shown again. After the module is
  disabled and enabled, it is shown again on the next `source-missing`.
- **AC22** — Given a resolved Source playlist with no `spotify:track:` items, or whose read throws,
  when an Archive run starts, then no Archive playlist is resolved or created, nothing is added, no
  notice is shown, and `lastRun` records `source-empty` or `source-unreadable` respectively.

### Archive playlist

- **AC23** — Given a Source with at least one track, no saved Archive URI in the Rootlist, and no
  playlist that the user owns and can edit named `ARCHIVE_NAME`, when an Archive run completes,
  then a playlist named `ARCHIVE_NAME` is created in the library root and its URI is saved. The
  Source tracks are added to it, and the Archived notice begins with "Created <Archive name>. ".
- **AC24** — Given a saved Archive URI that is in the Rootlist, when an Archive run starts, then
  that playlist is used whatever its current name. No name lookup and no creation happen.
- **AC25** — Given no saved Archive URI in the Rootlist (never saved, or saved and since removed),
  and several playlists that the user owns and can edit named `ARCHIVE_NAME`, when an Archive run
  starts, then the first in depth-first Rootlist order is used and its URI is saved. No playlist is
  created.
- **AC26** — Given name lookup runs (AC25), when the only playlists named `ARCHIVE_NAME` are owned
  by the user but not editable, or editable but owned by someone else, then none is used, and
  creation follows AC23.

### Errors and lifecycle

- **AC27** — Given a Rootlist call, the Archive read, creation or an add call throws, when the run
  ends, then `lastRun` records outcome `error` with the short reason, the details are logged to the
  console, and an error-styled notice reads "Discover Weekly Archive failed: <short reason>". A
  second `error` in the same load shows no further notice. A Source read that throws follows AC22,
  not this criterion.
- **AC28** — Given a run ended `error`, when a later run ends `added`, then `lastRun` no longer
  holds an error.
- **AC29** — Given the module is disposed while a run is waiting for client readiness, the
  Rootlist, a playlist read, creation or an add batch, when that wait resolves, then the run issues
  no further create or add call, writes no storage and shows no notice. An add request already sent
  when dispose ran may still complete.
- **AC30** — Given the module is disposed while waiting for client readiness, when the client then
  becomes ready, then no launch run starts.
- **AC31** — When the module is disabled, then the interval is cleared and the Settings section is
  removed from the Settings page.
- **AC32** — Given the module is disabled and then enabled, when it loads again, then exactly one
  interval is active, one Settings section is registered, and one launch run starts.
- **AC33** — Given `load()` throws after registering the interval or the Settings section, when the
  throw propagates, then everything it registered has already been disposed.

### Notices

- **AC34** — Given an Archive run adds N > 0 songs, when it completes, then one notice reads
  "Archived N songs from Discover Weekly to <Archive name>", using the playlist's current name and
  "1 song" when N is 1. A later run that adds songs shows it again.

### Settings

- **AC35** — When the Settings section opens and the playlist list loads, then the Source playlist
  dropdown lists "Automatic (Discover Weekly)" first, then every playlist in the Rootlist (folders
  flattened), labelled by name, with the saved choice selected.
- **AC36** — When the user picks a Source playlist, then `sourceUri` is saved and the next Archive
  run uses it, whatever its trigger. When they pick "Automatic (Discover Weekly)", then `sourceUri`
  is cleared and the next run uses Automatic detection.
- **AC37** — When the Settings section opens and the playlist list loads, then the Archive playlist
  dropdown lists only the playlists the user both owns and can edit, labelled by name, with the
  saved Archive playlist selected. Picking another saves its URI, and the next run adds to it.
- **AC38** — Given any Archive run is active, whatever started it, then "Archive now" is disabled.
  It is enabled again when the run ends, on every outcome.
- **AC39** — When the Settings section opens, and again after each run ends while it is open, then
  the status line follows the Design § Settings section table for the stored `lastRun`, with "Not
  run yet" when none is stored.
- **AC40** — Given the playlist list request fails or fails partway, when the Settings section
  opens, then an error line is shown. Each dropdown offers only its saved value, labelled by name
  if known, else by URI, and no stored value changes.

### Account safety (live)

- **AC41** — *(live)* Every probe that writes runs against a playlist named `DWA test <timestamp>`
  that it created, and deletes it in a `finally`. No probe edits, reorders or unsaves an existing
  playlist.
- **AC42** — *(live)* Before the first `spicetify apply` of a build that runs Archive runs, the
  module's `archiveUri` storage key holds the URI of a playlist named `DWA dev`. During development
  no Archive run adds to "Discover Weekly Archive".
- **AC43** — *(live)* Before the Platform adapters are written, `docs/spicetify-v3-platform.md`
  records Live verification items 1–7, each with the Spotify, CLI and kit versions it was checked on.

### Package and store

- **AC44** — `src/metadata.json` has `name` `discover-weekly-archive`, string `authors`
  (`["Heyian"]`), no `tags` and no `kind`, and a description stating both that the module creates a
  "Discover Weekly Archive" playlist when none exists and that it runs while Spotify is open.
- **AC45** — The README's first section states that:
  - the module creates the playlist when none exists;
  - it works only while Spotify is open, and a week in which Spotify never opens cannot be
    recovered;
  - it should be enabled on one computer only;
  - on a non-English client, the Source playlist is picked in Settings.
- **AC46** — `.github/workflows/ci.yml` runs `bun run check`, `bun run build:local` and
  `bun run check:dist` on every pull request and every push to `main`.
- **AC47** — `.github/workflows/release.yml` runs release-please on pushes to `main`. When a
  release is created, it builds from the tag, runs `check:dist --tag`, attaches the zip to the
  release, and writes the store entry to the job summary. With no `SPICETIFY_SUBMIT_TOKEN`, it opens
  no store PR (the 0.1.0 path). With the token set, `spicetify/actions/publish@v1` opens it.

## Agent's Calls

1. **`RECHECK_INTERVAL` = 6 hours.** Two playlist reads four times a day is negligible, and it
   catches a Monday refresh the same day. Dropped: 1 h (no gain) and 24 h (could miss a day).
2. **An Archive playlist dropdown** on top of Q3's automatic creation. This is separate from Q2,
   whose dropdown is for the Source playlist only. The user approved the idea on 2026-11-04. It lets an IFTTT user with a
   differently named archive point at it, reuses the Source dropdown, and is how development
   points at `DWA dev` (Q6). Dropped: automatic only (no way to fix a wrong pick).
3. **"Archive now" button and status line.** These are how a user checks that the module works
   without waiting for Monday. Dropped: no Settings controls beyond the dropdowns.
4. **Dedupe by track URI only.** It is simple and predictable. Relinked duplicates are rare. Dropped:
   matching by ISRC or by title and artist, which costs extra lookups and can create false matches.
5. **Silent when 0 songs are added; notices at most once per load for the missing-source and error
   cases.** The interval would otherwise spam.
6. **Automatic detection requires a Spotify owner,** not just a name match, so a user's own playlist
   called "Discover Weekly" is never taken as the Source playlist.
7. **Tooling mirrors track-playlist-preview:** bun, spicetify-kit, vitest, tsc, release-please,
   `spicetify/actions/publish@v1`, MIT. The repo is public under `Heyian`. Pin each action to its
   current major on the day of writing (2026-11-04: `actions/checkout@v7`, `actions/setup-node@v7`,
   `oven-sh/setup-bun@v2`, `googleapis/release-please-action@v5`, `spicetify/actions/publish@v1`).
   Dropped: the `spicetify/modules` monorepo tooling (pnpm, stitch), which assumes in-repo modules.
8. **Kit 0.4.4, not 0.3.1.** It is the latest. Read its changelog for breaking changes against
   track-playlist-preview's `build.ts` and `scripts/kitBuild.ts` before copying them.
9. **First release `0.1.0`, print-only,** with a hand-opened store PR. This is the same path
   track-playlist-preview took. Automatic submission starts once the token secret exists.
10. **Own-Discover-Weekly field, if one exists, joins the detection test without a new decision.**
   It only narrows Automatic detection. If none exists, a followed friend's Discover Weekly that
   comes first in the Rootlist would be taken. That is accepted, and the Source playlist setting
   fixes it.
11. **Turn off IFTTT before enabling the module,** not after a week of overlap (operator step 9).
   An overlap week guarantees duplicates.

## Deferred Items

None. Nothing was deferred while questioning. The language-independent lookup (option C) was
declined rather than deferred, and Live verification item 2 only records a finding. This repo
has no issue tracker history yet. File any deferral that comes up during implementation in
`Heyian/discover-weekly-archive` with Context, Required, Integration Points and Priority.

## Glossary Updates & ADRs

- Glossary: this repo has no glossary file, so the terms live in this spec's Terms section.
  track-playlist-preview keeps its terms the same way.
- ADRs: none. No decision passes the gate (hard to reverse, surprising, and a real trade-off). The
  name is hard to reverse, but it is not surprising.
- No ADR conflicts: this repo has no ADRs, and track-playlist-preview's two (GraphQL preview audio,
  building with kit) are consistent with this design.

## Config & Infrastructure Impact

The repo is empty apart from this spec. Every file is new.

| Category | File | Change |
| --- | --- | --- |
| Scripts/commands | `package.json` | `build`, `build:local`, `watch`, `test`, `typecheck`, `check`, `check:dist` as in track-playlist-preview. Name `discover-weekly-archive`, MIT, repository URL. |
| Scripts/commands | `build.ts`, `scripts/kitBuild.ts`, `scripts/checkDist.ts` (+ tests) | Copy and adapt `NAME`, against kit 0.4.4. |
| Scripts/commands | `scripts/cdp-eval.mjs` | Copy for live verification. |
| Scripts/commands | `tsconfig.json`, `bun.lock` | Copy and adapt. Generate the lockfile. |
| CI/CD | `.github/workflows/ci.yml` | Check, build:local and check:dist on PRs and on main. |
| CI/CD | `.github/workflows/release.yml` | release-please plus a publish job with the fork sync and `spicetify/actions/publish@v1`, reading `SPICETIFY_SUBMIT_TOKEN`. |
| CI/CD | `release-please-config.json`, `.release-please-manifest.json` | Node release type with `src/metadata.json` `$.version` as an extra file, `include-component-in-tag: false`, and a `scripts/releaseConfig.test.ts` like track-playlist-preview's. |
| Module | `src/metadata.json`, `src/index.scss` | Per AC44. Add a minimal stylesheet only if the Settings section needs one. |
| Repo | `.gitignore`, `.gitattributes`, `LICENSE` | Copy from track-playlist-preview, with the MIT copyright set to Heyian 2026. |
| Env config | — | No env vars. One repo secret, `SPICETIFY_SUBMIT_TOKEN` (Manual Operator Steps). |
| Containers / IaC / Schemas / API collections | — | None. Not applicable to a client module. |
| Agent index + docs | `CLAUDE.md`, `README.md`, `docs/spicetify-v3-platform.md`, `docs/preview.png` | See Documentation Updates. |

## Manual Operator Steps

In order. The agent does none of these.

1. **Create the GitHub repo** (if not done in the brainstorm session):
   `gh repo create Heyian/discover-weekly-archive --public --description "Spicetify v3 module that archives your Discover Weekly into a playlist, adding only the songs that aren't there yet."`.
   The local `origin` already points at it.
2. **Start Spotify with the debug port** before Live verification. This interrupts playback:
   `pkill -x spotify; sleep 3; setsid /opt/spotify/spotify --remote-debugging-port=8088 >/dev/null 2>&1 &`.
   Repeat after every `spicetify apply`.
3. **Allow Actions to open PRs.** GitHub → `Heyian/discover-weekly-archive` → Settings → Actions →
   General → Workflow permissions → tick "Allow GitHub Actions to create and approve pull
   requests". Do this before `release.yml` first lands on `main`.
4. **Approve the store preview image** (`docs/preview.png`, a 16:9 screenshot of the Settings
   section taken over the debug port) before it is committed.
5. **Merge the release PR** `chore(main): release 0.1.0`. The publish job attaches the zip and prints
   the store entry.
6. **Clean-install check.** On a Spicetify v3 setup that has never had this module, run
   `spicetify pkg install discover-weekly-archive <release zip URL>`, then
   `spicetify pkg enable discover-weekly-archive` and `spicetify apply`. Confirm that an Archive run
   happens and that the Settings section appears.
7. **Open the store PR by hand.** In your `spicetify/modules` fork, add
   `vault/discover-weekly-archive.json` with the entry from step 5, and open
   `Publish discover-weekly-archive@0.1.0`.
8. **Later releases.** Add the repo secret `SPICETIFY_SUBMIT_TOKEN` (repo → Settings → Secrets and
   variables → Actions). Reuse the classic `public_repo` PAT from track-playlist-preview, or mint a
   new one. From then on, publishing submits the store PR itself.
9. ~~Turn off the IFTTT applet before first enabling the module.~~ Done by the user on 2026-11-04.
   IFTTT does not check for duplicates, so the two must not run in the same week.
10. **Switch to the real archive.** Once the branch is merged and installed, open Spicetify Settings →
   Discover Weekly Archive. Set the Archive playlist to "Discover Weekly Archive", click "Archive
   now", and confirm only this week's missing songs were added. Then delete `DWA dev`.

## Documentation Updates

- `CLAUDE.md`: commands, the architecture rule, the non-obvious constraints from this spec and
  pointers to this spec and the platform notes. Keep it under 250 lines and follow
  track-playlist-preview's shape.
- `README.md`: per AC45, plus store install, settings and the build-from-source commands.
- `docs/spicetify-v3-platform.md`: copy only the track-playlist-preview sections this module relies
  on, re-verified, plus the Live verification findings. Each section names the version it was
  checked on.
- `docs/preview.png`: the store preview (operator step 4). `metadata.json` `preview` is its absolute
  raw GitHub URL.

## Implementation Plan Guidance

> **For the plan author (`superpowers:writing-plans`):**
>
> Before writing tasks, read the repo's agent index (`CLAUDE.md`/`AGENTS.md`) for architecture, commands, and conventions.
>
> The plan must include the tasks described under **Required Tasks** below, AND must apply every rule under **Per-Task Policies** to every implementation task.
>
> ---
>
> ### Required Tasks (each item produces explicit numbered tasks in the plan)
>
> 1. **Isolated workspace** — IF the session is not already isolated, add as the first task: *"Create an isolated workspace via `superpowers:using-git-worktrees`."*
> 2. ~~Glossary application~~ — dropped: this repo has no glossary file; terms live in the spec's Terms section.
> 3. ~~ADR creation~~ — dropped: the spec lists no ADRs.
> 4. **Deferred-item verification** — Add a task: *"Confirm every issue referenced in the 'Deferred Items' section exists and has all four required body sections (Context, Required, Integration Points, Priority)."* Run `gh issue view <#> --json body | jq -r .body` and grep for the four headings.
> 5. **Config file tasks** — FOR EACH file listed in the spec's "Config & Infrastructure Impact" section, add one explicit task: *"Update `<path>`."*
> 6. **Manual Operator Steps** — IF the spec's "Manual Operator Steps" section is non-empty, add a task ahead of every task that depends on those values existing: *"Hand the operator the Manual Operator Steps and wait for confirmation; if a wizard-generation skill is available, generate the script first."* The agent never performs these steps itself and never substitutes a placeholder credential to unblock itself.
> 7. **Docs update tasks** — FOR EACH entry in the spec's "Documentation Updates" section, add one explicit task: *"Update `<doc-path>`."* Design content goes in the docs dir, not the agent index; the index gets at most a 1-line pointer, a ≤3-sentence area summary, or a 1-line command/env-var entry.
> 8. **Post-implementation check** — Add as the second-to-last task: *"Verify every Required Task above was actually executed — config files updated, docs written, glossary entries applied, ADRs created."* Read the diff; don't trust plan markings.
> 9. **Final build task** — Add as the last task: *"Run `bun run build:local && bun run check:dist` and fix any issues until it builds successfully."* Non-negotiable — type-checks and tests alone do not catch all build-time failures.
>
> ---
>
> ### Per-Task Policies (apply to every implementation task)
>
> These are not separate tasks; they are rules every task must follow.
>
> - **Testing (TDD)** — Follow `superpowers:test-driven-development`, using the repo's test runner and file-name conventions.
> - **Verification before completion** — Before claiming a task done, invoke `superpowers:verification-before-completion`. Do not rely on type-checks alone for UI features.
> - **Commit hygiene** — One focused commit per task, matching the commit-message convention visible in this repo's history. Commit frequently.
> - **Pre-commit verification (mandatory)** — Before EVERY `git commit`, dispatch a verification subagent that runs `bun run check` from the repo root and reports `STATUS: PASS` or `STATUS: FAIL` with a terse per-issue list (no raw output). Wait for `STATUS: PASS` before committing; if FAIL, fix in the current task and re-run. Never use `git commit --no-verify`.
>
> ---
>
> ### Before finishing the branch (advisory cross-model review)
>
> After the final build passes — and before wrapping up via `superpowers:finishing-a-development-branch` — if a cross-model review helper is available (e.g. the Codex plugin's adversarial review), run it with focus: *"Judge correctness against the spec's acceptance criteria (AC1–AC47) only. Do not flag anything outside the stated criteria — no design alternatives, hardening, or scope the spec did not claim."*
>
> This **never gates a merge** — the gate stays `bun run check` plus `bun run build:local && bun run check:dist`; the review only flags what deserves a second look. If no helper is available, finish the branch without it.

Repo-specific additions:

- **Live verification is the first implementation task after scaffolding** (Design § Live
  verification). The adapters and AC6, AC7, AC14–AC17, AC23 and AC26 depend on what it finds.
- **Commits use Conventional Commit prefixes** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`,
  `build:`), because release-please reads them. Until the build exists, `bun run check` cannot run.
  The scaffolding task's own commit is checked by `bun install && bun run check` once
  `package.json` exists.
