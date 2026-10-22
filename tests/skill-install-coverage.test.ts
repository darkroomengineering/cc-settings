// The installers copy only the files their manifests name, so a skill file that
// is tracked in git but missing from a manifest ships in the repo and never
// reaches ~/.claude/skills or the Codex runtime. Setup still reports success.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { currentClaudeManagedSourceFiles } from "../src/lib/claude-managed-file-manifests.ts";
import { RUNTIME_SOURCE_FILES } from "../src/lib/codex-runtime-manifests.ts";

const ROOT = join(import.meta.dir, "..");

function trackedSkillFiles(): string[] {
  const out = Bun.spawnSync(["git", "ls-files", "skills"], { cwd: ROOT });
  return out.stdout.toString().trim().split("\n").filter(Boolean);
}

describe("skill install coverage", () => {
  test("the full Claude install copies every tracked skill file", () => {
    const installed = new Set(currentClaudeManagedSourceFiles("full").map((f) => f.source));
    expect(trackedSkillFiles().filter((f) => !installed.has(f))).toEqual([]);
  });

  test("the Codex runtime copies every tracked skill file", () => {
    const installed = new Set(RUNTIME_SOURCE_FILES);
    expect(trackedSkillFiles().filter((f) => !installed.has(f))).toEqual([]);
  });
});
