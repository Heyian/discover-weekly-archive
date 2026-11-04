import type { TimerPort } from "./types/domain";

/** Timers over the global scope; looked up per call so fake timers apply. */
export const realTimer: TimerPort = {
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
  clearInterval: (id) => globalThis.clearInterval(id),
};
