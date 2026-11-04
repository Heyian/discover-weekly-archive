import { describe, it, expect, vi } from "vitest";
import { createLibrary } from "./library";

const SPOTIFY = { type: "user", uri: "spotify:user:spotify", username: "spotify" };
const ME = { type: "user", uri: "spotify:user:me", username: "me" };

function pl(uri: string, name: string, extra: Record<string, unknown> = {}) {
  return { type: "playlist", uri, name, owner: ME, isOwnedBySelf: true, canAdd: true, ...extra };
}
function folder(name: string, items: unknown[]) {
  return { type: "folder", uri: `spotify:user:me:folder:${name}`, name, items };
}
function fakePlatform(root: unknown) {
  return {
    username: "me",
    RootlistAPI: {
      getContents: vi.fn().mockResolvedValue(root),
      createPlaylist: vi.fn().mockResolvedValue("spotify:playlist:new"),
    },
  };
}

describe("createLibrary.listPlaylists", () => {
  it("flattens folders depth-first", async () => {
    const root = folder("<root>", [
      pl("spotify:playlist:a", "A"),
      folder("f", [pl("spotify:playlist:b", "B"), folder("g", [pl("spotify:playlist:c", "C")])]),
      pl("spotify:playlist:d", "D"),
    ]);
    const out = await createLibrary(fakePlatform(root)).listPlaylists();
    expect(out.map((e) => e.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("flags Spotify-owned and user-owned playlists", async () => {
    const root = folder("<root>", [
      pl("spotify:playlist:dw", "Discover Weekly", {
        owner: SPOTIFY,
        isOwnedBySelf: false,
        canAdd: false,
      }),
      pl("spotify:playlist:mine", "DWA dev"),
    ]);
    const [dw, mine] = await createLibrary(fakePlatform(root)).listPlaylists();
    expect(dw).toMatchObject({ ownedBySpotify: true, ownedByUser: false, canEdit: false });
    expect(mine).toMatchObject({ ownedBySpotify: false, ownedByUser: true, canEdit: true });
  });

  it("ignores canEditItems and formatListData.type", async () => {
    const root = folder("<root>", [
      pl("spotify:playlist:x", "X", {
        canAdd: false,
        canEditItems: true,
        formatListData: { type: "discover-weekly" },
      }),
    ]);
    const [x] = await createLibrary(fakePlatform(root)).listPlaylists();
    expect(x).toMatchObject({ canEdit: false, isOwnDiscoverWeekly: null });
  });

  it("derives isOwnDiscoverWeekly from madeFor.username", async () => {
    const attrs = (u: unknown) => ({ formatListData: { attributes: { "madeFor.username": u } } });
    const root = folder("<root>", [
      pl("spotify:playlist:own", "Own", attrs("me")),
      pl("spotify:playlist:friend", "Friend", attrs("friend")),
      pl("spotify:playlist:none", "None"),
      pl("spotify:playlist:empty", "Empty", attrs("")),
    ]);
    const out = await createLibrary(fakePlatform(root)).listPlaylists();
    expect(out.map((e) => e.isOwnDiscoverWeekly)).toEqual([true, false, null, null]);
  });

  it("skips unknown item types and tolerates missing owner and name", async () => {
    const root = folder("<root>", [
      { type: "placeholder", uri: "spotify:playlist:p", isNotFound: true },
      { type: "weird", uri: "x" },
      { type: "playlist", uri: "spotify:playlist:bare" },
    ]);
    const out = await createLibrary(fakePlatform(root)).listPlaylists();
    expect(out).toEqual([
      {
        uri: "spotify:playlist:bare",
        name: "",
        ownedBySpotify: false,
        ownedByUser: false,
        canEdit: false,
        isOwnDiscoverWeekly: null,
      },
    ]);
  });

  it("rejects when getContents rejects", async () => {
    const platform = fakePlatform(null);
    platform.RootlistAPI.getContents.mockRejectedValue(new Error("boom"));
    await expect(createLibrary(platform).listPlaylists()).rejects.toThrow("boom");
  });

  it("returns [] for an empty or missing root", async () => {
    expect(await createLibrary(fakePlatform(null)).listPlaylists()).toEqual([]);
  });

  it("reads Spicetify.Platform at call time when none is passed", async () => {
    const lib = createLibrary();
    vi.stubGlobal("Spicetify", {
      Platform: fakePlatform(folder("<root>", [pl("spotify:playlist:a", "A")])),
    });
    try {
      expect((await lib.listPlaylists()).map((e) => e.name)).toEqual(["A"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("createLibrary.createPlaylist", () => {
  it("creates at the end of the root and resolves the URI", async () => {
    const platform = fakePlatform(null);
    const uri = await createLibrary(platform).createPlaylist("Discover Weekly Archive");
    expect(platform.RootlistAPI.createPlaylist).toHaveBeenCalledWith("Discover Weekly Archive", {
      after: "end",
    });
    expect(uri).toBe("spotify:playlist:new");
  });

  it("throws when createPlaylist resolves null", async () => {
    const platform = fakePlatform(null);
    platform.RootlistAPI.createPlaylist.mockResolvedValue(null);
    await expect(createLibrary(platform).createPlaylist("n")).rejects.toThrow();
  });
});
