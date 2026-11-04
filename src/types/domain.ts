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
