import type { PlaylistPort } from "../types/domain";

const PAGE_SIZE = 100;

/** The slice of `Spicetify.Platform` this adapter reads. */
interface PlaylistPlatform {
  PlaylistAPI: {
    getContents(
      uri: string,
      opts: { offset: number; limit: number },
    ): Promise<{ items?: { uri?: unknown }[]; totalLength?: number }>;
    add(uri: string, uris: string[], location: { after: "end" }): Promise<unknown>;
  };
}

export function createPlaylists(platform?: PlaylistPlatform): PlaylistPort {
  const api = () => (platform ?? Spicetify.Platform).PlaylistAPI as PlaylistPlatform["PlaylistAPI"];
  return {
    async readItemUris(uri) {
      const out: string[] = [];
      let offset = 0;
      for (;;) {
        const page = await api().getContents(uri, { offset, limit: PAGE_SIZE });
        const items = page?.items ?? [];
        for (const item of items) {
          if (typeof item?.uri === "string") out.push(item.uri);
        }
        offset += items.length;
        const total = page?.totalLength;
        if (items.length < PAGE_SIZE || (typeof total === "number" && offset >= total)) break;
      }
      return out;
    },
    async addTracks(uri, trackUris) {
      await api().add(uri, trackUris, { after: "end" });
    },
  };
}
