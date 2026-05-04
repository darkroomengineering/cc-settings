#!/usr/bin/env bun
// Emit JSON Schema for IDE autocomplete / install-time validation.
// Uses zod 4's native `z.toJSONSchema` — no extra dep.
//
// CI runs `bun run schemas:emit && git diff --exit-code schemas/` so any
// schema change must be committed alongside the zod source.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { AgentFrontmatter } from "./agent.ts";
import { ClaudeJson } from "./claude-json.ts";
import { HooksConfig } from "./hooks-config.ts";
import { Settings } from "./settings.ts";
import { SkillFrontmatter } from "./skill.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const OUT = resolve(ROOT, "schemas");

type Target = { file: string; schema: z.ZodType; id: string; title: string };

// Real, fetchable URLs — IDEs (VSCode, Cursor, JetBrains) use these for
// IntelliSense when a settings.json declares `$schema`. GitHub raw on `main`
// means schema updates are live as soon as a commit lands.
const SCHEMA_BASE =
  "https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/schemas";

const targets: Target[] = [
  {
    file: "settings.schema.json",
    schema: Settings,
    id: `${SCHEMA_BASE}/settings.schema.json`,
    title: "Claude Code settings.json (cc-settings)",
  },
  {
    file: "hooks-config.schema.json",
    schema: HooksConfig,
    id: `${SCHEMA_BASE}/hooks-config.schema.json`,
    title: "cc-settings hooks-config.json",
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
];

for (const { file, schema, id, title } of targets) {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  });
  const withMeta = { $id: id, title, ...json };
  const path = resolve(OUT, file);
  await writeFile(path, `${JSON.stringify(withMeta, null, 2)}\n`);
  console.log(`wrote ${path}`);
}
