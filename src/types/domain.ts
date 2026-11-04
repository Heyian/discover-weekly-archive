export type RunOutcome = "added" | "source-missing" | "source-empty" | "source-unreadable" | "error";

export interface RunRecord {
  /** Epoch ms. */
  at: number;
  outcome: RunOutcome;
  addedCount: number;
  /** Present only when `outcome` is `error`. */
  error?: string;
}

export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface NotifyPort {
  info(message: string): void;
  error(message: string): void;
}

export interface PlaylistEntry {
  uri: string;
  name: string;
  ownedBySpotify: boolean;
  ownedByUser: boolean;
  canEdit: boolean;
  /** From Live verification's own-Discover-Weekly field; null when none exists (AC17). */
  isOwnDiscoverWeekly: boolean | null;
}

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
