// Regression tests for the install-summary count helpers.
//
// Backstory: showSummary counted every manifest dir by top-level `*.md` files.
// That works for the flat dirs (agents/, rules/, …) but skills/ is the only
// dir built as subdirectories (skills/<name>/SKILL.md), so a /\.md$/ match only
// ever found skills/README.md and printed "skills/ (1)" — wildly wrong for 35
// installed skills. docs/ likewise undercounted, ignoring .md files in its
// subdirs that the installer copies recursively.
//
// The helpers take an absolute dir (CLAUDE_DIR is fixed at import), so we point
// them at a temp tree that reproduces the exact layout.
//
// Run: bun test tests/install-display.test.ts

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countEntries, countEntriesRecursive, countSkillDirs } from "../src/lib/install-display.ts";

let root: string;

async function touch(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "", "utf8");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cc-install-display-"));

  // skills/ — subdirs each holding SKILL.md, plus the README.md that caused
  // the original "(1)" miscount, plus a stray subdir with no SKILL.md.
  await touch(join(root, "skills", "README.md"));
  for (const name of ["build", "fix", "ship"]) {
    await touch(join(root, "skills", name, "SKILL.md"));
  }
  await mkdir(join(root, "skills", "not-a-skill"), { recursive: true }); // no SKILL.md

  // agents/ — flat *.md files (the layout countEntries was designed for).
  for (const name of ["explore.md", "implementer.md", "planner.md"]) {
    await touch(join(root, "agents", name));
  }

  // docs/ — top-level *.md plus .md files nested in subdirs.
  for (const name of ["a.md", "b.md"]) {
    await touch(join(root, "docs", name));
  }
  await touch(join(root, "docs", "plans", "c.md"));
  await touch(join(root, "docs", "upstream-bugs", "d.md"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("countSkillDirs", () => {
  test("counts subdirs containing SKILL.md, not top-level .md (the (1) bug)", async () => {
    // 3 real skills; README.md and not-a-skill/ must NOT be counted.
    expect(await countSkillDirs(join(root, "skills"))).toBe(3);
  });

  test("counting skills/ with countEntries would wrongly return 1 (README.md)", async () => {
    // This is exactly the regression — the old code path. Asserting it proves
    // the bug is real and that countSkillDirs is the necessary fix.
    expect(await countEntries(join(root, "skills"), /\.md$/)).toBe(1);
  });

  test("missing dir → 0", async () => {
    expect(await countSkillDirs(join(root, "does-not-exist"))).toBe(0);
  });
});

describe("countEntries", () => {
  test("counts flat top-level .md files (agents/ layout)", async () => {
    expect(await countEntries(join(root, "agents"), /\.md$/)).toBe(3);
  });

  test("does not descend into subdirs", async () => {
    // docs/ has 2 top-level .md; the 2 nested ones are invisible here.
    expect(await countEntries(join(root, "docs"), /\.md$/)).toBe(2);
  });

  test("missing dir → 0", async () => {
    expect(await countEntries(join(root, "nope"), /\.md$/)).toBe(0);
  });
});

describe("countEntriesRecursive", () => {
  test("counts .md anywhere under the dir (docs/ undercount fix)", async () => {
    // 2 top-level + 2 nested = 4.
    expect(await countEntriesRecursive(join(root, "docs"), /\.md$/)).toBe(4);
  });

  test("missing dir → 0", async () => {
    expect(await countEntriesRecursive(join(root, "ghost"), /\.md$/)).toBe(0);
  });
});
