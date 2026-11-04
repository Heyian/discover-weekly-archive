import { isArchiveCandidate } from "../resolve";
import type { PlaylistEntry } from "../types/domain";

export interface Option {
  value: string;
  label: string;
}

export type PlaylistList = { ok: true; playlists: PlaylistEntry[] } | { ok: false };

export const AUTOMATIC_SOURCE_LABEL = "Automatic (Discover Weekly)";
export const AUTOMATIC_ARCHIVE_LABEL = 'Automatic ("Discover Weekly Archive")';
export const LIST_ERROR_LINE = "Couldn't load your playlists.";

const toOption = (p: PlaylistEntry): Option => ({ value: p.uri, label: p.name });

/** `list === null` means still loading; it shows the same options as a failed load. */
export function sourceOptions(list: PlaylistList | null, savedUri: string): Option[] {
  const automatic: Option = { value: "", label: AUTOMATIC_SOURCE_LABEL };
  if (!list || !list.ok) {
    return savedUri === "" ? [automatic] : [{ value: savedUri, label: savedUri }];
  }
  const options = [automatic, ...list.playlists.map(toOption)];
  if (savedUri !== "" && !options.some((o) => o.value === savedUri)) {
    options.push({ value: savedUri, label: savedUri });
  }
  return options;
}

export function archiveOptions(list: PlaylistList | null, savedUri: string | null): Option[] {
  const automatic: Option = { value: "", label: AUTOMATIC_ARCHIVE_LABEL };
  if (!list || !list.ok) {
    return savedUri === null ? [automatic] : [{ value: savedUri, label: savedUri }];
  }
  const options = list.playlists.filter(isArchiveCandidate).map(toOption);
  if (savedUri === null) return [automatic, ...options];
  if (!options.some((o) => o.value === savedUri)) options.push({ value: savedUri, label: savedUri });
  return options;
}
