// Profile frontmatter schema + validator tests. Locks in:
//   - kebab-case name regex
//   - description required
//   - advisory fields (model, skills, tools, permissionMode, effort) are optional
//   - permissive passthrough for unknown fields
//   - all 6 shipped profiles/ validate cleanly today

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formatFrontmatterIssues, validateFrontmatters } from "../src/lib/frontmatter-validate.ts";
import { ProfileFrontmatter } from "../src/schemas/profile.ts";

const ROOT = resolve(import.meta.dir, "..");

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-profile-"));
}

describe("ProfileFrontmatter schema", () => {
  test("accepts a minimal valid profile", () => {
    const r = ProfileFrontmatter.safeParse({
      name: "nextjs",
      description: "Next.js web apps",
    });
    expect(r.success).toBe(true);
  });

  test("accepts all advisory fields", () => {
    const r = ProfileFrontmatter.safeParse({
      name: "nextjs",
      description: "Next.js web apps",
      model: "opus",
      skills: ["build", "component"],
      tools: ["Read", "Write"],
      permissionMode: "default",
      effort: "xhigh",
    });
    expect(r.success).toBe(true);
  });

  test("accepts pinned model variants like opus[1m]", () => {
    const r = ProfileFrontmatter.safeParse({
      name: "x",
      description: "y",
      model: "opus[1m]",
    });
    expect(r.success).toBe(true);
  });

  test("rejects non-kebab-case names", () => {
    const r = ProfileFrontmatter.safeParse({ name: "Next JS", description: "y" });
    expect(r.success).toBe(false);
  });

  test("rejects names with uppercase", () => {
    const r = ProfileFrontmatter.safeParse({ name: "NextJS", description: "y" });
    expect(r.success).toBe(false);
  });

  test("rejects missing description", () => {
    const r = ProfileFrontmatter.safeParse({ name: "nextjs" });
    expect(r.success).toBe(false);
  });

  test("rejects empty description", () => {
    const r = ProfileFrontmatter.safeParse({ name: "nextjs", description: "" });
    expect(r.success).toBe(false);
  });

  test("rejects effort typos", () => {
    const r = ProfileFrontmatter.safeParse({
      name: "x",
      description: "y",
      effort: "xtreme",
    });
    expect(r.success).toBe(false);
  });

  test("rejects permissionMode typos", () => {
    const r = ProfileFrontmatter.safeParse({
      name: "x",
      description: "y",
      permissionMode: "planning",
    });
    expect(r.success).toBe(false);
  });

  test("passthrough — unknown fields don't fail", () => {
    const r = ProfileFrontmatter.safeParse({
      name: "x",
      description: "y",
      somethingNew: "future field",
    });
    expect(r.success).toBe(true);
  });
});

describe("validateFrontmatters — repo dogfood (profiles)", () => {
  test("repo's actual profiles/ all pass validation today", async () => {
    const issues = await validateFrontmatters(ROOT);
    const profileIssues = issues.filter((i) => i.kind === "profile");
    if (profileIssues.length > 0) {
      const formatted = formatFrontmatterIssues(profileIssues) ?? "";
      throw new Error(`Profile frontmatter validation failed:\n${formatted}`);
    }
    expect(profileIssues).toEqual([]);
  });
});

describe("validateFrontmatters — synthetic profile failures", () => {
  test("catches a non-kebab name in a profile", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "profiles"));
      await writeFile(
        join(dir, "profiles", "broken.md"),
        ["---", "name: My Profile", "description: typo in name", "---", "", "body"].join("\n"),
      );
      const issues = await validateFrontmatters(dir);
      const profileIssues = issues.filter((i) => i.kind === "profile");
      expect(profileIssues).toHaveLength(1);
      expect(profileIssues[0]?.path).toBe("profiles/broken.md");
      expect(profileIssues[0]?.errors.some((e) => e.includes("kebab"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("catches missing description in a profile", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "profiles"));
      await writeFile(
        join(dir, "profiles", "broken.md"),
        ["---", "name: broken", "---", "", "no description"].join("\n"),
      );
      const issues = await validateFrontmatters(dir);
      const profileIssues = issues.filter((i) => i.kind === "profile");
      expect(profileIssues).toHaveLength(1);
      expect(profileIssues[0]?.errors.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("catches missing frontmatter in a profile", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "profiles"));
      await writeFile(
        join(dir, "profiles", "broken.md"),
        "# Profile with no frontmatter\n\nJust body text.",
      );
      const issues = await validateFrontmatters(dir);
      const profileIssues = issues.filter((i) => i.kind === "profile");
      expect(profileIssues).toHaveLength(1);
      expect(profileIssues[0]?.errors[0]).toContain("no parseable frontmatter");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skips README.md in profiles/", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "profiles"));
      await writeFile(
        join(dir, "profiles", "README.md"),
        "# Profiles README\n\nNo frontmatter — should be skipped.",
      );
      const issues = await validateFrontmatters(dir);
      const profileIssues = issues.filter((i) => i.kind === "profile");
      expect(profileIssues).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns empty when profiles/ directory is absent", async () => {
    const dir = await sandbox();
    try {
      const issues = await validateFrontmatters(dir);
      expect(issues).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("formatFrontmatterIssues — profile kind", () => {
  test("formats profile issues with path", () => {
    const out = formatFrontmatterIssues([
      { kind: "profile", path: "profiles/broken.md", errors: ["name: invalid"] },
    ]);
    expect(out).toContain("1 frontmatter issue(s)");
    expect(out).toContain("profiles/broken.md:");
    expect(out).toContain("agents/skills/profiles");
  });
});
