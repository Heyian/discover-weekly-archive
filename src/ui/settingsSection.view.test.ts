import { describe, it, expect } from "vitest";
import type { PlaylistEntry } from "../types/domain";
import {
  AUTOMATIC_ARCHIVE_LABEL,
  AUTOMATIC_SOURCE_LABEL,
  archiveOptions,
  sourceOptions,
} from "./settingsSection.view";

const entry = (uri: string, over: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  uri,
  name: `name-${uri}`,
  ownedBySpotify: false,
  ownedByUser: true,
  canEdit: true,
  isOwnDiscoverWeekly: null,
  ...over,
});

const a = entry("spotify:playlist:a");
const b = entry("spotify:playlist:b", { ownedByUser: false, canEdit: false });
const c = entry("spotify:playlist:c", { canEdit: false });

describe("sourceOptions", () => {
  it("AC35: automatic first, then every playlist", () => {
    expect(sourceOptions({ ok: true, playlists: [a, b] }, "")).toEqual([
      { value: "", label: AUTOMATIC_SOURCE_LABEL },
      { value: a.uri, label: a.name },
      { value: b.uri, label: b.name },
    ]);
  });

  it("appends a saved URI missing from the list", () => {
    expect(sourceOptions({ ok: true, playlists: [a] }, "spotify:playlist:gone")).toEqual([
      { value: "", label: AUTOMATIC_SOURCE_LABEL },
      { value: a.uri, label: a.name },
      { value: "spotify:playlist:gone", label: "spotify:playlist:gone" },
    ]);
  });

  it("AC40: failed or loading list keeps only the saved choice", () => {
    for (const list of [{ ok: false } as const, null]) {
      expect(sourceOptions(list, "")).toEqual([{ value: "", label: AUTOMATIC_SOURCE_LABEL }]);
      expect(sourceOptions(list, "spotify:playlist:x")).toEqual([
        { value: "spotify:playlist:x", label: "spotify:playlist:x" },
      ]);
    }
  });
});

describe("archiveOptions", () => {
  it("AC37: lists only owned, editable playlists; automatic first when nothing saved", () => {
    expect(archiveOptions({ ok: true, playlists: [a, b, c] }, null)).toEqual([
      { value: "", label: AUTOMATIC_ARCHIVE_LABEL },
      { value: a.uri, label: a.name },
    ]);
  });

  it("AC37: no automatic option once a candidate is saved", () => {
    expect(archiveOptions({ ok: true, playlists: [a, b] }, a.uri)).toEqual([{ value: a.uri, label: a.name }]);
  });

  it("appends a saved URI missing from the list", () => {
    expect(archiveOptions({ ok: true, playlists: [a] }, "spotify:playlist:gone")).toEqual([
      { value: a.uri, label: a.name },
      { value: "spotify:playlist:gone", label: "spotify:playlist:gone" },
    ]);
  });

  it("AC40: failed or loading list keeps only the saved choice", () => {
    for (const list of [{ ok: false } as const, null]) {
      expect(archiveOptions(list, null)).toEqual([{ value: "", label: AUTOMATIC_ARCHIVE_LABEL }]);
      expect(archiveOptions(list, "spotify:playlist:x")).toEqual([
        { value: "spotify:playlist:x", label: "spotify:playlist:x" },
      ]);
    }
  });
});
