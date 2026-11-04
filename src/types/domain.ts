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
