import { STORAGE_PREFIX } from "./constants";
import type { RunOutcome, RunRecord, StoragePort } from "./types/domain";

const SOURCE_KEY = `${STORAGE_PREFIX}sourceUri`;
const ARCHIVE_KEY = `${STORAGE_PREFIX}archiveUri`;
const LAST_RUN_KEY = `${STORAGE_PREFIX}lastRun`;

const OUTCOMES: readonly RunOutcome[] = ["added", "source-missing", "source-empty", "source-unreadable", "error"];

function isOutcome(v: unknown): v is RunOutcome {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A stored record, or null when it is corrupt or foreign. */
function parseRunRecord(raw: string): RunRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { at, outcome, addedCount, error } = parsed as Record<string, unknown>;
  if (!isFiniteNumber(at) || !isOutcome(outcome) || !isFiniteNumber(addedCount)) return null;
  const record: RunRecord = { at, outcome, addedCount };
  if (outcome === "error" && typeof error === "string") record.error = error;
  return record;
}

export function createStore(port: StoragePort) {
  return {
    /** `""` means automatic. */
    getSourceUri: (): string => port.get(SOURCE_KEY) ?? "",
    setSourceUri: (uri: string): void => port.set(SOURCE_KEY, uri),
    getArchiveUri: (): string | null => port.get(ARCHIVE_KEY) || null,
    setArchiveUri: (uri: string): void => port.set(ARCHIVE_KEY, uri),
    getLastRun(): RunRecord | null {
      const raw = port.get(LAST_RUN_KEY);
      return raw === null ? null : parseRunRecord(raw);
    },
    setLastRun(record: RunRecord): void {
      const { error, ...rest } = record;
      const clean: RunRecord = record.outcome === "error" && error !== undefined ? { ...rest, error } : rest;
      port.set(LAST_RUN_KEY, JSON.stringify(clean));
    },
  };
}

export type Store = ReturnType<typeof createStore>;
