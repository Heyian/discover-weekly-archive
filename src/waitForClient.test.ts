import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { waitForClient } from "./waitForClient";
import { READY_TIMEOUT_MS } from "./constants";
import { realTimer } from "./timer";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("waitForClient", () => {
  it("resolves without scheduling a timer when readiness already holds", async () => {
    await expect(
      waitForClient({ missing: () => [], timer: realTimer, timeoutMs: READY_TIMEOUT_MS }),
    ).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves once readiness holds on a later poll, clearing the deadline", async () => {
    const answers = [["Spicetify.React"], []];
    let settled = false;
    const p = waitForClient({
      missing: () => answers.shift() ?? [],
      timer: realTimer,
      timeoutMs: READY_TIMEOUT_MS,
    }).then(() => (settled = true));

    await vi.advanceTimersByTimeAsync(50);
    await p;

    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects at the deadline naming each missing global", async () => {
    const caught = waitForClient({
      missing: () => ["Spicetify.ContextMenu", "Spicetify.Platform"],
      timer: realTimer,
      timeoutMs: READY_TIMEOUT_MS,
    }).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    const err = await caught;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Spicetify.ContextMenu");
    expect((err as Error).message).toContain("Spicetify.Platform");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("names only the globals still missing at the deadline", async () => {
    let first = true;
    const missing = () => {
      if (first) {
        first = false;
        return ["Spicetify.React", "Spicetify.ContextMenu", "Spicetify.Platform"];
      }
      return ["Spicetify.ContextMenu"];
    };
    const caught = waitForClient({ missing, timer: realTimer, timeoutMs: READY_TIMEOUT_MS }).catch(
      (e: unknown) => e,
    );

    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    const message = ((await caught) as Error).message;

    expect(message).toContain("Spicetify.ContextMenu");
    expect(message).not.toContain("Spicetify.React");
  });

  it("rejects on abort and clears both timers", async () => {
    const ac = new AbortController();
    const caught = waitForClient({
      missing: () => ["Spicetify.React"],
      timer: realTimer,
      timeoutMs: READY_TIMEOUT_MS,
      signal: ac.signal,
    }).catch((e: unknown) => e);
    expect(vi.getTimerCount()).toBe(2);

    ac.abort();
    const err = await caught;

    expect(err).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects without timers when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      waitForClient({ missing: () => ["x"], timer: realTimer, timeoutMs: READY_TIMEOUT_MS, signal: ac.signal }),
    ).rejects.toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
