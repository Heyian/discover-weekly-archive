// checkDist.ts — asserts the shape of the built module folder before it is
// installed or published.
//
//   bun scripts/checkDist.ts [--tag <tag>]
//
// Checks `dist/discover-weekly-archive@<version>/` against `src/metadata.json`
// and, with `--tag`, that the release tag is `v<version>`. Prints each problem
// and exits 1 if there are any.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const FILES = ["index.js", "index.js.map", "metadata.json", "spicetify-module.json"];

/** Problems with the built folder `dir`, empty when it passes. */
export function checkDist(dir: string, source: Record<string, unknown>, tag?: string): string[] {
  const problems: string[] = [];
  const expected = `${source.name}@${source.version}`;
  if (basename(dir) !== expected) problems.push(`folder is ${basename(dir)}, expected ${expected}`);
  if (tag !== undefined && tag !== `v${source.version}`) {
    problems.push(`tag ${tag} does not match version ${source.version}`);
  }

  const missing = FILES.filter((file) => !existsSync(join(dir, file)));
  for (const file of missing) problems.push(`missing ${file}`);
  const read = (file: string) => (missing.includes(file) ? undefined : readFileSync(join(dir, file), "utf8"));

  const metadata = read("metadata.json");
  if (metadata !== undefined && !isDeepStrictEqual(JSON.parse(metadata), source)) {
    problems.push("metadata.json differs from src/metadata.json");
  }

  return problems;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const tagIndex = args.indexOf("--tag");
  const tag = tagIndex >= 0 ? args[tagIndex + 1] : undefined;
  if (tagIndex >= 0 && !tag) {
    console.error("--tag needs a value");
    process.exit(1);
  }
  const source = JSON.parse(readFileSync("src/metadata.json", "utf8"));
  const dir = join("dist", `${source.name}@${source.version}`);
  const problems = checkDist(dir, source, tag);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log(`${dir} passes`);
}
