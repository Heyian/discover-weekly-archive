// Capped wait for client readiness before the launch run touches the Spicetify globals.
// Pure: the probe and the timer are injected; index.ts supplies the Spicetify probe.
import type { TimerId, TimerPort } from "./types/domain";

export interface WaitForClientOptions {
  /** Names of the globals still absent, as dotted paths from the Spicetify global; empty when ready. */
  missing: () => string[];
  timer: TimerPort;
  timeoutMs: number;
  pollMs?: number;
  /** On abort, both timers are cleared and the wait rejects. */
  signal?: AbortSignal;
}

export function waitForClient({
  missing,
  timer,
  timeoutMs,
  pollMs = 50,
  signal,
}: WaitForClientOptions): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("Wait for client aborted"));
  if (missing().length === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let poll: TimerId;
    const cleanup = (): void => {
      timer.clearTimeout(deadline);
      timer.clearTimeout(poll);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new Error("Wait for client aborted"));
    };
    const deadline = timer.setTimeout(() => {
      cleanup();
      reject(new Error(`Client not ready after ${timeoutMs} ms; missing: ${missing().join(", ")}`));
    }, timeoutMs);

    const check = (): void => {
      if (missing().length === 0) {
        cleanup();
        resolve();
        return;
      }
      poll = timer.setTimeout(check, pollMs);
    };
    poll = timer.setTimeout(check, pollMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
