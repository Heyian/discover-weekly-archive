import { ARCHIVE_NAME } from "./constants";
import { shortReason } from "./messages";
import type { Notices } from "./notices";
import { batches, missingTracks, resolveArchive, resolveSource, trackUris } from "./resolve";
import type { Store } from "./storage";
import type { LibraryPort, PlaylistEntry, PlaylistPort, RunOutcome, RunRecord } from "./types/domain";

export interface ArchiveRunDeps {
  library: LibraryPort;
  playlists: PlaylistPort;
  store: Store;
  notices: Notices;
  log: (message: string, detail?: unknown) => void;
  now: () => number;
  batchSize: number;
}

/** One Archive run (spec Design § Archive run). Never throws. Resolves null when aborted. */
export async function runArchive(deps: ArchiveRunDeps, signal: AbortSignal): Promise<RunRecord | null> {
  try {
    return await execute(deps, signal);
  } catch (err) {
    // A failing store or notice port: nothing more to write or show.
    deps.log("Archive run crashed", err);
    return null;
  }
}

async function execute(deps: ArchiveRunDeps, signal: AbortSignal): Promise<RunRecord | null> {
  const { library, playlists, store, notices, log, now, batchSize } = deps;
  let addedCount = 0;

  const finish = (outcome: RunOutcome, error?: string): RunRecord => {
    const record: RunRecord = { at: now(), outcome, addedCount };
    if (error !== undefined) record.error = error;
    store.setLastRun(record);
    return record;
  };

  const fail = (err: unknown): RunRecord => {
    log("Archive run failed", err);
    const reason = shortReason(err);
    const record = finish("error", reason);
    notices.error(reason);
    return record;
  };

  let all: PlaylistEntry[];
  try {
    all = await library.listPlaylists();
  } catch (err) {
    return signal.aborted ? null : fail(err);
  }
  if (signal.aborted) return null;

  const source = resolveSource(all, store.getSourceUri());
  if (!source) {
    const record = finish("source-missing");
    notices.sourceMissing();
    return record;
  }

  let sourceTracks: string[];
  try {
    sourceTracks = trackUris(await playlists.readItemUris(source.uri));
  } catch (err) {
    if (signal.aborted) return null;
    log("Source playlist unreadable", err);
    return finish("source-unreadable");
  }
  if (signal.aborted) return null;
  if (sourceTracks.length === 0) {
    log("Source playlist has no tracks");
    return finish("source-empty");
  }

  let archiveName: string;
  let created: boolean;
  try {
    const existing = resolveArchive(all, store.getArchiveUri());
    let archiveUri: string;
    created = existing === null;
    if (existing) {
      archiveUri = existing.uri;
      archiveName = existing.name;
    } else {
      archiveUri = await library.createPlaylist(ARCHIVE_NAME);
      if (signal.aborted) return null;
      archiveName = ARCHIVE_NAME;
    }
    store.setArchiveUri(archiveUri);

    const archiveTracks = created ? [] : trackUris(await playlists.readItemUris(archiveUri));
    if (signal.aborted) return null;

    for (const batch of batches(missingTracks(sourceTracks, archiveTracks), batchSize)) {
      await playlists.addTracks(archiveUri, batch);
      if (signal.aborted) return null;
      addedCount += batch.length;
    }
  } catch (err) {
    return signal.aborted ? null : fail(err);
  }

  const record = finish("added");
  if (addedCount > 0) notices.archived(addedCount, archiveName, created);
  return record;
}
