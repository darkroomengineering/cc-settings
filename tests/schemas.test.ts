// Parse the real config files in this repo against the Phase 1 zod schemas.
// If these ever fail, either the schema is wrong or the file drifted.
// Kept minimal: we're verifying the schemas describe reality, not testing zod.

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { z } from "zod";
import { composeSettings } from "../src/lib/compose-settings.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { buildSchema, OUT, targets } from "../src/schemas/emit.ts";
import { HookEvent } from "../src/schemas/hooks.ts";
import { HooksConfig } from "../src/schemas/hooks-config.ts";
import { Settings } from "../src/schemas/settings.ts";
import { SkillFrontmatter } from "../src/schemas/skill.ts";

const ROOT = resolve(import.meta.dir, "..");

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`).join("\n");
}

describe("emitted JSON schemas are committed fresh", () => {
  // A stale OR hand-written schemas/*.schema.json fails here. Fix by running
  // `bun run schemas:emit` and committing the output — never hand-edit them.
  for (const t of targets) {
    test(`${t.file} matches emitter output`, async () => {
      const expected = buildSchema(t);
      const actual = await readFile(resolve(OUT, t.file), "utf8");
      expect(actual).toBe(expected);
    });
  }
});

describe("Settings schema vs the composed config/ fragments", () => {
  test("composed fragments parse without errors", async () => {
    const composed = await composeSettings(ROOT);
    const result = Settings.safeParse(composed);
    if (!result.success) {
      throw new Error(`composed fragments failed validation:\n${formatZodError(result.error)}`);
    }
    expect(result.success).toBe(true);
  });

  // Schema is now passthrough, not strict — unknown keys are tolerated so a
  // real live settings.json (which CC writes undocumented keys into) can parse.
  test("accepts unknown top-level keys (forward-compat passthrough)", () => {
    const result = Settings.safeParse({ env: {}, totallyUnknownKey: 1 });
    expect(result.success).toBe(true);
  });

  // Typo guard: replaces the old strict() check for OUR fragments. Every key
  // we ship in config/*.json must be a known typed key in the schema so typos
  // surface here rather than silently at install time.
  test("composed fragments contain only known keys", async () => {
    const composed = await composeSettings(ROOT);
    const knownKeys = new Set(Object.keys(Settings.shape));
    const unknownKeys = Object.keys(composed).filter((k) => !knownKeys.has(k));
    if (unknownKeys.length > 0) {
      throw new Error(
        `config/*.json fragments contain keys not in Settings.shape (typo?): ${unknownKeys.join(", ")}`,
      );
    }
    expect(unknownKeys.length).toBe(0);
  });

  // Positive: new documented keys accepted under passthrough + typed fields.
  test("accepts representative new documented keys", () => {
    const result = Settings.safeParse({
      tui: "fullscreen",
      editorMode: "vim",
      autoUpdatesChannel: "latest",
      teammateMode: "in-process",
    });
    expect(result.success).toBe(true);
  });

  // Negative: enum validation still catches bad values on known keys.
  test("rejects invalid enum value on known key (tui: bogus)", () => {
    const result = Settings.safeParse({ tui: "bogus" });
    expect(result.success).toBe(false);
  });
});

describe("HooksConfig schema", () => {
  // hooks-config.json was collapsed into settings.json.env (CC_CLAUDE_MD_*)
  // in Phase 4 and deleted in Phase 7. The schema stays callable in case a
  // downstream project revives the file shape, but we no longer ship one.
  test("HooksConfig parses an empty object", () => {
    expect(HooksConfig.safeParse({}).success).toBe(true);
  });
  test("HooksConfig rejects unknown top-level keys (strict)", () => {
    expect(HooksConfig.safeParse({ totally_unknown: true }).success).toBe(false);
  });
});

describe("Published JSON Schemas vs zod sources", () => {
  // The schemas/*.schema.json files are committed to git and referenced by
  // editors via $schema URLs (raw.githubusercontent.com on main). They must
  // stay in sync with the zod sources — `bun run schemas:emit` regenerates
  // them; CI fails if a commit changes a zod source without re-emitting.
  const schemas = [
    { file: "settings.schema.json", expectedTitle: "Claude Code settings.json (cc-settings)" },
    { file: "hooks-config.schema.json", expectedTitle: "cc-settings hooks-config.json" },
    { file: "skill.schema.json", expectedTitle: "Darkroom skill frontmatter" },
    { file: "claude-json.schema.json", expectedTitle: "~/.claude.json (passthrough)" },
  ] as const;

  for (const { file, expectedTitle } of schemas) {
    test(`${file} carries a valid $id pointing at GitHub raw on main`, async () => {
      const raw = await readFile(resolve(ROOT, "schemas", file), "utf8");
      const schema = JSON.parse(raw) as { $id?: string; title?: string };
      expect(schema.$id).toBe(
        `https://raw.githubusercontent.com/darkroomengineering/cc-settings/main/schemas/${file}`,
      );
      expect(schema.title).toBe(expectedTitle);
    });
  }

  test("config/10-core.json $schema points at the canonical schemastore URL", async () => {
    // Claude Code's settings validator strictly accepts only the schemastore
    // URL — any other value makes it skip the entire settings.json (env vars,
    // statusLine, hooks, permissions, all of it). Regression guard for v10.11.1.
    const raw = await readFile(resolve(ROOT, "config/10-core.json"), "utf8");
    const cfg = JSON.parse(raw) as { $schema?: string };
    expect(cfg.$schema).toBe("https://json.schemastore.org/claude-code-settings.json");
  });

  test("composed settings.json validates against the published settings schema", async () => {
    // Roundtrip: zod → JSON Schema → real composed config. If the published
    // schema rejects what we ship, editors will lint-error on every key.
    const composed = await composeSettings(ROOT);
    const result = Settings.safeParse(composed);
    expect(result.success).toBe(true);
  });
});

describe("HookEvent schema — v11.6.0 new events", () => {
  for (const event of ["Setup", "UserPromptExpansion", "PostToolBatch"] as const) {
    test(`accepts "${event}"`, () => {
      expect(HookEvent.safeParse(event).success).toBe(true);
    });
  }
  test("rejects an unknown event name", () => {
    expect(HookEvent.safeParse("TotallyBogusEvent").success).toBe(false);
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
