import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDist } from "./checkDist";

const SOURCE = {
  name: "discover-weekly-archive",
  version: "0.0.0",
  entries: { js: "index.js" },
};

let root: string;

async function fixture(
  folder = "discover-weekly-archive@0.0.0",
  files: Record<string, string> = {},
): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "check-dist-"));
  const dir = join(root, folder);
  await mkdir(dir);
  const all: Record<string, string> = {
    "index.js": 'import React from "/modules/stdlib/src/expose/react-shim.js";\n',
    "index.js.map": "{}",
    "metadata.json": JSON.stringify(SOURCE),
    "spicetify-module.json": "{}",
    ...files,
  };
  for (const [name, content] of Object.entries(all)) await writeFile(join(dir, name), content);
  return dir;
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("checkDist", () => {
  it("passes a well-formed folder", async () => {
    expect(checkDist(await fixture(), SOURCE)).toEqual([]);
  });

  it("reports each missing file", async () => {
    const dir = await fixture();
    await rm(join(dir, "index.js.map"));
    const problems = checkDist(dir, SOURCE);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("index.js.map");
  });

  it("reports metadata that differs from the source", async () => {
    const dir = await fixture(undefined, { "metadata.json": JSON.stringify({ ...SOURCE, version: "0.0.1" }) });
    expect(checkDist(dir, SOURCE)).not.toEqual([]);
  });

  it("reports a folder name that does not match name@version", async () => {
    expect(checkDist(await fixture("discover-weekly-archive"), SOURCE)).not.toEqual([]);
  });

  it("reports index.js without the react-shim import", async () => {
    const dir = await fixture(undefined, { "index.js": "const React = Spicetify.React;\n" });
    expect(checkDist(dir, SOURCE)).not.toEqual([]);
  });

  it("accepts a matching tag", async () => {
    expect(checkDist(await fixture(), SOURCE, "v0.0.0")).toEqual([]);
  });

  it("rejects a mismatched tag", async () => {
    const dir = await fixture();
    expect(checkDist(dir, SOURCE, "v0.0.1")).not.toEqual([]);
    expect(checkDist(dir, SOURCE, "0.0.0")).not.toEqual([]);
  });
});
