// Parse the real config files in this repo against the Phase 1 zod schemas.
// If these ever fail, either the schema is wrong or the file drifted.
// Kept minimal: we're verifying the schemas describe reality, not testing zod.

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { HooksConfig } from "../src/schemas/hooks-config.ts";
import { Settings } from "../src/schemas/settings.ts";
import { SkillFrontmatter } from "../src/schemas/skill.ts";

const ROOT = resolve(import.meta.dir, "..");

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

// Real YAML parser (Phase 3 upgrade). Returns the parsed frontmatter object
// or null if no frontmatter block is present.
function parseFrontmatter(md: string): Record<string, unknown> | null {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const body = match[1] ?? "";
  const parsed = parseYaml(body) as unknown;
  if (parsed === null || typeof parsed !== "object") return null;
  return parsed as Record<string, unknown>;
}

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`).join("\n");
}

describe("Settings schema vs the real settings.json", () => {
  test("parses without errors", async () => {
    const raw = await readJson(resolve(ROOT, "settings.json"));
    const result = Settings.safeParse(raw);
    if (!result.success) {
      throw new Error(`settings.json failed validation:\n${formatZodError(result.error)}`);
    }
    expect(result.success).toBe(true);
  });

  test("rejects unknown top-level keys (strict)", () => {
    const bad = Settings.safeParse({ env: {}, totallyUnknownKey: 1 });
    expect(bad.success).toBe(false);
  });
});

describe("HooksConfig schema", () => {
  test("parses hooks-config.json", async () => {
    const raw = await readJson(resolve(ROOT, "hooks-config.json"));
    const result = HooksConfig.safeParse(raw);
    if (!result.success) {
      throw new Error(`hooks-config.json failed:\n${formatZodError(result.error)}`);
    }
    expect(result.success).toBe(true);
  });
});

describe("SkillFrontmatter schema vs every SKILL.md in skills/", () => {
  test("all skills have valid frontmatter", async () => {
    const skillsDir = resolve(ROOT, "skills");
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const failures: string[] = [];
    let checked = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = resolve(skillsDir, entry.name, "SKILL.md");
      const file = Bun.file(skillPath);
      if (!(await file.exists())) continue;
      const text = await file.text();
      const fm = parseFrontmatter(text);
      if (!fm) {
        failures.push(`${entry.name}: no frontmatter`);
        continue;
      }
      const result = SkillFrontmatter.safeParse(fm);
      checked++;
      if (!result.success) {
        failures.push(`${entry.name}:\n${formatZodError(result.error)}`);
      }
    }

    if (failures.length)
      throw new Error(`${failures.length} skill(s) failed:\n${failures.join("\n\n")}`);
    expect(checked).toBeGreaterThan(0);
  });
});
