// Text contracts for forked skills. `ship` and `handoff` run with
// `context: fork`, so an eval case sees only the fork's report and passes or
// fails by chance; these rules are pinned here instead. Each check reads only
// the section that owns the rule, so moving a rule out of its step fails too.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// The text from `start` up to the next heading at the same or a higher level.
// Headings inside fenced code (Step 8's PR template) do not end a section.
function section(text: string, start: string): string {
  const at = text.indexOf(start);
  if (at === -1) throw new Error(`heading not found: ${start}`);
  const level = start.match(/^#+/)?.[0].length ?? 0;
  const lines = text.slice(at).split("\n");
  let fenced = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) fenced = !fenced;
    const hashes = line.match(/^(#+) /)?.[1]?.length;
    if (!fenced && hashes !== undefined && hashes <= level) {
      return lines.slice(0, i).join("\n");
    }
  }
  return lines.join("\n");
}

describe("ship commit and PR contract", () => {
  const ship = read("skills/ship/SKILL.md");
  const step7 = section(ship, "### Step 7:");
  const step8 = section(ship, "### Step 8:");
  const mechanics = section(read("rules/git.md"), "## Commit and PR mechanics");

  test("Step 7 commits from a message file with explicit pathspecs", () => {
    expect(step7).toContain("git commit -F <msgfile> -- ");
    expect(step7).not.toMatch(/git add (-A|\.)(\s|$)/);
  });

  test("Step 8 passes the PR body by file and starts from the repo template", () => {
    expect(step8).toContain('--body-file "$BODY_FILE"');
    expect(step8).not.toContain("--fill ");
    expect(step8).toMatch(/repo's\s+own PR template/);
    expect(step8).toContain("git log <base>..HEAD");
  });

  test("Step 8 treats a failed PR lookup as unknown, not as no PR", () => {
    expect(step8).toContain("a non-zero exit means PR state is unknown");
    expect(step8).not.toContain("owner:");
  });

  test("rules/git.md owns the same mechanics", () => {
    expect(mechanics).toContain("git commit -F <msgfile> -- <paths>");
    expect(mechanics).toContain("Never pass `--head owner:branch`");
    expect(mechanics).toContain("--body-file");
    expect(mechanics).toContain(".github/PULL_REQUEST_TEMPLATE/");
    expect(mechanics).toContain("git log <base>..HEAD");
  });
});

describe("handoff resume contract", () => {
  const untrusted = section(read("skills/handoff/SKILL.md"), "### Untrusted source");

  test("discovery reads metadata only", () => {
    expect(untrusted).toContain("**Discovery is metadata-only.**");
  });

  test("several candidates without an id means stop and ask", () => {
    expect(untrusted).toContain("**More than one candidate means stop and ask.**");
    expect(untrusted).toContain("AskUserQuestion");
  });
});

describe("section()", () => {
  test("stops at the next heading of the same level", () => {
    const text = "### A\none\n#### A.1\ntwo\n### B\nthree";
    expect(section(text, "### A")).toBe("### A\none\n#### A.1\ntwo");
  });

  test("ignores headings inside fenced code", () => {
    const text = "### A\n```md\n## inside\n```\nafter\n### B";
    expect(section(text, "### A")).toBe("### A\n```md\n## inside\n```\nafter");
  });

  test("throws when the heading is gone", () => {
    expect(() => section("### A\n", "### Z")).toThrow("heading not found");
  });
});
