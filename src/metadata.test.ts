import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const m = JSON.parse(readFileSync("src/metadata.json", "utf8"));

describe("src/metadata.json", () => {
  it("carries the store fields", () => {
    expect(m.name).toBe("discover-weekly-archive");
    expect(m.authors).toEqual(["Heyian"]);
    expect(m).not.toHaveProperty("tags");
    expect(m).not.toHaveProperty("kind");
    expect(m.description).toMatch(/Creates that playlist/);
    expect(m.description).toMatch(/while Spotify is\s+open/);
    expect(m.license).toBe("MIT");
    expect(m.preview).toBe("https://raw.githubusercontent.com/Heyian/discover-weekly-archive/main/docs/preview.png");
  });
});
