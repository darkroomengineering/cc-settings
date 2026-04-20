// Parse the real config files in this repo against the Phase 1 zod schemas.
// If these ever fail, either the schema is wrong or the file drifted.
// Kept minimal: we're verifying the schemas describe reality, not testing zod.

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { z } from "zod";
import { HooksConfig } from "../src/schemas/hooks-config.ts";
import { Settings } from "../src/schemas/settings.ts";
import { SkillFrontmatter } from "../src/schemas/skill.ts";

const ROOT = resolve(import.meta.dir, "..");

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

// Minimal YAML frontmatter extractor for SKILL.md files. Phase 3 replaces this
// with the `yaml` dep (see migration plan); we only need it here to validate
// shape, so a lazy regex is fine.
function parseFrontmatter(md: string): Record<string, unknown> | null {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const body = match[1] ?? "";
  const out: Record<string, unknown> = {};
  const lines = body.split(/\r?\n/);
  const indentedOrBlank = /^(\s+\S|\s*$)/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const kv = line.match(/^([a-zA-Z_-][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const [, key = "", rest = ""] = kv;

    // Block scalar (`|` or `>`) — gather indented lines until next key.
    if (rest === "|" || rest === ">") {
      const collected: string[] = [];
      i++;
      while (i < lines.length && indentedOrBlank.test(lines[i] ?? "")) {
        const next = lines[i] ?? "";
        collected.push(next.replace(/^\s+/, ""));
        i++;
      }
      out[key] = collected.join("\n").trim();
      continue;
    }

    // Block sequence (`key:\n  - value\n  - value`).
    if (rest === "") {
      const items: string[] = [];
      let j = i + 1;
      const listItem = /^\s+-\s+(.*)$/;
      while (j < lines.length) {
        const m = (lines[j] ?? "").match(listItem);
        if (!m) break;
        items.push((m[1] ?? "").replace(/^['"]|['"]$/g, "").trim());
        j++;
      }
      if (items.length) {
        out[key] = items;
        i = j;
        continue;
      }
    }

    // Inline array `[a, b, c]`.
    if (rest.startsWith("[") && rest.endsWith("]")) {
      out[key] = rest
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      out[key] = rest.replace(/^['"]|['"]$/g, "");
    }
    i++;
  }
  return out;
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
