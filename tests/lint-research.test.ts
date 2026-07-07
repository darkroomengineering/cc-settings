// RESEARCH.md shape-validator tests. Each rule fires on the correct shape; the
// harvest-seeded happy path passes clean.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatFindings,
  hasErrors,
  lintResearchDir,
  lintResearchText,
} from "../src/lib/lint-research.ts";

const validSeed = `# AutoResearch Config: example

## Test Inputs

### Test 1: first
Do the first thing.

### Test 2: second
Do the second thing.

## Checklist

- [ ] ran the failing test before reading source
- [ ] avoided the documented bad path
- [ ] output is independently verifiable

## Settings
- samples: 3
- min_improvement: 0.05
- max_rounds: 50
`;

async function sandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-lint-research-"));
}

describe("lintResearchText — happy path", () => {
  test("a harvest-seeded RESEARCH.md produces no findings", () => {
    const findings = lintResearchText("RESEARCH.md", validSeed);
    expect(findings).toEqual([]);
  });
});

describe("lintResearchText — Test Inputs", () => {
  test("errors when the section is absent", () => {
    const text = validSeed.replace(/## Test Inputs[\s\S]*?## Checklist/, "## Checklist");
    const rules = lintResearchText("r.md", text).map((f) => f.rule);
    expect(rules).toContain("missing-test-inputs");
  });

  test("errors on fewer than two test inputs", () => {
    const text = validSeed.replace("### Test 2: second\nDo the second thing.\n", "");
    const rules = lintResearchText("r.md", text).map((f) => f.rule);
    expect(rules).toContain("too-few-test-inputs");
  });
});

describe("lintResearchText — Checklist", () => {
  test("errors when the section is absent", () => {
    const text = validSeed.replace(/## Checklist[\s\S]*?## Settings/, "## Settings");
    const rules = lintResearchText("r.md", text).map((f) => f.rule);
    expect(rules).toContain("missing-checklist");
  });

  test("errors on fewer than three checklist items", () => {
    const text = validSeed.replace("- [ ] output is independently verifiable\n", "");
    const rules = lintResearchText("r.md", text).map((f) => f.rule);
    expect(rules).toContain("too-few-checklist");
  });

  test("warns (not errors) past the seven-item sweet spot", () => {
    const extra = Array.from({ length: 6 }, (_, i) => `- [ ] extra criterion ${i}`).join("\n");
    const text = validSeed.replace(
      "- [ ] output is independently verifiable",
      `- [ ] output is independently verifiable\n${extra}`,
    );
    const result = lintResearchText("r.md", text);
    expect(result.some((f) => f.rule === "too-many-checklist" && f.severity === "warning")).toBe(
      true,
    );
    expect(result.some((f) => f.severity === "error")).toBe(false);
  });
});

describe("lintResearchText — Settings", () => {
  test("errors on a non-numeric numeric setting (aspirational placeholder)", () => {
    const text = validSeed.replace("- samples: 3", "- samples: TBD");
    const rules = lintResearchText("r.md", text).map((f) => f.rule);
    expect(rules).toContain("non-numeric-setting");
  });

  test("tolerates a missing Settings section (optional)", () => {
    const text = validSeed.replace(/## Settings[\s\S]*$/, "");
    expect(lintResearchText("r.md", text)).toEqual([]);
  });
});

describe("lintResearchDir", () => {
  test("lints each skill's RESEARCH.md and skips skills without one", async () => {
    const dir = await sandbox();
    try {
      await mkdir(join(dir, "good"), { recursive: true });
      await writeFile(join(dir, "good", "RESEARCH.md"), validSeed);
      await mkdir(join(dir, "bad"), { recursive: true });
      await writeFile(join(dir, "bad", "RESEARCH.md"), "# no sections here");
      await mkdir(join(dir, "none"), { recursive: true }); // no RESEARCH.md — skipped

      const result = await lintResearchDir(dir);
      expect(result.fileCount).toBe(2);
      expect(hasErrors(result)).toBe(true);
      expect(formatFindings(result)).toContain("RESEARCH.md file(s)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing skills dir returns empty result", async () => {
    const result = await lintResearchDir("/nonexistent/xyz");
    expect(result.fileCount).toBe(0);
    expect(result.findings).toEqual([]);
  });
});
