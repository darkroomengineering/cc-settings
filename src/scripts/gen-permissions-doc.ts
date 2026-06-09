#!/usr/bin/env bun
// Inject the generated permissions listing into docs/settings-reference.md.
//
// Thin CLI over src/lib/permissions-doc.ts (the builder + markers live there).
//
// Usage:
//   bun run docs:permissions

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BEGIN, buildPermissionsBlock, END } from "../lib/permissions-doc.ts";

const root = resolve(import.meta.dir, "..", "..");
const docPath = resolve(root, "docs", "settings-reference.md");

const original = await readFile(docPath, "utf8");

const beginIdx = original.indexOf(BEGIN);
const endIdx = original.indexOf(END);

if (beginIdx === -1 || endIdx === -1) {
  console.error(`ERROR: Markers not found in ${docPath}.\nExpected:\n  ${BEGIN}\n  ${END}`);
  process.exit(1);
}

const block = buildPermissionsBlock(root);
const updated = `${original.slice(0, beginIdx + BEGIN.length)}\n${block}\n${original.slice(endIdx)}`;

await writeFile(docPath, updated, "utf8");
console.log(`docs:permissions — wrote generated block to ${docPath}`);
