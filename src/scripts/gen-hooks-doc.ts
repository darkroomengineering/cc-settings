#!/usr/bin/env bun
// Regenerate the hook wiring tables in docs/hooks-reference.md.
//
// Thin CLI over src/lib/hooks-doc.ts (the builder, markers and descriptions
// live there). Also checks that hook-bench covers every synchronous hook.
//
// Usage:
//   bun run docs:hooks            rewrite the tables in place
//   bun run docs:hooks --check    exit 1 when the doc is stale, without writing

import { resolve } from "node:path";
import { loadHookConfig, updateHooksDoc } from "../lib/hooks-doc.ts";
import { benchCoverage } from "./hook-bench.ts";

const check = process.argv.includes("--check");
const root = resolve(import.meta.dir, "..", "..");
const docPath = resolve(root, "docs", "hooks-reference.md");

const entries = loadHookConfig(root);
const extraProblems = benchCoverage(entries).map((p) => `hook-bench: ${p}`);
const { problems, stale, wrote } = await updateHooksDoc(docPath, entries, { check, extraProblems });

if (check && stale) problems.unshift(`${docPath} is stale; run \`bun run docs:hooks\``);
if (problems.length > 0) {
  for (const p of problems) console.error(`ERROR: ${p}`);
  if (!check) console.error(`docs:hooks — left ${docPath} unchanged`);
  process.exit(1);
}
if (check) console.log("docs:hooks — hook tables are fresh");
else if (wrote) console.log(`docs:hooks — wrote the hook tables to ${docPath}`);
else console.log(`docs:hooks — ${docPath} is up to date`);
