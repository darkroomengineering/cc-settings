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
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BACKUP_ONLY_PATHS } from "../src/lib/managed-paths.ts";

const REPO = resolve(import.meta.dir, "..");
const SETUP_TS = join(REPO, "src", "setup.ts");
interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(home: string, extraArgs: string[] = []): Promise<RunResult> {
  const proc = Bun.spawn(
    [process.execPath, SETUP_TS, `--source=${REPO}`, "--target=claude", ...extraArgs],
    {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CC_SKIP_DEPS: "1",
        CC_SKIP_SCHEDULE: "1",
        CC_SKIP_CODEX_CLI: "1",
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

async function createArchive(
  home: string,
  label: string,
  mutate: (fixture: string) => Promise<void>,
): Promise<void> {
  const fixture = await mkdtemp(join(tmpdir(), `cc-backup-fixture-${label}-`));
  const generator = await mkdtemp(join(tmpdir(), `cc-backup-generator-${label}-`));
  try {
    expect((await run(generator)).exitCode).toBe(0);
    const generatorBackups = join(generator, ".claude", "backups");
    const before = new Set(
      (await readdir(generatorBackups)).filter((name) => name.endsWith(".tar.gz")),
    );
    const update = await run(generator);
    expect(update.exitCode, `${update.stdout}\n${update.stderr}`).toBe(0);
    const sourceName = (await readdir(generatorBackups)).find(
      (name) => name.endsWith(".tar.gz") && !before.has(name),
    );
    expect(sourceName).toBeDefined();
    const sourceArchive = join(generatorBackups, sourceName as string);
    const extract = Bun.spawn(["tar", "-xzf", sourceArchive, "-C", fixture], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [extractCode, extractStderr] = await Promise.all([
      extract.exited,
      new Response(extract.stderr).text(),
    ]);
    expect(extractCode, extractStderr).toBe(0);

    await mutate(fixture);
    const archive = join(home, ".claude", "backups", `backup-${label}.tar.gz`);
    const tar = Bun.spawn(["tar", "-czf", archive, "-C", fixture, ".claude", ".claude.json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([tar.exited, new Response(tar.stderr).text()]);
    expect(code, stderr).toBe(0);
    await Promise.all([
      writeFile(`${archive}.schedule.json`, await readFile(`${sourceArchive}.schedule.json`)),
      writeFile(`${archive}.state.json`, await readFile(`${sourceArchive}.state.json`)),
    ]);
  } finally {
    await Promise.all([
      rm(fixture, { recursive: true, force: true }),
      rm(generator, { recursive: true, force: true }),
    ]);
  }
}

// Directories cleanOldConfig() unconditionally wipes on every run (subset that
// createBackup() previously did NOT cover — see H7).
const WIPED_DIRS = ["agents", "skills", "rules", "profiles", "docs", "hooks"];

describe("installer backup — H7 (rollback covers cleanOldConfig's full footprint)", () => {
  test(
    "--rollback refuses missing live managed dirs before changing the remaining install",
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

        const sentinel = join(claudeDir, ".cc-settings-version");
        const settings = join(claudeDir, "settings.json");
        const before = await Promise.all([readFile(sentinel), readFile(settings)]);

        // A rollback must not overwrite a live install after its owned content
        // has changed outside the installer.
        const rollback = await run(home, ["--rollback"]);
        expect(rollback.exitCode).not.toBe(0);
        expect(`${rollback.stdout}\n${rollback.stderr}`).toMatch(/modified|changed|missing|owned/i);
        expect(await Promise.all([readFile(sentinel), readFile(settings)])).toEqual(before);
        for (const dir of WIPED_DIRS) {
          expect(existsSync(join(claudeDir, dir)), `${dir}/ must remain absent`).toBe(false);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 180_000 },
  );

  test.each([
    [
      "legacy-missing-ownership",
      async (fixture: string) => {
        const claude = join(fixture, ".claude");
        for (const path of [
          ".cc-settings-version",
          ".cc-settings-hooks-fingerprint",
          ".cc-settings-src-manifest",
          ".cc-settings-baseline.json",
          "src",
        ]) {
          await rm(join(claude, path), { recursive: true, force: true });
        }
      },
    ],
    [
      "symlink-src",
      async (fixture: string) => {
        const src = join(fixture, ".claude", "src");
        await rm(src, { recursive: true, force: true });
        await writeFile(join(fixture, "outside"), "outside\n");
        await symlink(join(fixture, "outside"), src);
      },
    ],
    [
      "nested-symlink",
      async (fixture: string) => {
        await writeFile(join(fixture, "outside"), "outside\n");
        await symlink(
          join(fixture, "outside"),
          join(fixture, ".claude", "src", "lib", "linked.ts"),
        );
      },
    ],
    [
      "wrong-node-modules-symlink",
      async (fixture: string) => {
        await rm(join(fixture, ".claude", "src", "node_modules"), {
          recursive: true,
          force: true,
        });
        await symlink("/wrong/repo/node_modules", join(fixture, ".claude", "src", "node_modules"));
      },
    ],
    [
      "src-wrong-type",
      async (fixture: string) => {
        const src = join(fixture, ".claude", "src");
        await rm(src, { recursive: true, force: true });
        await writeFile(src, "not a directory\n");
      },
    ],
    [
      "sentinel-wrong-type",
      async (fixture: string) => {
        const sentinel = join(fixture, ".claude", ".cc-settings-version");
        await rm(sentinel);
        await mkdir(sentinel);
      },
    ],
    [
      "invalid-sentinel",
      async (fixture: string) => {
        await writeFile(join(fixture, ".claude", ".cc-settings-version"), "{bad");
      },
    ],
    [
      "missing-managed-files",
      async (fixture: string) => {
        await writeFile(
          join(fixture, ".claude", ".cc-settings-version"),
          `${JSON.stringify({ version: "13.14.0", profile: "full", repo_path: "/expected/repo" })}\n`,
        );
      },
    ],
    [
      "invalid-managed-files",
      async (fixture: string) => {
        await writeFile(
          join(fixture, ".claude", ".cc-settings-version"),
          `${JSON.stringify({
            version: "13.14.0",
            profile: "full",
            repo_path: "/expected/repo",
            managed_files: { "src/setup.ts": "not-a-hash" },
          })}\n`,
        );
      },
    ],
    [
      "invalid-settings",
      async (fixture: string) => {
        await writeFile(join(fixture, ".claude", "settings.json"), "{bad");
      },
    ],
  ] as const)(
    "rollback rejects tampered archive %s before live mutation",
    async (label, mutate) => {
      const home = await mkdtemp(join(tmpdir(), `cc-backup-reject-${label}-`));
      try {
        expect((await run(home)).exitCode).toBe(0);
        const claude = join(home, ".claude");
        const personal = join(claude, "agents", "personal.md");
        await writeFile(personal, "personal exact bytes\n");
        await createArchive(home, label, mutate);
        const paths = [
          join(claude, ".cc-settings-version"),
          join(claude, "settings.json"),
          join(claude, "AGENTS.md"),
          join(claude, "agents", "implementer.md"),
          join(claude, "src", "setup.ts"),
          join(home, ".claude.json"),
          personal,
        ];
        const before = new Map(
          await Promise.all(
            paths.map(async (path) => [path, (await readFile(path)).toString("base64")] as const),
          ),
        );

        const rollback = await run(home, [`--rollback=${label}`]);
        expect(rollback.exitCode).not.toBe(0);
        if (label === "missing-managed-files") {
          expect(`${rollback.stdout}\n${rollback.stderr}`).toMatch(
            /managed-file hash ownership|managed_files|required|sidecar does not match its ownership manifest version/i,
          );
        }
        for (const [path, bytes] of before) {
          expect((await readFile(path)).toString("base64"), path).toBe(bytes);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.each([1, 2, 3, 4] as const)(
    "rollback rejects an archive containing only %i of 5 ownership units",
    async (count) => {
      const label = `partial-ownership-${count}`;
      const home = await mkdtemp(join(tmpdir(), `cc-backup-${label}-`));
      try {
        expect((await run(home)).exitCode).toBe(0);
        const claude = join(home, ".claude");
        const personal = join(claude, "agents", "personal.md");
        await writeFile(personal, "personal exact bytes\n");
        await createArchive(home, label, async (fixture) => {
          for (const path of BACKUP_ONLY_PATHS.slice(count)) {
            await rm(join(fixture, ".claude", path), { recursive: true, force: true });
          }
        });
        const paths = [
          join(claude, ".cc-settings-version"),
          join(claude, "settings.json"),
          join(claude, "AGENTS.md"),
          join(claude, "agents", "implementer.md"),
          join(claude, "src", "setup.ts"),
          join(home, ".claude.json"),
          personal,
        ];
        const before = new Map(
          await Promise.all(
            paths.map(async (path) => [path, (await readFile(path)).toString("base64")] as const),
          ),
        );

        const rollback = await run(home, [`--rollback=${label}`]);
        expect(rollback.exitCode).not.toBe(0);
        for (const [path, bytes] of before) {
          expect((await readFile(path)).toString("base64"), path).toBe(bytes);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test("rollback accepts an installer-produced archive with the exact managed ownership set", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-backup-complete-ownership-"));
    try {
      expect((await run(home)).exitCode).toBe(0);
      const claude = join(home, ".claude");
      const selectedPaths = [
        join(claude, ".cc-settings-version"),
        join(claude, "settings.json"),
        join(claude, "src", "setup.ts"),
        ...BACKUP_ONLY_PATHS.filter((path) => path !== "src").map((path) => join(claude, path)),
      ];
      const selected = new Map(
        await Promise.all(
          selectedPaths.map(
            async (path) => [path, (await readFile(path)).toString("base64")] as const,
          ),
        ),
      );
      const beforeNames = new Set(await readdir(join(claude, "backups")));
      expect((await run(home)).exitCode).toBe(0);
      const archiveName = (await readdir(join(claude, "backups"))).find(
        (name) => /^backup-.*\.tar\.gz$/.test(name) && !beforeNames.has(name),
      );
      expect(archiveName).toBeDefined();

      const rollback = await run(home, [`--rollback=${archiveName}`]);
      if (rollback.exitCode !== 0) {
        throw new Error(
          `complete ownership rollback failed (${rollback.exitCode})\nstdout:\n${rollback.stdout}\nstderr:\n${rollback.stderr}`,
        );
      }
      for (const [path, bytes] of selected) {
        expect((await readFile(path)).toString("base64"), path).toBe(bytes);
      }
      for (const path of BACKUP_ONLY_PATHS) {
        expect(existsSync(join(claude, path)), `${path} must be restored`).toBe(true);
      }
      expect((await run(home, ["--uninstall"])).exitCode).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test("prepared compensation memoizes a refresh failure without mutating", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-compensation-memo-"));
    const runner = join(home, "runner.ts");
    try {
      const installed = await run(home);
      expect(installed.exitCode, `${installed.stdout}\n${installed.stderr}`).toBe(0);
      await writeFile(
        runner,
        `import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBackup } from ${JSON.stringify(join(REPO, "src/lib/install-fs.ts"))};
import { prepareClaudeCompensation } from ${JSON.stringify(join(REPO, "src/lib/install-cmds.ts"))};
const home = process.env.HOME as string;
const claude = join(home, ".claude");
const personal = join(claude, "agents", "personal.md");
const snapshot = await createBackup({ temporary: true });
const prepared = await prepareClaudeCompensation(snapshot);
if (!snapshot.archivePath) throw new Error("expected a compensation archive");
const stagingRoot = join(claude, "tmp");
const stagingNames = await (await import("node:fs/promises")).readdir(stagingRoot);
const stagingName = stagingNames.find((name) => name.startsWith("rollback-"));
if (!stagingName) throw new Error("expected a prepared rollback staging directory");
const staging = join(stagingRoot, stagingName);
await rm(join(staging, ".claude", "agents", "implementer.md"), { force: true });
await writeFile(snapshot.archivePath, "invalid archive bytes\\n");
await writeFile(personal, "live before first execute\\n");
let first: unknown;
try { await prepared.execute(); } catch (cause) { first = cause; }
const restoredBeforeSecond = await readFile(personal, "utf8");
await writeFile(personal, "between executes\\n");
let second: unknown;
try { await prepared.execute(); } catch (cause) { second = cause; }
const afterSecond = await readFile(personal, "utf8");
await prepared.cleanup();
console.log(JSON.stringify({
  firstMessage: first instanceof Error ? first.message : null,
  secondMessage: second instanceof Error ? second.message : null,
  sameError: first === second,
  restoredBeforeSecond,
  afterSecond,
}));
`,
      );
      const proc = Bun.spawn([process.execPath, runner], {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CC_SKIP_SCHEDULE: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      const result = JSON.parse(stdout) as {
        firstMessage: string | null;
        secondMessage: string | null;
        sameError: boolean;
        restoredBeforeSecond: string;
        afterSecond: string;
      };
      expect(result.firstMessage).toBe("Could not refresh Claude compensation (exit 1)");
      expect(result.secondMessage).toBe(result.firstMessage);
      expect(result.sameError).toBe(true);
      expect(result.restoredBeforeSecond).toBe("live before first execute\n");
      expect(result.afterSecond).toBe("between executes\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  test("prepared compensation memoizes a failure after managed paths were removed", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-compensation-late-memo-"));
    const runner = join(home, "runner.ts");
    try {
      const installed = await run(home);
      expect(installed.exitCode, `${installed.stdout}\n${installed.stderr}`).toBe(0);
      await writeFile(
        runner,
        `import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createBackup } from ${JSON.stringify(join(REPO, "src/lib/install-fs.ts"))};
import { prepareClaudeCompensation } from ${JSON.stringify(join(REPO, "src/lib/install-cmds.ts"))};
const home = process.env.HOME as string;
const claude = join(home, ".claude");
const managed = join(claude, "agents", "implementer.md");
const skills = join(claude, "skills");
const snapshot = await createBackup({ temporary: true });
const prepared = await prepareClaudeCompensation(snapshot);
await rm(skills, { recursive: true, force: true });
await writeFile(skills, "ordinary file blocks nested managed removal\\n");
let first: unknown;
try { await prepared.execute(); } catch (cause) { first = cause; }
const managedExistsAfterFirst = existsSync(managed);
await mkdir(join(claude, "agents"), { recursive: true });
await writeFile(managed, "between executes\\n");
let second: unknown;
try { await prepared.execute(); } catch (cause) { second = cause; }
const afterSecond = await readFile(managed, "utf8");
await prepared.cleanup();
console.log(JSON.stringify({
  firstMessage: first instanceof Error ? first.message : null,
  secondMessage: second instanceof Error ? second.message : null,
  sameError: first === second,
  managedExistsAfterFirst,
  afterSecond,
}));
`,
      );
      const proc = Bun.spawn([process.execPath, runner], {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CC_SKIP_SCHEDULE: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      const result = JSON.parse(stdout) as {
        firstMessage: string | null;
        secondMessage: string | null;
        sameError: boolean;
        managedExistsAfterFirst: boolean;
        afterSecond: string;
      };
      expect(result.firstMessage).not.toBeNull();
      expect(result.secondMessage).toBe(result.firstMessage);
      expect(result.sameError).toBe(true);
      expect(result.managedExistsAfterFirst).toBe(false);
      expect(result.afterSecond).toBe("between executes\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  test.each([".claude/output-styles", ".claude/agents/implementer.md"] as const)(
    "rollback rejects exact-state metadata whose declared payload is missing: %s",
    async (missingPayload) => {
      const home = await mkdtemp(join(tmpdir(), "cc-backup-declared-missing-"));
      const extracted = await mkdtemp(join(tmpdir(), "cc-backup-rebuild-"));
      try {
        expect((await run(home)).exitCode).toBe(0);
        const beforeNames = new Set(await readdir(join(home, ".claude", "backups")));
        expect((await run(home)).exitCode).toBe(0);
        const archiveName = (await readdir(join(home, ".claude", "backups"))).find(
          (name) => /^backup-.*\.tar\.gz$/.test(name) && !beforeNames.has(name),
        );
        expect(archiveName).toBeDefined();
        const archive = join(home, ".claude", "backups", archiveName as string);
        const extract = Bun.spawn(["tar", "-xzf", archive, "-C", extracted], {
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(await extract.exited).toBe(0);
        await rm(join(extracted, missingPayload), { recursive: true, force: true });
        const rebuild = Bun.spawn(
          ["tar", "-czf", archive, "-C", extracted, ".claude", ".claude.json"],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(await rebuild.exited).toBe(0);
        const livePaths = [
          join(home, ".claude", ".cc-settings-version"),
          join(home, ".claude", "settings.json"),
          join(home, ".claude", "agents", "implementer.md"),
          join(home, ".claude.json"),
        ];
        const before = new Map(
          await Promise.all(
            livePaths.map(async (path) => [path, await readFile(path, "utf8")] as const),
          ),
        );

        const rollback = await run(home, [`--rollback=${archiveName}`]);
        expect(rollback.exitCode).not.toBe(0);
        for (const [path, bytes] of before) expect(await readFile(path, "utf8")).toBe(bytes);
      } finally {
        await Promise.all([
          rm(home, { recursive: true, force: true }),
          rm(extracted, { recursive: true, force: true }),
        ]);
      }
    },
    180_000,
  );

  test("rollback rejects a staged managed payload omitted consistently from archive metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-backup-staged-ownership-omission-"));
    const extracted = await mkdtemp(join(tmpdir(), "cc-backup-staged-ownership-extract-"));
    try {
      expect((await run(home)).exitCode).toBe(0);
      const beforeNames = new Set(await readdir(join(home, ".claude", "backups")));
      expect((await run(home)).exitCode).toBe(0);
      const archiveName = (await readdir(join(home, ".claude", "backups"))).find(
        (name) => /^backup-.*\.tar\.gz$/.test(name) && !beforeNames.has(name),
      );
      expect(archiveName).toBeDefined();
      const archive = join(home, ".claude", "backups", archiveName as string);
      const extract = Bun.spawn(["tar", "-xzf", archive, "-C", extracted], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await extract.exited).toBe(0);
      const omittedRelative = ".cc-settings-baseline.json";
      const stagedSentinel = join(extracted, ".claude", ".cc-settings-version");
      const sentinel = JSON.parse(await readFile(stagedSentinel, "utf8")) as {
        managed_files: Record<string, string>;
      };
      delete sentinel.managed_files[omittedRelative];
      await writeFile(stagedSentinel, `${JSON.stringify(sentinel, null, 2)}\n`);
      await rm(join(extracted, ".claude", omittedRelative));
      const statePath = `${archive}.state.json`;
      const state = JSON.parse(await readFile(statePath, "utf8")) as { present: string[] };
      state.present = state.present.filter((path) => path !== `.claude/${omittedRelative}`);
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      const rebuild = Bun.spawn(
        ["tar", "-czf", archive, "-C", extracted, ".claude", ".claude.json"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await rebuild.exited).toBe(0);
      const livePaths = [
        join(home, ".claude", ".cc-settings-version"),
        join(home, ".claude", "settings.json"),
        join(home, ".claude", "agents", "implementer.md"),
        join(home, ".claude.json"),
      ];
      const before = new Map(
        await Promise.all(
          livePaths.map(async (path) => [path, await readFile(path, "utf8")] as const),
        ),
      );

      const rollback = await run(home, [`--rollback=${archiveName}`]);

      expect(rollback.exitCode).not.toBe(0);
      for (const [path, bytes] of before) expect(await readFile(path, "utf8")).toBe(bytes);
    } finally {
      await Promise.all([
        rm(home, { recursive: true, force: true }),
        rm(extracted, { recursive: true, force: true }),
      ]);
    }
  }, 180_000);
});
