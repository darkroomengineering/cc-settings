// Builder for the exhaustive permissions listing in docs/settings-reference.md.
//
// Reads config/30-permissions.json and emits a deterministic markdown block.
// The block is injected between the BEGIN/END markers by the thin CLI wrapper
// src/scripts/gen-permissions-doc.ts; tests/docs-permissions.test.ts asserts
// freshness against this builder directly.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const BEGIN = "<!-- BEGIN AUTOGEN:permissions -->";
export const END = "<!-- END AUTOGEN:permissions -->";

const PermissionsFragment = z.looseObject({
  permissions: z.looseObject({
    allow: z.array(z.string()),
    deny: z.array(z.string()),
  }),
});

export function buildPermissionsBlock(repoRoot: string): string {
  const permissionsPath = resolve(repoRoot, "config", "30-permissions.json");
  const raw = readFileSync(permissionsPath, "utf8");
  const { allow, deny } = PermissionsFragment.parse(JSON.parse(raw)).permissions;

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
