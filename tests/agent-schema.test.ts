// Agent frontmatter schema + validator tests. Locks in:
//   - strict enums for effort / permissionMode / model alias
//   - kebab-case name regex
//   - permissive passthrough for unknown fields (agent ecosystem is fast-moving)
//   - real repo's agents/ all parse cleanly today

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formatFrontmatterIssues, validateFrontmatters } from "../src/lib/frontmatter-validate.ts";
import { AgentFrontmatter } from "../src/schemas/agent.ts";

const ROOT = resolve(import.meta.dir, "..");

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-agent-"));
}

describe("AgentFrontmatter schema", () => {
  test("accepts a minimal valid agent", () => {
    const r = AgentFrontmatter.safeParse({ name: "explore", description: "explore code" });
    expect(r.success).toBe(true);
  });

  test("accepts all known effort levels", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      const r = AgentFrontmatter.safeParse({
        name: "x",
        description: "y",
        effort,
      });
      expect(r.success).toBe(true);
    }
  });

  test("rejects effort typos", () => {
    const r = AgentFrontmatter.safeParse({
      name: "x",
      description: "y",
      effort: "xtreme",
    });
    expect(r.success).toBe(false);
  });

  test("rejects permissionMode typos", () => {
    const r = AgentFrontmatter.safeParse({
      name: "x",
      description: "y",
      permissionMode: "planning",
    });
    expect(r.success).toBe(false);
  });

  test("accepts pinned model variants like opus[1m]", () => {
    const r = AgentFrontmatter.safeParse({
      name: "x",
      description: "y",
      model: "opus[1m]",
    });
    expect(r.success).toBe(true);
  });

  test("rejects non-kebab-case names", () => {
    const r = AgentFrontmatter.safeParse({ name: "MyAgent", description: "y" });
    expect(r.success).toBe(false);
  });

  test("rejects empty description", () => {
    const r = AgentFrontmatter.safeParse({ name: "x", description: "" });
    expect(r.success).toBe(false);
  });

  test("passthrough — unknown fields don't fail", () => {
    const r = AgentFrontmatter.safeParse({
      name: "x",
      description: "y",
      somethingNew: "future field",
    });
    expect(r.success).toBe(true);
  });
});

describe("validateFrontmatters — repo dogfood", () => {
  test("repo's actual agents/ + skills/ all pass validation today", async () => {
    const issues = await validateFrontmatters(ROOT);
    if (issues.length > 0) {
      const formatted = formatFrontmatterIssues(issues) ?? "";
      throw new Error(`Frontmatter validation failed:\n${formatted}`);
    }
    expect(issues).toEqual([]);
  });
});

describe("validateFrontmatters — synthetic failures", () => {
  test("catches an effort typo in an agent file", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "agents"));
      await writeFile(
        join(dir, "agents", "broken.md"),
        ["---", "name: broken", "description: oops", "effort: xtreme", "---", "", "body"].join(
          "\n",
        ),
      );
      const issues = await validateFrontmatters(dir);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.kind).toBe("agent");
      expect(issues[0]?.path).toBe("agents/broken.md");
      expect(issues[0]?.errors.some((e) => e.includes("effort"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("catches a permissionMode typo", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "agents"));
      await writeFile(
        join(dir, "agents", "broken.md"),
        ["---", "name: broken", "description: oops", "permissionMode: planning", "---"].join("\n"),
      );
      const issues = await validateFrontmatters(dir);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.errors.some((e) => e.includes("permissionMode"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("catches a non-kebab name in a skill", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "skills", "BadName"), { recursive: true });
      await writeFile(
        join(dir, "skills", "BadName", "SKILL.md"),
        ["---", "name: BadName", "description: typo in name", "---"].join("\n"),
      );
      const issues = await validateFrontmatters(dir);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.kind).toBe("skill");
      expect(issues[0]?.errors.some((e) => e.includes("kebab"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("duplicate top-level key in an agent is caught (strict routing, issue #88)", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "agents"));
      // Two `model:` keys — a bad-merge scenario. The loose parser used to
      // silently take the last value; validateFrontmatters now routes
      // through parseFrontmatterStrict and must flag this.
      await writeFile(
        join(dir, "agents", "broken.md"),
        [
          "---",
          "name: broken",
          "description: oops",
          "model: opus",
          "model: sonnet",
          "---",
          "",
          "body",
        ].join("\n"),
      );
      const issues = await validateFrontmatters(dir);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.kind).toBe("agent");
      expect(issues[0]?.errors.some((e) => e.includes("model"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing frontmatter delimiters surfaces clearly", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "agents"));
      await writeFile(join(dir, "agents", "broken.md"), "no frontmatter here");
      const issues = await validateFrontmatters(dir);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.errors[0]).toContain("no parseable frontmatter");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns empty when both directories are absent", async () => {
    const dir = await sandbox();
    try {
      const issues = await validateFrontmatters(dir);
      expect(issues).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("formatFrontmatterIssues", () => {
  test("returns null for empty list", () => {
    expect(formatFrontmatterIssues([])).toBeNull();
  });

  test("formats per-file with indented errors", () => {
    const out = formatFrontmatterIssues([
      { kind: "agent", path: "agents/broken.md", errors: ["effort: invalid"] },
      { kind: "skill", path: "skills/foo/SKILL.md", errors: ["name: invalid"] },
    ]);
    expect(out).toContain("2 frontmatter issue(s)");
    expect(out).toContain("agents/broken.md:");
    expect(out).toContain("skills/foo/SKILL.md:");
  });
});
