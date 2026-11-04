// src/index.ts
// Entry point: the v3 loader calls load(ctx). It builds one wiring — live
// adapters, the scheduler and the Settings section — starts the launch run
// without awaiting the client, and registers its dispose with ctx.defer.
// Every load() builds a fresh wiring; unload disposes all of it.
import { runArchive } from "./archiveRun";
import { ADD_BATCH_SIZE, PREVIOUS_RUN_WAIT_MS, READY_TIMEOUT_MS, RECHECK_INTERVAL_MS } from "./constants";
import { createNotices } from "./notices";
import { createLibrary } from "./platform/library";
import { createPlaylists } from "./platform/playlist";
import { createRunGate } from "./runGate";
import { createScheduler, startLaunchRun } from "./scheduler";
import { createStore } from "./storage";
import { createDisposer } from "./teardown";
import { realTimer } from "./timer";
import type { StoragePort } from "./types/domain";
import { notifications } from "./ui/notifications";
import { registerSettingsSection, type ModuleRuntimeContext } from "./ui/settingsSection";
import { waitForClient } from "./waitForClient";

// Module scope on purpose: it outlives disable → enable, so a new load's first run waits for the
// previous load's aborted run (an add may still be in flight) before reading the Archive.
const runGate = createRunGate(realTimer, PREVIOUS_RUN_WAIT_MS);

const localStorageAdapter: StoragePort = {
  get(key) {
    try {
      return Spicetify.LocalStorage.get(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => Spicetify.LocalStorage.set(key, value),
};

function log(message: string, detail?: unknown): void {
  const line = `[discover-weekly-archive] ${message}`;
  if (detail === undefined) console.info(line);
  else console.error(line, detail);
}

const formatTime = (at: number): string => new Date(at).toLocaleString();

/** The readiness globals still absent (docs/spicetify-v3-platform.md § Readiness globals). */
function missing(): string[] {
  const s = (globalThis as { Spicetify?: { Platform?: Record<string, unknown>; showNotification?: unknown } })
    .Spicetify;
  const out = (["RootlistAPI", "PlaylistAPI", "username"] as const)
    .filter((name) => !s?.Platform?.[name])
    .map((name) => `Spicetify.Platform.${name}`);
  if (!s?.showNotification) out.push("Spicetify.showNotification");
  return out;
}

export async function load(ctx: ModuleRuntimeContext): Promise<void> {
  const store = createStore(localStorageAdapter);
  const notices = createNotices(notifications);
  const library = createLibrary();
  const playlists = createPlaylists();
  const scheduler = createScheduler({
    run: (signal) =>
      runArchive(
        { library, playlists, store, notices, log, now: () => Date.now(), batchSize: ADD_BATCH_SIZE },
        signal,
      ),
    gate: runGate,
    timer: realTimer,
    intervalMs: RECHECK_INTERVAL_MS,
    log,
  });

  const launch = new AbortController();
  // Not awaited: load() returns promptly (AC11); the loader awaits modules one by one.
  startLaunchRun({
    waitReady: () => waitForClient({ missing, timer: realTimer, timeoutMs: READY_TIMEOUT_MS, signal: launch.signal }),
    trigger: () => {
      scheduler.trigger();
    },
    signal: launch.signal,
    log,
  });

  const dispose = createDisposer([() => launch.abort(), () => scheduler.dispose()]);
  // Deferred before the registrar exists, so on unload (reverse order) the
  // Settings section goes first, then this wiring.
  ctx.defer(dispose);
  try {
    registerSettingsSection(ctx, { store, scheduler, library, formatTime });
  } catch (error) {
    // load() rejecting means the loader never runs our disposers (partial-load
    // leak), so dispose here; the deferred call later is a no-op (AC33).
    try {
      dispose();
    } catch {
      // The original error is the one load() reports.
    }
    throw error;
  }
}
