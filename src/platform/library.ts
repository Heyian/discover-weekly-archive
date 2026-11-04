import type { LibraryPort, PlaylistEntry } from "../types/domain";

/** The slice of `Spicetify.Platform` this adapter reads. */
interface LibraryPlatform {
  username?: string;
  RootlistAPI: {
    getContents(): Promise<unknown>;
    createPlaylist(name: string, location: { after: "end" }): Promise<string | null>;
  };
}

interface RawNode {
  type?: unknown;
  uri?: unknown;
  name?: unknown;
  items?: unknown;
  owner?: { username?: unknown } | null;
  isOwnedBySelf?: unknown;
  canAdd?: unknown;
  formatListData?: { attributes?: Record<string, unknown> } | null;
}

function collect(node: RawNode, username: string | undefined, out: PlaylistEntry[]): void {
  if (node.type === "folder") {
    if (Array.isArray(node.items)) {
      for (const child of node.items) {
        if (child && typeof child === "object") collect(child as RawNode, username, out);
      }
    }
    return;
  }
  if (node.type !== "playlist" || typeof node.uri !== "string") return;
  const mf = node.formatListData?.attributes?.["madeFor.username"];
  out.push({
    uri: node.uri,
    name: typeof node.name === "string" ? node.name : "",
    ownedBySpotify: node.owner?.username === "spotify",
    ownedByUser: node.isOwnedBySelf === true,
    canEdit: node.canAdd === true,
    isOwnDiscoverWeekly: typeof mf === "string" && mf !== "" ? mf === username : null,
  });
}

export function createLibrary(platform?: LibraryPlatform): LibraryPort {
  const current = (): LibraryPlatform => platform ?? Spicetify.Platform;
  return {
    async listPlaylists() {
      const p = current();
      const root = await p.RootlistAPI.getContents();
      const out: PlaylistEntry[] = [];
      if (root && typeof root === "object") collect(root as RawNode, p.username, out);
      return out;
    },
    async createPlaylist(name) {
      const uri = await current().RootlistAPI.createPlaylist(name, { after: "end" });
      if (typeof uri !== "string" || uri === "") {
        throw new Error(`Could not create the "${name}" playlist.`);
      }
      return uri;
    },
  };
}
