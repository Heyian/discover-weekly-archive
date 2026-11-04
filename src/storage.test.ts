import { describe, expect, it } from "vitest";
import { createStore } from "./storage";
import type { StoragePort } from "./types/domain";

function memoryPort(initial: Record<string, string> = {}): StoragePort & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
  };
}

const LAST_RUN = "discover-weekly-archive:lastRun";

describe("createStore", () => {
  it("round-trips each value under the documented keys", () => {
    const port = memoryPort();
    const store = createStore(port);
    store.setSourceUri("spotify:playlist:src");
    store.setArchiveUri("spotify:playlist:arc");
    store.setLastRun({ at: 5, outcome: "error", addedCount: 0, error: "boom" });
    expect(store.getSourceUri()).toBe("spotify:playlist:src");
    expect(store.getArchiveUri()).toBe("spotify:playlist:arc");
    expect(store.getLastRun()).toEqual({ at: 5, outcome: "error", addedCount: 0, error: "boom" });
    expect([...port.data.keys()].sort()).toEqual([
      "discover-weekly-archive:archiveUri",
      "discover-weekly-archive:lastRun",
      "discover-weekly-archive:sourceUri",
    ]);
  });

  it("defaults when unset", () => {
    const store = createStore(memoryPort());
    expect(store.getSourceUri()).toBe("");
    expect(store.getArchiveUri()).toBeNull();
    expect(store.getLastRun()).toBeNull();
  });

  it("treats a stored empty archive uri as absent", () => {
    const store = createStore(memoryPort({ "discover-weekly-archive:archiveUri": "" }));
    expect(store.getArchiveUri()).toBeNull();
  });

  it("stores an empty source uri when cleared", () => {
    const port = memoryPort();
    createStore(port).setSourceUri("");
    expect(port.data.get("discover-weekly-archive:sourceUri")).toBe("");
  });

  it("holds no error on an added record written after an error one", () => {
    const store = createStore(memoryPort());
    store.setLastRun({ at: 1, outcome: "error", addedCount: 0, error: "x" });
    store.setLastRun({ at: 1, outcome: "added", addedCount: 2 });
    expect(store.getLastRun()).toEqual({ at: 1, outcome: "added", addedCount: 2 });
    expect("error" in store.getLastRun()!).toBe(false);
  });

  it.each([
    ["not json"],
    ['{"outcome":"bogus","at":1,"addedCount":0}'],
    ['{"outcome":"added"}'],
    ['{"outcome":"added","at":1,"addedCount":"2"}'],
    ["null"],
  ])("treats corrupt lastRun %s as absent", (raw) => {
    expect(createStore(memoryPort({ [LAST_RUN]: raw })).getLastRun()).toBeNull();
  });

  it("drops error unless the outcome is error", () => {
    const raw = '{"outcome":"added","at":1,"addedCount":2,"error":"stale"}';
    expect(createStore(memoryPort({ [LAST_RUN]: raw })).getLastRun()).toEqual({
      at: 1,
      outcome: "added",
      addedCount: 2,
    });
  });
});
