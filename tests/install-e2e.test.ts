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
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LIGHT_SKILLS } from "../src/lib/light-profile.ts";

const REPO = resolve(import.meta.dir, "..");
const SETUP_TS = join(REPO, "src", "setup.ts");

interface InstallResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runInstall(home: string, extraArgs: string[] = []): Promise<InstallResult> {
  const proc = Bun.spawn(["bun", SETUP_TS, `--source=${REPO}`, ...extraArgs], {
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
        const result = await runInstall(home, []);
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

// ---------------------------------------------------------------------------
// Light install E2E
// ---------------------------------------------------------------------------

describe("install E2E — light profile", () => {
  test(
    "--light fresh install: only share-learning skill, no CLAUDE.md/AGENTS.md, settings=$schema+statusLine only",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-light-"));
      try {
        const result = await runInstall(home, ["--light"]);
        if (result.exitCode !== 0) {
          throw new Error(
            `light installer failed (${result.exitCode})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
          );
        }

        const claudeDir = join(home, ".claude");

        // Skills: ONLY share-learning.
        const skillsDir = join(claudeDir, "skills");
        const installedSkills = new Set(await readdir(skillsDir).catch(() => []));
        for (const skill of LIGHT_SKILLS) {
          expect(installedSkills.has(skill), `skill "${skill}" should be installed`).toBe(true);
        }
        for (const installed of installedSkills) {
          expect(
            (LIGHT_SKILLS as readonly string[]).includes(installed),
            `"${installed}" should NOT be in a light install`,
          ).toBe(true);
        }

        // No agents dir (or empty).
        const agentsDir = join(claudeDir, "agents");
        if (existsSync(agentsDir)) {
          const agentFiles = (await readdir(agentsDir).catch(() => [])).filter((f) =>
            f.endsWith(".md"),
          );
          expect(agentFiles.length).toBe(0);
        }

        // No CLAUDE.md.
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(false);
        // No AGENTS.md.
        expect(existsSync(join(claudeDir, "AGENTS.md"))).toBe(false);
        // No rules/.
        expect(existsSync(join(claudeDir, "rules"))).toBe(false);
        // No contexts/.
        expect(existsSync(join(claudeDir, "contexts"))).toBe(false);
        // No profiles/.
        expect(existsSync(join(claudeDir, "profiles"))).toBe(false);
        // No docs/ (or empty).
        if (existsSync(join(claudeDir, "docs"))) {
          const docFiles = (await readdir(join(claudeDir, "docs")).catch(() => [])).filter((f) =>
            f.endsWith(".md"),
          );
          expect(docFiles.length).toBe(0);
        }

        // settings.json: only $schema + statusLine — no mcpServers, no hooks, no env,
        // no permissions.
        const settingsRaw = await readFile(join(claudeDir, "settings.json"), "utf8");
        const settings = JSON.parse(settingsRaw) as Record<string, unknown>;
        expect(settings.$schema).toBeTruthy();
        expect(settings.statusLine).toBeTruthy();
        expect(
          "mcpServers" in settings && Object.keys(settings.mcpServers as object).length > 0,
        ).toBe(false);
        expect("hooks" in settings && Object.keys(settings.hooks as object).length > 0).toBe(false);
        expect(
          "env" in settings &&
            (settings.env as Record<string, unknown>).CLAUDE_CODE_EFFORT_LEVEL !== undefined,
        ).toBe(false);
        expect(
          "permissions" in settings &&
            ((settings.permissions as Record<string, unknown[]>).allow?.length ?? 0) > 0,
        ).toBe(false);

        // src/ is present (statusLine command references it).
        expect(existsSync(join(claudeDir, "src"))).toBe(true);

        // Sentinel profile === "light".
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        ) as { profile?: string };
        expect(sentinel.profile).toBe("light");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test(
    "full → light switch: cc-settings footprint gone, only share-learning remains",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-switch-fl-"));
      try {
        // First: full install.
        const full = await runInstall(home, []);
        expect(full.exitCode).toBe(0);

        // Verify full install has CLAUDE.md before the switch.
        expect(existsSync(join(home, ".claude", "CLAUDE.md"))).toBe(true);

        // Second: switch to light.
        const light = await runInstall(home, ["--light"]);
        if (light.exitCode !== 0) {
          throw new Error(
            `light switch failed (${light.exitCode})\nstdout:\n${light.stdout}\nstderr:\n${light.stderr}`,
          );
        }

        const claudeDir = join(home, ".claude");

        // skills: only share-learning.
        const skillsDir = join(claudeDir, "skills");
        const installedSkills = new Set(await readdir(skillsDir).catch(() => []));
        for (const skill of LIGHT_SKILLS) {
          expect(installedSkills.has(skill), `skill "${skill}" should be present`).toBe(true);
        }
        for (const installed of installedSkills) {
          expect(
            (LIGHT_SKILLS as readonly string[]).includes(installed),
            `"${installed}" should NOT be present after full→light switch`,
          ).toBe(true);
        }

        // No CLAUDE.md / AGENTS.md after switch.
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(false);
        expect(existsSync(join(claudeDir, "AGENTS.md"))).toBe(false);
        // No agents dir files.
        if (existsSync(join(claudeDir, "agents"))) {
          const agentFiles = (await readdir(join(claudeDir, "agents")).catch(() => [])).filter(
            (f) => f.endsWith(".md"),
          );
          expect(agentFiles.length).toBe(0);
        }
        // No rules.
        expect(existsSync(join(claudeDir, "rules"))).toBe(false);
        // No contexts.
        expect(existsSync(join(claudeDir, "contexts"))).toBe(false);
        // No profiles.
        expect(existsSync(join(claudeDir, "profiles"))).toBe(false);

        // settings.json: no cc-settings env, no cc-settings permissions, no cc-settings hooks.
        const settings = JSON.parse(
          await readFile(join(claudeDir, "settings.json"), "utf8"),
        ) as Record<string, unknown>;
        // No CLAUDE_CODE_EFFORT_LEVEL.
        const env = (settings.env ?? {}) as Record<string, unknown>;
        expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
        // No mcpServers with cc-settings content.
        const mcp = (settings.mcpServers ?? {}) as Record<string, unknown>;
        expect("context7" in mcp).toBe(false);
        // No cc-settings hooks.
        const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
        const allHookCommands = Object.values(hooks)
          .flat()
          .flatMap((g: unknown) => {
            const gr = g as { hooks?: Array<{ command?: string }> };
            return (gr.hooks ?? []).map((h) => h.command ?? "");
          });
        expect(
          allHookCommands.some(
            (c) => c.includes("/.claude/src/hooks/") || c.includes("/.claude/src/scripts/"),
          ),
        ).toBe(false);

        // No cc-settings scalar/object settings leaked from the full install
        // (sandbox, teammateMode, spinnerVerbs, attribution, …). A clean full→light
        // switch with no user-authored settings must reduce to exactly $schema + statusLine.
        expect(Object.keys(settings).sort()).toEqual(["$schema", "statusLine"]);

        // Sentinel profile === "light".
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        ) as { profile?: string };
        expect(sentinel.profile).toBe("light");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 },
  );

  test(
    "light → full switch: CLAUDE.md present, agents present, all skills present, sentinel=full",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-e2e-switch-lf-"));
      try {
        // First: light install.
        const light = await runInstall(home, ["--light"]);
        expect(light.exitCode).toBe(0);

        // Second: switch to full.
        const full = await runInstall(home, []);
        if (full.exitCode !== 0) {
          throw new Error(
            `full switch failed (${full.exitCode})\nstdout:\n${full.stdout}\nstderr:\n${full.stderr}`,
          );
        }

        const claudeDir = join(home, ".claude");

        // CLAUDE.md and AGENTS.md restored.
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(true);
        expect(existsSync(join(claudeDir, "AGENTS.md"))).toBe(true);

        // agents/ has content.
        const agentsDir = join(claudeDir, "agents");
        expect(existsSync(agentsDir)).toBe(true);
        const agentFiles = (await readdir(agentsDir).catch(() => [])).filter((f) =>
          f.endsWith(".md"),
        );
        expect(agentFiles.length).toBeGreaterThan(0);

        // skills has more than just share-learning.
        const skillsDir = join(claudeDir, "skills");
        const installedSkills = await readdir(skillsDir).catch(() => []);
        expect(installedSkills.length).toBeGreaterThan(1);

        // settings.json has statusLine (full inherits it).
        const settings = JSON.parse(
          await readFile(join(claudeDir, "settings.json"), "utf8"),
        ) as Record<string, unknown>;
        expect(settings.statusLine).toBeTruthy();

        // Sentinel profile === "full".
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        ) as { profile?: string };
        expect(sentinel.profile).toBe("full");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 },
  );
});
