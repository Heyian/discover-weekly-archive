import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createScheduler, startLaunchRun } from "./scheduler";
import { RECHECK_INTERVAL_MS, RUN_TIMEOUT_MS } from "./constants";
import { createRunGate, type RunGate } from "./runGate";
import { realTimer } from "./timer";

const SETTLE_CAP = 10_000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(run: (signal: AbortSignal) => Promise<unknown>, gate: RunGate = createRunGate(realTimer, SETTLE_CAP)) {
  const log = vi.fn();
  const scheduler = createScheduler({
    run,
    gate,
    timer: realTimer,
    intervalMs: RECHECK_INTERVAL_MS,
    runTimeoutMs: RUN_TIMEOUT_MS,
    log,
  });
  return { scheduler, log };
}

describe("createScheduler", () => {
  it("AC9: drops a trigger while a run is active and does not start it afterwards", async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const { scheduler } = setup(run);

    expect(scheduler.trigger()).toBe(true);
    expect(scheduler.trigger()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    d.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("AC10: releases the guard after a resolve", async () => {
    const run = vi.fn(() => Promise.resolve());
    const { scheduler } = setup(run);

    expect(scheduler.trigger()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.trigger()).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("AC10: releases the guard after a rejection and logs it", async () => {
    const run = vi.fn(() => Promise.reject(new Error("boom")));
    const { scheduler, log } = setup(run);

    expect(scheduler.trigger()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalled();
    expect(scheduler.trigger()).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("AC13: runs on the interval, first at the full period", async () => {
    const run = vi.fn(() => Promise.resolve());
    const { scheduler } = setup(run);

    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("AC31: dispose clears the interval and aborts the active run", async () => {
    const d = deferred();
    let seen: AbortSignal | undefined;
    const run = vi.fn((signal: AbortSignal) => {
      seen = signal;
      return d.promise;
    });
    const { scheduler } = setup(run);

    scheduler.trigger();
    expect(seen?.aborted).toBe(false);
    scheduler.dispose();
    expect(seen?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a new scheduler's first run waits for an aborted run of the previous one to settle", async () => {
    const gate = createRunGate(realTimer, SETTLE_CAP);
    const addInFlight = deferred();
    const first = setup(() => addInFlight.promise, gate);
    first.scheduler.trigger();
    first.scheduler.dispose();

    const run = vi.fn(() => Promise.resolve());
    const second = setup(run, gate);
    expect(second.scheduler.trigger()).toBe(true);
    expect(second.scheduler.isRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(SETTLE_CAP - 1);
    expect(run).not.toHaveBeenCalled();

    addInFlight.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(second.scheduler.isRunning()).toBe(false);
    second.scheduler.dispose();
  });

  it("disposed while waiting for the previous run: the run never starts and no timer is left", async () => {
    const gate = createRunGate(realTimer, SETTLE_CAP);
    const first = setup(() => new Promise(() => {}), gate);
    first.scheduler.trigger();
    first.scheduler.dispose();

    const run = vi.fn(() => Promise.resolve());
    const second = setup(run, gate);
    second.scheduler.trigger();
    second.scheduler.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SETTLE_CAP);
    expect(run).not.toHaveBeenCalled();
  });

  it("a run that never settles is aborted at the run cap and the guard is released", async () => {
    let seen: AbortSignal | undefined;
    const run = vi.fn((signal: AbortSignal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const { scheduler, log } = setup(run);
    const listener = vi.fn();
    scheduler.onChange(listener);

    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS - 1);
    expect(scheduler.isRunning()).toBe(true);
    expect(scheduler.trigger()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(seen?.aborted).toBe(true);
    expect(scheduler.isRunning()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("timed out"), expect.anything());

    // The next run starts, after waiting (capped) for the hung one to settle.
    expect(scheduler.trigger()).toBe(true);
    expect(scheduler.isRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(SETTLE_CAP);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("a timed-out run that settles late does not release the next run's guard", async () => {
    const hung = deferred();
    const next = deferred();
    const run = vi.fn().mockReturnValueOnce(hung.promise).mockReturnValueOnce(next.promise);
    const { scheduler } = setup(run);

    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS);
    scheduler.trigger();
    hung.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(scheduler.isRunning()).toBe(true);

    next.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.isRunning()).toBe(false);
    scheduler.dispose();
  });

  it("a run that ends in time leaves only the interval timer", async () => {
    const { scheduler } = setup(() => Promise.resolve());
    scheduler.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    scheduler.dispose();
  });

  it("dispose is idempotent and later triggers do not start a run", () => {
    const run = vi.fn(() => Promise.resolve());
    const { scheduler } = setup(run);

    scheduler.dispose();
    expect(() => scheduler.dispose()).not.toThrow();
    expect(scheduler.trigger()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("dispose drops listeners", async () => {
    const d = deferred();
    const { scheduler } = setup(() => d.promise);
    const listener = vi.fn();
    scheduler.onChange(listener);

    scheduler.dispose();
    d.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("AC38: notifies listeners on start and end; isRunning tracks the run", async () => {
    const d = deferred();
    const { scheduler } = setup(() => d.promise);
    const listener = vi.fn();
    scheduler.onChange(listener);

    expect(scheduler.isRunning()).toBe(false);
    scheduler.trigger();
    expect(scheduler.isRunning()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    d.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.isRunning()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("AC38: isRunning is false after a rejection and listeners fire", async () => {
    const d = deferred();
    const { scheduler } = setup(() => d.promise);
    const listener = vi.fn();
    scheduler.onChange(listener);

    scheduler.trigger();
    d.reject(new Error("x"));
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.isRunning()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("onChange unsubscribe stops notifications", () => {
    const { scheduler } = setup(() => new Promise(() => {}));
    const listener = vi.fn();
    const off = scheduler.onChange(listener);
    off();
    scheduler.trigger();
    expect(listener).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it("logs and survives a run that throws synchronously", async () => {
    const { scheduler, log } = setup(() => {
      throw new Error("sync");
    });
    expect(scheduler.trigger()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(false);
    scheduler.dispose();
  });
});

describe("startLaunchRun", () => {
  it("AC11: triggers once waitReady resolves", async () => {
    const d = deferred();
    const trigger = vi.fn();
    startLaunchRun({ waitReady: () => d.promise, trigger, signal: new AbortController().signal, log: vi.fn() });

    expect(trigger).not.toHaveBeenCalled();
    d.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("AC12: logs a rejection and does not trigger", async () => {
    const trigger = vi.fn();
    const log = vi.fn();
    startLaunchRun({
      waitReady: () => Promise.reject(new Error("not ready")),
      trigger,
      signal: new AbortController().signal,
      log,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(trigger).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("AC30: does not trigger when aborted before waitReady resolves", async () => {
    const d = deferred();
    const ac = new AbortController();
    const trigger = vi.fn();
    startLaunchRun({ waitReady: () => d.promise, trigger, signal: ac.signal, log: vi.fn() });

    ac.abort();
    d.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("AC30: logs nothing when the wait rejects because the module unloaded", async () => {
    const d = deferred();
    const ac = new AbortController();
    const trigger = vi.fn();
    const log = vi.fn();
    startLaunchRun({ waitReady: () => d.promise, trigger, signal: ac.signal, log });

    ac.abort();
    d.reject(new Error("Wait for client aborted"));
    await vi.advanceTimersByTimeAsync(0);
    expect(trigger).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
