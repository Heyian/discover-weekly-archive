// src/runGate.ts
// Orders Archive runs across loads. index.ts keeps one gate at module scope, which survives
// disable → enable (docs/spicetify-v3-platform.md § Unload, enable and reload). A run aborted by
// dispose may still have an add in flight; the next run waits for it before reading the Archive,
// so it does not add the same songs again.
import type { TimerPort } from "./types/domain";

export interface RunGate {
  /**
   * Starts `body` once the previously entered body settles, `capMs` elapses or `signal` aborts,
   * whichever comes first; on abort, `body` never starts. With nothing pending, `body` starts
   * synchronously. The returned promise settles with `body` and never rejects.
   */
  enter(signal: AbortSignal, body: () => Promise<void>): Promise<void>;
}

const noop = (): void => {};

function settledOrCapped(previous: Promise<void>, timer: TimerPort, capMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      timer.clearTimeout(id);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const id = timer.setTimeout(done, capMs);
    signal.addEventListener("abort", done);
    void previous.then(done);
  });
}

export function createRunGate(timer: TimerPort, capMs: number): RunGate {
  let pending: Promise<void> | null = null;
  return {
    enter(signal, body) {
      const previous = pending;
      const started = previous
        ? settledOrCapped(previous, timer, capMs, signal).then(() => (signal.aborted ? undefined : body()))
        : body();
      const settled = started.then(noop, noop);
      pending = settled;
      void settled.then(() => {
        if (pending === settled) pending = null;
      });
      return settled;
    },
  };
}
