// Linter tests. Validates each rule fires on the correct shape and that the
// happy-path passes cleanly.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formatFindings, hasErrors, lintSkillsDir } from "../src/lib/lint-skills.ts";

const ROOT = resolve(import.meta.dir, "..");

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-lint-skills-"));
}

async function writeSkill(root: string, name: string, body: string): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), body);
}

const goodFrontmatter = (name: string) =>
  `---
name: ${name}
description: A reasonably long description that explains what it does. Triggers "test", "example".
---

# Body
`;

describe("lintSkillsDir — happy path", () => {
  test("clean skill produces no findings", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "alpha", goodFrontmatter("alpha"));
      const result = await lintSkillsDir(dir);
      expect(result.findings).toEqual([]);
      expect(result.skillCount).toBe(1);
      expect(hasErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing skills dir returns empty result", async () => {
    const result = await lintSkillsDir("/nonexistent/xyz");
    expect(result.skillCount).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

describe("lintSkillsDir — kebab-case", () => {
  test("flags Capital folder name", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "BadName", goodFrontmatter("BadName"));
      const result = await lintSkillsDir(dir);
      const rules = result.findings.map((f) => f.rule);
      expect(rules).toContain("folder-kebab-case");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("flags underscore folder name", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "snake_case", goodFrontmatter("snake_case"));
      const result = await lintSkillsDir(dir);
      const rules = result.findings.map((f) => f.rule);
      expect(rules).toContain("folder-kebab-case");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintSkillsDir — reserved names", () => {
  test("flags reserved 'claude-*' prefix", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "claude-helper", goodFrontmatter("claude-helper"));
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "reserved-name")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("flags reserved 'anthropic' literal", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "anthropic", goodFrontmatter("anthropic"));
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "reserved-name")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does NOT flag 'cc-sync' (not reserved)", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "cc-sync", goodFrontmatter("cc-sync"));
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "reserved-name")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintSkillsDir — README inside", () => {
  test("flags README.md inside skill folder", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "alpha", goodFrontmatter("alpha"));
      await writeFile(join(dir, "alpha", "README.md"), "# nope");
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "no-readme-inside")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintSkillsDir — angle brackets in frontmatter", () => {
  test("flags <skill-name> placeholder in argument-hint", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(
        dir,
        "alpha",
        `---
name: alpha
description: Long enough description to pass the floor. Triggers "test".
argument-hint: "<skill-name>"
---

# Body
`,
      );
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "no-angle-brackets")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("flags > comparison in description", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(
        dir,
        "alpha",
        `---
name: alpha
description: A description with a comparison operator >50 and trigger word "test".
---

# Body
`,
      );
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "no-angle-brackets")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintSkillsDir — description rules", () => {
  test("warns on too-short description", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(
        dir,
        "alpha",
        `---
name: alpha
description: Helps stuff.
---

# Body
`,
      );
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "description-too-short")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("warns on missing trigger language", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(
        dir,
        "alpha",
        `---
name: alpha
description: This skill performs sophisticated analysis of documents and outputs reports.
---

# Body
`,
      );
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "description-no-trigger-language")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors on description over 1024 chars", async () => {
    const dir = await sandbox();
    try {
      const longDesc = `Triggers test. ${"x".repeat(1100)}`;
      await writeSkill(
        dir,
        "alpha",
        `---
name: alpha
description: ${longDesc}
---

# Body
`,
      );
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "description-too-long")).toBe(true);
      expect(hasErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintSkillsDir — name/folder mismatch", () => {
  test("flags when frontmatter name differs from folder", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "alpha", goodFrontmatter("beta"));
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "name-folder-mismatch")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintSkillsDir — missing pieces", () => {
  test("flags missing SKILL.md", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "alpha"), { recursive: true });
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "skill-md-missing")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("flags missing frontmatter", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "alpha", "# No frontmatter here");
      const result = await lintSkillsDir(dir);
      expect(result.findings.some((f) => f.rule === "frontmatter-missing")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintSkillsDir — description byte budget", () => {
  test("flags total description bytes over the budget", async () => {
    const dir = await sandbox();
    try {
      // The check only runs under checkManaged, which also gates the count
      // ratchet and ACTIVE_SKILLS parity — those will fire too against this
      // fixture, but this test only cares about the byte-budget finding.
      await writeSkill(dir, "alpha", goodFrontmatter("alpha"));
      const result = await lintSkillsDir(dir, { checkManaged: true, descriptionByteBudget: 10 });
      const finding = result.findings.find((f) => f.rule === "description-byte-budget");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain("budget 10");
      expect(finding?.message).toContain("alpha");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not flag total description bytes under the budget", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "alpha", goodFrontmatter("alpha"));
      const result = await lintSkillsDir(dir, {
        checkManaged: true,
        descriptionByteBudget: 1_000_000,
      });
      expect(result.findings.some((f) => f.rule === "description-byte-budget")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("real repo skills/ dir stays under SKILL_DESCRIPTION_BYTE_BUDGET", async () => {
    const result = await lintSkillsDir(resolve(ROOT, "skills"), { checkManaged: true });
    expect(result.findings.some((f) => f.rule === "description-byte-budget")).toBe(false);
  });
});

describe("formatFindings", () => {
  test("emits header and rule lines", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "BadCaps", goodFrontmatter("BadCaps"));
      const result = await lintSkillsDir(dir);
      const out = formatFindings(result);
      expect(out).toContain("Linted 1 skill");
      expect(out).toContain("[folder-kebab-case]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintSkillsDir — description shape", () => {
  test("a `|` block-scalar description is an error", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(
        dir,
        "blocky",
        `---
name: blocky
description: |
  Does a thing worth describing at length. Use when:
  - User says "blocky"
  - User asks for a block
---

# Body
`,
      );
      const result = await lintSkillsDir(dir);
      expect(result.findings.map((f) => f.rule)).toContain("description-multiline");
      expect(hasErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-house trigger phrasing warns but does not fail", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(
        dir,
        "usefor",
        `---
name: usefor
description: A reasonably long description that explains what it does. Use for "test", "example".
---

# Body
`,
      );
      const result = await lintSkillsDir(dir);
      expect(result.findings.map((f) => f.rule)).toContain("description-nonstandard-trigger");
      expect(hasErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the house form passes both checks", async () => {
    const dir = await sandbox();
    try {
      await writeSkill(dir, "housed", goodFrontmatter("housed"));
      const rules = (await lintSkillsDir(dir)).findings.map((f) => f.rule);
      expect(rules).not.toContain("description-multiline");
      expect(rules).not.toContain("description-nonstandard-trigger");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
