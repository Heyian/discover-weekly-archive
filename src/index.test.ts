import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("./ui/settingsSection", () => ({ registerSettingsSection: vi.fn() }));
vi.mock("./platform/library", () => ({
  createLibrary: vi.fn(() => ({
    readRootlist: vi.fn(async () => ({ playlists: [], unavailableUris: [] })),
    createPlaylist: vi.fn(),
  })),
}));
vi.mock("./platform/playlist", () => ({
  createPlaylists: vi.fn(() => ({ readItemUris: vi.fn(async () => []), addTracks: vi.fn() })),
}));

import { load } from "./index";
import { registerSettingsSection, type SettingsDeps } from "./ui/settingsSection";
import { createLibrary } from "./platform/library";
import { READY_TIMEOUT_MS, RECHECK_INTERVAL_MS } from "./constants";
import { SOURCE_MISSING_NOTICE } from "./messages";

type Platform = Record<string, unknown>;
interface SpicetifyStub {
  LocalStorage: { get: Mock; set: Mock };
  showNotification?: Mock;
  Platform: Platform;
}

const READY_PLATFORM = (): Platform => ({ RootlistAPI: {}, PlaylistAPI: {}, username: "me" });

let storage: Map<string, string>;
let spicetify: SpicetifyStub;

function stubSpicetify(platform: Platform): void {
  spicetify = {
    LocalStorage: {
      get: vi.fn((k: string) => storage.get(k) ?? null),
      set: vi.fn((k: string, v: string) => void storage.set(k, v)),
    },
    showNotification: vi.fn(),
    Platform: platform,
  };
  (globalThis as { Spicetify?: unknown }).Spicetify = spicetify;
}

function makeReady(): void {
  Object.assign(spicetify.Platform, READY_PLATFORM());
}

const ctx = () => ({ spotifyVersion: "1.3.4.258", identifier: "discover-weekly-archive", defer: vi.fn() });
type Ctx = ReturnType<typeof ctx>;

/** Runs every function load() passed to ctx.defer, in reverse order, as the loader does. */
function unload(c: Ctx): void {
  for (const [fn] of [...c.defer.mock.calls].reverse()) (fn as () => void)();
}

/** The n-th library load() built (0-based). */
const library = (n: number) =>
  vi.mocked(createLibrary).mock.results[n]!.value as { readRootlist: Mock; createPlaylist: Mock };

/** Archive runs started across every load: each run lists the Rootlist first. */
const runs = (): number =>
  vi.mocked(createLibrary).mock.results.reduce(
    (sum, r) => sum + (r.value as { readRootlist: Mock }).readRootlist.mock.calls.length,
    0,
  );

const settingsDeps = (n: number): SettingsDeps => vi.mocked(registerSettingsSection).mock.calls[n]![1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  storage = new Map();
  stubSpicetify({});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { Spicetify?: unknown }).Spicetify;
});

describe("load", () => {
  it("AC11: resolves before the client is ready; one run starts once it is", async () => {
    await load(ctx());
    expect(registerSettingsSection).toHaveBeenCalledTimes(1);
    expect(runs()).toBe(0);

    makeReady();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs()).toBe(1);
  });

  it.each(["RootlistAPI", "PlaylistAPI", "username"])(
    "readiness waits for Spicetify.Platform.%s",
    async (name) => {
      const platform = READY_PLATFORM();
      delete platform[name];
      stubSpicetify(platform);
      await load(ctx());
      await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
      expect(runs()).toBe(0);
    },
  );

  it("readiness waits for Spicetify.showNotification", async () => {
    stubSpicetify(READY_PLATFORM());
    delete spicetify.showNotification;
    await load(ctx());
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(runs()).toBe(0);
  });

  it("AC12: readiness times out → no launch run; the interval and Archive now still run", async () => {
    await load(ctx());
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(runs()).toBe(0);
    expect(registerSettingsSection).toHaveBeenCalledTimes(1);

    makeReady();
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS - READY_TIMEOUT_MS);
    expect(runs()).toBe(1);

    expect(settingsDeps(0).scheduler.trigger()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(runs()).toBe(2);
  });

  it("AC30: disposed during the wait → no launch run once the client is ready", async () => {
    const c = ctx();
    await load(c);
    unload(c);
    makeReady();
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(runs()).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("AC31: the deferred disposer leaves no timer", async () => {
    const c = ctx();
    await load(c);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unload(c);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("AC32: load → dispose → load leaves one interval, two sections and one launch run", async () => {
    const first = ctx();
    await load(first);
    unload(first);

    makeReady();
    await load(ctx());
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    expect(registerSettingsSection).toHaveBeenCalledTimes(2);
    expect(library(0).readRootlist).not.toHaveBeenCalled();
    expect(library(1).readRootlist).toHaveBeenCalledTimes(1);
  });

  it("AC33: a throwing settings registration rejects load and leaves no timer", async () => {
    const boom = new Error("boom");
    vi.mocked(registerSettingsSection).mockImplementationOnce(() => {
      throw boom;
    });
    await expect(load(ctx())).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defers its disposer before registering the settings section", async () => {
    const c = ctx();
    await load(c);
    expect(c.defer).toHaveBeenCalledTimes(1);
    expect(c.defer.mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(registerSettingsSection).mock.invocationCallOrder[0]!,
    );
  });
});

describe("adapters", () => {
  it("a throwing LocalStorage.get reads as unset", async () => {
    await load(ctx());
    spicetify.LocalStorage.get.mockImplementation(() => {
      throw new Error("storage");
    });
    const { store } = settingsDeps(0);
    expect(store.getSourceUri()).toBe("");
    expect(store.getArchiveUri()).toBeNull();
    expect(store.getLastRun()).toBeNull();
  });

  it("writes the run record through LocalStorage", async () => {
    stubSpicetify(READY_PLATFORM());
    await load(ctx());
    await vi.advanceTimersByTimeAsync(0);
    expect(spicetify.LocalStorage.set).toHaveBeenCalledWith("discover-weekly-archive:lastRun", expect.any(String));
  });

  it("an info notice uses plain styling", async () => {
    stubSpicetify(READY_PLATFORM());
    await load(ctx());
    await vi.advanceTimersByTimeAsync(0);
    expect(spicetify.showNotification).toHaveBeenCalledWith(SOURCE_MISSING_NOTICE);
  });

  it("an error notice uses error styling and the details go to console.error", async () => {
    stubSpicetify(READY_PLATFORM());
    const err = new Error("rootlist down");
    vi.mocked(createLibrary).mockReturnValueOnce({
      readRootlist: vi.fn(async () => {
        throw err;
      }),
      createPlaylist: vi.fn(),
    });
    await load(ctx());
    await vi.advanceTimersByTimeAsync(0);
    expect(spicetify.showNotification).toHaveBeenCalledWith(expect.stringContaining("failed"), true);
    expect(console.error).toHaveBeenCalledWith("[discover-weekly-archive] Archive run failed", err);
  });

  it("formatTime renders a local date and time", async () => {
    await load(ctx());
    expect(settingsDeps(0).formatTime(0)).toBe(new Date(0).toLocaleString());
  });
});
