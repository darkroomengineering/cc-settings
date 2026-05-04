// Skill prereq checker tests. Schema validation, requirement evaluation,
// missing-prereq report formatting.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSkillRequirements,
  formatPrereqWarnings,
  readAllSkillFrontmatters,
  readConfiguredMcpServers,
  reportMissingPrereqs,
} from "../src/lib/skill-prereqs.ts";
import {
  SkillFrontmatter,
  type SkillFrontmatter as SkillFrontmatterType,
  SkillRequirement,
} from "../src/schemas/skill.ts";

// Test helper — mint a SkillFrontmatter with whatever fields the test cares
// about, without re-declaring `name`/`description` every time.
function fm(extra: Record<string, unknown>): SkillFrontmatterType {
  return { name: "x", description: "y", ...extra } as SkillFrontmatterType;
}

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-prereq-"));
}

async function writeSkill(
  dir: string,
  name: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  const skillDir = join(dir, name);
  await mkdir(skillDir, { recursive: true });
  // Convert object to YAML manually — tests don't need full YAML emit.
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) {
        if (typeof item === "object" && item !== null) {
          const entries = Object.entries(item as Record<string, unknown>);
          lines.push(`  - ${entries[0]?.[0]}: ${entries[0]?.[1]}`);
          for (const [k2, v2] of entries.slice(1)) {
            lines.push(`    ${k2}: ${v2}`);
          }
        } else {
          lines.push(`  - ${item}`);
        }
      }
    } else {
      lines.push(`${k}: ${typeof v === "string" && v.includes(":") ? `"${v}"` : v}`);
    }
  }
  lines.push("---", "", "# Body");
  await writeFile(join(skillDir, "SKILL.md"), lines.join("\n"));
}

describe("SkillRequirement schema", () => {
  test("accepts a command requirement", () => {
    const r = SkillRequirement.safeParse({ command: "lighthouse" });
    expect(r.success).toBe(true);
  });

  test("accepts a command requirement with install hint", () => {
    const r = SkillRequirement.safeParse({ command: "lighthouse", install: "npm i -g lighthouse" });
    expect(r.success).toBe(true);
  });

  test("accepts an mcp requirement", () => {
    const r = SkillRequirement.safeParse({ mcp: "context7" });
    expect(r.success).toBe(true);
  });

  test("rejects entry with neither command nor mcp", () => {
    const r = SkillRequirement.safeParse({ install: "something" });
    expect(r.success).toBe(false);
  });

  test("rejects empty command string", () => {
    const r = SkillRequirement.safeParse({ command: "" });
    expect(r.success).toBe(false);
  });
});

describe("SkillFrontmatter accepts requires:", () => {
  test("frontmatter with full requires array parses cleanly", () => {
    const r = SkillFrontmatter.safeParse({
      name: "lighthouse",
      description: "audit performance",
      requires: [
        { command: "lighthouse", install: "npm i -g lighthouse" },
        { mcp: "claude_ai_Context7" },
      ],
    });
    expect(r.success).toBe(true);
  });

  test("frontmatter without requires still parses (optional)", () => {
    const r = SkillFrontmatter.safeParse({
      name: "fix",
      description: "fix bugs",
    });
    expect(r.success).toBe(true);
  });
});

describe("readConfiguredMcpServers", () => {
  test("merges servers from settings.json + ~/.claude.json", async () => {
    const dir = await sandbox();
    try {
      await writeFile(
        join(dir, "settings.json"),
        JSON.stringify({ mcpServers: { teamServer: { command: "x" } } }),
      );
      // No ~/.claude.json in the sandbox — exercises the missing-file branch.
      const servers = await readConfiguredMcpServers(dir);
      expect(servers.has("teamServer")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns empty set when neither file exists", async () => {
    const dir = await sandbox();
    try {
      const servers = await readConfiguredMcpServers(dir);
      // We can't fully isolate ~/.claude.json since it lives outside the
      // sandbox, but the function shouldn't throw and should return a Set.
      expect(servers).toBeInstanceOf(Set);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("malformed JSON in settings.json doesn't throw", async () => {
    const dir = await sandbox();
    try {
      await writeFile(join(dir, "settings.json"), "{not json");
      await expect(readConfiguredMcpServers(dir)).resolves.toBeInstanceOf(Set);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("checkSkillRequirements", () => {
  test("returns missing CLI when command isn't on PATH", () => {
    const missing = checkSkillRequirements(
      fm({ requires: [{ command: "definitely-not-on-path-xyz123", install: "npm i -g foo" }] }),
      new Set(),
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]?.kind).toBe("command");
    expect(missing[0]?.name).toBe("definitely-not-on-path-xyz123");
    expect(missing[0]?.install).toBe("npm i -g foo");
  });

  test("returns missing MCP when not configured", () => {
    const missing = checkSkillRequirements(
      fm({ requires: [{ mcp: "missing-mcp-server" }] }),
      new Set(["other-server"]),
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]?.kind).toBe("mcp");
    expect(missing[0]?.name).toBe("missing-mcp-server");
  });

  test("returns empty when MCP IS configured", () => {
    const missing = checkSkillRequirements(
      fm({ requires: [{ mcp: "configured-server" }] }),
      new Set(["configured-server"]),
    );
    expect(missing).toEqual([]);
  });

  test("returns empty when CLI IS on PATH (uses bun, which we know exists)", () => {
    const missing = checkSkillRequirements(fm({ requires: [{ command: "bun" }] }), new Set());
    expect(missing).toEqual([]);
  });

  test("returns empty when no requires field", () => {
    expect(checkSkillRequirements(fm({}), new Set())).toEqual([]);
  });
});

describe("readAllSkillFrontmatters", () => {
  test("walks skills dir and parses frontmatter", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "alpha", {
        name: "alpha",
        description: "first skill",
      });
      await writeSkill(dir, "beta", {
        name: "beta",
        description: "second skill",
      });
      const skills = await readAllSkillFrontmatters(dir);
      expect(skills).toHaveLength(2);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(["alpha", "beta"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns [] for missing dir (no throw)", async () => {
    const skills = await readAllSkillFrontmatters("/nonexistent/path/xyz");
    expect(skills).toEqual([]);
  });
});

describe("reportMissingPrereqs — end-to-end", () => {
  test("aggregates missing prereqs across multiple skills", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "lighthouse", {
        name: "lighthouse",
        description: "audit",
        requires: [{ command: "definitely-not-on-path-xyz" }],
      });
      await writeSkill(dir, "fix", {
        name: "fix",
        description: "fix bugs",
        // no requires → not in report
      });
      const reports = await reportMissingPrereqs(dir, "/nonexistent");
      expect(reports).toHaveLength(1);
      expect(reports[0]?.skill).toBe("lighthouse");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("formatPrereqWarnings", () => {
  test("returns null when no missing prereqs", () => {
    expect(formatPrereqWarnings([])).toBeNull();
  });

  test("formats per-skill bullet list", () => {
    const out = formatPrereqWarnings([
      {
        skill: "lighthouse",
        missing: [{ kind: "command", name: "lighthouse", install: "npm i -g lighthouse" }],
      },
      {
        skill: "tldr",
        missing: [{ kind: "mcp", name: "tldr-mcp" }],
      },
    ]);
    expect(out).toContain("2 skill(s) have unmet prerequisites");
    expect(out).toContain("/lighthouse:");
    expect(out).toContain("missing CLI: lighthouse (npm i -g lighthouse)");
    expect(out).toContain("/tldr:");
    expect(out).toContain("missing MCP: tldr-mcp");
  });
});
