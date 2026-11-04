import { describe, it, expect, vi } from "vitest";
import { createPlaylists } from "./playlist";

type Opts = { offset: number; limit: number };

function fakePlatform(all: { uri: string; isPlayable?: boolean }[]) {
  return {
    PlaylistAPI: {
      getContents: vi.fn(async (_uri: string, opts: Opts) => ({
        items: all.slice(opts.offset, opts.offset + opts.limit),
        offset: 0,
        limit: Math.min(opts.limit, Math.max(all.length - opts.offset, 0)),
        totalLength: all.length,
      })),
      add: vi.fn().mockResolvedValue(undefined),
    },
  };
}
const tracks = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ uri: `spotify:track:${i}`, type: "track" }));

describe("createPlaylists.readItemUris", () => {
  it("pages through all items in order, always passing offset and limit", async () => {
    const platform = fakePlatform(tracks(250));
    const out = await createPlaylists(platform).readItemUris("spotify:playlist:p");
    expect(out).toEqual(tracks(250).map((t) => t.uri));
    const calls = platform.PlaylistAPI.getContents.mock.calls;
    expect(calls.map((c) => c[1])).toEqual([
      { offset: 0, limit: 100 },
      { offset: 100, limit: 100 },
      { offset: 200, limit: 100 },
    ]);
  });

  it("stops at totalLength when the last page is full", async () => {
    const platform = fakePlatform(tracks(200));
    const out = await createPlaylists(platform).readItemUris("p");
    expect(out).toHaveLength(200);
    expect(platform.PlaylistAPI.getContents).toHaveBeenCalledTimes(2);
  });

  it("stops on a short page even if totalLength overstates", async () => {
    const platform = fakePlatform(tracks(30));
    platform.PlaylistAPI.getContents.mockImplementation(async (_u: string, o: Opts) => ({
      items: tracks(30).slice(o.offset, o.offset + o.limit),
      offset: 0,
      limit: 30,
      totalLength: 999,
    }));
    const out = await createPlaylists(platform).readItemUris("p");
    expect(out).toHaveLength(30);
    expect(platform.PlaylistAPI.getContents).toHaveBeenCalledTimes(1);
  });

  it("returns unplayable items too", async () => {
    const platform = fakePlatform([
      { uri: "spotify:track:a", isPlayable: false },
      { uri: "spotify:track:b", isPlayable: true },
    ]);
    expect(await createPlaylists(platform).readItemUris("p")).toEqual([
      "spotify:track:a",
      "spotify:track:b",
    ]);
  });

  it("returns [] for an empty playlist", async () => {
    expect(await createPlaylists(fakePlatform([])).readItemUris("p")).toEqual([]);
  });

  it("rejects when getContents rejects", async () => {
    const platform = fakePlatform([]);
    platform.PlaylistAPI.getContents.mockRejectedValue(new Error("nope"));
    await expect(createPlaylists(platform).readItemUris("p")).rejects.toThrow("nope");
  });
});

describe("createPlaylists.addTracks", () => {
  it("appends at the end in one call", async () => {
    const platform = fakePlatform([]);
    await createPlaylists(platform).addTracks("spotify:playlist:p", [
      "spotify:track:a",
      "spotify:track:b",
    ]);
    expect(platform.PlaylistAPI.add).toHaveBeenCalledTimes(1);
    expect(platform.PlaylistAPI.add).toHaveBeenCalledWith(
      "spotify:playlist:p",
      ["spotify:track:a", "spotify:track:b"],
      { after: "end" },
    );
  });
});
