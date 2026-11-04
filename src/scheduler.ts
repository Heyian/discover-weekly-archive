import type { RunGate } from "./runGate";
import type { TimerPort } from "./types/domain";

export interface Scheduler {
  /** Starts a run unless one is active; returns whether it started. */
  trigger(): boolean;
  isRunning(): boolean;
  /** Called when a run starts and when it ends; returns unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Clears the interval, aborts the active run, drops listeners. Idempotent. */
  dispose(): void;
}

export function createScheduler(opts: {
  run: (signal: AbortSignal) => Promise<unknown>;
  /** Shared across loads: a run starts once the previous load's last run settled (capped). */
  gate: RunGate;
  timer: TimerPort;
  intervalMs: number;
  log: (message: string, detail?: unknown) => void;
}): Scheduler {
  const { run, gate, timer, intervalMs, log } = opts;
  const listeners = new Set<() => void>();
  let active: AbortController | null = null;
  let disposed = false;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const trigger = (): boolean => {
    if (disposed || active) return false;
    const controller = new AbortController();
    active = controller;
    notify();
    void gate
      .enter(controller.signal, async () => {
        try {
          await run(controller.signal);
        } catch (error) {
          log("Archive run failed", error);
        }
      })
      .then(() => {
        active = null;
        notify();
      });
    return true;
  };

  const interval = timer.setInterval(trigger, intervalMs);

  return {
    trigger,
    isRunning: () => active !== null,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      timer.clearInterval(interval);
      active?.abort();
      listeners.clear();
    },
  };
}

/** Launch run: trigger once `waitReady` resolves, unless `signal` aborted; log a rejection not caused by the abort. */
export function startLaunchRun(opts: {
  waitReady: () => Promise<void>;
  trigger: () => void;
  signal: AbortSignal;
  log: (message: string, detail?: unknown) => void;
}): void {
  const { waitReady, trigger, signal, log } = opts;
  void waitReady().then(
    () => {
      if (!signal.aborted) trigger();
    },
    (error: unknown) => {
      if (!signal.aborted) log("Launch run skipped: client not ready", error);
    },
  );
}
