// Knowledge-note linter tests. Validates each rule fires on the correct shape
// and that the happy-path passes cleanly.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatKnowledgeFindings,
  hasKnowledgeErrors,
  lintKnowledgeDir,
} from "../src/lib/lint-knowledge.ts";

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-lint-knowledge-"));
}

async function writeNote(root: string, filename: string, body: string): Promise<void> {
  await writeFile(join(root, filename), body);
}

const goodNote = (name: string) =>
  `---
name: ${name}
kind: convention
added-by: test-user
---

## What

A concise description of the convention.

## Why

Reason for adopting this convention.

## How to apply

Apply it like this.
`;

describe("lintKnowledgeDir — happy path", () => {
  test("clean note produces no findings", async () => {
    const dir = await sandbox();
    try {
      await writeNote(dir, "my-note.md", goodNote("my-note"));
      const result = await lintKnowledgeDir(dir);
      expect(result.findings).toEqual([]);
      expect(result.noteCount).toBe(1);
      expect(hasKnowledgeErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing dir returns empty result", async () => {
    const result = await lintKnowledgeDir("/nonexistent/knowledge-xyz");
    expect(result.noteCount).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("README.md, INDEX.md and CONTRIBUTING.md are skipped", async () => {
    const dir = await sandbox();
    try {
      await writeNote(dir, "README.md", "no frontmatter here");
      await writeNote(dir, "INDEX.md", "no frontmatter here");
      await writeNote(dir, "CONTRIBUTING.md", "no frontmatter here");
      const result = await lintKnowledgeDir(dir);
      expect(result.noteCount).toBe(0);
      expect(result.findings).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("clean multi-note dir produces 0 errors", async () => {
    const dir = await sandbox();
    try {
      await writeNote(dir, "note-one.md", goodNote("note-one"));
      await writeNote(dir, "note-two.md", goodNote("note-two"));
      await writeNote(dir, "note-three.md", goodNote("note-three"));
      const result = await lintKnowledgeDir(dir);
      expect(hasKnowledgeErrors(result)).toBe(false);
      expect(result.noteCount).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintKnowledgeDir — missing/invalid kind", () => {
  test("missing kind → error", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "bad-note.md",
        `---
name: bad-note
added-by: test-user
---

Some body content here.
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(hasKnowledgeErrors(result)).toBe(true);
      expect(result.findings.some((f) => f.rule === "schema")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("invalid kind value → error", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "bad-kind.md",
        `---
name: bad-kind
kind: unknown-type
added-by: test-user
---

Body content.
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(hasKnowledgeErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintKnowledgeDir — name/filename mismatch", () => {
  test("name differs from filename stem → error", async () => {
    const dir = await sandbox();
    try {
      // filename is alpha.md but frontmatter name is beta
      await writeNote(dir, "alpha.md", goodNote("beta"));
      const result = await lintKnowledgeDir(dir);
      expect(result.findings.some((f) => f.rule === "name-filename-mismatch")).toBe(true);
      expect(hasKnowledgeErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintKnowledgeDir — non-kebab name", () => {
  test("CamelCase name → error", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "BadName.md",
        `---
name: BadName
kind: pattern
added-by: test-user
---

Body content.
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(hasKnowledgeErrors(result)).toBe(true);
      // Schema rule fires for invalid kebab-case name
      expect(result.findings.some((f) => f.rule === "schema")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("name with underscore → error", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "bad_name.md",
        `---
name: bad_name
kind: gotcha
added-by: test-user
---

Body content.
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(hasKnowledgeErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintKnowledgeDir — empty body", () => {
  test("note with no body content → error", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "empty-body.md",
        `---
name: empty-body
kind: decision
added-by: test-user
---
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(result.findings.some((f) => f.rule === "empty-body")).toBe(true);
      expect(hasKnowledgeErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("note with only whitespace body → error", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "ws-body.md",
        `---
name: ws-body
kind: incident
added-by: test-user
---



`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(result.findings.some((f) => f.rule === "empty-body")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintKnowledgeDir — angle brackets in body are allowed", () => {
  test("unescaped < or > in body is NOT flagged (knowledge notes are plain markdown)", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "angle-note.md",
        `---
name: angle-note
kind: convention
added-by: test-user
---

Use <ComponentName> here, or a Slack ref like <#C123> — both are fine.
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(hasKnowledgeErrors(result)).toBe(false);
      expect(result.findings).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintKnowledgeDir — supersedes warning", () => {
  test("supersedes referencing missing note → warning", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "new-note.md",
        `---
name: new-note
kind: convention
added-by: test-user
supersedes: old-note
---

Body content here explaining the change.
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(result.findings.some((f) => f.rule === "supersedes-unknown")).toBe(true);
      const finding = result.findings.find((f) => f.rule === "supersedes-unknown");
      expect(finding?.severity).toBe("warning");
      // It's a warning not an error
      expect(hasKnowledgeErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("supersedes referencing existing note → no warning", async () => {
    const dir = await sandbox();
    try {
      await writeNote(dir, "old-convention.md", goodNote("old-convention"));
      await writeNote(
        dir,
        "new-convention.md",
        `---
name: new-convention
kind: convention
added-by: test-user
supersedes: old-convention
---

Updated convention body.
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(result.findings.some((f) => f.rule === "supersedes-unknown")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintKnowledgeDir — missing frontmatter", () => {
  test("no frontmatter → error", async () => {
    const dir = await sandbox();
    try {
      await writeNote(dir, "no-fm.md", "# Just a heading\n\nNo frontmatter here.");
      const result = await lintKnowledgeDir(dir);
      expect(result.findings.some((f) => f.rule === "frontmatter-missing")).toBe(true);
      expect(hasKnowledgeErrors(result)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lintKnowledgeDir — missing added-by", () => {
  test("missing added-by → error", async () => {
    const dir = await sandbox();
    try {
      await writeNote(
        dir,
        "no-author.md",
        `---
name: no-author
kind: decision
---

Body content here.
`,
      );
      const result = await lintKnowledgeDir(dir);
      expect(hasKnowledgeErrors(result)).toBe(true);
      expect(result.findings.some((f) => f.rule === "schema")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("formatKnowledgeFindings", () => {
  test("emits header and rule lines", async () => {
    const dir = await sandbox();
    try {
      await writeNote(dir, "alpha.md", goodNote("beta")); // mismatch
      const result = await lintKnowledgeDir(dir);
      const out = formatKnowledgeFindings(result);
      expect(out).toContain("Linted 1 note(s).");
      expect(out).toContain("[name-filename-mismatch]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
