// Unit tests for plugins/context-report's pure report(); the hook module has
// no runtime imports, so it loads under plain `bun test`. The engine-side
// behaviour (report after next(), transcript vs debug) is covered by the kit
// tests in plugins/context-report/tests/ for `claude plugin test`.

import { describe, expect, test } from "bun:test";
import { report, shortPath } from "../plugins/context-report/hooks/register.ts";

const HOME = "/home/me";
const CWD = "/home/me/repo";

describe("shortPath", () => {
  test("prefers ./ under cwd, then ~/ under home, else absolute", () => {
    expect(shortPath(`${CWD}/AGENTS.md`, CWD, HOME)).toBe("./AGENTS.md");
    expect(shortPath(`${HOME}/.claude/CLAUDE.md`, CWD, HOME)).toBe("~/.claude/CLAUDE.md");
    expect(shortPath("/etc/claude/CLAUDE.md", CWD, HOME)).toBe("/etc/claude/CLAUDE.md");
    expect(shortPath(`${HOME}/x.md`, CWD, undefined)).toBe(`${HOME}/x.md`);
  });
});

describe("report", () => {
  test("lists tiers in order, marks @ imports, counts memory, sums bytes", () => {
    const lines = report({
      cwd: CWD,
      home: HOME,
      projectAgentsMdExists: true,
      files: [
        { path: `${HOME}/.claude/CLAUDE.md`, kind: "user", content: "a".repeat(1024) },
        {
          path: `${HOME}/.claude/AGENTS.md`,
          kind: "user",
          content: "b".repeat(2048),
          parent: `${HOME}/.claude/CLAUDE.md`,
        },
        { path: `${CWD}/AGENTS.md`, kind: "project", content: "c".repeat(512) },
        { path: `${HOME}/.claude/projects/x/memory/MEMORY.md`, kind: "memory", content: "m" },
      ],
    });
    expect(lines).toEqual([
      "Instructions loaded (4 files, 3.5 KB): user ~/.claude/CLAUDE.md +@AGENTS.md · project ./AGENTS.md · memory 1",
    ]);
  });

  test("hints at /cc migrate for a project CLAUDE.md; wording follows whether AGENTS.md exists", () => {
    const files = [{ path: `${CWD}/CLAUDE.md`, kind: "project" as const, content: "x" }];
    expect(report({ cwd: CWD, home: HOME, projectAgentsMdExists: false, files })[1]).toContain(
      "Run /cc migrate to rename it to AGENTS.md",
    );
    expect(report({ cwd: CWD, home: HOME, projectAgentsMdExists: true, files })[1]).toContain(
      "Run /cc migrate to merge it into AGENTS.md",
    );
    expect(report({ cwd: CWD, home: HOME, projectAgentsMdExists: undefined, files })[1]).toContain(
      "merge it into",
    );
  });

  test("a CLAUDE.local.md counts as the blocking file too", () => {
    const lines = report({
      cwd: CWD,
      home: HOME,
      projectAgentsMdExists: true,
      files: [{ path: `${CWD}/CLAUDE.local.md`, kind: "local", content: "x" }],
    });
    expect(lines[1]).toStartWith("./CLAUDE.local.md is the project instructions here");
  });

  test("flags a user CLAUDE.md without the @AGENTS.md import", () => {
    const lines = report({
      cwd: CWD,
      home: HOME,
      projectAgentsMdExists: true,
      files: [{ path: `${HOME}/.claude/CLAUDE.md`, kind: "user", content: "Read AGENTS.md" }],
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("has no @AGENTS.md import");
  });

  test("an imported project file is not mistaken for a blocking CLAUDE.md", () => {
    const lines = report({
      cwd: CWD,
      home: HOME,
      projectAgentsMdExists: true,
      files: [
        { path: `${CWD}/AGENTS.md`, kind: "project", content: "@docs/CLAUDE.md" },
        {
          path: `${CWD}/docs/CLAUDE.md`,
          kind: "project",
          content: "notes",
          parent: `${CWD}/AGENTS.md`,
        },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("project ./AGENTS.md +@CLAUDE.md");
  });

  test("no files", () => {
    expect(report({ cwd: CWD, home: HOME, projectAgentsMdExists: false, files: [] })).toEqual([
      "Instructions loaded: none.",
    ]);
  });
});
