#!/usr/bin/env bun
// Generator for the exhaustive permissions listing in docs/settings-reference.md.
//
// Reads config/30-permissions.json and emits a deterministic markdown block.
// The block is injected between <!-- BEGIN AUTOGEN:permissions --> and
// <!-- END AUTOGEN:permissions --> markers in docs/settings-reference.md.
//
// Usage (CLI):
//   bun src/scripts/gen-permissions-doc.ts
//
// Also importable — buildPermissionsBlock() and the marker constants are
// exported so tests/docs-permissions.test.ts can assert freshness without
// touching the filesystem.

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const BEGIN = "<!-- BEGIN AUTOGEN:permissions -->";
export const END = "<!-- END AUTOGEN:permissions -->";

export function buildPermissionsBlock(repoRoot: string): string {
  const permissionsPath = resolve(repoRoot, "config", "30-permissions.json");
  const raw = readFileSync(permissionsPath, "utf8");
  const config = JSON.parse(raw) as {
    permissions: { allow: string[]; deny: string[] };
  };
  const { allow, deny } = config.permissions;

  const lines: string[] = [
    "_Auto-generated from `config/30-permissions.json` — do not edit by hand; run `bun run docs:permissions`._",
    "",
    "**Allow**",
    "",
    "```",
    ...allow,
    "```",
    "",
    "**Deny**",
    "",
    "```",
    ...deny,
    "```",
  ];

  return lines.join("\n");
}

if (import.meta.main) {
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
}
