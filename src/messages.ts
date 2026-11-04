import type { RunRecord } from "./types/domain";

const MAX_REASON = 80;

const songs = (count: number): string => `${count} ${count === 1 ? "song" : "songs"}`;

export function statusLine(record: RunRecord | null, formatTime: (at: number) => string): string {
  if (!record) return "Not run yet";
  const prefix = `Last run: ${formatTime(record.at)} · `;
  switch (record.outcome) {
    case "error":
      return `${prefix}failed: ${record.error ?? ""}`;
    case "source-missing":
      return `${prefix}Discover Weekly not found — pick it below`;
    case "source-empty":
      return `${prefix}Discover Weekly was empty, will retry`;
    case "source-unreadable":
      return `${prefix}couldn't read Discover Weekly, will retry`;
    case "added":
      return `${prefix}${songs(record.addedCount)} added`;
  }
}

export function archivedNotice(count: number, archiveName: string, created: boolean): string {
  const archived = `Archived ${songs(count)} from Discover Weekly to ${archiveName}`;
  return created ? `Created ${archiveName}. ${archived}` : archived;
}

export const SOURCE_MISSING_NOTICE =
  "Discover Weekly Archive couldn't find Discover Weekly. Save it to your library, or pick it in Spicetify Settings.";

export function errorNotice(reason: string): string {
  return `Discover Weekly Archive failed: ${reason}`;
}

export function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n")[0] ?? "";
  return firstLine.length > MAX_REASON ? `${firstLine.slice(0, MAX_REASON - 1)}…` : firstLine;
}
