import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunGate } from "./runGate";
import { realTimer } from "./timer";

const CAP = 10_000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const live = () => new AbortController().signal;

describe("createRunGate", () => {
  it("starts the body synchronously when nothing is pending", () => {
    const gate = createRunGate(realTimer, CAP);
    const body = vi.fn(async () => {});
    void gate.enter(live(), body);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("waits for the previous body to settle before starting the next", async () => {
    const gate = createRunGate(realTimer, CAP);
    const first = deferred();
    void gate.enter(live(), () => first.promise);
    const second = vi.fn(async () => {});
    void gate.enter(live(), second);

    await vi.advanceTimersByTimeAsync(CAP - 1);
    expect(second).not.toHaveBeenCalled();
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a previous body that rejects still releases the next", async () => {
    const gate = createRunGate(realTimer, CAP);
    const first = deferred();
    const entered = gate.enter(live(), () => first.promise);
    const second = vi.fn(async () => {});
    void gate.enter(live(), second);

    first.reject(new Error("x"));
    await expect(entered).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("starts the next body once the cap elapses if the previous never settles", async () => {
    const gate = createRunGate(realTimer, CAP);
    void gate.enter(live(), () => new Promise(() => {}));
    const second = vi.fn(async () => {});
    void gate.enter(live(), second);

    await vi.advanceTimersByTimeAsync(CAP - 1);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("an abort during the wait skips the body, clears the cap timer and resolves", async () => {
    const gate = createRunGate(realTimer, CAP);
    void gate.enter(live(), () => new Promise(() => {}));
    const ac = new AbortController();
    const second = vi.fn(async () => {});
    const entered = gate.enter(ac.signal, second);

    ac.abort();
    expect(vi.getTimerCount()).toBe(0);
    await expect(entered).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(CAP);
    expect(second).not.toHaveBeenCalled();
  });

  it("a body that settled leaves nothing pending: the next starts synchronously", async () => {
    const gate = createRunGate(realTimer, CAP);
    await gate.enter(live(), async () => {});
    const next = vi.fn(async () => {});
    void gate.enter(live(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
