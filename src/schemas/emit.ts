#!/usr/bin/env bun
// Emit JSON Schema for IDE autocomplete / install-time validation.
// Uses zod 4's native `z.toJSONSchema` — no extra dep.
//
// CI runs `bun run schemas:emit && git diff --exit-code schemas/`, and
// tests/schemas.test.ts asserts the committed files equal buildSchema() output —
// so a stale OR hand-written schema fails the normal test suite. NEVER hand-edit
// the files under schemas/; run `bun run schemas:emit` and commit the output.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { AgentFrontmatter } from "./agent.ts";
import { ClaudeJson } from "./claude-json.ts";
import { KnowledgeFrontmatter } from "./knowledge.ts";
import { ProfileFrontmatter } from "./profile.ts";
import { Settings } from "./settings.ts";
import { SkillFrontmatter } from "./skill.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
export const OUT = resolve(ROOT, "schemas");

export type Target = { file: string; schema: z.ZodType; id: string; title: string };

// Real, fetchable URLs — IDEs (VSCode, Cursor, JetBrains) use these for
// IntelliSense when a settings.json declares `$schema`. GitHub raw on `main`
// means schema updates are live as soon as a commit lands.
const SCHEMA_BASE =
  "https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/schemas";

export const targets: Target[] = [
  {
    file: "settings.schema.json",
    schema: Settings,
    id: `${SCHEMA_BASE}/settings.schema.json`,
    title: "Claude Code settings.json (cc-settings)",
  },
  {
    file: "skill.schema.json",
    schema: SkillFrontmatter,
    id: `${SCHEMA_BASE}/skill.schema.json`,
    title: "Darkroom skill frontmatter",
  },
  {
    file: "agent.schema.json",
    schema: AgentFrontmatter,
    id: `${SCHEMA_BASE}/agent.schema.json`,
    title: "Darkroom agent frontmatter",
  },
  {
    file: "claude-json.schema.json",
    schema: ClaudeJson,
    id: `${SCHEMA_BASE}/claude-json.schema.json`,
    title: "~/.claude.json (passthrough)",
  },
  {
    file: "profile.schema.json",
    schema: ProfileFrontmatter,
    id: `${SCHEMA_BASE}/profile.schema.json`,
    title: "Darkroom profile frontmatter",
  },
  {
    file: "knowledge.schema.json",
    schema: KnowledgeFrontmatter,
    id: `${SCHEMA_BASE}/knowledge.schema.json`,
    title: "Darkroom knowledge note frontmatter",
  },
];

// Single source of truth for a target's emitted JSON text — used by the CLI
// writer below AND by the freshness test in tests/schemas.test.ts. Keep the
// formatting identical to what is written to disk.
export function buildSchema(t: Target): string {
  const json = z.toJSONSchema(t.schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  });
  const withMeta = { $id: t.id, title: t.title, ...json };
  return `${JSON.stringify(withMeta, null, 2)}\n`;
}

export async function emitAll(): Promise<void> {
  for (const t of targets) {
    const path = resolve(OUT, t.file);
    await writeFile(path, buildSchema(t));
    console.log(`wrote ${path}`);
  }
}

// Only write to disk when invoked directly (the `schemas:emit` CLI). Importing
// this module (e.g. from the freshness test) must not touch the filesystem.
if (import.meta.main) {
  await emitAll();
}
