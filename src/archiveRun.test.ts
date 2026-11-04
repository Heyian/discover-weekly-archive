import { describe, expect, it, vi } from "vitest";
import { runArchive, type ArchiveRunDeps } from "./archiveRun";
import { ARCHIVE_NAME } from "./constants";
import { shortReason } from "./messages";
import type { Notices } from "./notices";
import { createStore } from "./storage";
import type { LibraryPort, PlaylistEntry, PlaylistPort } from "./types/domain";

const t = (n: string) => `spotify:track:${n}`;
const SRC = "spotify:playlist:src";
const ARC = "spotify:playlist:arc";
const NEW = "spotify:playlist:new";

const dw = (over: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  uri: SRC,
  name: "Discover Weekly",
  ownedBySpotify: true,
  ownedByUser: false,
  canEdit: false,
  isOwnDiscoverWeekly: true,
  ...over,
});
const arch = (over: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  uri: ARC,
  name: ARCHIVE_NAME,
  ownedBySpotify: false,
  ownedByUser: true,
  canEdit: true,
  isOwnDiscoverWeekly: null,
  ...over,
});

function setup(opts: {
  list?: PlaylistEntry[];
  contents?: Record<string, string[]>;
  batchSize?: number;
  saved?: { source?: string; archive?: string };
}) {
  const mem = new Map<string, string>();
  const store = createStore({ get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) });
  if (opts.saved?.source) store.setSourceUri(opts.saved.source);
  if (opts.saved?.archive) store.setArchiveUri(opts.saved.archive);
  const contents: Record<string, string[]> = { ...(opts.contents ?? {}) };
  const adds: { uri: string; tracks: string[] }[] = [];
  const library: LibraryPort = {
    listPlaylists: vi.fn(async () => opts.list ?? []),
    createPlaylist: vi.fn(async () => {
      contents[NEW] = [];
      return NEW;
    }),
  };
  const playlists: PlaylistPort = {
    readItemUris: vi.fn(async (u: string) => [...(contents[u] ?? [])]),
    addTracks: vi.fn(async (u: string, tracks: string[]) => {
      adds.push({ uri: u, tracks });
      contents[u] = [...(contents[u] ?? []), ...tracks];
    }),
  };
  const notices: Notices = { archived: vi.fn(), sourceMissing: vi.fn(), error: vi.fn() };
  const setLastRun = vi.spyOn(store, "setLastRun");
  const setArchiveUri = vi.spyOn(store, "setArchiveUri");
  const log = vi.fn();
  const deps: ArchiveRunDeps = {
    library,
    playlists,
    store,
    notices,
    log,
    now: () => 1234,
    batchSize: opts.batchSize ?? 100,
  };
  return { deps, library, playlists, store, notices, log, adds, setLastRun, setArchiveUri };
}
type Setup = ReturnType<typeof setup>;

const live = () => new AbortController().signal;

function expectQuietStop(s: Setup) {
  expect(s.setArchiveUri).not.toHaveBeenCalled();
  expect(s.library.createPlaylist).not.toHaveBeenCalled();
  expect(s.playlists.readItemUris).toHaveBeenCalledTimes(1);
  expect(s.adds).toEqual([]);
  expect(s.notices.archived).not.toHaveBeenCalled();
  expect(s.notices.error).not.toHaveBeenCalled();
  expect(s.notices.sourceMissing).not.toHaveBeenCalled();
  expect(s.log).toHaveBeenCalled();
}

describe("runArchive", () => {
  it("AC1: adds only the missing Source tracks", async () => {
    const s = setup({
      list: [dw(), arch()],
      contents: { [SRC]: [t("A"), t("B"), t("C")], [ARC]: [t("X"), t("B")] },
    });
    const r = await runArchive(s.deps, live());
    expect(s.adds).toEqual([{ uri: ARC, tracks: [t("A"), t("C")] }]);
    expect(r).toEqual({ at: 1234, outcome: "added", addedCount: 2 });
    expect(s.notices.archived).toHaveBeenCalledWith(2, ARCHIVE_NAME, false);
    expect(s.store.getLastRun()).toEqual(r);
  });

  it("AC2: nothing missing adds nothing and shows no notice", async () => {
    const s = setup({ list: [dw(), arch()], contents: { [SRC]: [t("A")], [ARC]: [t("A"), t("Z")] } });
    const r = await runArchive(s.deps, live());
    expect(s.adds).toEqual([]);
    expect(s.notices.archived).not.toHaveBeenCalled();
    expect(r).toEqual({ at: 1234, outcome: "added", addedCount: 0 });
  });

  it("AC7: splits adds into batches in order", async () => {
    const s = setup({
      list: [dw(), arch()],
      batchSize: 2,
      contents: { [SRC]: ["A", "B", "C", "D", "E"].map(t), [ARC]: [] },
    });
    await runArchive(s.deps, live());
    expect(s.adds.map((a) => a.tracks)).toEqual([[t("A"), t("B")], [t("C"), t("D")], [t("E")]]);
  });

  it("AC8/AC28: failed batch records error with the count; next run adds the rest", async () => {
    const s = setup({
      list: [dw(), arch()],
      batchSize: 2,
      contents: { [SRC]: ["A", "B", "C", "D", "E"].map(t), [ARC]: [] },
    });
    const boom = new Error("boom\nsecond line");
    const original = s.playlists.addTracks;
    let calls = 0;
    s.playlists.addTracks = vi.fn(async (u, tr) => {
      if (++calls === 2) throw boom;
      return original(u, tr);
    });
    const r = await runArchive(s.deps, live());
    expect(r).toEqual({ at: 1234, outcome: "error", addedCount: 2, error: shortReason(boom) });
    expect(s.notices.error).toHaveBeenCalledWith(shortReason(boom));
    expect(s.log).toHaveBeenCalledWith(expect.any(String), boom);

    s.playlists.addTracks = original;
    s.adds.length = 0;
    const r2 = await runArchive(s.deps, live());
    expect(s.adds.map((a) => a.tracks)).toEqual([[t("C"), t("D")], [t("E")]]);
    expect(r2).toEqual({ at: 1234, outcome: "added", addedCount: 3 });
    expect(r2?.error).toBeUndefined();
  });

  it("AC20: no Source records source-missing and touches nothing", async () => {
    const s = setup({ list: [arch()] });
    const r = await runArchive(s.deps, live());
    expect(r).toEqual({ at: 1234, outcome: "source-missing", addedCount: 0 });
    expect(s.notices.sourceMissing).toHaveBeenCalledOnce();
    expect(s.library.createPlaylist).not.toHaveBeenCalled();
    expect(s.playlists.readItemUris).not.toHaveBeenCalled();
  });

  it("AC22: source-empty", async () => {
    const s = setup({ list: [dw()], contents: { [SRC]: ["spotify:local:a:b:c:1"] } });
    const r = await runArchive(s.deps, live());
    expect(r?.outcome).toBe("source-empty");
    expectQuietStop(s);
  });

  it("AC22: source-unreadable", async () => {
    const s = setup({ list: [dw()] });
    s.playlists.readItemUris = vi.fn(async () => {
      throw new Error("nope");
    });
    const r = await runArchive(s.deps, live());
    expect(r?.outcome).toBe("source-unreadable");
    expectQuietStop(s);
  });

  it("AC23: creates the Archive when none exists", async () => {
    const s = setup({ list: [dw()], contents: { [SRC]: [t("A"), t("B")] } });
    const r = await runArchive(s.deps, live());
    expect(s.library.createPlaylist).toHaveBeenCalledExactlyOnceWith(ARCHIVE_NAME);
    expect(s.store.getArchiveUri()).toBe(NEW);
    expect(s.playlists.readItemUris).toHaveBeenCalledTimes(1);
    expect(s.adds).toEqual([{ uri: NEW, tracks: [t("A"), t("B")] }]);
    expect(s.notices.archived).toHaveBeenCalledWith(2, ARCHIVE_NAME, true);
    expect(r?.addedCount).toBe(2);
  });

  it("AC24: saved Archive wins over a name match, whatever its name", async () => {
    const other = "spotify:playlist:other";
    const s = setup({
      list: [dw(), arch(), arch({ uri: other, name: "Renamed" })],
      saved: { archive: other },
      contents: { [SRC]: [t("A")], [other]: [] },
    });
    await runArchive(s.deps, live());
    expect(s.adds).toEqual([{ uri: other, tracks: [t("A")] }]);
    expect(s.notices.archived).toHaveBeenCalledWith(1, "Renamed", false);
    expect(s.library.createPlaylist).not.toHaveBeenCalled();
  });

  it("AC25: name lookup saves the found URI and creates nothing", async () => {
    const s = setup({ list: [dw(), arch()], contents: { [SRC]: [t("A")], [ARC]: [] } });
    await runArchive(s.deps, live());
    expect(s.store.getArchiveUri()).toBe(ARC);
    expect(s.library.createPlaylist).not.toHaveBeenCalled();
  });

  describe("AC27: throws end in an error record", () => {
    const fail = async () => {
      throw new Error("E");
    };
    const cases: [string, (s: Setup) => void][] = [
      ["listPlaylists", (s) => void (s.library.listPlaylists = fail)],
      [
        "Archive read",
        (s) => {
          const read = s.playlists.readItemUris;
          s.playlists.readItemUris = async (u) => (u === ARC ? fail() : read(u));
        },
      ],
      [
        "createPlaylist",
        (s) => {
          s.library.listPlaylists = async () => [dw()];
          s.library.createPlaylist = fail;
        },
      ],
      ["addTracks", (s) => void (s.playlists.addTracks = fail)],
    ];
    it.each(cases)("%s", async (_name, breakIt) => {
      const s = setup({ list: [dw(), arch()], contents: { [SRC]: [t("A")], [ARC]: [] } });
      breakIt(s);
      const r = await runArchive(s.deps, live());
      expect(r).toEqual({ at: 1234, outcome: "error", addedCount: 0, error: "E" });
      expect(s.log).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
      expect(s.notices.error).toHaveBeenCalledWith("E");
    });
  });

  it("Review Focus 1: Source URI = Archive URI adds nothing", async () => {
    const s = setup({
      list: [dw()],
      saved: { source: SRC, archive: SRC },
      contents: { [SRC]: [t("A"), t("B")] },
    });
    const r = await runArchive(s.deps, live());
    expect(s.adds).toEqual([]);
    expect(s.library.createPlaylist).not.toHaveBeenCalled();
    expect(r).toEqual({ at: 1234, outcome: "added", addedCount: 0 });
    expect(s.notices.archived).not.toHaveBeenCalled();
  });

  describe("AC29: abort while an await is pending", () => {
    const points = ["list", "source read", "create", "archive read", "add"] as const;

    it.each(points)("%s", async (point) => {
      const s = setup({
        list: point === "create" ? [dw()] : [dw(), arch()],
        batchSize: 1,
        contents: { [SRC]: [t("A"), t("B")], [ARC]: [] },
      });
      let release!: () => void;
      const gateOpen = new Promise<void>((r) => (release = r));
      let reached!: () => void;
      const reachedGate = new Promise<void>((r) => (reached = r));
      const gate = async () => {
        reached();
        await gateOpen;
      };
      const { library, playlists } = s;
      const list = library.listPlaylists;
      const create = library.createPlaylist;
      const read = playlists.readItemUris;
      const add = playlists.addTracks;
      if (point === "list") {
        library.listPlaylists = async () => (await gate(), list());
      }
      if (point === "create") {
        library.createPlaylist = async (n) => (await gate(), create(n));
      }
      if (point === "source read" || point === "archive read") {
        const target = point === "source read" ? SRC : ARC;
        playlists.readItemUris = async (u) => (u === target ? (await gate(), read(u)) : read(u));
      }
      if (point === "add") {
        let n = 0;
        playlists.addTracks = async (u, tr) => (++n === 1 ? (await gate(), add(u, tr)) : add(u, tr));
      }

      const ac = new AbortController();
      const run = runArchive(s.deps, ac.signal);
      await reachedGate;
      ac.abort();
      release();

      expect(await run).toBeNull();
      expect(s.setLastRun).not.toHaveBeenCalled();
      expect(s.notices.archived).not.toHaveBeenCalled();
      expect(s.notices.error).not.toHaveBeenCalled();
      expect(s.notices.sourceMissing).not.toHaveBeenCalled();
      // Only the already-issued first add may complete; no second batch.
      expect(s.adds).toHaveLength(point === "add" ? 1 : 0);
      if (point === "create") expect(s.setArchiveUri).not.toHaveBeenCalled();
    });
  });
});
