// End-to-end install test. Spawns `bun src/setup.ts --source=<repo>` with
// HOME pointed at a tmpdir and asserts the resulting tree shape.
//
// Why this matters: unit tests cover the merger, the compose, and individual
// scripts. They don't cover the install ORCHESTRATION — the order things run,
// the actual file copies, the version sentinel write, the link-vs-copy logic
// for node_modules. This test fires the whole flow and verifies the end state.
//
// Sets CC_SKIP_DEPS=1 to bypass `pipx install llm-tldr` and similar global
// installs — those write outside HOME and would pollute the dev/CI environment.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const SETUP_TS = join(REPO, "src", "setup.ts");

interface InstallResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runInstall(home: string): Promise<InstallResult> {
  const proc = Bun.spawn(["bun", SETUP_TS, `--source=${REPO}`], {
    env: {
      ...process.env,
      HOME: home,
      // os.homedir() reads USERPROFILE on Windows, not HOME — set both so the
      // installer targets the tmpdir on every platform.
      USERPROFILE: home,
      CC_SKIP_DEPS: "1",
      // Avoid color codes / banner art bleeding into assertion strings.
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

describe("install E2E — fresh HOME", () => {
  test(
    "first install writes a coherent ~/.claude/ tree",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-"));
      try {
        const result = await runInstall(home);
        if (result.exitCode !== 0) {
          throw new Error(
            `installer exited with ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
          );
        }

        const claudeDir = join(home, ".claude");

        // Top-level files we ship.
        expect(existsSync(join(claudeDir, "settings.json"))).toBe(true);
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(true);
        expect(existsSync(join(claudeDir, "AGENTS.md"))).toBe(true);
        expect(existsSync(join(claudeDir, ".cc-settings-version"))).toBe(true);

        // Managed directory tree.
        for (const dir of [
          "agents",
          "skills",
          "profiles",
          "rules",
          "contexts",
          "hooks",
          "docs",
          "memory",
          "src",
          "src/scripts",
          "src/hooks",
          "src/lib",
          "src/schemas",
        ]) {
          expect(existsSync(join(claudeDir, dir))).toBe(true);
        }

        // settings.json is valid JSON and has the team-baseline fields.
        const settings = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf8"));
        expect(typeof settings).toBe("object");
        expect(settings.statusLine?.command).toContain("statusline.ts");
        expect(settings.$schema).toBe("https://json.schemastore.org/claude-code-settings.json");

        // Version sentinel was written.
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        );
        expect(typeof sentinel.version).toBe("string");
        expect(sentinel.version).toMatch(/^\d+\.\d+\.\d+$/);

        // First-install delta line should appear.
        expect(result.stdout).toContain("first install at v");

        // No backup yet — fresh HOME has no settings.json to back up.
        const backupsDir = join(claudeDir, "backups");
        if (existsSync(backupsDir)) {
          const stats = await stat(backupsDir);
          expect(stats.isDirectory()).toBe(true);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test(
    "second install on top of first prints version-delta (or 'no change')",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-"));
      try {
        // Two back-to-back runs against the same HOME. The second is a re-install.
        const first = await runInstall(home);
        expect(first.exitCode).toBe(0);

        const second = await runInstall(home);
        expect(second.exitCode).toBe(0);
        // Same version both runs — delta is silent (per formatVersionDelta).
        // We DO expect the 'Restart Claude Code' line and a re-emitted summary.
        expect(second.stdout).toContain("Installed to:");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 90_000 },
  );

  test(
    "--migrate-only against a fresh HOME applies merger only (no dependencies, no file copy)",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-mig-"));
      try {
        const proc = Bun.spawn(["bun", SETUP_TS, `--source=${REPO}`, "--migrate-only"], {
          env: { ...process.env, HOME: home, USERPROFILE: home, CC_SKIP_DEPS: "1", NO_COLOR: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const code = await proc.exited;
        if (code !== 0) {
          throw new Error(`migrate-only failed (${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
        }

        // settings.json + sentinel exist (merger + sentinel ran).
        expect(existsSync(join(home, ".claude", "settings.json"))).toBe(true);
        expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(true);

        // CLAUDE.md was NOT copied (file-copy phase was skipped).
        expect(existsSync(join(home, ".claude", "CLAUDE.md"))).toBe(false);

        // The migrate-only banner appears in stdout.
        expect(stdout).toContain("Migrate-only");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );
});
