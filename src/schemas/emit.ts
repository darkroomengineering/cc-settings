#!/usr/bin/env bun
// Emit JSON Schema for IDE autocomplete / install-time validation.
// Uses zod 4's native `z.toJSONSchema` — no extra dep.
//
// CI runs `bun run schemas:emit && git diff --exit-code schemas/` so any
// schema change must be committed alongside the zod source.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { ClaudeJson } from "./claude-json.ts";
import { HooksConfig } from "./hooks-config.ts";
import { Settings } from "./settings.ts";
import { SkillFrontmatter } from "./skill.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const OUT = resolve(ROOT, "schemas");

type Target = { file: string; schema: z.ZodType; id: string; title: string };

const targets: Target[] = [
  {
    file: "settings.schema.json",
    schema: Settings,
    id: "https://cc-settings.darkroom/schema/settings.json",
    title: "Claude Code settings.json",
  },
  {
    file: "hooks-config.schema.json",
    schema: HooksConfig,
    id: "https://cc-settings.darkroom/schema/hooks-config.json",
    title: "cc-settings hooks-config.json",
  },
  {
    file: "skill.schema.json",
    schema: SkillFrontmatter,
    id: "https://cc-settings.darkroom/schema/skill.json",
    title: "Darkroom skill frontmatter",
  },
  {
    file: "claude-json.schema.json",
    schema: ClaudeJson,
    id: "https://cc-settings.darkroom/schema/claude-json.json",
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
