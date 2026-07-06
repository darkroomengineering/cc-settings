// Agent frontmatter linter tests. Validates each rule fires on the correct
// shape and that the happy-path passes cleanly.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAgentFindings, hasAgentErrors, lintAgentsDir } from "../src/lib/lint-agents.ts";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-lint-agents-"));
}

async function writeAgent(root: string, name: string, body: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, `${name}.md`), body);
}

const goodFrontmatter = (name: string) =>
  `---
name: ${name}
description: A reasonably long description of what this agent does.
---

# Body
`;

describe("lintAgentsDir — happy path", () => {
  test("clean agent produces no findings", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(dir, "alpha", goodFrontmatter("alpha"));
      const result = await lintAgentsDir(dir);
      expect(result.findings).toEqual([]);
      expect(result.agentCount).toBe(1);
      expect(hasAgentErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing agents dir returns empty result", async () => {
    const result = await lintAgentsDir("/nonexistent/xyz");
    expect(result.agentCount).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("README.md at the root is skipped", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(dir, "alpha", goodFrontmatter("alpha"));
      await writeFile(join(dir, "README.md"), "# Agents README");
      const result = await lintAgentsDir(dir);
      expect(result.agentCount).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintAgentsDir — schema errors", () => {
  test("effort typo → error", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(
        dir,
        "alpha",
        `---
name: alpha
description: A description.
effort: xtreme
---
`,
      );
      const result = await lintAgentsDir(dir);
      expect(result.findings.some((f) => f.rule === "schema")).toBe(true);
      expect(hasAgentErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("permissionMode typo → error", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(
        dir,
        "alpha",
        `---
name: alpha
description: A description.
permissionMode: planning
---
`,
      );
      const result = await lintAgentsDir(dir);
      expect(result.findings.some((f) => f.rule === "schema")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-kebab-case name → error", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(
        dir,
        "alpha",
        `---
name: MyAgent
description: A description.
---
`,
      );
      const result = await lintAgentsDir(dir);
      expect(hasAgentErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintAgentsDir — name/file mismatch", () => {
  test("flags when frontmatter name differs from filename", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(dir, "alpha", goodFrontmatter("beta"));
      const result = await lintAgentsDir(dir);
      expect(result.findings.some((f) => f.rule === "name-file-mismatch")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintAgentsDir — narrow-schema enum carve-out (issue #82/#104)", () => {
  test("isolation: remote is a warning, not an error", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(
        dir,
        "alpha",
        `---
name: alpha
description: A description.
isolation: remote
---
`,
      );
      const result = await lintAgentsDir(dir);
      const finding = result.findings.find((f) => f.rule === "narrow-schema-enum");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(hasAgentErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("memory: user is a warning, not an error", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(
        dir,
        "alpha",
        `---
name: alpha
description: A description.
memory: user
---
`,
      );
      const result = await lintAgentsDir(dir);
      const finding = result.findings.find((f) => f.rule === "narrow-schema-enum");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(hasAgentErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("isolation: bogus-value is still a hard error", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(
        dir,
        "alpha",
        `---
name: alpha
description: A description.
isolation: bogus-value
---
`,
      );
      const result = await lintAgentsDir(dir);
      expect(hasAgentErrors(result)).toBe(true);
      expect(result.findings.some((f) => f.rule === "narrow-schema-enum")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintAgentsDir — missing frontmatter", () => {
  test("flags missing frontmatter", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(dir, "alpha", "# No frontmatter here");
      const result = await lintAgentsDir(dir);
      expect(result.findings.some((f) => f.rule === "frontmatter-missing")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintAgentsDir — repo dogfood", () => {
  test("repo's actual agents/ all pass validation today", async () => {
    const result = await lintAgentsDir(join(import.meta.dir, "..", "agents"));
    expect(hasAgentErrors(result)).toBe(false);
  });
});

describe("formatAgentFindings", () => {
  test("emits header and rule lines", async () => {
    const dir = await sandbox();
    try {
      await writeAgent(dir, "alpha", goodFrontmatter("beta"));
      const result = await lintAgentsDir(dir);
      const out = formatAgentFindings(result);
      expect(out).toContain("Linted 1 agent(s).");
      expect(out).toContain("[name-file-mismatch]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
