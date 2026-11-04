import { describe, it, expect } from "vitest";
import { ARCHIVE_NAME, DISCOVER_WEEKLY_NAME } from "./constants";
import type { PlaylistEntry } from "./types/domain";
import { batches, isArchiveCandidate, missingTracks, resolveArchive, resolveSource, trackUris } from "./resolve";

const pl = (o: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  uri: "spotify:playlist:x",
  name: "Other",
  ownedBySpotify: false,
  ownedByUser: true,
  canEdit: true,
  isOwnDiscoverWeekly: null,
  ...o,
});
const dw = (o: Partial<PlaylistEntry> = {}) =>
  pl({ name: DISCOVER_WEEKLY_NAME, ownedBySpotify: true, ownedByUser: false, canEdit: false, ...o });

describe("resolveSource", () => {
  it("AC14 picks the Spotify-owned Discover Weekly", () => {
    const want = dw({ uri: "dw" });
    expect(resolveSource([pl({ uri: "a" }), want, pl({ uri: "b" })], "")).toBe(want);
  });
  it("AC15 ignores a user-owned Discover Weekly", () => {
    expect(resolveSource([pl({ name: DISCOVER_WEEKLY_NAME })], "")).toBeNull();
  });
  it("AC16 takes the first of several matches", () => {
    const first = dw({ uri: "1" });
    expect(resolveSource([first, dw({ uri: "2" })], "")).toBe(first);
  });
  it("AC17 skips entries flagged false and prefers true", () => {
    const second = dw({ uri: "2", isOwnDiscoverWeekly: true });
    expect(resolveSource([dw({ uri: "1", isOwnDiscoverWeekly: false }), second], "")).toBe(second);
  });
  it("AC17 takes the first when the field is null on all", () => {
    const first = dw({ uri: "1" });
    expect(resolveSource([first, dw({ uri: "2" })], "")).toBe(first);
  });
  it("matches the name exactly", () => {
    expect(resolveSource([dw({ name: "discover weekly" }), dw({ name: "Discover Weekly " })], "")).toBeNull();
  });
  it("AC18 uses the saved URI even with an earlier match", () => {
    const saved = pl({ uri: "saved", name: "Mine" });
    expect(resolveSource([dw({ uri: "dw" }), saved], "saved")).toBe(saved);
  });
  it("AC19 falls back to automatic when the saved URI is absent", () => {
    const auto = dw({ uri: "dw" });
    expect(resolveSource([auto], "gone")).toBe(auto);
  });
});

describe("resolveArchive", () => {
  it("AC24 uses the saved URI whatever its name, owner or edit flag", () => {
    const saved = pl({ uri: "s", name: "Renamed", ownedByUser: false, canEdit: false });
    expect(resolveArchive([pl({ name: ARCHIVE_NAME }), saved], "s")).toBe(saved);
  });
  it("AC25 takes the first named candidate when saved is absent or null", () => {
    const first = pl({ uri: "1", name: ARCHIVE_NAME });
    const list = [first, pl({ uri: "2", name: ARCHIVE_NAME })];
    expect(resolveArchive(list, null)).toBe(first);
    expect(resolveArchive(list, "gone")).toBe(first);
  });
  it("AC26 returns null with no usable candidate", () => {
    expect(
      resolveArchive(
        [
          pl({ name: ARCHIVE_NAME, ownedByUser: true, canEdit: false }),
          pl({ name: ARCHIVE_NAME, ownedByUser: false, canEdit: true }),
        ],
        null,
      ),
    ).toBeNull();
  });
  it("isArchiveCandidate needs owned and editable", () => {
    expect(isArchiveCandidate(pl())).toBe(true);
    expect(isArchiveCandidate(pl({ canEdit: false }))).toBe(false);
    expect(isArchiveCandidate(pl({ ownedByUser: false }))).toBe(false);
  });
});

describe("track helpers", () => {
  it("AC3/AC4 keeps track URIs only, deduplicated in order", () => {
    expect(
      trackUris([
        "spotify:track:A",
        "spotify:local:x",
        "spotify:track:B",
        "spotify:episode:E",
        "spotify:track:A",
        "spotify:track:C",
      ]),
    ).toEqual(["spotify:track:A", "spotify:track:B", "spotify:track:C"]);
  });
  it("AC1/AC5 returns source tracks absent from the archive", () => {
    expect(missingTracks(["A", "B", "C"], ["B"])).toEqual(["A", "C"]);
    expect(missingTracks(["A2"], ["A1"])).toEqual(["A2"]);
  });
  it("batches", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });
});
