import { ARCHIVE_NAME, DISCOVER_WEEKLY_NAME } from "./constants";
import type { PlaylistEntry } from "./types/domain";

export function isArchiveCandidate(p: PlaylistEntry): boolean {
  return p.ownedByUser && p.canEdit;
}

function detectSource(playlists: PlaylistEntry[]): PlaylistEntry | null {
  return (
    playlists.find(
      (p) => p.name === DISCOVER_WEEKLY_NAME && p.ownedBySpotify && p.isOwnDiscoverWeekly !== false,
    ) ?? null
  );
}

/** `savedUri` of "" means automatic detection. */
export function resolveSource(playlists: PlaylistEntry[], savedUri: string): PlaylistEntry | null {
  if (savedUri !== "") {
    const saved = playlists.find((p) => p.uri === savedUri);
    if (saved) return saved;
  }
  return detectSource(playlists);
}

export function resolveArchive(playlists: PlaylistEntry[], savedUri: string | null): PlaylistEntry | null {
  if (savedUri) {
    const saved = playlists.find((p) => p.uri === savedUri);
    if (saved) return saved;
  }
  return playlists.find((p) => p.name === ARCHIVE_NAME && isArchiveCandidate(p)) ?? null;
}

/** Keeps `spotify:track:` URIs only, in first-occurrence order. */
export function trackUris(itemUris: string[]): string[] {
  return [...new Set(itemUris.filter((u) => u.startsWith("spotify:track:")))];
}

export function missingTracks(source: string[], archive: string[]): string[] {
  const have = new Set(archive);
  return source.filter((u) => !have.has(u));
}

export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
