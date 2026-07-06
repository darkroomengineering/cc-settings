// Profile frontmatter linter tests. Validates each rule fires on the correct
// shape and that the happy-path passes cleanly.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatProfileFindings,
  hasProfileErrors,
  lintProfilesDir,
} from "../src/lib/lint-profiles.ts";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-lint-profiles-"));
}

async function writeProfile(root: string, name: string, body: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, `${name}.md`), body);
}

const goodFrontmatter = (name: string) =>
  `---
name: ${name}
description: A reasonably long description of what this profile is for.
---

# Body
`;

describe("lintProfilesDir — happy path", () => {
  test("clean profile produces no findings", async () => {
    const dir = await sandbox();
    try {
      await writeProfile(dir, "nextjs", goodFrontmatter("nextjs"));
      const result = await lintProfilesDir(dir);
      expect(result.findings).toEqual([]);
      expect(result.profileCount).toBe(1);
      expect(hasProfileErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing profiles dir returns empty result", async () => {
    const result = await lintProfilesDir("/nonexistent/xyz");
    expect(result.profileCount).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("README.md at the root is skipped", async () => {
    const dir = await sandbox();
    try {
      await writeProfile(dir, "nextjs", goodFrontmatter("nextjs"));
      await writeFile(join(dir, "README.md"), "# Profiles README");
      const result = await lintProfilesDir(dir);
      expect(result.profileCount).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintProfilesDir — schema errors", () => {
  test("effort typo → error", async () => {
    const dir = await sandbox();
    try {
      await writeProfile(
        dir,
        "nextjs",
        `---
name: nextjs
description: A description.
effort: xtreme
---
`,
      );
      const result = await lintProfilesDir(dir);
      expect(result.findings.some((f) => f.rule === "schema")).toBe(true);
      expect(hasProfileErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("permissionMode typo → error", async () => {
    const dir = await sandbox();
    try {
      await writeProfile(
        dir,
        "nextjs",
        `---
name: nextjs
description: A description.
permissionMode: planning
---
`,
      );
      const result = await lintProfilesDir(dir);
      expect(hasProfileErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-kebab-case name → error", async () => {
    const dir = await sandbox();
    try {
      await writeProfile(
        dir,
        "nextjs",
        `---
name: NextJS
description: A description.
---
`,
      );
      const result = await lintProfilesDir(dir);
      expect(hasProfileErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintProfilesDir — name/file mismatch", () => {
  test("flags when frontmatter name differs from filename", async () => {
    const dir = await sandbox();
    try {
      await writeProfile(dir, "nextjs", goodFrontmatter("react-router"));
      const result = await lintProfilesDir(dir);
      expect(result.findings.some((f) => f.rule === "name-file-mismatch")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintProfilesDir — missing frontmatter", () => {
  test("flags missing frontmatter", async () => {
    const dir = await sandbox();
    try {
      await writeProfile(dir, "nextjs", "# No frontmatter here");
      const result = await lintProfilesDir(dir);
      expect(result.findings.some((f) => f.rule === "frontmatter-missing")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintProfilesDir — repo dogfood", () => {
  test("repo's actual profiles/ all pass validation today", async () => {
    const result = await lintProfilesDir(join(import.meta.dir, "..", "profiles"));
    expect(hasProfileErrors(result)).toBe(false);
  });
});

describe("formatProfileFindings", () => {
  test("emits header and rule lines", async () => {
    const dir = await sandbox();
    try {
      await writeProfile(dir, "nextjs", goodFrontmatter("react-router"));
      const result = await lintProfilesDir(dir);
      const out = formatProfileFindings(result);
      expect(out).toContain("Linted 1 profile(s).");
      expect(out).toContain("[name-file-mismatch]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
