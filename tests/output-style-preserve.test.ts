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
      CC_SKIP_SCHEDULE: "1",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return await proc.exited;
}

describe("output styles — a user's own style survives an install", () => {
  test("re-install fails closed when darkroom.md changed and preserves both styles", async () => {
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
      const sentinel = join(home, ".claude", ".cc-settings-version");
      const settings = join(home, ".claude", "settings.json");
      const before = await Promise.all([
        readFile(mine),
        readFile(join(stylesDir, "darkroom.md")),
        readFile(sentinel),
        readFile(settings),
      ]);

      expect(await install(home)).not.toBe(0);

      expect(
        await Promise.all([
          readFile(mine),
          readFile(join(stylesDir, "darkroom.md")),
          readFile(sentinel),
          readFile(settings),
        ]),
      ).toEqual(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  // Same data-loss class on the other path: `output-styles` is a full-only dir,
  // so the full→light prune would `rm -rf` the whole directory unless it is
  // scoped to the file we ship (sharedDirOwnedFiles() in managed-paths.ts).
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

  // Third variant of the same data-loss class, on `--rollback`: it used to
  // treat output-styles/ as a wholly-owned unit (managedRestoreAllowset built
  // its allowlist straight off MANAGED_TOP_LEVEL_PATHS' `rel`s, with no
  // narrowing for shared dirs), so cmdRollback would rm -rf the WHOLE
  // directory before restoring the backed-up contents — deleting a style the
  // user hand-wrote after the last backup. Rollback must restore only the
  // files cc-settings owns (darkroom.md) and leave everything else in place.
  test("--rollback fails closed when darkroom.md changed and preserves both styles", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-outputstyle-rollback-"));
    try {
      // Install 1: creates darkroom.md, and gives install 2's createBackup
      // something to snapshot.
      expect(await install(home)).toBe(0);
      // Install 2: this run's createBackup fires before cleanOldConfig wipes
      // install 1's content, so it backs up darkroom.md as it stood then.
      expect(await install(home)).toBe(0);

      const stylesDir = join(home, ".claude", "output-styles");
      // The user hand-writes their own style AFTER the last backup was taken.
      const mine = join(stylesDir, "rico-personal.md");
      await writeFile(mine, "---\nname: Rico\n---\n\nplain words only.\n");
      await writeFile(join(stylesDir, "darkroom.md"), "clobbered\n");
      const sentinel = join(home, ".claude", ".cc-settings-version");
      const before = await Promise.all([
        readFile(mine),
        readFile(join(stylesDir, "darkroom.md")),
        readFile(sentinel),
      ]);

      const proc = Bun.spawn(["bun", SETUP_TS, "--rollback"], {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CC_SKIP_DEPS: "1",
          CC_SKIP_SCHEDULE: "1",
          NO_COLOR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      expect(exitCode, `${stdout}\n${stderr}`).not.toBe(0);
      expect(`${stdout}\n${stderr}`).toMatch(/modified managed content|changed/i);
      expect(
        await Promise.all([
          readFile(mine),
          readFile(join(stylesDir, "darkroom.md")),
          readFile(sentinel),
        ]),
      ).toEqual(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);
});
