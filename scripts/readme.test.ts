import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("README", () => {
  it("first section states the AC45 facts", () => {
    const first = readFileSync("README.md", "utf8").split(/^## /m).slice(0, 2).join("## ");
    expect(first).toMatch(/creates?\b.*"Discover Weekly Archive"|"Discover Weekly Archive".*creat/s);
    expect(first).toMatch(/only while Spotify is open/i);
    expect(first).toMatch(/never opened?.*can(no|')t be recovered/is);
    expect(first).toMatch(/one computer/i);
    expect(first).toMatch(/non-English/i);
    expect(first).toMatch(/Source playlist/);
  });
});
