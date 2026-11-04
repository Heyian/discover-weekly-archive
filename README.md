# Discover Weekly Archive

A [Spicetify](https://spicetify.app) **v3** module that copies your Discover Weekly into a
"Discover Weekly Archive" playlist, adding only songs that are not already there.

> **Spicetify v3 only.** This module targets the Spicetify v3 CLI (3.x) and its module system.
> Spicetify v2 (`spicetify-cli` 2.x and its `Extensions/` folder) is not supported.

Spotify replaces Discover Weekly every week, and last week's songs are gone. This module keeps them
in a playlist of your own.

## What it does

- **Archives each week.** It runs at launch, once the client is ready, and every 6 hours after that.
  It adds only the songs missing from the Archive, matched by track URI, so repeat runs add nothing.
- **Creates the playlist if needed.** If you have no "Discover Weekly Archive" playlist, the module
  creates one in your library root.
- **Works only while Spotify is open.** A week in which Spotify is never opened can't be recovered.
- **Enable it on one computer only.** Settings are per client, and two clients running at the same
  time can add the same songs twice.
- **Finds Discover Weekly automatically.** It looks for the Spotify-owned playlist named exactly
  "Discover Weekly" that was made for you. On a non-English client that name differs, so pick your
  Discover Weekly as the Source playlist in Settings.

## Install

Requires [Spicetify](https://spicetify.app/docs/getting-started) **v3** (CLI 3.x). v2 is not
supported.

### From the module store

Install **Discover Weekly Archive** from the in-client store, or from a terminal:

```bash
spicetify pkg install discover-weekly-archive
spicetify pkg enable discover-weekly-archive
spicetify apply          # restarts Spotify
```

### From a release zip

Install a release's zip by URL. This form skips checksum verification.

```bash
spicetify pkg install discover-weekly-archive https://github.com/Heyian/discover-weekly-archive/releases/download/v<version>/discover-weekly-archive@<version>.zip
spicetify pkg enable discover-weekly-archive
spicetify apply
```

### From source

Also requires [Bun](https://bun.com/docs/installation) and [Node.js](https://nodejs.org) ≥ 22.

```bash
git clone https://github.com/Heyian/discover-weekly-archive.git
cd discover-weekly-archive
bun install
bun run build            # builds into your Spicetify modules folder
spicetify apply          # restarts Spotify
```

`bun run check` runs the typecheck and the tests.

## Settings

Open the profile menu in Spotify → **Spicetify Settings** → **Discover Weekly Archive** section.

| Setting | Description |
| --- | --- |
| Source playlist | Where songs come from. "Automatic (Discover Weekly)" is first, then every playlist in your library. |
| Archive playlist | Where songs go. Lists only playlists you own and can edit. |
| Archive now | Runs an archive right away. Disabled while a run is active. |
| Status | The result of the last run. |

## Caveats

This module depends on **internal, undocumented Spotify APIs**. They carry no compatibility
guarantee and can change without notice.

Not affiliated with, endorsed by, or sponsored by Spotify.

## License

[MIT](LICENSE) © Heyian
