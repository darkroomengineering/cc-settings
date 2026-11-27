#!/usr/bin/env bun
// Regenerate the hook wiring tables in docs/hooks-reference.md.
//
// Thin CLI over src/lib/hooks-doc.ts (the builder, markers and descriptions
// live there). Also checks that hook-bench covers every synchronous hook.
//
// Usage:
//   bun run docs:hooks            rewrite the tables in place
//   bun run docs:hooks --check    exit 1 when the doc is stale, without writing

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadHookConfig, renderHooksDoc } from "../lib/hooks-doc.ts";
import { benchCoverage } from "./hook-bench.ts";

const check = process.argv.includes("--check");
const root = resolve(import.meta.dir, "..", "..");
const docPath = resolve(root, "docs", "hooks-reference.md");

const original = await readFile(docPath, "utf8");
const entries = loadHookConfig(root);
const { text, problems } = renderHooksDoc(original, entries);
problems.push(...benchCoverage(entries).map((p) => `hook-bench: ${p}`));

if (check) {
  if (text !== original) problems.unshift(`${docPath} is stale; run \`bun run docs:hooks\``);
} else if (text !== original) {
  await writeFile(docPath, text, "utf8");
  console.log(`docs:hooks — wrote the hook tables to ${docPath}`);
} else {
  console.log(`docs:hooks — ${docPath} is up to date`);
}

if (problems.length > 0) {
  for (const p of problems) console.error(`ERROR: ${p}`);
  process.exit(1);
}
if (check) console.log("docs:hooks — hook tables are fresh");
