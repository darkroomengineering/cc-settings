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
import {
  classifyMcpServers,
  countEntries,
  countEntriesRecursive,
  countSkillDirs,
  readShippedMcpNames,
} from "../src/lib/install-display.ts";

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

  // config/20-mcp.json — the fragment readShippedMcpNames reads. Deliberately
  // written WITHOUT `_status` keys, matching the real fragment: that absence is
  // what made the old `_status`-based classification misreport.
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(
    join(root, "config", "20-mcp.json"),
    JSON.stringify({
      mcpServers: {
        context7: { command: "bunx" },
        tldr: { command: "tldr-mcp" },
        figma: { type: "http" },
        "chrome-devtools": { command: "bunx" },
      },
    }),
    "utf8",
  );
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

  // ~/.claude/skills/ is shared — plugin and third-party skills live alongside
  // cc-settings' own and are deliberately never touched by the installer.
  // Counting them made the summary claim credit for skills it did not install.
  test("third-party skills are not counted as installed", async () => {
    const shared = join(root, "shared-skills");
    for (const name of ["build", "fix", "ship"]) {
      await touch(join(shared, name, "SKILL.md"));
    }
    // Real examples seen in a live ~/.claude/skills: not shipped by cc-settings.
    for (const name of ["context7-mcp", "programa"]) {
      await touch(join(shared, name, "SKILL.md"));
    }
    expect(await countSkillDirs(shared)).toBe(3);
  });

  test("tombstoned skills are not counted even if the dir lingers", async () => {
    const stale = join(root, "stale-skills");
    await touch(join(stale, "build", "SKILL.md"));
    // `lenis` is a retired skill in TOMBSTONE_SKILLS — the installer removes it,
    // so counting it would over-report on the run that deletes it.
    await touch(join(stale, "lenis", "SKILL.md"));
    expect(await countSkillDirs(stale)).toBe(1);
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

// MCP core/user-added classification.
//
// Backstory: the summary grouped servers by a `_status` key read back off
// ~/.claude.json. The composer strips `_status`/`_comment` (settings.json stays
// schema-clean), so nothing cc-settings writes carries one. The only entries
// that still had `_status: "core"` were residue from a pre-strip install, which
// meant currently-shipped servers — tldr, context7 — were reported to the user
// as "user-added". Classification now derives from the shipped fragment.

describe("readShippedMcpNames", () => {
  test("reads the server names cc-settings ships", async () => {
    const names = await readShippedMcpNames(root);
    expect([...names].sort()).toEqual(["chrome-devtools", "context7", "figma", "tldr"]);
  });

  test("no sourceDir → empty set (degrade to user-added, never guess)", async () => {
    expect((await readShippedMcpNames()).size).toBe(0);
  });

  test("missing fragment → empty set", async () => {
    expect((await readShippedMcpNames(join(root, "nope"))).size).toBe(0);
  });
});

describe("classifyMcpServers", () => {
  test("shipped servers are cc-settings-managed, regardless of _status residue", () => {
    const shipped = new Set(["context7", "tldr", "figma", "chrome-devtools"]);
    const { managed, userAdded } = classifyMcpServers(
      ["context7", "tldr", "figma", "chrome-devtools", "sanity"],
      shipped,
    );
    // The exact regression: tldr and context7 land under cc-settings, not user-added.
    expect(managed).toEqual(["context7", "tldr", "figma", "chrome-devtools"]);
    expect(userAdded).toEqual(["sanity"]);
  });

  test("empty shipped set → everything is user-added", () => {
    const { managed, userAdded } = classifyMcpServers(["tldr", "sanity"], new Set());
    expect(managed).toEqual([]);
    expect(userAdded).toEqual(["tldr", "sanity"]);
  });
});
