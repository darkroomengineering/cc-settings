// H7 regression: createBackup() must snapshot every directory/file
// cleanOldConfig() unconditionally wipes on every run — not just the 4 files
// it backed up before (settings.json, CLAUDE.md, AGENTS.md, .claude.json) —
// so `bun src/setup.ts --rollback` can actually restore what a failed install
// wiped, not just those 4 files.
//
// Reproduces the failure scenario directly: run a full install (creates real
// managed content), run a second full install (its createBackup() now has
// something to snapshot), simulate a mid-install crash by deleting the
// managed directories exactly as cleanOldConfig() would (but without a
// successful copy phase following it), then --rollback and assert the wiped
// directories come back with content.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const SETUP_TS = join(REPO, "src", "setup.ts");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(home: string, extraArgs: string[] = []): Promise<RunResult> {
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
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

// Directories cleanOldConfig() unconditionally wipes on every run (subset that
// createBackup() previously did NOT cover — see H7).
const WIPED_DIRS = ["agents", "skills", "rules", "profiles", "docs", "hooks"];

describe("installer backup — H7 (rollback covers cleanOldConfig's full footprint)", () => {
  test(
    "--rollback restores managed dirs wiped by a failed install, not just the 4 legacy files",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-backup-e2e-"));
      try {
        // Install 1: populate ~/.claude with real managed content.
        const first = await run(home);
        expect(first.exitCode).toBe(0);

        const claudeDir = join(home, ".claude");
        for (const dir of WIPED_DIRS) {
          const files = await readdir(join(claudeDir, dir)).catch(() => []);
          expect(files.length, `${dir}/ should have content after install 1`).toBeGreaterThan(0);
        }

        // Install 2: createBackup() now has something to snapshot (this run's
        // createBackup fires BEFORE cleanOldConfig wipes install 1's content).
        const second = await run(home);
        expect(second.exitCode).toBe(0);
        expect(existsSync(join(claudeDir, "backups"))).toBe(true);
        const backups = (await readdir(join(claudeDir, "backups"))).filter((f) =>
          f.endsWith(".tar.gz"),
        );
        expect(backups.length).toBeGreaterThan(0);

        // Simulate exactly the H7 crash scenario: cleanOldConfig ran (wiping
        // the managed dirs) but the subsequent copy phase never completed.
        for (const dir of WIPED_DIRS) {
          await rm(join(claudeDir, dir), { recursive: true, force: true });
        }
        for (const dir of WIPED_DIRS) {
          expect(existsSync(join(claudeDir, dir))).toBe(false);
        }

        // Recovery path the installer prints on failure: --rollback.
        const rollback = await run(home, ["--rollback"]);
        if (rollback.exitCode !== 0) {
          throw new Error(
            `rollback failed (${rollback.exitCode})\nstdout:\n${rollback.stdout}\nstderr:\n${rollback.stderr}`,
          );
        }

        // Every wiped directory is back, with content — not just the 4
        // legacy files (settings.json/CLAUDE.md/AGENTS.md/.claude.json).
        for (const dir of WIPED_DIRS) {
          expect(existsSync(join(claudeDir, dir)), `${dir}/ should be restored`).toBe(true);
          const files = await readdir(join(claudeDir, dir)).catch(() => []);
          expect(files.length, `${dir}/ should have content after rollback`).toBeGreaterThan(0);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 180_000 },
  );
});
