// Regression: installing cc-settings must NOT delete a user's own output style.
//
// ~/.claude/output-styles/ is a path Claude Code's own /config picker
// encourages users to hand-write files into, and cc-settings ships exactly one
// file there (darkroom.md). The first version of this wiring registered the
// directory in MANAGED_TOP_LEVEL_PATHS with a `\.md$` glob — the same broad
// wipe used for agents/rules/profiles/docs — which cleanOldConfig applies to
// EVERY matching file in the directory. That would have deleted a personal
// output style on every install: data loss, not a stale-file prune.
//
// The wipe is scoped to /^darkroom\.md$/ instead. This test pins that: a
// foreign style survives a re-install, and ours is still refreshed.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const SETUP_TS = join(REPO, "src", "setup.ts");

async function install(home: string, extraArgs: string[] = []): Promise<number> {
  const proc = Bun.spawn(["bun", SETUP_TS, `--source=${REPO}`, ...extraArgs], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CC_SKIP_DEPS: "1",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return await proc.exited;
}

describe("output styles — a user's own style survives an install", () => {
  test("re-install keeps a foreign output style and refreshes darkroom.md", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-outputstyle-"));
    try {
      expect(await install(home)).toBe(0);

      const stylesDir = join(home, ".claude", "output-styles");
      expect(existsSync(join(stylesDir, "darkroom.md"))).toBe(true);

      // The user hand-writes their own style, and edits ours.
      await mkdir(stylesDir, { recursive: true });
      const mine = join(stylesDir, "rico-personal.md");
      await writeFile(mine, "---\nname: Rico\n---\n\nplain words only.\n");
      await writeFile(join(stylesDir, "darkroom.md"), "clobbered\n");

      // Second install: cleanOldConfig runs, then the copy phase.
      expect(await install(home)).toBe(0);

      // The user's style is untouched — content included, not just the path.
      expect(existsSync(mine)).toBe(true);
      expect(await readFile(mine, "utf8")).toContain("plain words only.");

      // Ours is restored from source, not left clobbered.
      const ours = await readFile(join(stylesDir, "darkroom.md"), "utf8");
      expect(ours).not.toContain("clobbered");
      expect(ours).toContain("name: Darkroom");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  // Same data-loss class on the other path: `output-styles` is a full-only dir,
  // so the full→light prune would `rm -rf` the whole directory unless it is
  // scoped to the file we ship (SHARED_DIR_OWNED_FILES in light-profile.ts).
  test("full -> light downgrade removes only darkroom.md, not the user's style", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-outputstyle-light-"));
    try {
      expect(await install(home)).toBe(0);

      const stylesDir = join(home, ".claude", "output-styles");
      const mine = join(stylesDir, "rico-personal.md");
      await writeFile(mine, "---\nname: Rico\n---\n\nplain words only.\n");

      expect(await install(home, ["--light"])).toBe(0);

      // Ours is gone — light is the raw-Claude-Code tier.
      expect(existsSync(join(stylesDir, "darkroom.md"))).toBe(false);
      // Theirs is not.
      expect(existsSync(mine)).toBe(true);
      expect(await readFile(mine, "utf8")).toContain("plain words only.");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);
});
