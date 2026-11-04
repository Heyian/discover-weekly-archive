export const MODULE_ID = "discover-weekly-archive";
export const DISCOVER_WEEKLY_NAME = "Discover Weekly";
export const ARCHIVE_NAME = "Discover Weekly Archive";
export const READY_TIMEOUT_MS = 10_000;
export const RECHECK_INTERVAL_MS = 21_600_000;
// Longest a run waits for the previous load's aborted run (an add in flight) to settle.
export const PREVIOUS_RUN_WAIT_MS = 10_000;
// Longest one Archive run holds the single-run guard; a Platform call that never settles is abandoned.
export const RUN_TIMEOUT_MS = 300_000;
export const STORAGE_PREFIX = "discover-weekly-archive:";
// PlaylistAPI.add showed no per-call limit up to 500 (docs/spicetify-v3-platform.md); 100 by choice.
export const ADD_BATCH_SIZE = 100;
