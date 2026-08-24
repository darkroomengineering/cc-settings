import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { prependTestPath, shellFixtureCommand } from "./support/portable-process.ts";

const REPO = resolve(import.meta.dir, "..");
const SETUP_TS = join(REPO, "src", "setup.ts");
const START = "<!-- cc-settings:codex:start -->";
const END = "<!-- cc-settings:codex:end -->";

interface InstallResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCodex(
  home: string,
  extraArgs: string[] = [],
  target: "claude" | "codex" | "both" = "codex",
  extraEnv: Record<string, string> = {},
  source: string = REPO,
): Promise<InstallResult> {
  const codexHome = join(home, ".codex");
  const firstPathEntry = extraEnv.PATH?.split(delimiter)[0];
  const fixture = firstPathEntry ? join(firstPathEntry, "codex") : null;
  const commandEnv =
    fixture && existsSync(fixture)
      ? {
          CC_SETTINGS_TEST_MODE: "codex-install",
          CC_SETTINGS_TEST_CODEX_COMMAND_JSON: shellFixtureCommand(fixture),
        }
      : {};
  const child = Bun.spawn(
    [process.execPath, SETUP_TS, `--source=${source}`, `--target=${target}`, ...extraArgs],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        CC_SKIP_DEPS: "1",
        CC_SKIP_SCHEDULE: "1",
        CC_SKIP_CODEX_CLI: "1",
        NO_COLOR: "1",
        ...extraEnv,
        ...commandEnv,
        HOME: extraEnv.HOME ?? home,
        USERPROFILE: extraEnv.USERPROFILE ?? home,
        CODEX_HOME: extraEnv.CODEX_HOME ?? codexHome,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function copySourceFixture(parent: string): Promise<string> {
  const source = join(parent, "source");
  await cp(REPO, source, {
    recursive: true,
    filter: (path) => {
      const relative = path.slice(REPO.length).replace(/^[/\\]/, "");
      return !relative
        .split(/[/\\]+/)
        .some((part) => [".git", "node_modules", ".venv", ".tldr", "backups"].includes(part));
    },
  });
  return source;
}

async function packagedVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(REPO, "package.json"), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

function neighboringMajor(version: string, direction: "older" | "newer"): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a semantic release version, received ${version}`);
  const major = Number.parseInt(match[1] as string, 10);
  if (direction === "newer") return `${major + 1}.0.0`;
  if (major === 0) throw new Error(`Cannot construct an older major release from ${version}`);
  return `${major - 1}.0.0`;
}

async function rewriteSentinelVersion(path: string, version: string): Promise<void> {
  const sentinel = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  sentinel.version = version;
  await writeFile(path, `${JSON.stringify(sentinel, null, 2)}\n`);
}

function expectSuccess(result: InstallResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `Codex lifecycle exited ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

async function managedAgentNames(codexHome: string): Promise<string[]> {
  const sentinel = JSON.parse(await readFile(join(codexHome, ".cc-settings-version"), "utf8")) as {
    managed_agents: string[];
  };
  return sentinel.managed_agents;
}

async function snapshotPaths(paths: string[]): Promise<Map<string, string | null>> {
  return new Map(
    await Promise.all(
      paths.map(async (path) => {
        const bytes = await readFile(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        return [path, bytes === null ? null : bytes.toString("base64")] as const;
      }),
    ),
  );
}

async function expectPathsExact(snapshot: Map<string, string | null>): Promise<void> {
  for (const [path, expected] of snapshot) {
    const current = await readFile(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    expect(current === null ? null : current.toString("base64"), path).toBe(expected);
  }
}

async function sharedBackupIds(home: string): Promise<{ claude: string[]; codex: string[] }> {
  const claudeDir = join(home, ".claude", "backups");
  const codexDir = join(home, ".codex", "backups", "cc-settings");
  const claude = (await readdir(claudeDir).catch(() => []))
    .map((name) => name.match(/^backup-(\d{14}-\d{3}-\d+-\d+)\.tar\.gz$/)?.[1])
    .filter((id): id is string => id !== undefined)
    .sort();
  const codex = (await readdir(codexDir).catch(() => []))
    .filter((name) => /^\d{14}-\d{3}-\d+-\d+$/.test(name))
    .sort();
  return { claude, codex };
}

async function createStatefulCodex(home: string): Promise<{
  bin: string;
  plugin: string;
  disabled: string;
  marketplace: string;
  calls: string;
}> {
  const bin = join(home, "bin");
  const plugin = join(home, ".fake-plugin-installed");
  const disabled = join(home, ".fake-plugin-disabled");
  const marketplace = join(home, ".fake-marketplace-installed");
  const calls = join(home, ".fake-codex-calls");
  await mkdir(bin, { recursive: true });
  const executable = join(bin, "codex");
  await writeFile(
    executable,
    '#!/bin/sh\nplugin="$HOME/.fake-plugin-installed"\ndisabled="$HOME/.fake-plugin-disabled"\nmarket="$HOME/.fake-marketplace-installed"\nmanaged="$CODEX_HOME/darkroom/source"\ncalls="$HOME/.fake-codex-calls"\nprintf \'%s\\n\' "$*" >> "$calls"\nif [ "$FAKE_CROSS_SECOND" = "1" ] && [ ! -e "$HOME/.crossed-second" ]; then date +%s > "$HOME/.codex-start-second"; sleep 1.1; date +%s > "$HOME/.codex-end-second"; touch "$HOME/.crossed-second"; fi\ncase "$2:$3" in\n  list:*) if [ -e "$plugin" ]; then if [ -e "$disabled" ]; then enabled=false; else enabled=true; fi; source=$(cat "$plugin"); printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":%s,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$enabled" "$source" "$source"; else printf \'{"installed":[]}\\n\'; fi; exit 0;;\n  marketplace:list) if [ -e "$market" ]; then root=$(cat "$market"); printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$root" "$root"; else printf \'{"marketplaces":[]}\\n\'; fi; exit 0;;\n  marketplace:add) printf \'%s\n\' "${4:-$managed}" > "$market"; exit 0;;\n  marketplace:remove) rm -f "$market"; exit 0;;\n  add:*) if [ -e "$market" ]; then cat "$market" > "$plugin"; else printf \'%s\n\' "$managed" > "$plugin"; fi; rm -f "$disabled"; exit 0;;\n  remove:*) rm -f "$plugin" "$disabled"; exit 0;;\n  enable:*) if [ ! -e "$plugin" ]; then if [ -e "$market" ]; then cat "$market" > "$plugin"; else printf \'%s\n\' "$managed" > "$plugin"; fi; fi; rm -f "$disabled"; exit 0;;\n  disable:*) touch "$disabled"; exit 0;;\nesac\nexit 0\n',
  );
  await chmod(executable, 0o755);
  return { bin, plugin, disabled, marketplace, calls };
}

describe("Codex installer lifecycle", () => {
  test(
    "full install and reinstall create valid native state without touching Claude",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-install-"));
      const codexHome = join(home, ".codex");
      try {
        await mkdir(codexHome, { recursive: true });
        await writeFile(join(codexHome, "AGENTS.md"), "user instructions\n");

        expectSuccess(await runCodex(home));

        expect(existsSync(join(codexHome, "AGENTS.md"))).toBe(true);
        expect(existsSync(join(codexHome, "agents", "implementer.toml"))).toBe(true);
        expect(existsSync(join(codexHome, "agents", "codex-verifier.toml"))).toBe(false);
        expect(existsSync(join(codexHome, "rules", "darkroom.rules"))).toBe(true);
        expect(existsSync(join(codexHome, "darkroom", "source"))).toBe(true);
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(true);
        expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);

        const names = await managedAgentNames(codexHome);
        expect(names).toHaveLength(9);
        expect(names).toContain("implementer");
        expect(names).not.toContain("codex-verifier");
        for (const name of names) {
          const raw = await readFile(join(codexHome, "agents", `${name}.toml`), "utf8");
          const parsed = Bun.TOML.parse(raw) as Record<string, unknown>;
          expect(parsed.name).toBe(name);
          expect(typeof parsed.description).toBe("string");
          expect(typeof parsed.developer_instructions).toBe("string");
          const developerInstructions = parsed.developer_instructions as string;
          for (const nativeName of [
            "exec_command",
            "apply_patch",
            "spawn_agent",
            "followup_task",
            "send_message",
            "wait_agent",
            "interrupt_agent",
          ]) {
            expect(developerInstructions).toContain(nativeName);
          }
          for (const obsoleteName of ["send_input", "resume_agent", "close_agent"]) {
            expect(developerInstructions).not.toContain(obsoleteName);
          }
          expect(developerInstructions).toContain(
            "Do not invoke codex-verifier or codex-run.ts from inside Codex",
          );
          expect(developerInstructions).not.toContain("CLAUDE.md");
          expect(typeof parsed.sandbox_mode).toBe("string");
          expect(["read-only", "workspace-write"]).toContain(parsed.sandbox_mode as string);
          expect(raw).not.toContain(".claude/src");
          if (parsed.model_reasoning_effort !== undefined) {
            expect(typeof parsed.model_reasoning_effort).toBe("string");
            expect(["low", "medium", "high", "xhigh"]).toContain(
              parsed.model_reasoning_effort as string,
            );
          }
        }

        expectSuccess(await runCodex(home));
        const instructions = await readFile(join(codexHome, "AGENTS.md"), "utf8");
        expect(instructions).toContain("user instructions");
        expect(instructions).toContain("$CODEX_HOME/agents");
        expect(instructions).not.toContain("~/.codex/agents");
        expect(instructions.split(START)).toHaveLength(2);
        expect(instructions.split(END)).toHaveLength(2);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 },
  );

  test("status recognizes the installed plugin by its real pluginId", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-status-plugin-id-"));
    try {
      const fake = await createStatefulCodex(home);
      const env = {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(fake.bin),
      };
      expectSuccess(await runCodex(home, [], "codex", env));

      const status = await runCodex(home, ["--status"], "codex", env);

      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("Codex:");
      expect(status.stdout).toContain("plugin: installed");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("status tells a user with older Codex settings to run the normal update", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-status-update-"));
    const sentinel = join(home, ".codex", ".cc-settings-version");
    try {
      expectSuccess(await runCodex(home));
      const packaged = await packagedVersion();
      const installed = neighboringMajor(packaged, "older");
      await rewriteSentinelVersion(sentinel, installed);

      const status = await runCodex(home, ["--status"]);

      expect(status.exitCode, `${status.stdout}\n${status.stderr}`).toBe(0);
      expect(status.stdout).toContain(installed);
      expect(status.stdout).toContain(packaged);
      expect(status.stdout).toMatch(/re-?run|update/i);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("status identifies an older source checkout without recommending a Codex downgrade", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-status-older-source-"));
    const sentinel = join(home, ".codex", ".cc-settings-version");
    try {
      expectSuccess(await runCodex(home));
      const packaged = await packagedVersion();
      const installed = neighboringMajor(packaged, "newer");
      await rewriteSentinelVersion(sentinel, installed);

      const status = await runCodex(home, ["--status"]);

      expect(status.exitCode, `${status.stdout}\n${status.stderr}`).toBe(0);
      expect(status.stdout).toContain(installed);
      expect(status.stdout).toContain(packaged);
      expect(status.stdout).toMatch(/source checkout.*older|update or replace/i);
      expect(status.stdout).not.toMatch(/re-?run to update/i);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test(
    "a Codex collision aborts a both-target install before Claude is mutated",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-collision-"));
      const collision = join(home, ".codex", "agents", "implementer.toml");
      const original = 'name = "personal-implementer"\n';
      try {
        await mkdir(join(home, ".codex", "agents"), { recursive: true });
        await writeFile(collision, original);

        const result = await runCodex(home, [], "both");

        expect(result.exitCode).not.toBe(0);
        expect(await readFile(collision, "utf8")).toBe(original);
        expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
        expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test(
    "a malformed managed instruction block aborts both targets before mutation",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-instructions-"));
      const instructions = join(home, ".codex", "AGENTS.md");
      const original = `${START}\nbroken block without an end marker\n`;
      try {
        await mkdir(join(home, ".codex"), { recursive: true });
        await writeFile(instructions, original);

        const result = await runCodex(home, [], "both");

        expect(result.exitCode).not.toBe(0);
        expect(await readFile(instructions, "utf8")).toBe(original);
        expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
        expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test(
    "first install refuses to overwrite an unowned same-name native agent",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-collision-"));
      const collision = join(home, ".codex", "agents", "implementer.toml");
      const original = 'name = "personal-implementer"\n';
      try {
        await mkdir(join(home, ".codex", "agents"), { recursive: true });
        await writeFile(collision, original);

        const result = await runCodex(home);

        expect(result.exitCode).not.toBe(0);
        expect(await readFile(collision, "utf8")).toBe(original);
        expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test(
    "first install refuses to overwrite an unowned darkroom command rule",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-rule-collision-"));
      const collision = join(home, ".codex", "rules", "darkroom.rules");
      const original = "# personal darkroom policy\n";
      try {
        await mkdir(join(home, ".codex", "rules"), { recursive: true });
        await writeFile(collision, original);

        const result = await runCodex(home);

        expect(result.exitCode).not.toBe(0);
        expect(await readFile(collision, "utf8")).toBe(original);
        expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );

  test(
    "light, rollback, and uninstall change only files owned by the sentinel",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-lifecycle-"));
      const codexHome = join(home, ".codex");
      const personalAgent = join(codexHome, "agents", "personal.toml");
      const personalRule = join(codexHome, "rules", "personal.rules");
      try {
        await mkdir(join(codexHome, "agents"), { recursive: true });
        await mkdir(join(codexHome, "rules"), { recursive: true });
        await writeFile(join(codexHome, "AGENTS.md"), "before\n");
        await writeFile(personalAgent, 'name = "personal"\n');
        await writeFile(personalRule, "# personal\n");

        expectSuccess(await runCodex(home));
        const managed = await managedAgentNames(codexHome);
        const backupsBeforeLight = await readdir(join(codexHome, "backups", "cc-settings"));

        expectSuccess(await runCodex(home, ["--light"]));
        for (const name of managed) {
          expect(existsSync(join(codexHome, "agents", `${name}.toml`))).toBe(false);
        }
        expect(existsSync(join(codexHome, "rules", "darkroom.rules"))).toBe(false);
        expect(existsSync(personalAgent)).toBe(true);
        expect(existsSync(personalRule)).toBe(true);

        expectSuccess(await runCodex(home, ["--rollback"]));
        expect(existsSync(join(codexHome, "agents", "implementer.toml"))).toBe(true);
        expect(existsSync(join(codexHome, "rules", "darkroom.rules"))).toBe(true);
        expect(existsSync(personalAgent)).toBe(true);
        expect(existsSync(personalRule)).toBe(true);

        expectSuccess(await runCodex(home, ["--uninstall"]));
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(codexHome, "darkroom", "source"))).toBe(false);
        expect(existsSync(join(codexHome, "rules", "darkroom.rules"))).toBe(false);
        expect(existsSync(personalAgent)).toBe(true);
        expect(existsSync(personalRule)).toBe(true);
        const instructions = await readFile(join(codexHome, "AGENTS.md"), "utf8");
        expect(instructions).toBe("before\n");
        const backupsAfterUninstall = await readdir(join(codexHome, "backups", "cc-settings"));
        expect(backupsAfterUninstall.length).toBeGreaterThanOrEqual(backupsBeforeLight.length);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 180_000 },
  );

  test.each(["claude", "both"] as const)(
    "%s rollback preserves personal shared-directory files while restoring selected managed state",
    async (target) => {
      const home = await mkdtemp(join(tmpdir(), `cc-${target}-rollback-personal-`));
      const claudeDir = join(home, ".claude");
      try {
        const sourceA = await realpath(await copySourceFixture(join(home, "source-parent")));
        const sourceB = sourceA;
        await mkdir(join(sourceA, "node_modules"));
        const managedRelative = "agents/implementer.md";
        const selectedManagedBytes = await readFile(join(sourceA, managedRelative));
        const sourceBManagedBytes = Buffer.concat([
          selectedManagedBytes,
          Buffer.from("\nsource B managed agent\n"),
        ]);
        const fake = target === "both" ? await createStatefulCodex(home) : null;
        const env: Record<string, string> = fake
          ? { CC_SKIP_CODEX_CLI: "0", PATH: prependTestPath(fake.bin) }
          : {};
        expectSuccess(await runCodex(home, [], target, env, sourceA));
        const idsBefore = await sharedBackupIds(home);
        const claudeBackupsBefore = new Set(
          await readdir(join(claudeDir, "backups")).catch(() => []),
        );
        await writeFile(join(sourceB, managedRelative), sourceBManagedBytes);
        expectSuccess(await runCodex(home, [], target, env, sourceB));
        const idsAfter = await sharedBackupIds(home);
        const backupId =
          target === "both"
            ? idsAfter.claude.find(
                (id) => idsAfter.codex.includes(id) && !idsBefore.claude.includes(id),
              )
            : (await readdir(join(claudeDir, "backups")))
                .find((name) => /^backup-.*\.tar\.gz$/.test(name) && !claudeBackupsBefore.has(name))
                ?.replace(/^backup-|\.tar\.gz$/g, "");
        expect(backupId).toBeDefined();
        expect(await readFile(join(claudeDir, managedRelative))).toEqual(sourceBManagedBytes);
        const personalFiles = new Map([
          ["agents/personal.md", "personal agent exact bytes\n"],
          ["skills/personal/SKILL.md", "personal skill exact bytes\n"],
          ["rules/personal.md", "personal rule exact bytes\n"],
          ["profiles/personal.md", "personal profile exact bytes\n"],
          ["docs/personal.md", "personal docs exact bytes\n"],
          ["hooks/personal.ts", "personal hook exact bytes\n"],
        ]);
        for (const [relativePath, bytes] of personalFiles) {
          const path = join(claudeDir, relativePath);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, bytes);
        }

        const rollback = await runCodex(home, [`--rollback=${backupId}`], target, env, sourceB);
        expect(rollback.exitCode, `${rollback.stdout}\n${rollback.stderr}`).toBe(0);
        expect(await readFile(join(claudeDir, managedRelative))).toEqual(selectedManagedBytes);
        const sentinel = JSON.parse(
          await readFile(join(claudeDir, ".cc-settings-version"), "utf8"),
        ) as { repo_path: string; managed_files: Record<string, string> };
        expect(sentinel.repo_path).toBe(sourceA);
        expect(sentinel.managed_files[managedRelative]).toMatch(/^[a-f0-9]{64}$/);
        for (const [relativePath, bytes] of personalFiles) {
          expect(await readFile(join(claudeDir, relativePath), "utf8"), relativePath).toBe(bytes);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test(
    "rolling back a fresh install restores the absent pre-install state",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-fresh-rollback-"));
      const codexHome = join(home, ".codex");
      try {
        expectSuccess(await runCodex(home));
        expect(existsSync(join(home, ".claude"))).toBe(false);
        expectSuccess(await runCodex(home, ["--rollback"]));

        expect(existsSync(join(home, ".claude"))).toBe(false);
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(codexHome, "darkroom", "source"))).toBe(false);
        expect(existsSync(join(codexHome, "rules", "darkroom.rules"))).toBe(false);
        expect(existsSync(join(codexHome, "config.toml"))).toBe(false);
        expect(existsSync(join(codexHome, "plugins"))).toBe(false);

        expectSuccess(await runCodex(home));
        expect(existsSync(join(home, ".claude"))).toBe(false);
        expectSuccess(await runCodex(home, ["--uninstall"]));
        expect(existsSync(join(home, ".claude"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 },
  );

  test("fresh combined install creates one valid empty paired recovery point", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-both-fresh-recovery-"));
    const claudeDir = join(home, ".claude");
    const codexHome = join(home, ".codex");
    const claudePersonal = join(claudeDir, "personal.txt");
    const codexPersonal = join(codexHome, "personal.txt");
    const tracked = [
      claudePersonal,
      codexPersonal,
      join(claudeDir, ".cc-settings-version"),
      join(claudeDir, "settings.json"),
      join(codexHome, ".cc-settings-version"),
      join(codexHome, "AGENTS.md"),
    ];
    try {
      await Promise.all([
        mkdir(claudeDir, { recursive: true }),
        mkdir(codexHome, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(claudePersonal, "claude personal exact bytes\n"),
        writeFile(codexPersonal, "codex personal exact bytes\n"),
      ]);
      const absent = await snapshotPaths(tracked);

      expectSuccess(await runCodex(home, [], "both"));
      const first = await sharedBackupIds(home);
      const common = first.claude.filter((id) => first.codex.includes(id));
      expect(common).toHaveLength(1);
      const firstId = common[0] as string;
      const archive = join(claudeDir, "backups", `backup-${firstId}.tar.gz`);
      const sidecar = JSON.parse(await readFile(`${archive}.schedule.json`, "utf8")) as Record<
        string,
        unknown
      >;
      expect(sidecar.version).toBe(3);
      expect(
        JSON.parse(
          await readFile(
            join(codexHome, "backups", "cc-settings", firstId, "manifest.json"),
            "utf8",
          ),
        ),
      ).toEqual(expect.objectContaining({ present: expect.any(Array) }));

      expectSuccess(await runCodex(home, ["--rollback"], "both"));
      await expectPathsExact(absent);
      expectSuccess(await runCodex(home, [], "both"));
      const second = await sharedBackupIds(home);
      const newestCommon = second.claude
        .filter((id) => second.codex.includes(id))
        .sort()
        .at(-1);
      expect(newestCommon).toBeDefined();
      expectSuccess(await runCodex(home, [`--rollback=${newestCommon}`], "both"));
      await expectPathsExact(absent);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 240_000);

  test("rollback rejects a missing declared payload before changing live state", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-rollback-preflight-"));
    const codexHome = join(home, ".codex");
    try {
      expectSuccess(await runCodex(home));
      const backupsDir = join(codexHome, "backups", "cc-settings");
      const before = new Set(await readdir(backupsDir));
      expectSuccess(await runCodex(home));
      const backupName = (await readdir(backupsDir)).find((name) => !before.has(name));
      expect(backupName).toBeDefined();

      const sentinelPath = join(codexHome, ".cc-settings-version");
      const instructionsPath = join(codexHome, "AGENTS.md");
      const [sentinelBytes, instructionBytes] = await Promise.all([
        readFile(sentinelPath, "utf8"),
        readFile(instructionsPath, "utf8"),
      ]);
      await rm(join(backupsDir, backupName as string, "files", ".cc-settings-version"));

      const rollback = await runCodex(home, [`--rollback=${backupName}`]);
      expect(rollback.exitCode).not.toBe(0);
      expect(await readFile(sentinelPath, "utf8")).toBe(sentinelBytes);
      expect(await readFile(instructionsPath, "utf8")).toBe(instructionBytes);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  test("rollback rejects a full backup manifest with null plugin state before mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-null-full-plugin-backup-"));
    const codexHome = join(home, ".codex");
    try {
      const fake = await createStatefulCodex(home);
      const env = {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(fake.bin),
      };
      expectSuccess(await runCodex(home, [], "both", env));
      expectSuccess(await runCodex(home, ["--light"], "both", env));
      const backupsDir = join(codexHome, "backups", "cc-settings");
      const backupIds = (await readdir(backupsDir)).filter((name) =>
        /^\d{14}-\d{3}-\d+-\d+$/.test(name),
      );
      let backupId: string | undefined;
      for (const candidate of backupIds) {
        const candidateManifest = JSON.parse(
          await readFile(join(backupsDir, candidate, "manifest.json"), "utf8"),
        ) as Record<string, unknown>;
        if (
          candidateManifest.restoredProfile === "full" &&
          candidateManifest.pluginState !== null
        ) {
          backupId = candidate;
          break;
        }
      }
      expect(backupId).toBeDefined();
      const manifestPath = join(
        codexHome,
        "backups",
        "cc-settings",
        backupId as string,
        "manifest.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      expect(manifest.restoredProfile).toBe("full");
      expect(manifest.pluginState).not.toBeNull();
      manifest.pluginState = null;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const before = await snapshotPaths([
        join(codexHome, ".cc-settings-version"),
        join(codexHome, "AGENTS.md"),
        join(codexHome, "agents", "implementer.toml"),
        join(codexHome, "rules", "darkroom.rules"),
        fake.plugin,
        fake.marketplace,
      ]);
      await writeFile(fake.calls, "");

      const rollback = await runCodex(home, [`--rollback=${backupId}`], "codex", env);

      expect(rollback.exitCode).not.toBe(0);
      expect(`${rollback.stdout}\n${rollback.stderr}`).toMatch(/plugin state|pluginState|null/i);
      await expectPathsExact(before);
      const calls = await readFile(fake.calls, "utf8");
      expect(calls).not.toMatch(/plugin remove|marketplace remove/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test.each(["install", "rollback", "uninstall"] as const)(
    "%s rejects a symlinked Codex backups parent without touching its target",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-backups-link-${operation}-`));
      const codexHome = join(home, ".codex");
      const outside = join(home, "outside-backups");
      const outsideMarker = join(outside, "personal.txt");
      try {
        expectSuccess(await runCodex(home));
        await rm(join(codexHome, "backups"), { recursive: true, force: true });
        await mkdir(outside);
        await writeFile(outsideMarker, "outside exact bytes\n");
        await symlink(outside, join(codexHome, "backups"));
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          outsideMarker,
        ]);
        const args = operation === "install" ? [] : [`--${operation}`];

        const result = await runCodex(home, args);
        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
        expect(existsSync(join(outside, "cc-settings"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.each(["tmp", "darkroom"] as const)(
    "install rejects a symlinked Codex %s parent before outside or live mutation",
    async (parent) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-${parent}-link-`));
      const codexHome = join(home, ".codex");
      const outside = join(home, `outside-${parent}`);
      const outsideMarker = join(outside, "personal.txt");
      try {
        await Promise.all([mkdir(codexHome, { recursive: true }), mkdir(outside)]);
        await writeFile(outsideMarker, "outside exact bytes\n");
        await symlink(outside, join(codexHome, parent));

        const result = await runCodex(home);
        expect(result.exitCode).not.toBe(0);
        expect(await readFile(outsideMarker, "utf8")).toBe("outside exact bytes\n");
        expect((await readdir(outside)).sort()).toEqual(["personal.txt"]);
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.each(
    (["equal", "child", "parent", "symlink-equivalent"] as const).flatMap((overlap) =>
      (["codex", "both"] as const).map((target) => [overlap, target] as const),
    ),
  )(
    "CODEX_HOME/Claude root overlap %s rejects target %s before mutation",
    async (overlap, target) => {
      const home = await mkdtemp(join(tmpdir(), `cc-root-overlap-${overlap}-${target}-`));
      const claudeDir = join(home, ".claude");
      try {
        await mkdir(claudeDir);
        let codexHome: string;
        if (overlap === "equal") codexHome = claudeDir;
        else if (overlap === "child") codexHome = join(claudeDir, "codex-child");
        else if (overlap === "parent") codexHome = home;
        else {
          codexHome = join(home, "codex-link");
          await symlink(claudeDir, codexHome);
        }

        const result = await runCodex(home, [], target, { CODEX_HOME: codexHome });

        expect(result.exitCode).not.toBe(0);
        expect(await readdir(claudeDir)).toEqual([]);
        expect(existsSync(join(claudeDir, "settings.json"))).toBe(false);
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test("an unrelated custom Codex root remains valid", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-root-custom-valid-"));
    const codexHome = join(home, "custom-codex-home");
    try {
      expectSuccess(await runCodex(home, [], "codex", { CODEX_HOME: codexHome }));
      expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(true);
      expect(existsSync(join(home, ".claude"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test
    .skipIf(process.platform !== "darwin")
    .each(
      (["Library", "Library/LaunchAgents"] as const).flatMap((boundary) =>
        (["claude", "both"] as const).flatMap((target) =>
          (["install", "update", "rollback", "uninstall"] as const).map(
            (operation) => [boundary, target, operation] as const,
          ),
        ),
      ),
    )(
    "symlinked scheduler boundary %s rejects %s %s before product or outside mutation",
    async (boundary, target, operation) => {
      const home = await mkdtemp(join(tmpdir(), "cc-schedule-boundary-"));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const outside = join(home, "outside-launch-agents");
      const outsideMarker = join(outside, "personal.txt");
      try {
        if (operation !== "install") {
          expectSuccess(await runCodex(home, [], target));
          if (operation === "rollback") expectSuccess(await runCodex(home, [], target));
        }
        const tracked = await snapshotPaths([
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          join(claudeDir, "CLAUDE.md"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
        ]);
        await mkdir(outside);
        await writeFile(outsideMarker, "outside exact bytes\n");
        if (boundary === "Library") {
          await rm(join(home, "Library"), { recursive: true, force: true });
          await symlink(outside, join(home, "Library"));
        } else {
          await mkdir(join(home, "Library"), { recursive: true });
          await symlink(outside, join(home, "Library", "LaunchAgents"));
        }
        const bin = join(home, "bin");
        await mkdir(bin);
        await writeFile(
          join(bin, "launchctl"),
          '#!/bin/sh\ntouch "$HOME/.launchctl-was-called"\nexit 1\n',
        );
        await chmod(join(bin, "launchctl"), 0o755);
        const args =
          operation === "rollback"
            ? ["--rollback"]
            : operation === "uninstall"
              ? ["--uninstall"]
              : ["--auto-update=on"];

        const result = await runCodex(home, args, target, {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        });

        expect(result.exitCode).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/symlink|unsafe|boundary/i);
        await expectPathsExact(tracked);
        expect(await readFile(outsideMarker, "utf8")).toBe("outside exact bytes\n");
        expect(existsSync(join(home, ".launchctl-was-called"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test.each(["codex", "both"] as const)(
    "a missing CODEX_HOME below a symlinked ancestor rejects target %s before lock mutation",
    async (target) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-home-ancestor-${target}-`));
      const outside = join(home, "outside");
      const linkedParent = join(home, "linked-parent");
      const codexHome = join(linkedParent, "missing-codex-home");
      const outsideMarker = join(outside, "personal.txt");
      try {
        await mkdir(outside);
        await writeFile(outsideMarker, "outside exact bytes\n");
        await symlink(outside, linkedParent);

        const result = await runCodex(home, [], target, { CODEX_HOME: codexHome });

        expect(result.exitCode).not.toBe(0);
        expect(await readFile(outsideMarker, "utf8")).toBe("outside exact bytes\n");
        expect((await readdir(outside)).sort()).toEqual(["personal.txt"]);
        expect(existsSync(join(home, ".claude"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  async function expectUnsafeBackupDescendantRejected(
    operation: "install" | "rollback" | "uninstall",
    invalidKind: "symlink" | "wrong-type",
  ): Promise<void> {
    const home = await mkdtemp(join(tmpdir(), `cc-codex-backup-${operation}-${invalidKind}-`));
    const codexHome = join(home, ".codex");
    const backupsDir = join(codexHome, "backups", "cc-settings");
    try {
      expectSuccess(await runCodex(home));
      if (operation === "rollback") expectSuccess(await runCodex(home));
      const invalid = join(codexHome, "darkroom", "source", "src", "lib", `unsafe-${invalidKind}`);
      if (invalidKind === "symlink") {
        await symlink(join(home, "outside"), invalid);
      } else {
        const mkfifo = Bun.spawn(["mkfifo", invalid], { stdout: "pipe", stderr: "pipe" });
        const [exitCode, stderr] = await Promise.all([
          mkfifo.exited,
          new Response(mkfifo.stderr).text(),
        ]);
        expect(exitCode, stderr).toBe(0);
      }
      const before = await snapshotPaths([
        join(codexHome, ".cc-settings-version"),
        join(codexHome, "AGENTS.md"),
        join(codexHome, "agents", "implementer.toml"),
        join(codexHome, "rules", "darkroom.rules"),
      ]);
      const backupsBefore = (await readdir(backupsDir)).sort();
      const args = operation === "install" ? [] : [`--${operation}`];

      const result = await runCodex(home, args);
      expect(result.exitCode).not.toBe(0);
      await expectPathsExact(before);
      expect((await lstat(invalid)).isSymbolicLink()).toBe(invalidKind === "symlink");
      expect((await readdir(backupsDir)).sort()).toEqual(backupsBefore);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }

  test.each(["install", "rollback", "uninstall"] as const)(
    "%s fails closed when the live Codex backup source contains a symlink descendant",
    async (operation) => expectUnsafeBackupDescendantRejected(operation, "symlink"),
    240_000,
  );

  // Windows has no mkfifo command or POSIX FIFO file type. Keep the symlink
  // contract above active there and skip only these three named-pipe fixtures.
  test.skipIf(process.platform === "win32").each(["install", "rollback", "uninstall"] as const)(
    "%s fails closed for a FIFO descendant (Windows skipped: POSIX FIFOs are unavailable)",
    async (operation) => expectUnsafeBackupDescendantRejected(operation, "wrong-type"),
    240_000,
  );

  test("managed-source backups exclude node_modules links and regenerate dependencies", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-runtime-backup-filter-"));
    const codexHome = join(home, ".codex");
    try {
      expectSuccess(await runCodex(home));
      const managedSource = join(codexHome, "darkroom", "source");
      const typescriptBin = join(managedSource, "node_modules", "typescript", "bin");
      const binDir = join(managedSource, "node_modules", ".bin");
      await Promise.all([
        mkdir(typescriptBin, { recursive: true }),
        mkdir(binDir, { recursive: true }),
      ]);
      await writeFile(join(typescriptBin, "tsc"), "#!/bin/sh\nexit 0\n");
      await symlink("../typescript/bin/tsc", join(binDir, "tsc"));
      expectSuccess(await runCodex(home));
      expect(existsSync(join(managedSource, "node_modules"))).toBe(false);
      expectSuccess(await runCodex(home, ["--rollback"]));
      expect(existsSync(join(managedSource, "node_modules"))).toBe(false);
      expectSuccess(await runCodex(home, ["--uninstall"]));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 240_000);

  test("managed runtime source is an allowlist, not a repository clone", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-runtime-"));
    try {
      const source = await copySourceFixture(home);
      await Promise.all([
        writeFile(join(source, ".env.local"), "SECRET=nope\n"),
        writeFile(join(source, ".npmrc"), "//registry/:_authToken=nope\n"),
        writeFile(join(source, "PLAN.md"), "plan\n"),
        mkdir(join(source, ".venv"), { recursive: true }).then(() =>
          writeFile(join(source, ".venv", "secret"), "nope\n"),
        ),
        mkdir(join(source, ".tldr"), { recursive: true }).then(() =>
          writeFile(join(source, ".tldr", "index"), "nope\n"),
        ),
        mkdir(join(source, "src", "lib", ".tldr"), { recursive: true }).then(() =>
          writeFile(join(source, "src", "lib", ".tldr", "status"), "nope\n"),
        ),
        writeFile(join(source, "src", "lib", ".env.local"), "SECRET=nope\n"),
        writeFile(join(source, "src", "lib", ".npmrc"), "registry=nope\n"),
        writeFile(join(source, "src", "lib", "secret.pem"), "nope\n"),
        writeFile(join(source, "src", "lib", "cache.tsbuildinfo"), "nope\n"),
        writeFile(join(source, "src", "lib", "user-created.ts"), "export const secret = true\n"),
        writeFile(
          join(source, "src", "scripts", "user-created.ts"),
          "export const secret = true\n",
        ),
        writeFile(join(source, "skills", "fix", "user-note.txt"), "private note\n"),
        writeFile(join(source, "hooks", "user-created.json"), "{}\n"),
        mkdir(join(source, "skills", "x", "tmp"), { recursive: true }).then(() =>
          writeFile(join(source, "skills", "x", "tmp", "junk"), "nope\n"),
        ),
      ]);

      expectSuccess(await runCodex(home, [], "codex", {}, source));
      const installed = join(home, ".codex", "darkroom", "source");
      for (const excluded of [
        ".env.local",
        ".npmrc",
        ".venv",
        ".tldr",
        "PLAN.md",
        "docs",
        ".git",
      ]) {
        expect(existsSync(join(installed, excluded)), `${excluded} must not be copied`).toBe(false);
      }
      for (const required of [".codex-plugin", ".mcp.json", "hooks", "skills", "src"] as const) {
        expect(existsSync(join(installed, required)), `${required} must be copied`).toBe(true);
      }
      for (const excluded of [
        "src/lib/.tldr/status",
        "src/lib/.env.local",
        "src/lib/.npmrc",
        "src/lib/secret.pem",
        "src/lib/cache.tsbuildinfo",
        "src/lib/user-created.ts",
        "src/scripts/user-created.ts",
        "skills/fix/user-note.txt",
        "hooks/user-created.json",
        "skills/x/tmp/junk",
      ]) {
        expect(existsSync(join(installed, excluded)), `${excluded} must not be copied`).toBe(false);
      }
      for (const required of [
        ".claude-plugin/marketplace.json",
        ".codex-plugin/plugin.json",
        ".mcp.json",
        "hooks/hooks.json",
        "skills/fix/SKILL.md",
        "src/lib/codex-install.ts",
        "src/scripts/codex-hook.ts",
        "package.json",
        "bun.lock",
        "tsconfig.json",
      ]) {
        expect(existsSync(join(installed, required)), `${required} must be packaged`).toBe(true);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  test.each(
    [
      "AGENTS.md",
      "codex/AGENTS.append.md",
      "codex/rules/darkroom.rules",
      "agents/implementer.md",
      ".codex-plugin/plugin.json",
      ".mcp.json",
      "hooks/hooks.json",
    ].flatMap((artifact) => [
      [artifact, "codex"],
      [artifact, "both"],
    ]) as Array<[string, "codex" | "both"]>,
  )(
    "a symlinked selected source artifact %s aborts target %s before mutation",
    async (artifact, target) => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-source-link-"));
      try {
        const source = await copySourceFixture(home);
        const outside = join(home, "outside-source-target");
        await writeFile(outside, "outside exact bytes\n");
        await unlink(join(source, artifact));
        await symlink(outside, join(source, artifact));

        const result = await runCodex(home, [], target, {}, source);
        expect(result.exitCode).not.toBe(0);
        expect(existsSync(join(home, ".claude"))).toBe(false);
        expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
        expect(await readFile(outside, "utf8")).toBe("outside exact bytes\n");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test.each(
    (["unexpected-file", "nested-file", "symlink", "missing-expected"] as const).flatMap(
      (mutation) => (["codex", "both"] as const).map((target) => [mutation, target] as const),
    ),
  )(
    "source agents boundary rejects %s for target %s before product mutation",
    async (mutation, target) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-agent-source-${mutation}-${target}-`));
      try {
        const source = await copySourceFixture(home);
        const agents = join(source, "agents");
        if (mutation === "unexpected-file") {
          await writeFile(join(agents, "foo.md"), "---\nname: foo\n---\n");
        } else if (mutation === "nested-file") {
          await mkdir(join(agents, "nested"));
          await writeFile(join(agents, "nested", "foo.md"), "nested\n");
        } else if (mutation === "symlink") {
          await symlink(join(source, "AGENTS.md"), join(agents, "foo.md"));
        } else {
          await rm(join(agents, "implementer.md"));
        }

        const result = await runCodex(home, [], target, {}, source);

        expect(result.exitCode).not.toBe(0);
        expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(home, ".claude"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test("unsafe agent names in sentinels and backup manifests fail before mutation", async () => {
    const sentinelHome = await mkdtemp(join(tmpdir(), "cc-codex-bad-sentinel-"));
    const backupHome = await mkdtemp(join(tmpdir(), "cc-codex-bad-backup-"));
    try {
      const sentinelPath = join(sentinelHome, ".codex", ".cc-settings-version");
      await mkdir(dirname(sentinelPath), { recursive: true });
      const sentinelBytes = `${JSON.stringify({
        version: "1.0.0",
        installed_at: new Date(0).toISOString(),
        profile: "full",
        repo_path: REPO,
        managed_agents: ["../escape"],
      })}\n`;
      await writeFile(sentinelPath, sentinelBytes);
      const sentinelResult = await runCodex(sentinelHome);
      expect(sentinelResult.exitCode).not.toBe(0);
      expect(await readFile(sentinelPath, "utf8")).toBe(sentinelBytes);
      expect(existsSync(join(sentinelHome, ".claude"))).toBe(false);

      const backup = join(backupHome, ".codex", "backups", "cc-settings", "bad");
      await mkdir(backup, { recursive: true });
      const marker = join(backupHome, ".codex", "AGENTS.md");
      await writeFile(marker, "keep\n");
      await writeFile(
        join(backup, "manifest.json"),
        `${JSON.stringify({
          createdAt: new Date(0).toISOString(),
          present: [],
          previousManagedAgents: ["../escape"],
          nextManagedAgents: [],
        })}\n`,
      );
      const rollback = await runCodex(backupHome, ["--rollback=bad"]);
      expect(rollback.exitCode).not.toBe(0);
      expect(await readFile(marker, "utf8")).toBe("keep\n");
    } finally {
      await Promise.all([
        rm(sentinelHome, { recursive: true, force: true }),
        rm(backupHome, { recursive: true, force: true }),
      ]);
    }
  }, 120_000);

  test.each(["light", "rollback", "uninstall"] as const)(
    "%s rejects a sentinel that claims a correctly hashed personal Codex agent",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-personal-sentinel-${operation}-`));
      const codexHome = join(home, ".codex");
      try {
        expectSuccess(await runCodex(home));
        if (operation === "rollback") expectSuccess(await runCodex(home));
        const personal = join(codexHome, "agents", "personal.toml");
        const personalBytes = 'name = "personal"\n';
        await writeFile(personal, personalBytes);
        const sentinelPath = join(codexHome, ".cc-settings-version");
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
          managed_agents: string[];
          managed_agent_hashes: Record<string, string>;
        };
        sentinel.managed_agents.push("personal");
        sentinel.managed_agent_hashes.personal = new Bun.CryptoHasher("sha256")
          .update(personalBytes)
          .digest("hex");
        const sentinelBytes = `${JSON.stringify(sentinel, null, 2)}\n`;
        await writeFile(sentinelPath, sentinelBytes);
        const before = await snapshotPaths([
          sentinelPath,
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          personal,
        ]);
        const args = operation === "light" ? ["--light"] : [`--${operation}`];

        const result = await runCodex(home, args);
        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.each(
    (["install", "light", "rollback", "uninstall"] as const).flatMap((operation) =>
      (["runtime-file", "unexpected-source-file", "managed-instructions"] as const).map(
        (mutation) => [operation, mutation] as const,
      ),
    ),
  )(
    "%s rejects modified Codex-owned %s before any mutation",
    async (operation, mutation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-owned-${operation}-${mutation}-`));
      const codexHome = join(home, ".codex");
      try {
        expectSuccess(await runCodex(home));
        if (operation === "rollback") expectSuccess(await runCodex(home));
        if (mutation === "runtime-file") {
          const runtime = join(codexHome, "darkroom", "source", "package.json");
          await writeFile(runtime, `${await readFile(runtime, "utf8")}\n`);
        } else if (mutation === "unexpected-source-file") {
          await writeFile(
            join(codexHome, "darkroom", "source", "user-created.txt"),
            "user bytes\n",
          );
        } else {
          const instructions = join(codexHome, "AGENTS.md");
          await writeFile(
            instructions,
            (await readFile(instructions, "utf8")).replace(
              "Use the native custom agents",
              "User changed the managed block. Use the native custom agents",
            ),
          );
        }
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
          join(codexHome, "darkroom", "source", "package.json"),
          join(codexHome, "darkroom", "source", "user-created.txt"),
        ]);
        const args =
          operation === "install" ? [] : operation === "light" ? ["--light"] : [`--${operation}`];

        const result = await runCodex(home, args);

        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test.each(["managed_source_hashes", "managed_instructions_hash"] as const)(
    "legacy full sentinel missing %s fails closed before lifecycle mutation",
    async (field) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-legacy-${field}-`));
      const codexHome = join(home, ".codex");
      try {
        expectSuccess(await runCodex(home));
        const sentinelPath = join(codexHome, ".cc-settings-version");
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as Record<
          string,
          unknown
        >;
        delete sentinel[field];
        await writeFile(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`);
        const before = await snapshotPaths([
          sentinelPath,
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
        ]);

        const result = await runCodex(home, ["--uninstall"]);

        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test("an older full Codex agent subset upgrades safely and uninstall removes only its claims", async () => {
    const upgradeHome = await mkdtemp(join(tmpdir(), "cc-codex-agent-upgrade-"));
    const uninstallHome = await mkdtemp(join(tmpdir(), "cc-codex-agent-subset-uninstall-"));
    try {
      for (const [home, operation] of [
        [upgradeHome, "upgrade"],
        [uninstallHome, "uninstall"],
      ] as const) {
        expectSuccess(await runCodex(home));
        const codexHome = join(home, ".codex");
        const sentinelPath = join(codexHome, ".cc-settings-version");
        const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as {
          managed_agents: string[];
          managed_agent_hashes: Record<string, string>;
        };
        const omitted = sentinel.managed_agents.at(-1) as string;
        sentinel.managed_agents = sentinel.managed_agents.filter((name) => name !== omitted);
        delete sentinel.managed_agent_hashes[omitted];
        await writeFile(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`);
        const omittedPath = join(codexHome, "agents", `${omitted}.toml`);
        if (operation === "upgrade") {
          await rm(omittedPath);
          expectSuccess(await runCodex(home));
          expect(await managedAgentNames(codexHome)).toContain(omitted);
          expect(existsSync(omittedPath)).toBe(true);
        } else {
          const omittedBytes = await readFile(omittedPath, "utf8");
          expectSuccess(await runCodex(home, ["--uninstall"]));
          expect(await readFile(omittedPath, "utf8")).toBe(omittedBytes);
          expect(existsSync(join(codexHome, "agents", "implementer.toml"))).toBe(false);
        }
      }
    } finally {
      await Promise.all([
        rm(upgradeHome, { recursive: true, force: true }),
        rm(uninstallHome, { recursive: true, force: true }),
      ]);
    }
  }, 240_000);

  test.each(["previousManagedAgents", "nextManagedAgents"] as const)(
    "rollback rejects a backup whose %s claims a personal agent payload",
    async (manifestField) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-personal-backup-${manifestField}-`));
      const codexHome = join(home, ".codex");
      try {
        expectSuccess(await runCodex(home));
        const beforeBackups = new Set(await readdir(join(codexHome, "backups", "cc-settings")));
        expectSuccess(await runCodex(home));
        const backupId = (await readdir(join(codexHome, "backups", "cc-settings"))).find(
          (name) => !beforeBackups.has(name),
        );
        expect(backupId).toBeDefined();
        const personal = join(codexHome, "agents", "personal.toml");
        await writeFile(personal, 'name = "personal"\n');
        const backup = join(codexHome, "backups", "cc-settings", backupId as string);
        const manifestPath = join(backup, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
          string,
          unknown
        >;
        const names = manifest[manifestField] as string[];
        names.push("personal");
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        const payload = join(backup, "files", "agents", "personal.toml");
        await mkdir(dirname(payload), { recursive: true });
        await writeFile(payload, 'name = "personal"\n');
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          personal,
        ]);

        const result = await runCodex(home, [`--rollback=${backupId}`]);
        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.each([
    "previous-set-differs-from-sentinel",
    "sentinel-omitted-with-agent-payload",
    "sentinel-present-with-empty-previous-set",
    "declared-agent-payload-missing",
    "orphan-agent-payload",
  ] as const)(
    "rollback rejects internally inconsistent Codex backup ownership: %s",
    async (tamper) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-backup-cross-check-${tamper}-`));
      const codexHome = join(home, ".codex");
      try {
        expectSuccess(await runCodex(home));
        const beforeIds = new Set(await readdir(join(codexHome, "backups", "cc-settings")));
        expectSuccess(await runCodex(home));
        const backupId = (await readdir(join(codexHome, "backups", "cc-settings"))).find(
          (name) => !beforeIds.has(name),
        );
        expect(backupId).toBeDefined();
        const backup = join(codexHome, "backups", "cc-settings", backupId as string);
        const manifestPath = join(backup, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          present: string[];
          previousManagedAgents: string[];
        };
        const managedName = manifest.previousManagedAgents[0];
        expect(managedName).toBeDefined();
        const agentRelative = join("agents", `${managedName}.toml`);
        if (tamper === "previous-set-differs-from-sentinel") {
          manifest.previousManagedAgents = manifest.previousManagedAgents.slice(1);
        } else if (tamper === "sentinel-omitted-with-agent-payload") {
          manifest.present = manifest.present.filter((path) => path !== ".cc-settings-version");
        } else if (tamper === "sentinel-present-with-empty-previous-set") {
          manifest.previousManagedAgents = [];
        } else if (tamper === "declared-agent-payload-missing") {
          await rm(join(backup, "files", agentRelative));
        } else {
          const orphan = join(backup, "files", "agents", "personal.toml");
          await writeFile(orphan, 'name = "personal"\n');
        }
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        const personal = join(codexHome, "agents", "personal.toml");
        await writeFile(personal, 'name = "personal-live"\n');
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
          personal,
        ]);

        const result = await runCodex(home, [`--rollback=${backupId}`]);

        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test.each(["light", "uninstall"] as const)(
    "modified owned native files make %s fail before either file changes",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-user-replaced-"));
      const agent = join(home, ".codex", "agents", "implementer.toml");
      const rule = join(home, ".codex", "rules", "darkroom.rules");
      const agentBytes = 'name = "user-implementer"\n';
      const ruleBytes = "# user replacement\n";
      try {
        expectSuccess(await runCodex(home));
        await writeFile(agent, agentBytes);
        await writeFile(rule, ruleBytes);
        const personal = join(home, ".codex", "agents", "personal.toml");
        await writeFile(personal, 'name = "personal"\n');
        const before = await snapshotPaths([
          join(home, ".codex", ".cc-settings-version"),
          join(home, ".codex", "AGENTS.md"),
          agent,
          rule,
          personal,
        ]);

        const result = await runCodex(home, operation === "light" ? ["--light"] : ["--uninstall"]);

        expect(result.exitCode).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/modified|hash|owned/i);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test("fresh light lifecycle preserves independent full-only agent and rule destinations", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-light-independent-full-only-"));
    const agent = join(home, ".codex", "agents", "implementer.toml");
    const rule = join(home, ".codex", "rules", "darkroom.rules");
    try {
      await Promise.all([
        mkdir(dirname(agent), { recursive: true }),
        mkdir(dirname(rule), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(agent, 'name = "independent implementer"\n'),
        writeFile(rule, "# independent darkroom rule\n"),
      ]);
      for (const args of [["--light"], ["--light"], ["--uninstall"]]) {
        expectSuccess(await runCodex(home, args));
        expect(await readFile(agent, "utf8")).toBe('name = "independent implementer"\n');
        expect(await readFile(rule, "utf8")).toBe("# independent darkroom rule\n");
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  test.each([
    ["agents/implementer.toml", 'name = "user-replaced-implementer"\n'],
    ["rules/darkroom.rules", "# user-replaced rule\n"],
  ] as const)(
    "full reinstall refuses a modified managed destination %s before changing any Codex state",
    async (relativePath, replacement) => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-modified-reinstall-"));
      const codexHome = join(home, ".codex");
      try {
        expectSuccess(await runCodex(home));
        const changed = join(codexHome, relativePath);
        await writeFile(changed, replacement);
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
        ]);

        const result = await runCodex(home);

        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
        expect(await readFile(changed, "utf8")).toBe(replacement);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.each(["light", "uninstall"] as const)(
    "%s fails and restores state when Codex rejects the plugin removal command",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-remove-command-${operation}-`));
      const codexHome = join(home, ".codex");
      const bin = join(home, "bin");
      try {
        expectSuccess(await runCodex(home));
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
        ]);
        await mkdir(bin);
        const fakeCodex = join(bin, "codex");
        await writeFile(
          fakeCodex,
          '#!/bin/sh\nsource="$CODEX_HOME/darkroom/source"\ncase "$2:$3" in\n  list:*) printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  marketplace:list) printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  remove:*|marketplace:remove) echo "unrecognized subcommand" >&2; exit 1;;\nesac\nexit 0\n',
        );
        await chmod(fakeCodex, 0o755);

        const args = operation === "light" ? ["--light"] : ["--uninstall"];
        const result = await runCodex(home, args, "codex", {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(bin),
        });
        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test("uninstall removes an empty managed darkroom root but preserves unrelated content", async () => {
    const emptyHome = await mkdtemp(join(tmpdir(), "cc-codex-empty-root-"));
    const userHome = await mkdtemp(join(tmpdir(), "cc-codex-user-root-"));
    try {
      expectSuccess(await runCodex(emptyHome));
      expectSuccess(await runCodex(emptyHome, ["--uninstall"]));
      expect(existsSync(join(emptyHome, ".codex", "darkroom"))).toBe(false);

      expectSuccess(await runCodex(userHome));
      const personal = join(userHome, ".codex", "darkroom", "personal.txt");
      await writeFile(personal, "personal exact bytes\n");
      expectSuccess(await runCodex(userHome, ["--uninstall"]));
      expect(await readFile(personal, "utf8")).toBe("personal exact bytes\n");
      expect(existsSync(join(userHome, ".codex", "darkroom"))).toBe(true);
    } finally {
      await Promise.all([
        rm(emptyHome, { recursive: true, force: true }),
        rm(userHome, { recursive: true, force: true }),
      ]);
    }
  }, 180_000);

  test("the static runtime manifest closes every transitive relative TypeScript import", async () => {
    const installerSource = await readFile(join(REPO, "src", "lib", "codex-install.ts"), "utf8");
    const manifestBody = installerSource.match(
      /const RUNTIME_SOURCE_FILES = \[([\s\S]*?)\] as const;/,
    )?.[1];
    expect(manifestBody).toBeDefined();
    const manifest = new Set(
      [...(manifestBody as string).matchAll(/"([^"]+)"/g)].map((match) => match[1] as string),
    );
    const entrypointText = `${await readFile(join(REPO, "hooks", "hooks.json"), "utf8")}\n${await readFile(join(REPO, "package.json"), "utf8")}`;
    const pending = [
      "src/scripts/codex-hook.ts",
      ...new Set(entrypointText.match(/src\/[a-z0-9_./-]+\.ts/g) ?? []),
    ];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const current = pending.pop() as string;
      if (visited.has(current)) continue;
      visited.add(current);
      expect(manifest.has(current), `runtime entrypoint/import omitted: ${current}`).toBe(true);
      const source = await readFile(join(REPO, current), "utf8");
      const imports = [...source.matchAll(/(?:from\s+|import\()\s*["'](\.[^"']+)["']\)?/g)].map(
        (match) => match[1] as string,
      );
      for (const specifier of imports) {
        const unresolved = resolve(REPO, dirname(current), specifier);
        const candidates = [unresolved, `${unresolved}.ts`, join(unresolved, "index.ts")];
        const dependency = candidates.find((candidate) => existsSync(candidate));
        if (!dependency || !dependency.endsWith(".ts")) continue;
        pending.push(relative(REPO, dependency).replaceAll("\\", "/"));
      }
    }

    expect(manifest).toContain("src/lib/claude-managed-files.ts");
    for (const required of [
      ".claude-plugin/marketplace.json",
      ".codex-plugin/plugin.json",
      ".mcp.json",
      "hooks/hooks.json",
      "package.json",
      "bun.lock",
    ]) {
      expect(manifest).toContain(required);
    }
  });

  test("missing Codex sentinel makes uninstall a no-op and install collisions fail closed", async () => {
    const uninstallHome = await mkdtemp(join(tmpdir(), "cc-codex-no-sentinel-uninstall-"));
    const installHome = await mkdtemp(join(tmpdir(), "cc-codex-no-sentinel-install-"));
    const seed = async (home: string): Promise<ReturnType<typeof createStatefulCodex>> => {
      const codexHome = join(home, ".codex");
      const fake = await createStatefulCodex(home);
      await Promise.all([
        mkdir(join(codexHome, "agents"), { recursive: true }),
        mkdir(join(codexHome, "rules"), { recursive: true }),
        mkdir(join(codexHome, "darkroom", "source"), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          join(codexHome, "AGENTS.md"),
          `user before\n${START}\nunowned lookalike\n${END}\nuser after\n`,
        ),
        writeFile(join(codexHome, "agents", "implementer.toml"), 'name = "personal"\n'),
        writeFile(join(codexHome, "rules", "darkroom.rules"), "# personal rule\n"),
        writeFile(join(codexHome, "darkroom", "source", "personal.txt"), "personal source\n"),
        writeFile(fake.plugin, `${join(home, "independent-plugin-source")}\n`),
        writeFile(fake.marketplace, `${join(home, "independent-marketplace-root")}\n`),
      ]);
      return fake;
    };
    try {
      for (const [home, operation] of [
        [uninstallHome, "uninstall"],
        [installHome, "install"],
      ] as const) {
        const fake = await seed(home);
        const codexHome = join(home, ".codex");
        const before = await snapshotPaths([
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
          join(codexHome, "darkroom", "source", "personal.txt"),
          fake.plugin,
          fake.marketplace,
        ]);
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(fake.bin),
        };
        const result = await runCodex(
          home,
          operation === "uninstall" ? ["--uninstall"] : [],
          "codex",
          env,
        );
        if (operation === "uninstall") expectSuccess(result);
        else expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
      }
    } finally {
      await Promise.all([
        rm(uninstallHome, { recursive: true, force: true }),
        rm(installHome, { recursive: true, force: true }),
      ]);
    }
  }, 240_000);

  test("a both-target Codex plugin failure preserves Claude and self-restores Codex", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-both-codex-failure-"));
    const claudeDir = join(home, ".claude");
    const codexHome = join(home, ".codex");
    const bin = join(home, "bin");
    try {
      await Promise.all([mkdir(codexHome, { recursive: true }), mkdir(bin, { recursive: true })]);
      expectSuccess(await runCodex(home, [], "claude"));
      const personal = join(claudeDir, "agents", "personal.md");
      await writeFile(personal, "personal\n");
      const claudeFiles = await snapshotPaths([
        join(claudeDir, "settings.json"),
        join(claudeDir, ".cc-settings-version"),
        join(claudeDir, "AGENTS.md"),
        join(claudeDir, "agents", "implementer.md"),
        join(home, ".claude.json"),
        personal,
      ]);
      await writeFile(join(codexHome, "AGENTS.md"), "codex before\n");
      const fakeCodex = join(bin, "codex");
      await writeFile(
        fakeCodex,
        '#!/bin/sh\ncase "$2:$3" in\n  list:*) printf \'{"installed":[]}\\n\'; exit 0;;\n  marketplace:list) printf \'{"marketplaces":[]}\\n\'; exit 0;;\n  marketplace:add) touch "$HOME/.marketplace-added-before-failure"; exit 0;;\n  add:*) touch "$HOME/.plugin-add-attempted"; echo plugin failure >&2; exit 1;;\nesac\nexit 0\n',
      );
      await chmod(fakeCodex, 0o755);

      const result = await runCodex(home, [], "both", {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(bin),
      });
      expect(result.exitCode).not.toBe(0);
      expect(existsSync(join(home, ".marketplace-added-before-failure"))).toBe(true);
      expect(existsSync(join(home, ".plugin-add-attempted"))).toBe(true);
      await expectPathsExact(claudeFiles);
      expect(await readFile(join(codexHome, "AGENTS.md"), "utf8")).toBe("codex before\n");
      for (const path of [
        ".cc-settings-version",
        "agents/implementer.toml",
        "rules/darkroom.rules",
        "darkroom/source",
      ]) {
        expect(existsSync(join(codexHome, path)), path).toBe(false);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);

  test("a fresh full install removes newly added plugin state after a post-plugin write failure", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-first-install-compensation-"));
    const codexHome = join(home, ".codex");
    const bin = join(home, "bin");
    const calls = join(home, ".fake-codex-first-install-calls");
    const plugin = join(home, ".fake-plugin-installed");
    const marketplace = join(home, ".fake-marketplace-installed");
    try {
      await mkdir(bin);
      const fakeCodex = join(bin, "codex");
      await writeFile(
        fakeCodex,
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-codex-first-install-calls"\nplugin="$HOME/.fake-plugin-installed"\nmarket="$HOME/.fake-marketplace-installed"\nsource="$CODEX_HOME/darkroom/source"\ncase "$2:$3" in\n  list:*) if [ -e "$plugin" ]; then printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; else printf \'{"installed":[]}\\n\'; fi; exit 0;;\n  marketplace:list) if [ -e "$market" ]; then printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; else printf \'{"marketplaces":[]}\\n\'; fi; exit 0;;\n  marketplace:add) touch "$market"; exit 0;;\n  add:*) touch "$plugin"; mkdir "$CODEX_HOME/.cc-settings-version"; exit 0;;\n  marketplace:remove) rm -f "$market"; exit 0;;\n  remove:*) rm -f "$plugin"; exit 0;;\nesac\nexit 0\n',
      );
      await chmod(fakeCodex, 0o755);

      const result = await runCodex(home, [], "codex", {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(bin),
      });

      expect(result.exitCode).not.toBe(0);
      const commandLog = await readFile(calls, "utf8");
      expect(commandLog).toContain("plugin marketplace add");
      expect(commandLog).toContain("plugin add darkroom@cc-settings");
      expect(commandLog).toContain("plugin remove darkroom@cc-settings");
      expect(commandLog).toContain("plugin marketplace remove cc-settings");
      expect(existsSync(plugin)).toBe(false);
      expect(existsSync(marketplace)).toBe(false);
      for (const path of [
        ".cc-settings-version",
        "AGENTS.md",
        "agents/implementer.toml",
        "rules/darkroom.rules",
        "darkroom/source",
      ]) {
        expect(existsSync(join(codexHome, path)), path).toBe(false);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a full install fails closed when successful plugin commands do not change observed state", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-plugin-no-state-change-"));
    const codexHome = join(home, ".codex");
    const bin = join(home, "bin");
    const calls = join(home, ".fake-codex-no-state-calls");
    try {
      await mkdir(bin);
      const fakeCodex = join(bin, "codex");
      await writeFile(
        fakeCodex,
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-codex-no-state-calls"\ncase "$2:$3" in\n  list:*) printf \'{"installed":[]}\\n\'; exit 0;;\n  marketplace:list) printf \'{"marketplaces":[]}\\n\'; exit 0;;\n  marketplace:add|marketplace:remove|add:*|remove:*) exit 0;;\nesac\nexit 0\n',
      );
      await chmod(fakeCodex, 0o755);

      const install = await runCodex(home, [], "codex", {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(bin),
      });

      expect(install.exitCode).not.toBe(0);
      expect(`${install.stdout}\n${install.stderr}`).toMatch(/plugin|marketplace|installed|state/i);
      const commandLog = await readFile(calls, "utf8");
      expect(commandLog).toContain("plugin marketplace add");
      expect(commandLog).toContain("plugin add darkroom@cc-settings");
      expect(commandLog).toContain("plugin remove darkroom@cc-settings");
      expect(commandLog).toContain("plugin marketplace remove cc-settings");
      for (const path of [
        ".cc-settings-version",
        "AGENTS.md",
        "agents/implementer.toml",
        "rules/darkroom.rules",
        "darkroom/source",
      ]) {
        expect(existsSync(join(codexHome, path)), path).toBe(false);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test.each(["AGENTS.md", "config.toml"] as const)(
    "a late Codex install failure preserves a concurrent user edit to %s",
    async (targetName) => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-global-toctou-"));
      const codexHome = join(home, ".codex");
      const bin = join(home, "bin");
      const target = join(codexHome, targetName);
      const marker = join(home, ".codex-global-edit-fired");
      const concurrentBytes = `concurrent ${targetName} bytes\n`;
      try {
        await Promise.all([mkdir(codexHome), mkdir(bin)]);
        await Promise.all([
          writeFile(join(codexHome, "AGENTS.md"), "original user agents bytes\n"),
          writeFile(join(codexHome, "config.toml"), "original = true\n"),
        ]);
        const other = join(codexHome, targetName === "AGENTS.md" ? "config.toml" : "AGENTS.md");
        const otherBytes = await readFile(other);
        const fakeCodex = join(bin, "codex");
        await writeFile(
          fakeCodex,
          `#!/bin/sh
case "$2:$3" in
  list:*) printf '{"installed":[]}\\n'; exit 0;;
  marketplace:list) printf '{"marketplaces":[]}\\n'; exit 0;;
  marketplace:add) touch "$HOME/.fake-marketplace-installed"; exit 0;;
  add:*) printf '${concurrentBytes}' > "$CODEX_HOME/${targetName}"; touch "$HOME/.codex-global-edit-fired"; echo plugin failure >&2; exit 1;;
  marketplace:remove) rm -f "$HOME/.fake-marketplace-installed"; exit 0;;
  remove:*) exit 0;;
esac
exit 0
`,
        );
        await chmod(fakeCodex, 0o755);

        const install = await runCodex(home, [], "codex", {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(bin),
        });

        expect(install.exitCode).not.toBe(0);
        expect(existsSync(marker)).toBe(true);
        expect(await readFile(target, "utf8")).toBe(concurrentBytes);
        expect(await readFile(other)).toEqual(otherBytes);
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(codexHome, "darkroom", "source"))).toBe(false);
        expect(existsSync(join(home, ".fake-marketplace-installed"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test("Codex compensation preserves both global files when plugin add succeeds before a later write failure", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-global-post-add-failure-"));
    const codexHome = join(home, ".codex");
    const bin = join(home, "bin");
    const agents = join(codexHome, "AGENTS.md");
    const config = join(codexHome, "config.toml");
    const concurrentAgents = "concurrent agents after plugin add\n";
    const concurrentConfig = "concurrent_after_add = true\n";
    try {
      await Promise.all([mkdir(codexHome), mkdir(bin)]);
      await Promise.all([
        writeFile(agents, "original agents\n"),
        writeFile(config, "original = true\n"),
      ]);
      const fakeCodex = join(bin, "codex");
      await writeFile(
        fakeCodex,
        `#!/bin/sh
plugin="$HOME/.fake-plugin-installed"
market="$HOME/.fake-marketplace-installed"
source="$CODEX_HOME/darkroom/source"
printf '%s\n' "$*" >> "$HOME/.fake-codex-post-add-calls"
case "$2:$3" in
  list:*) [ -e "$plugin" ] && printf '{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\n' "$source" "$source" || printf '{"installed":[]}\n'; exit 0;;
  marketplace:list) [ -e "$market" ] && printf '{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\n' "$source" "$source" || printf '{"marketplaces":[]}\n'; exit 0;;
  marketplace:add) printf '%s\n' "$source" > "$market"; exit 0;;
  add:*) printf '${concurrentAgents}' > "$CODEX_HOME/AGENTS.md"; printf '${concurrentConfig}' > "$CODEX_HOME/config.toml"; touch "$plugin" "$HOME/.codex-post-add-edit-fired"; mkdir "$CODEX_HOME/.cc-settings-version"; exit 0;;
  remove:*) rm -f "$plugin"; exit 0;;
  marketplace:remove) rm -f "$market"; exit 0;;
esac
exit 0
`,
      );
      await chmod(fakeCodex, 0o755);

      const install = await runCodex(home, [], "codex", {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(bin),
      });

      expect(install.exitCode).not.toBe(0);
      expect(existsSync(join(home, ".codex-post-add-edit-fired"))).toBe(true);
      expect(await readFile(agents, "utf8")).toBe(concurrentAgents);
      expect(await readFile(config, "utf8")).toBe(concurrentConfig);
      expect(existsSync(join(home, ".fake-plugin-installed"))).toBe(false);
      expect(existsSync(join(home, ".fake-marketplace-installed"))).toBe(false);
      expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
      expect(await readFile(join(home, ".fake-codex-post-add-calls"), "utf8")).toMatch(
        /plugin add darkroom@cc-settings/,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test("combined install preserves concurrent Claude settings edited by a successful Codex step", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-both-claude-settings-toctou-"));
    const claudeDir = join(home, ".claude");
    const codexHome = join(home, ".codex");
    try {
      const fake = await createStatefulCodex(home);
      const env = {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(fake.bin),
      };
      expectSuccess(await runCodex(home, [], "both", env));
      const canonicalSource = await realpath(join(codexHome, "darkroom", "source"));
      await Promise.all([
        writeFile(fake.plugin, `${canonicalSource}\n`),
        writeFile(fake.marketplace, `${canonicalSource}\n`),
      ]);
      const settings = join(claudeDir, "settings.json");
      const globalConfig = join(home, ".claude.json");
      const concurrentSettings = '{"concurrent":true}\n';
      const concurrentGlobal = '{"concurrentGlobal":true}\n';
      const before = await snapshotPaths([
        join(claudeDir, ".cc-settings-version"),
        join(claudeDir, "AGENTS.md"),
        join(claudeDir, "agents", "implementer.md"),
        join(codexHome, ".cc-settings-version"),
        join(codexHome, "AGENTS.md"),
        join(codexHome, "agents", "implementer.toml"),
        fake.plugin,
        fake.marketplace,
      ]);
      const fakeCodex = join(fake.bin, "codex");
      await writeFile(
        fakeCodex,
        `#!/bin/sh
source="$CODEX_HOME/darkroom/source"
plugin="$HOME/.fake-plugin-installed"
market="$HOME/.fake-marketplace-installed"
case "$2:$3" in
  list:*) [ -e "$plugin" ] && printf '{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\n' "$(cat "$plugin")" "$(cat "$plugin")" || printf '{"installed":[]}\n'; exit 0;;
  marketplace:list) [ -e "$market" ] && printf '{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\n' "$(cat "$market")" "$(cat "$market")" || printf '{"marketplaces":[]}\n'; exit 0;;
  remove:*) printf '${concurrentSettings}' > "$HOME/.claude/settings.json"; printf '${concurrentGlobal}' > "$HOME/.claude.json"; rm -f "$HOME/.claude/.cc-settings-version"; mkdir "$HOME/.claude/.cc-settings-version"; touch "$HOME/.codex-edited-claude-settings"; rm -f "$plugin"; exit 0;;
  add:*) realpath "$source" > "$plugin"; exit 0;;
esac
exit 0
`,
      );
      await chmod(fakeCodex, 0o755);

      const result = await runCodex(home, ["--light"], "both", env);

      expect(result.exitCode).not.toBe(0);
      expect(existsSync(join(home, ".codex-edited-claude-settings"))).toBe(true);
      expect(await readFile(settings, "utf8")).toBe(concurrentSettings);
      expect(await readFile(globalConfig, "utf8")).toBe(concurrentGlobal);
      await expectPathsExact(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test.each(["install", "rollback", "uninstall"] as const)(
    "combined %s preserves valid Claude JSON edits when Codex fails before Claude starts",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-both-codex-early-${operation}-`));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      try {
        const fake = await createStatefulCodex(home);
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(fake.bin),
        };
        let args: string[];
        let failingAction: "add" | "remove";
        if (operation === "install") {
          expectSuccess(await runCodex(home, ["--light"], "both", env));
          args = [];
          failingAction = "add";
        } else if (operation === "uninstall") {
          expectSuccess(await runCodex(home, [], "both", env));
          args = ["--uninstall"];
          failingAction = "remove";
        } else {
          expectSuccess(await runCodex(home, [], "both", env));
          const beforeLight = await sharedBackupIds(home);
          expectSuccess(await runCodex(home, ["--light"], "both", env));
          const afterLight = await sharedBackupIds(home);
          const selected = afterLight.claude.find(
            (id) => afterLight.codex.includes(id) && !beforeLight.claude.includes(id),
          );
          expect(selected).toBeDefined();
          args = [`--rollback=${selected}`];
          failingAction = "add";
        }
        if (existsSync(join(codexHome, "darkroom", "source"))) {
          const canonicalSource = await realpath(join(codexHome, "darkroom", "source"));
          if (existsSync(fake.plugin)) await writeFile(fake.plugin, `${canonicalSource}\n`);
          if (existsSync(fake.marketplace))
            await writeFile(fake.marketplace, `${canonicalSource}\n`);
        }
        const concurrentSettings = `{"external":"${operation}-settings"}\n`;
        const concurrentGlobal = `{"external":"${operation}-global"}\n`;
        const settings = join(claudeDir, "settings.json");
        const globalConfig = join(home, ".claude.json");
        const before = await snapshotPaths([
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "AGENTS.md"),
          join(claudeDir, "agents", "implementer.md"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
          fake.plugin,
          fake.marketplace,
        ]);
        const executable = join(fake.bin, "codex");
        await writeFile(
          executable,
          `#!/bin/sh
plugin="$HOME/.fake-plugin-installed"
market="$HOME/.fake-marketplace-installed"
source="$CODEX_HOME/darkroom/source"
case "$2:$3" in
  list:*) [ -e "$plugin" ] && printf '{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\n' "$(cat "$plugin")" "$(cat "$plugin")" || printf '{"installed":[]}\n'; exit 0;;
  marketplace:list) [ -e "$market" ] && printf '{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\n' "$(cat "$market")" "$(cat "$market")" || printf '{"marketplaces":[]}\n'; exit 0;;
  marketplace:add) realpath "$source" > "$market"; exit 0;;
  marketplace:remove) rm -f "$market"; exit 0;;
  add:*) if [ "${failingAction}" = add ] && [ ! -e "$HOME/.codex-early-failure-fired" ]; then printf '${concurrentSettings}' > "$HOME/.claude/settings.json"; printf '${concurrentGlobal}' > "$HOME/.claude.json"; realpath "$source" > "$plugin"; touch "$HOME/.codex-early-failure-fired"; echo plugin add failure >&2; exit 1; fi; realpath "$source" > "$plugin"; exit 0;;
  remove:*) if [ "${failingAction}" = remove ] && [ ! -e "$HOME/.codex-early-failure-fired" ]; then printf '${concurrentSettings}' > "$HOME/.claude/settings.json"; printf '${concurrentGlobal}' > "$HOME/.claude.json"; rm -f "$plugin"; touch "$HOME/.codex-early-failure-fired"; echo plugin remove failure >&2; exit 1; fi; rm -f "$plugin"; exit 0;;
esac
exit 0
`,
        );
        await chmod(executable, 0o755);

        const failed = await runCodex(home, args, "both", env);

        expect(failed.exitCode).not.toBe(0);
        expect(existsSync(join(home, ".codex-early-failure-fired"))).toBe(true);
        expect(await readFile(settings, "utf8")).toBe(concurrentSettings);
        expect(await readFile(globalConfig, "utf8")).toBe(concurrentGlobal);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test("a Claude install failure compensates a successful Codex mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-both-claude-failure-"));
    const claudeDir = join(home, ".claude");
    const codexHome = join(home, ".codex");
    const bin = join(home, "bin");
    try {
      expectSuccess(await runCodex(home, [], "both"));
      const personal = join(claudeDir, "agents", "personal.md");
      await writeFile(personal, "personal exact bytes\n");
      const before = await snapshotPaths([
        join(claudeDir, ".cc-settings-version"),
        join(claudeDir, "settings.json"),
        join(claudeDir, "AGENTS.md"),
        join(claudeDir, "agents", "implementer.md"),
        join(claudeDir, "skills", "fix", "SKILL.md"),
        join(claudeDir, "src", "setup.ts"),
        join(home, ".claude.json"),
        personal,
        join(codexHome, ".cc-settings-version"),
        join(codexHome, "AGENTS.md"),
        join(codexHome, "agents", "implementer.toml"),
        join(codexHome, "rules", "darkroom.rules"),
      ]);
      await mkdir(bin);
      const fakeCodex = join(bin, "codex");
      await writeFile(
        fakeCodex,
        '#!/bin/sh\nsource="$CODEX_HOME/darkroom/source"\ncase "$2:$3" in\n  list:*) printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  marketplace:list) printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  add:*) printf \'{bad\' > "$HOME/.claude.json"; if [ -e "$HOME/.codex-mutated-before-claude-failure" ]; then touch "$HOME/.codex-restore-failed"; echo restore failure >&2; exit 1; fi; touch "$HOME/.codex-mutated-before-claude-failure"; exit 0;;\nesac\nexit 0\n',
      );
      await chmod(fakeCodex, 0o755);

      const failed = await runCodex(home, [], "both", {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(bin),
      });
      expect(failed.exitCode).not.toBe(0);
      expect(existsSync(join(home, ".codex-mutated-before-claude-failure"))).toBe(true);
      expect(existsSync(join(home, ".codex-restore-failed"))).toBe(true);
      await expectPathsExact(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test.each(["install", "uninstall"] as const)(
    "combined %s revalidates Claude ownership after Codex mutation",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-both-${operation}-claude-toctou-`));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      try {
        const fake = await createStatefulCodex(home);
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(fake.bin),
        };
        expectSuccess(await runCodex(home, [], "both", env));
        const canonicalPluginSource = await realpath(join(codexHome, "darkroom", "source"));
        await Promise.all([
          writeFile(fake.plugin, `${canonicalPluginSource}\n`),
          writeFile(fake.marketplace, `${canonicalPluginSource}\n`),
        ]);
        const concurrentFile = join(claudeDir, "agents", "implementer.md");
        const concurrentBytes = `concurrent Claude edit during Codex ${operation}\n`;
        const marker = join(home, `.codex-mutated-claude-${operation}`);
        const before = await snapshotPaths([
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          join(claudeDir, "AGENTS.md"),
          join(claudeDir, "skills", "fix", "SKILL.md"),
          join(claudeDir, "src", "setup.ts"),
          join(home, ".claude.json"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
          fake.plugin,
          fake.disabled,
          fake.marketplace,
        ]);
        const executable = join(fake.bin, "codex");
        const originalScript = await readFile(executable, "utf8");
        const needle =
          operation === "install"
            ? '  add:*) if [ -e "$market" ]; then'
            : '  remove:*) rm -f "$plugin" "$disabled"; exit 0;;';
        const replacement =
          operation === "install"
            ? `  add:*) printf '${concurrentBytes}' > "$HOME/.claude/agents/implementer.md"; touch "$HOME/.codex-mutated-claude-install"; if [ -e "$market" ]; then`
            : `  remove:*) printf '${concurrentBytes}' > "$HOME/.claude/agents/implementer.md"; touch "$HOME/.codex-mutated-claude-uninstall"; rm -f "$plugin" "$disabled"; exit 0;;`;
        expect(originalScript).toContain(needle);
        await writeFile(executable, originalScript.replace(needle, replacement));
        await chmod(executable, 0o755);
        await writeFile(fake.calls, "");

        const result = await runCodex(
          home,
          operation === "uninstall" ? ["--uninstall"] : [],
          "both",
          env,
        );

        expect(result.exitCode).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/changed|modified|ownership/i);
        expect(existsSync(marker)).toBe(true);
        expect(await readFile(concurrentFile, "utf8")).toBe(concurrentBytes);
        await expectPathsExact(before);
        const calls = await readFile(fake.calls, "utf8");
        expect(calls).toMatch(operation === "install" ? /plugin add/ : /plugin remove/);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test("combined rollback revalidates Claude after Codex mutation and compensates Codex", async () => {
    const preflightHome = await mkdtemp(join(tmpdir(), "cc-both-rollback-preflight-"));
    const runtimeHome = await mkdtemp(join(tmpdir(), "cc-both-rollback-runtime-"));
    try {
      expectSuccess(await runCodex(preflightHome));
      const preflightCodex = join(preflightHome, ".codex");
      const preflightSentinel = await readFile(
        join(preflightCodex, ".cc-settings-version"),
        "utf8",
      );
      const rejected = await runCodex(preflightHome, ["--rollback"], "both");
      expect(rejected.exitCode).not.toBe(0);
      expect(await readFile(join(preflightCodex, ".cc-settings-version"), "utf8")).toBe(
        preflightSentinel,
      );

      const fake = await createStatefulCodex(runtimeHome);
      const env = {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(fake.bin),
      };
      expectSuccess(await runCodex(runtimeHome, [], "both", env));
      const beforeLight = await sharedBackupIds(runtimeHome);
      expectSuccess(await runCodex(runtimeHome, ["--light"], "both", env));
      const afterLight = await sharedBackupIds(runtimeHome);
      const backupId = afterLight.claude.find(
        (id) => afterLight.codex.includes(id) && !beforeLight.claude.includes(id),
      );
      expect(backupId).toBeDefined();
      const runtimeClaude = join(runtimeHome, ".claude");
      const runtimeCodex = join(runtimeHome, ".codex");
      const externallyEdited = join(runtimeClaude, "src", "setup.ts");
      const externalBytes = "external edit after rollback preparation\n";
      const before = await snapshotPaths([
        join(runtimeClaude, ".cc-settings-version"),
        join(runtimeClaude, "settings.json"),
        join(runtimeClaude, "AGENTS.md"),
        join(runtimeHome, ".claude.json"),
        join(runtimeCodex, ".cc-settings-version"),
        join(runtimeCodex, "AGENTS.md"),
        fake.plugin,
        fake.marketplace,
      ]);
      await writeFile(
        join(fake.bin, "codex"),
        '#!/bin/sh\nplugin="$HOME/.fake-plugin-installed"\nmarket="$HOME/.fake-marketplace-installed"\nsource="$CODEX_HOME/darkroom/source"\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-codex-calls"\ncase "$2:$3" in\n  list:*) if [ -e "$plugin" ]; then p=$(cat "$plugin"); printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$p" "$p"; else printf \'{"installed":[]}\\n\'; fi; exit 0;;\n  marketplace:list) if [ -e "$market" ]; then m=$(cat "$market"); printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$m" "$m"; else printf \'{"marketplaces":[]}\\n\'; fi; exit 0;;\n  marketplace:add) printf \'%s\\n\' "$source" > "$market"; if [ ! -e "$HOME/.rollback-mutated-codex" ]; then printf \'external edit after rollback preparation\\n\' > "$HOME/.claude/src/setup.ts"; touch "$HOME/.rollback-mutated-codex"; fi; exit 0;;\n  marketplace:remove) rm -f "$market"; exit 0;;\n  add:*) printf \'%s\\n\' "$source" > "$plugin"; exit 0;;\n  remove:*) rm -f "$plugin"; exit 0;;\nesac\nexit 0\n',
      );
      await chmod(join(fake.bin, "codex"), 0o755);
      await writeFile(fake.calls, "");
      const failed = await runCodex(runtimeHome, [`--rollback=${backupId}`], "both", env);
      const calls = await readFile(fake.calls, "utf8");
      expect(
        failed.exitCode,
        `${failed.stdout}\n${failed.stderr}\nCodex calls:\n${calls}`,
      ).not.toBe(0);
      expect(`${failed.stdout}\n${failed.stderr}`).toMatch(/modified managed content|changed/i);
      expect(existsSync(join(runtimeHome, ".rollback-mutated-codex"))).toBe(true);
      expect(calls).toContain("plugin marketplace add");
      expect(calls).toContain("plugin add darkroom@cc-settings");
      expect(calls).toContain("plugin remove darkroom@cc-settings");
      expect(await readFile(externallyEdited, "utf8")).toBe(externalBytes);
      await expectPathsExact(before);
    } finally {
      await Promise.all([
        rm(preflightHome, { recursive: true, force: true }),
        rm(runtimeHome, { recursive: true, force: true }),
      ]);
    }
  }, 240_000);

  test("both-target rollback retains and restores an explicitly selected oldest backup", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-both-oldest-backup-"));
    const claudeDir = join(home, ".claude");
    const codexHome = join(home, ".codex");
    try {
      expectSuccess(await runCodex(home, [], "both"));
      const claudeJsonPath = join(home, ".claude.json");
      const selectedClaudeJson = JSON.parse(await readFile(claudeJsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      selectedClaudeJson.userGeneration = "selected";
      await writeFile(claudeJsonPath, `${JSON.stringify(selectedClaudeJson, null, 2)}\n`);
      await writeFile(
        join(codexHome, "AGENTS.md"),
        `${await readFile(join(codexHome, "AGENTS.md"), "utf8")}selected Codex instructions\n`,
      );
      const selectedState = await snapshotPaths([
        join(claudeDir, ".cc-settings-version"),
        join(claudeDir, "settings.json"),
        join(claudeDir, "AGENTS.md"),
        join(claudeDir, "agents", "implementer.md"),
        join(claudeDir, "src", "setup.ts"),
        claudeJsonPath,
        join(codexHome, ".cc-settings-version"),
        join(codexHome, "AGENTS.md"),
        join(codexHome, "agents", "implementer.toml"),
        join(codexHome, "rules", "darkroom.rules"),
      ]);

      const fake = await createStatefulCodex(home);
      const beforeCrossedUpdate = await sharedBackupIds(home);
      expectSuccess(
        await runCodex(home, [], "both", {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(fake.bin),
          FAKE_CROSS_SECOND: "1",
        }),
      );
      const startSecond = Number(await readFile(join(home, ".codex-start-second"), "utf8"));
      const endSecond = Number(await readFile(join(home, ".codex-end-second"), "utf8"));
      expect(endSecond - startSecond).toBeGreaterThanOrEqual(1);

      const firstClaudeBackups = (await readdir(join(claudeDir, "backups"))).filter((name) =>
        /^backup-.*\.tar\.gz$/.test(name),
      );
      expect(firstClaudeBackups).toHaveLength(2);
      const afterCrossedUpdate = await sharedBackupIds(home);
      const selectedBackupId = afterCrossedUpdate.claude.find(
        (id) => afterCrossedUpdate.codex.includes(id) && !beforeCrossedUpdate.claude.includes(id),
      );
      expect(selectedBackupId).toBeDefined();
      const selectedBackup = `backup-${selectedBackupId}.tar.gz`;
      expect(selectedBackupId).toMatch(/^\d{14}-\d{3}-\d+-\d+$/);
      expect(
        existsSync(join(codexHome, "backups", "cc-settings", selectedBackupId as string)),
      ).toBe(true);

      for (let index = 0; index < 4; index++) {
        await Bun.sleep(1_100);
        expectSuccess(await runCodex(home, [], "both"));
        const laterClaudeJson = JSON.parse(await readFile(claudeJsonPath, "utf8")) as Record<
          string,
          unknown
        >;
        laterClaudeJson.userGeneration = `later-${index}`;
        await writeFile(claudeJsonPath, `${JSON.stringify(laterClaudeJson, null, 2)}\n`);
        await writeFile(
          join(codexHome, "AGENTS.md"),
          `${await readFile(join(codexHome, "AGENTS.md"), "utf8")}later Codex state ${index}\n`,
        );
      }

      const backupsDir = join(claudeDir, "backups");
      const beforeRollback = (await readdir(backupsDir))
        .filter((name) => /^backup-.*\.tar\.gz$/.test(name))
        .sort();
      expect(beforeRollback).toHaveLength(5);
      expect(beforeRollback).toContain(selectedBackup);

      const oldestRollback = await runCodex(home, [`--rollback=${selectedBackupId}`], "both");
      if (oldestRollback.exitCode !== 0) {
        const calls = await readFile(fake.calls, "utf8").catch(() => "<no Codex calls>\n");
        const plugin = await readFile(fake.plugin, "utf8").catch(() => "<absent>\n");
        const marketplace = await readFile(fake.marketplace, "utf8").catch(() => "<absent>\n");
        throw new Error(
          `${oldestRollback.stderr}\nCodex calls:\n${calls}plugin=${plugin}marketplace=${marketplace}`,
        );
      }
      await expectPathsExact(selectedState);
      const afterRollback = (await readdir(backupsDir)).filter((name) =>
        /^backup-.*\.tar\.gz$/.test(name),
      );
      expect(afterRollback).toHaveLength(5);
      expect(afterRollback).toContain(selectedBackup);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 300_000);

  test.each(["codex", "claude"] as const)(
    "combined rollback ignores a newer %s-only orphan and requires an exact paired ID",
    async (orphanTarget) => {
      const home = await mkdtemp(join(tmpdir(), `cc-both-${orphanTarget}-orphan-`));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const claudeJson = join(home, ".claude.json");
      const tracked = [
        join(claudeDir, ".cc-settings-version"),
        join(claudeDir, "settings.json"),
        claudeJson,
        join(codexHome, ".cc-settings-version"),
        join(codexHome, "AGENTS.md"),
        join(codexHome, "agents", "implementer.toml"),
      ];
      try {
        expectSuccess(await runCodex(home, [], "both"));
        const selectedClaudeJson = JSON.parse(await readFile(claudeJson, "utf8")) as Record<
          string,
          unknown
        >;
        selectedClaudeJson.pairedGeneration = "selected";
        await writeFile(claudeJson, `${JSON.stringify(selectedClaudeJson, null, 2)}\n`);
        await writeFile(
          join(codexHome, "AGENTS.md"),
          `${await readFile(join(codexHome, "AGENTS.md"), "utf8")}selected pair\n`,
        );
        const selected = await snapshotPaths(tracked);
        const beforeSelectedBackup = await sharedBackupIds(home);
        expectSuccess(await runCodex(home, [], "both"));
        const paired = await sharedBackupIds(home);
        const common = paired.claude.filter(
          (id) => paired.codex.includes(id) && !beforeSelectedBackup.claude.includes(id),
        );
        expect(common).toHaveLength(1);

        const laterClaudeJson = JSON.parse(await readFile(claudeJson, "utf8")) as Record<
          string,
          unknown
        >;
        laterClaudeJson.pairedGeneration = "later";
        await writeFile(claudeJson, `${JSON.stringify(laterClaudeJson, null, 2)}\n`);
        await writeFile(
          join(codexHome, "AGENTS.md"),
          `${await readFile(join(codexHome, "AGENTS.md"), "utf8")}later orphan\n`,
        );
        const orphanId = "99999999999999-999-999999-999";
        const pairedId = common[0] as string;
        if (orphanTarget === "codex") {
          await cp(
            join(codexHome, "backups", "cc-settings", pairedId),
            join(codexHome, "backups", "cc-settings", orphanId),
            { recursive: true },
          );
        } else {
          const backupsDir = join(claudeDir, "backups");
          const pairedArchive = join(backupsDir, `backup-${pairedId}.tar.gz`);
          const orphanArchive = join(backupsDir, `backup-${orphanId}.tar.gz`);
          await Promise.all([
            cp(pairedArchive, orphanArchive),
            cp(`${pairedArchive}.schedule.json`, `${orphanArchive}.schedule.json`),
            cp(`${pairedArchive}.state.json`, `${orphanArchive}.state.json`),
          ]);
        }

        const withOrphan = await sharedBackupIds(home);
        expect(withOrphan[orphanTarget]).toContain(orphanId);
        const beforeExplicitFailure = await snapshotPaths(tracked);
        const explicit = await runCodex(home, [`--rollback=${orphanId}`], "both");
        expect(explicit.exitCode).not.toBe(0);
        await expectPathsExact(beforeExplicitFailure);

        expectSuccess(await runCodex(home, ["--rollback"], "both"));
        await expectPathsExact(selected);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test("combined rollback accepts one timestamp match and rejects zero or ambiguous matches", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-both-substring-selection-"));
    const claudeDir = join(home, ".claude");
    const codexHome = join(home, ".codex");
    const claudeJson = join(home, ".claude.json");
    const tracked = [
      join(claudeDir, ".cc-settings-version"),
      claudeJson,
      join(codexHome, ".cc-settings-version"),
      join(codexHome, "AGENTS.md"),
    ];
    try {
      expectSuccess(await runCodex(home, [], "both"));
      const selectedJson = JSON.parse(await readFile(claudeJson, "utf8")) as Record<
        string,
        unknown
      >;
      selectedJson.substringGeneration = "selected";
      await writeFile(claudeJson, `${JSON.stringify(selectedJson, null, 2)}\n`);
      const selected = await snapshotPaths(tracked);
      const beforeSelectedBackup = await sharedBackupIds(home);
      await Bun.sleep(1_100);
      expectSuccess(await runCodex(home, [], "both"));
      const ids = await sharedBackupIds(home);
      const common = ids.claude.filter(
        (id) => ids.codex.includes(id) && !beforeSelectedBackup.claude.includes(id),
      );
      expect(common).toHaveLength(1);
      const pairedId = common[0] as string;
      const timestamp = pairedId.slice(0, 14);

      const laterJson = JSON.parse(await readFile(claudeJson, "utf8")) as Record<string, unknown>;
      laterJson.substringGeneration = "later";
      await writeFile(claudeJson, `${JSON.stringify(laterJson, null, 2)}\n`);
      const beforeMissing = await snapshotPaths(tracked);
      const missing = await runCodex(home, ["--rollback=00000000000000"], "both");
      expect(missing.exitCode).not.toBe(0);
      await expectPathsExact(beforeMissing);

      expectSuccess(await runCodex(home, [`--rollback=${timestamp}`], "both"));
      await expectPathsExact(selected);

      const ambiguousId = `${pairedId.slice(0, pairedId.lastIndexOf("-") + 1)}999999`;
      const backupsDir = join(claudeDir, "backups");
      const pairedArchive = join(backupsDir, `backup-${pairedId}.tar.gz`);
      const ambiguousArchive = join(backupsDir, `backup-${ambiguousId}.tar.gz`);
      await Promise.all([
        cp(pairedArchive, ambiguousArchive),
        cp(`${pairedArchive}.schedule.json`, `${ambiguousArchive}.schedule.json`),
        cp(`${pairedArchive}.state.json`, `${ambiguousArchive}.state.json`),
        cp(
          join(codexHome, "backups", "cc-settings", pairedId),
          join(codexHome, "backups", "cc-settings", ambiguousId),
          { recursive: true },
        ),
      ]);
      const ambiguousPairs = await sharedBackupIds(home);
      const timestampMatches = ambiguousPairs.claude.filter(
        (id) => ambiguousPairs.codex.includes(id) && id.startsWith(timestamp),
      );
      expect(timestampMatches).toHaveLength(2);
      const beforeAmbiguous = await snapshotPaths(tracked);
      const ambiguous = await runCodex(home, [`--rollback=${timestamp}`], "both");
      expect(ambiguous.exitCode).not.toBe(0);
      expect(`${ambiguous.stdout}\n${ambiguous.stderr}`).toMatch(/ambiguous|longer|full id/i);
      await expectPathsExact(beforeAmbiguous);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 300_000);

  test("a Claude uninstall runtime failure compensates the completed Codex uninstall", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-both-uninstall-runtime-"));
    const claudeDir = join(home, ".claude");
    const codexHome = join(home, ".codex");
    const bin = join(home, "bin");
    try {
      expectSuccess(await runCodex(home, [], "both"));
      const personal = join(claudeDir, "agents", "personal.md");
      await writeFile(personal, "personal exact bytes\n");
      const before = await snapshotPaths([
        join(claudeDir, ".cc-settings-version"),
        join(claudeDir, "settings.json"),
        join(claudeDir, "AGENTS.md"),
        join(claudeDir, "agents", "implementer.md"),
        join(claudeDir, "skills", "fix", "SKILL.md"),
        join(claudeDir, "src", "setup.ts"),
        join(home, ".claude.json"),
        personal,
        join(codexHome, ".cc-settings-version"),
        join(codexHome, "AGENTS.md"),
        join(codexHome, "agents", "implementer.toml"),
        join(codexHome, "rules", "darkroom.rules"),
      ]);
      await mkdir(bin);
      const fakeCodex = join(bin, "codex");
      await writeFile(
        fakeCodex,
        '#!/bin/sh\nsource="$CODEX_HOME/darkroom/source"\ncase "$2:$3" in\n  list:*) printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  marketplace:list) printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  remove:*) printf \'{bad\' > "$HOME/.claude.json"; touch "$HOME/.codex-mutated-before-uninstall-failure"; exit 0;;\n  add:*) printf \'{bad\' > "$HOME/.claude.json"; touch "$HOME/.uninstall-codex-restore-failed"; echo restore failure >&2; exit 1;;\nesac\nexit 0\n',
      );
      await chmod(fakeCodex, 0o755);

      const failed = await runCodex(home, ["--uninstall"], "both", {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(bin),
      });
      expect(failed.exitCode).not.toBe(0);
      expect(existsSync(join(home, ".codex-mutated-before-uninstall-failure"))).toBe(true);
      expect(existsSync(join(home, ".uninstall-codex-restore-failed"))).toBe(true);
      await expectPathsExact(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test.skipIf(process.platform !== "darwin")(
    "install failure after scheduler mutation restores both products and prior unloaded state",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-schedule-install-"));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const bin = join(home, "bin");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        expectSuccess(await runCodex(home, [], "both"));
        const before = await snapshotPaths([
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          join(claudeDir, "AGENTS.md"),
          join(claudeDir, "agents", "implementer.md"),
          join(home, ".claude.json"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          plist,
          loaded,
        ]);
        await mkdir(bin);
        const launchctl = join(bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\ncase "$1" in\n  print) if [ -e "$HOME/.fake-launchctl-loaded" ]; then exit 0; fi; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap)\n    touch "$HOME/.fake-launchctl-loaded"\n    if [ "$FAKE_MUTATE_SENTINEL" = "1" ] && [ ! -e "$HOME/.schedule-mutated-once" ]; then\n      rm -f "$HOME/.claude/.cc-settings-version"\n      mkdir "$HOME/.claude/.cc-settings-version"\n      touch "$HOME/.schedule-mutated-once"\n    fi\n    exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const scheduleEnv = {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        };

        const failed = await runCodex(home, ["--auto-update=on"], "both", {
          ...scheduleEnv,
          FAKE_MUTATE_SENTINEL: "1",
        });
        expect(failed.exitCode).not.toBe(0);
        await expectPathsExact(before);

        expectSuccess(await runCodex(home, ["--auto-update=on"], "both", scheduleEnv));
        expect(existsSync(plist)).toBe(true);
        expect(existsSync(loaded)).toBe(true);
        expect(
          JSON.parse(await readFile(join(claudeDir, ".cc-settings-version"), "utf8")).auto_update,
        ).toBe(true);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test.skipIf(process.platform !== "darwin")(
    "uninstall failure after scheduler mutation restores loaded state before successful removal",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-schedule-uninstall-"));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const bin = join(home, "bin");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        await mkdir(bin);
        const launchctl = join(bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\ncase "$1" in\n  print) if [ -e "$HOME/.fake-launchctl-loaded" ]; then exit 0; fi; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const scheduleEnv = {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        };
        expectSuccess(await runCodex(home, ["--auto-update=on"], "both", scheduleEnv));
        expect(existsSync(plist)).toBe(true);
        expect(existsSync(loaded)).toBe(true);
        const before = await snapshotPaths([
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          join(claudeDir, "AGENTS.md"),
          join(claudeDir, "agents", "implementer.md"),
          join(home, ".claude.json"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          plist,
          loaded,
        ]);
        const codex = join(bin, "codex");
        await writeFile(
          codex,
          '#!/bin/sh\nsource="$CODEX_HOME/darkroom/source"\ncase "$2:$3" in\n  list:*) printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  marketplace:list) printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  remove:*) if [ ! -e "$HOME/.uninstall-mutated-once" ]; then rm -f "$HOME/.claude/.cc-settings-version"; mkdir "$HOME/.claude/.cc-settings-version"; touch "$HOME/.uninstall-mutated-once"; fi; exit 0;;\nesac\nexit 0\n',
        );
        await chmod(codex, 0o755);

        const failed = await runCodex(home, ["--uninstall"], "both", {
          ...scheduleEnv,
          CC_SKIP_CODEX_CLI: "0",
        });
        expect(failed.exitCode).not.toBe(0);
        expect(existsSync(join(home, ".uninstall-mutated-once"))).toBe(true);
        await expectPathsExact(before);

        expectSuccess(await runCodex(home, ["--uninstall"], "both", scheduleEnv));
        expect(existsSync(plist)).toBe(false);
        expect(existsSync(loaded)).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test.skipIf(process.platform !== "darwin")(
    "combined rollback restores the selected auto-update plist and loaded state",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-schedule-rollback-"));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const bin = join(home, "bin");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        await mkdir(bin);
        const launchctl = join(bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\ncase "$1" in\n  print) if [ -e "$HOME/.fake-launchctl-loaded" ]; then exit 0; fi; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const scheduleEnv = {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        };

        expectSuccess(await runCodex(home, ["--auto-update=on"], "both", scheduleEnv));
        const selected = await snapshotPaths([
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          plist,
          loaded,
        ]);
        const selectedPlistMode = (await stat(plist)).mode & 0o777;

        expectSuccess(await runCodex(home, ["--auto-update=off"], "both", scheduleEnv));
        expect(existsSync(plist)).toBe(false);
        expect(existsSync(loaded)).toBe(false);
        expect(
          JSON.parse(await readFile(join(claudeDir, ".cc-settings-version"), "utf8")).auto_update,
        ).toBe(false);

        const paired = await sharedBackupIds(home);
        const common = paired.claude.filter((id) => paired.codex.includes(id));
        expect(common.length).toBeGreaterThanOrEqual(2);
        const backupId = common.at(-1);
        expect(backupId).toMatch(/^\d{14}-\d{3}-\d+-\d+$/);

        expectSuccess(await runCodex(home, [`--rollback=${backupId}`], "both", scheduleEnv));
        await expectPathsExact(selected);
        expect((await stat(plist)).mode & 0o777).toBe(selectedPlistMode);
        expect(
          JSON.parse(await readFile(join(claudeDir, ".cc-settings-version"), "utf8")).auto_update,
        ).toBe(true);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test.skipIf(process.platform !== "darwin").each(["auto-update-off", "uninstall"] as const)(
    "%s compensates both products when launchctl bootout fails and the job stays loaded",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-both-schedule-bootout-${operation}-`));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const bin = join(home, "bin");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        await mkdir(bin);
        const launchctl = join(bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) if [ -e "$HOME/.fake-launchctl-loaded" ]; then exit 0; fi; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) if [ -e "$HOME/.fail-bootout" ]; then echo permission denied >&2; exit 1; fi; rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const scheduleEnv = {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        };
        expectSuccess(await runCodex(home, ["--auto-update=on"], "both", scheduleEnv));
        const plistMode = (await stat(plist)).mode & 0o777;
        const tracked = [
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          join(claudeDir, "AGENTS.md"),
          join(home, ".claude.json"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          plist,
          loaded,
        ];
        const before = await snapshotPaths(tracked);
        const args = operation === "uninstall" ? ["--uninstall"] : ["--auto-update=off"];
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) [ -e "$HOME/.fake-launchctl-loaded" ] && exit 0; exit 113;;\n  bootout) echo permission denied >&2; exit 1;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);

        const failed = await runCodex(home, args, "both", scheduleEnv);

        const launchctlCalls = await readFile(join(home, ".fake-launchctl-calls"), "utf8");
        expect(
          failed.exitCode,
          `${failed.stdout}\n${failed.stderr}\nlaunchctl calls:\n${launchctlCalls}`,
        ).not.toBe(0);
        expect(`${failed.stdout}\n${failed.stderr}`).toMatch(
          /bootout|auto-update|schedule|launchctl|compensation.*incomplete/i,
        );
        await expectPathsExact(before);
        expect((await stat(plist)).mode & 0o777).toBe(plistMode);
        expect(
          JSON.parse(await readFile(join(claudeDir, ".cc-settings-version"), "utf8")).auto_update,
        ).toBe(true);
        expect(launchctlCalls).toContain("bootout");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test.skipIf(process.platform !== "darwin")(
    "install refresh compensates exactly when scheduler bootout is denied despite a usable bootstrap",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-schedule-refresh-bootout-"));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        const fake = await createStatefulCodex(home);
        const launchctl = join(fake.bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) [ -e "$HOME/.fake-launchctl-loaded" ] && exit 0; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(fake.bin),
        };
        expectSuccess(await runCodex(home, ["--auto-update=on"], "both", env));
        const canonicalSource = await realpath(join(codexHome, "darkroom", "source"));
        await Promise.all([
          writeFile(fake.plugin, `${canonicalSource}\n`),
          writeFile(fake.marketplace, `${canonicalSource}\n`),
        ]);
        const tracked = [
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          join(claudeDir, "AGENTS.md"),
          join(home, ".claude.json"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          fake.plugin,
          fake.marketplace,
          plist,
          loaded,
        ];
        const before = await snapshotPaths(tracked);
        const plistMode = (await stat(plist)).mode & 0o777;
        await writeFile(join(home, ".fake-launchctl-calls"), "");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) [ -e "$HOME/.fake-launchctl-loaded" ] && exit 0; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) touch "$HOME/.bootout-denied-marker"; echo permission denied >&2; exit 1;;\n  bootstrap) touch "$HOME/.bootstrap-would-succeed" "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);

        const failed = await runCodex(home, ["--auto-update=on"], "both", env);

        expect(failed.exitCode).not.toBe(0);
        expect(existsSync(join(home, ".bootout-denied-marker"))).toBe(true);
        expect(existsSync(join(home, ".bootstrap-would-succeed"))).toBe(false);
        const calls = await readFile(join(home, ".fake-launchctl-calls"), "utf8");
        expect(calls).toContain("bootout");
        expect(calls).not.toContain("bootstrap");
        await expectPathsExact(before);
        expect((await stat(plist)).mode & 0o777).toBe(plistMode);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test.skipIf(process.platform !== "darwin")(
    "rollback compensates both products after Claude writes but scheduler enrollment fails",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-rollback-late-schedule-"));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      const observed = join(home, ".claude-write-observed-before-schedule-failure");
      const concurrentSettings = '{"schedulerExternal":true}\n';
      const concurrentGlobal = '{"schedulerGlobalExternal":true}\n';
      try {
        const fake = await createStatefulCodex(home);
        const launchctl = join(fake.bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) if [ -e "$HOME/.fake-launchctl-loaded" ]; then exit 0; fi; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(fake.bin),
        };
        expectSuccess(await runCodex(home, ["--auto-update=on"], "both", env));
        const beforeLight = await sharedBackupIds(home);
        expectSuccess(await runCodex(home, ["--light", "--auto-update=off"], "both", env));
        const afterLight = await sharedBackupIds(home);
        let selectedId: string | undefined;
        for (const id of afterLight.claude.filter(
          (candidate) =>
            afterLight.codex.includes(candidate) && !beforeLight.claude.includes(candidate),
        )) {
          const manifest = JSON.parse(
            await readFile(join(codexHome, "backups", "cc-settings", id, "manifest.json"), "utf8"),
          ) as { restoredProfile?: string; pluginState?: { restoreMode?: string } | null };
          if (
            manifest.restoredProfile === "full" &&
            manifest.pluginState?.restoreMode !== "independent-preserve-only"
          ) {
            selectedId = id;
            break;
          }
        }
        expect(selectedId).toBeDefined();
        expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(false);
        expect(existsSync(plist)).toBe(false);
        expect(existsSync(loaded)).toBe(false);
        const tracked = [
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "CLAUDE.md"),
          join(claudeDir, "agents", "implementer.md"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          fake.plugin,
          fake.disabled,
          fake.marketplace,
          plist,
          loaded,
        ];
        const beforeRollback = await snapshotPaths(tracked);
        await writeFile(
          launchctl,
          `#!/bin/sh
printf '%s\n' "$*" >> "$HOME/.fake-launchctl-calls"
case "$1" in
  print) [ -e "$HOME/.fake-launchctl-loaded" ] && exit 0; printf 'Bad request.\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\n' "$(id -u)" >&2; exit 113;;
  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;
  bootstrap) if [ -e "$HOME/.claude/CLAUDE.md" ]; then printf '${concurrentSettings}' > "$HOME/.claude/settings.json"; printf '${concurrentGlobal}' > "$HOME/.claude.json"; touch "$HOME/.claude-write-observed-before-schedule-failure"; fi; echo permission denied >&2; exit 1;;
esac
`,
        );
        await chmod(launchctl, 0o755);
        await writeFile(join(home, ".fake-launchctl-calls"), "");

        const rollback = await runCodex(home, [`--rollback=${selectedId}`], "both", env);

        expect(rollback.exitCode).not.toBe(0);
        expect(`${rollback.stdout}\n${rollback.stderr}`).toMatch(/bootstrap|schedule|launchctl/i);
        expect(existsSync(observed)).toBe(true);
        expect(await readFile(join(home, ".fake-launchctl-calls"), "utf8")).toContain("bootstrap");
        expect(await readFile(join(claudeDir, "settings.json"), "utf8")).toBe(concurrentSettings);
        expect(await readFile(join(home, ".claude.json"), "utf8")).toBe(concurrentGlobal);
        await expectPathsExact(beforeRollback);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test.skipIf(process.platform !== "darwin").each([
    ["claude", "exact-not-found", 113, "com.darkroom.cc-settings-autoupdate", true],
    ["both", "exact-not-found", 113, "com.darkroom.cc-settings-autoupdate", true],
    ["both", "wrong-label", 113, "com.darkroom.other", false],
    ["both", "wrong-uid", 113, "com.darkroom.cc-settings-autoupdate", false],
    ["both", "wrong-exit", 1, "com.darkroom.cc-settings-autoupdate", false],
    ["both", "extra-text", 113, "com.darkroom.cc-settings-autoupdate", false],
  ] as const)(
    "fresh %s install treats launchctl %s as unloaded only for the exact macOS response",
    async (target, variant, exitCode, label, shouldSucceed) => {
      const home = await mkdtemp(join(tmpdir(), `cc-schedule-query-${variant}-`));
      try {
        const bin = join(home, "bin");
        await mkdir(bin);
        const uid = process.getuid?.() ?? 0;
        const reportedUid = variant === "wrong-uid" ? uid + 1 : uid;
        const extra = variant === "extra-text" ? "unexpected detail\\n" : "";
        const launchctl = join(bin, "launchctl");
        await writeFile(
          launchctl,
          `#!/bin/sh
if [ "$1" = "print" ]; then
  printf 'Bad request.\\nCould not find service "${label}" in domain for user gui: ${reportedUid}\\n${extra}' >&2
  exit ${exitCode}
fi
exit 0
`,
        );
        await chmod(launchctl, 0o755);

        const result = await runCodex(home, ["--auto-update=off"], target, {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        });

        if (shouldSucceed) {
          expectSuccess(result);
          expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(true);
          if (target === "both") {
            expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(true);
          }
        } else {
          expect(result.exitCode).not.toBe(0);
          expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(false);
          expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test("a post-backup plugin failure restores the exact prior managed state", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-plugin-failure-"));
    try {
      const source = await copySourceFixture(home);
      expectSuccess(await runCodex(home, [], "codex", {}, source));
      const codexHome = join(home, ".codex");
      const tracked = [
        "AGENTS.md",
        ".cc-settings-version",
        "agents/implementer.toml",
        "rules/darkroom.rules",
      ];
      const before = new Map(
        await Promise.all(
          tracked.map(
            async (path) => [path, await readFile(join(codexHome, path), "utf8")] as const,
          ),
        ),
      );
      await writeFile(join(source, "AGENTS.md"), "changed source instructions\n");
      await writeFile(
        join(source, "agents", "implementer.md"),
        `${await readFile(join(source, "agents", "implementer.md"), "utf8")}\nchanged\n`,
      );
      const bin = join(home, "bin");
      await mkdir(bin);
      const fakeCodex = join(bin, "codex");
      await writeFile(
        fakeCodex,
        '#!/bin/sh\nsource="$CODEX_HOME/darkroom/source"\ncase "$2:$3" in\n  list:*) printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":true,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  marketplace:list) printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$source" "$source"; exit 0;;\n  marketplace:add) touch "$HOME/.marketplace-mutated"; exit 0;;\n  add:*) touch "$HOME/.plugin-add-attempted"; echo plugin failure >&2; exit 1;;\nesac\nexit 0\n',
      );
      await chmod(fakeCodex, 0o755);

      const failed = await runCodex(
        home,
        [],
        "codex",
        { CC_SKIP_CODEX_CLI: "0", PATH: prependTestPath(bin) },
        source,
      );
      expect(failed.exitCode).not.toBe(0);
      expect(existsSync(join(home, ".marketplace-mutated"))).toBe(true);
      expect(existsSync(join(home, ".plugin-add-attempted"))).toBe(true);
      for (const [path, bytes] of before) {
        expect(await readFile(join(codexHome, path), "utf8"), path).toBe(bytes);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 180_000);

  test.each([
    ["full", "absent"],
    ["light", "enabled"],
    ["light", "disabled"],
  ] as const)(
    "a full attempt from %s preserves independent plugin state=%s",
    async (priorProfile, initialPluginState) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-plugin-state-${priorProfile}-`));
      const codexHome = join(home, ".codex");
      const bin = join(home, "bin");
      const pluginState = join(home, ".fake-plugin-installed");
      const disabledState = join(home, ".fake-plugin-disabled");
      const marketplaceState = join(home, ".fake-marketplace-installed");
      try {
        expectSuccess(await runCodex(home, priorProfile === "light" ? ["--light"] : []));
        if (initialPluginState !== "absent") {
          const independentSource = join(home, "independent-plugin-source");
          await mkdir(independentSource);
          const canonicalIndependentSource = await realpath(independentSource);
          await Promise.all([
            writeFile(pluginState, `${canonicalIndependentSource}\n`),
            writeFile(marketplaceState, `${canonicalIndependentSource}\n`),
          ]);
          if (initialPluginState === "disabled") await writeFile(disabledState, "disabled\n");
        }
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
        ]);
        const expectedPluginState = {
          installed: existsSync(pluginState),
          disabled: existsSync(disabledState),
          marketplace: existsSync(marketplaceState),
        };
        await mkdir(bin);
        const fakeCodex = join(bin, "codex");
        await writeFile(
          fakeCodex,
          '#!/bin/sh\nplugin="$HOME/.fake-plugin-installed"\ndisabled="$HOME/.fake-plugin-disabled"\nmarket="$HOME/.fake-marketplace-installed"\nmanaged="$CODEX_HOME/darkroom/source"\ncase "$2:$3" in\n  list:*) if [ -e "$plugin" ]; then if [ -e "$disabled" ]; then enabled=false; else enabled=true; fi; source=$(cat "$plugin"); printf \'{"installed":[{"pluginId":"darkroom@cc-settings","installed":true,"enabled":%s,"source":{"source":"local","path":"%s"},"marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$enabled" "$source" "$source"; else printf \'{"installed":[]}\\n\'; fi; exit 0;;\n  marketplace:list) if [ -e "$market" ]; then root=$(cat "$market"); printf \'{"marketplaces":[{"name":"cc-settings","root":"%s","marketplaceSource":{"sourceType":"local","source":"%s"}}]}\\n\' "$root" "$root"; else printf \'{"marketplaces":[]}\\n\'; fi; exit 0;;\n  marketplace:add) printf \'%s\n\' "${4:-$managed}" > "$market"; exit 0;;\n  marketplace:remove) rm -f "$market"; exit 0;;\n  add:*) if [ -e "$market" ]; then cat "$market" > "$plugin"; else printf \'%s\n\' "$managed" > "$plugin"; fi; rm -f "$disabled"; if [ ! -e "$HOME/.failed-plugin-add-once" ]; then touch "$HOME/.failed-plugin-add-once"; echo plugin failure >&2; exit 1; fi; exit 0;;\n  remove:*) rm -f "$plugin" "$disabled"; exit 0;;\n  enable:*) if [ ! -e "$plugin" ]; then cat "$market" > "$plugin"; fi; rm -f "$disabled"; exit 0;;\n  disable:*) touch "$disabled"; exit 0;;\nesac\nexit 0\n',
        );
        await chmod(fakeCodex, 0o755);

        const failed = await runCodex(home, [], "codex", {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(bin),
        });
        expect(failed.exitCode).not.toBe(0);
        await expectPathsExact(before);
        expect(existsSync(pluginState)).toBe(expectedPluginState.installed);
        expect(existsSync(disabledState)).toBe(expectedPluginState.disabled);
        expect(existsSync(marketplaceState)).toBe(expectedPluginState.marketplace);
        expect(existsSync(join(home, ".failed-plugin-add-once"))).toBe(priorProfile === "full");
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test("independent plugin ownership survives light install, light update, and light uninstall", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-independent-plugin-"));
    const codexHome = join(home, ".codex");
    try {
      const fake = await createStatefulCodex(home);
      const independentPluginSource = join(home, "independent-plugin-source");
      const independentMarketplaceRoot = join(home, "independent-marketplace-root");
      await Promise.all([
        writeFile(fake.plugin, `${independentPluginSource}\n`),
        writeFile(fake.marketplace, `${independentMarketplaceRoot}\n`),
        mkdir(codexHome, { recursive: true }),
        mkdir(independentPluginSource, { recursive: true }),
        mkdir(independentMarketplaceRoot, { recursive: true }),
      ]);
      const config = join(codexHome, "config.toml");
      await writeFile(config, "personal = true\n");
      const env = {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(fake.bin),
      };

      expectSuccess(await runCodex(home, ["--light"], "codex", env));
      const beforeRejectedFull = await snapshotPaths([
        join(codexHome, ".cc-settings-version"),
        join(codexHome, "AGENTS.md"),
        config,
        fake.plugin,
        fake.marketplace,
      ]);
      const rejectedFull = await runCodex(home, [], "codex", env);
      expect(rejectedFull.exitCode).not.toBe(0);
      await expectPathsExact(beforeRejectedFull);
      expectSuccess(await runCodex(home, ["--light"], "codex", env));
      expectSuccess(await runCodex(home, ["--uninstall"], "codex", env));
      expect(await readFile(fake.plugin, "utf8")).toBe(`${independentPluginSource}\n`);
      expect(await readFile(fake.marketplace, "utf8")).toBe(`${independentMarketplaceRoot}\n`);
      expect(await readFile(config, "utf8")).toBe("personal = true\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 240_000);

  test("an unobserved plugin state in a light backup never authorizes later plugin mutation", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-null-plugin-state-"));
    const codexHome = join(home, ".codex");
    try {
      expectSuccess(await runCodex(home, [], "claude"));
      expectSuccess(await runCodex(home, ["--uninstall"], "both"));
      const backupId = (await readdir(join(codexHome, "backups", "cc-settings"))).find((name) =>
        /^\d{14}-\d{3}-\d+-\d+$/.test(name),
      );
      expect(backupId).toBeDefined();
      const manifest = JSON.parse(
        await readFile(
          join(codexHome, "backups", "cc-settings", backupId as string, "manifest.json"),
          "utf8",
        ),
      ) as { pluginState: unknown };
      expect(manifest.pluginState).toBeNull();

      const fake = await createStatefulCodex(home);
      const independentSource = join(home, "independent-plugin-root");
      const agentsPath = join(codexHome, "AGENTS.md");
      const configPath = join(codexHome, "config.toml");
      const userAgents = "post-snapshot user instructions\n";
      const userConfig = "personal = true\n";
      await mkdir(independentSource);
      const canonicalIndependentSource = await realpath(independentSource);
      await Promise.all([
        writeFile(fake.plugin, `${canonicalIndependentSource}\n`),
        writeFile(fake.marketplace, `${canonicalIndependentSource}\n`),
        writeFile(agentsPath, userAgents),
        writeFile(configPath, userConfig),
      ]);
      const before = await snapshotPaths([fake.plugin, fake.marketplace, agentsPath, configPath]);
      const env = {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(fake.bin),
      };

      expectSuccess(await runCodex(home, [`--rollback=${backupId}`], "codex", env));

      await expectPathsExact(before);
      expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
      const calls = await readFile(fake.calls, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      expect(calls).not.toMatch(/plugin remove|marketplace remove/);

      await Promise.all([unlink(fake.plugin), unlink(fake.marketplace)]);
      expectSuccess(await runCodex(home, [], "codex", env));
      expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(true);
      expect(existsSync(fake.plugin)).toBe(true);
      expectSuccess(await runCodex(home, [`--rollback=${backupId}`], "codex", env));

      expect(await readFile(agentsPath, "utf8")).toBe(userAgents);
      expect(await readFile(configPath, "utf8")).toBe(userConfig);
      expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
      expect(existsSync(fake.plugin)).toBe(false);
      expect(existsSync(fake.marketplace)).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 240_000);

  test("a managed full plugin is removed by light transition and full uninstall", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-managed-plugin-"));
    try {
      const fake = await createStatefulCodex(home);
      const env = {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(fake.bin),
      };
      expectSuccess(await runCodex(home, [], "codex", env));
      expect(existsSync(fake.plugin)).toBe(true);
      expect(existsSync(fake.marketplace)).toBe(true);
      expectSuccess(await runCodex(home, ["--light"], "codex", env));
      expect(existsSync(fake.plugin)).toBe(false);
      expect(existsSync(fake.marketplace)).toBe(false);
      expectSuccess(await runCodex(home, [], "codex", env));
      expectSuccess(await runCodex(home, ["--uninstall"], "codex", env));
      expect(existsSync(fake.plugin)).toBe(false);
      expect(existsSync(fake.marketplace)).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 240_000);

  test.each(["install", "light", "uninstall"] as const)(
    "managed full plugin repointed to unrelated provenance rejects %s before mutation",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-repointed-${operation}-`));
      const codexHome = join(home, ".codex");
      try {
        const fake = await createStatefulCodex(home);
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(fake.bin),
        };
        expectSuccess(await runCodex(home, [], "codex", env));
        await Promise.all([
          writeFile(fake.plugin, `${join(home, "foreign-plugin-source")}\n`),
          writeFile(fake.marketplace, `${join(home, "foreign-marketplace-root")}\n`),
        ]);
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
          fake.plugin,
          fake.marketplace,
        ]);
        const args =
          operation === "install" ? [] : operation === "light" ? ["--light"] : ["--uninstall"];

        const result = await runCodex(home, args, "codex", env);

        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test("light without enrollment can upgrade to full and later remove only its created plugin", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-light-full-owned-plugin-"));
    try {
      const fake = await createStatefulCodex(home);
      const env = {
        CC_SKIP_CODEX_CLI: "0",
        PATH: prependTestPath(fake.bin),
      };
      expectSuccess(await runCodex(home, ["--light"], "codex", env));
      expect(existsSync(fake.plugin)).toBe(false);
      expect(existsSync(fake.marketplace)).toBe(false);
      expectSuccess(await runCodex(home, [], "codex", env));
      expect(existsSync(fake.plugin)).toBe(true);
      expect(existsSync(fake.marketplace)).toBe(true);
      expectSuccess(await runCodex(home, ["--light"], "codex", env));
      expect(existsSync(fake.plugin)).toBe(false);
      expect(existsSync(fake.marketplace)).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 240_000);

  test.each(["enabled", "disabled"] as const)(
    "rollback rejects a selected light backup's untrusted independent %s plugin provenance",
    async (selectedState) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-rollback-plugin-${selectedState}-`));
      const codexHome = join(home, ".codex");
      try {
        const fake = await createStatefulCodex(home);
        const independentPluginSource = join(home, "independent-plugin-source");
        await mkdir(independentPluginSource, { recursive: true });
        const canonicalIndependentSource = await realpath(independentPluginSource);
        await Promise.all([
          writeFile(fake.plugin, `${canonicalIndependentSource}\n`),
          writeFile(fake.marketplace, `${canonicalIndependentSource}\n`),
          mkdir(codexHome, { recursive: true }),
        ]);
        if (selectedState === "disabled") await writeFile(fake.disabled, "disabled\n");
        const config = join(codexHome, "config.toml");
        await writeFile(config, "selected = true\n");
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(fake.bin),
        };
        expectSuccess(await runCodex(home, ["--light"], "codex", env));
        const before = new Set(await readdir(join(codexHome, "backups", "cc-settings")));
        expectSuccess(await runCodex(home, ["--light"], "codex", env));
        const backupId = (await readdir(join(codexHome, "backups", "cc-settings"))).find(
          (name) => !before.has(name),
        );
        expect(backupId).toBeDefined();
        const manifest = JSON.parse(
          await readFile(
            join(codexHome, "backups", "cc-settings", backupId as string, "manifest.json"),
            "utf8",
          ),
        ) as {
          restoredProfile: string;
          pluginState: {
            pluginInstalled: boolean;
            pluginEnabled: boolean;
            marketplaceEnrolled: boolean;
            pluginSource: string;
            marketplaceSource: string;
            restoreMode: string;
          } | null;
        };
        expect(manifest.restoredProfile).toBe("light");
        expect(manifest.pluginState).toEqual({
          pluginInstalled: true,
          pluginEnabled: selectedState === "enabled",
          marketplaceEnrolled: true,
          pluginSource: canonicalIndependentSource,
          marketplaceSource: canonicalIndependentSource,
          restoreMode: "independent-preserve-only",
        });
        const matchingState = await snapshotPaths([
          config,
          fake.plugin,
          fake.disabled,
          fake.marketplace,
        ]);
        await writeFile(fake.calls, "");
        const noOp = await runCodex(home, [`--rollback=${backupId}`], "codex", env);
        expect(noOp.exitCode, `${noOp.stdout}\n${noOp.stderr}`).toBe(0);
        await expectPathsExact(matchingState);
        expect(await readFile(fake.calls, "utf8")).not.toMatch(
          /marketplace add|marketplace remove|plugin add|plugin remove/,
        );
        await Promise.all([
          rm(fake.plugin, { force: true }),
          rm(fake.disabled, { force: true }),
          rm(fake.marketplace, { force: true }),
          writeFile(config, "selected = false\n"),
        ]);
        const beforeRejected = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          config,
          fake.plugin,
          fake.disabled,
          fake.marketplace,
        ]);
        const backupsBeforeRejected = await readdir(join(codexHome, "backups", "cc-settings"));
        await writeFile(fake.calls, "");
        const rejected = await runCodex(home, [`--rollback=${backupId}`], "codex", env);
        expect(rejected.exitCode).not.toBe(0);
        expect(`${rejected.stdout}\n${rejected.stderr}`).toMatch(
          /provenance|trusted.*source|backup payload/i,
        );
        await expectPathsExact(beforeRejected);
        expect(await readdir(join(codexHome, "backups", "cc-settings"))).toEqual(
          backupsBeforeRejected,
        );
        expect(await readFile(fake.calls, "utf8")).not.toMatch(
          /marketplace (?:add|remove)|plugin (?:add|remove)/,
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );

  test.each(["codex", "both"] as const)(
    "explicit full target %s requires the Codex CLI before Claude mutation",
    async (target) => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-no-cli-"));
      try {
        const bin = join(home, "bin");
        await mkdir(bin);
        const result = await runCodex(home, [], target, {
          CC_SKIP_CODEX_CLI: "0",
          PATH: bin,
        });
        expect(result.exitCode).not.toBe(0);
        expect(existsSync(join(home, ".claude"))).toBe(false);
        expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test("fresh light install succeeds without a Codex CLI", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-codex-light-no-cli-"));
    try {
      const bin = join(home, "bin");
      await mkdir(bin);
      expectSuccess(
        await runCodex(home, ["--light"], "codex", {
          CC_SKIP_CODEX_CLI: "0",
          PATH: bin,
        }),
      );
      expect(
        JSON.parse(await readFile(join(home, ".codex", ".cc-settings-version"), "utf8")).profile,
      ).toBe("light");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test.each(["codex", "both"] as const)(
    "bare CC_SKIP_CODEX_CLI cannot bypass a production-like full %s install",
    async (target) => {
      const home = await mkdtemp(join(tmpdir(), "cc-codex-production-skip-"));
      try {
        const bin = join(home, "bin");
        await mkdir(bin);
        const result = await runCodex(home, [], target, {
          NODE_ENV: "production",
          CC_SKIP_CODEX_CLI: "1",
          CC_SETTINGS_TEST_MODE: "codex-install",
          CC_SETTINGS_TEST_CODEX_COMMAND_JSON: "not-json",
          PATH: bin,
        });
        expect(result.exitCode).not.toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/CC_SKIP_CODEX_CLI|bypass/i);
        expect(existsSync(join(home, ".claude"))).toBe(false);
        expect(existsSync(join(home, ".codex", ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );

  test.each(["light", "uninstall", "rollback"] as const)(
    "%s fails before changing a managed plugin-owning state when the Codex CLI is absent",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-${operation}-no-cli-`));
      const codexHome = join(home, ".codex");
      try {
        expectSuccess(await runCodex(home));
        if (operation === "rollback") expectSuccess(await runCodex(home, ["--light"]));
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          join(codexHome, "agents", "implementer.toml"),
          join(codexHome, "rules", "darkroom.rules"),
        ]);
        const backupsBefore = (await readdir(join(codexHome, "backups", "cc-settings"))).sort();
        const bin = join(home, "bin");
        await mkdir(bin);
        const args =
          operation === "light"
            ? ["--light"]
            : operation === "uninstall"
              ? ["--uninstall"]
              : ["--rollback"];
        const result = await runCodex(home, args, "codex", {
          CC_SKIP_CODEX_CLI: "0",
          PATH: bin,
        });
        expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
        expect((await readdir(join(codexHome, "backups", "cc-settings"))).sort()).toEqual(
          backupsBefore,
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test.skipIf(process.platform !== "darwin")(
    "an install-time scheduler bootstrap failure restores both products and the prior enrollment",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-install-bootstrap-failure-"));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        const fake = await createStatefulCodex(home);
        const launchctl = join(fake.bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) [ -e "$HOME/.fake-launchctl-loaded" ] && exit 0; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(fake.bin),
        };
        expectSuccess(await runCodex(home, ["--auto-update=on"], "both", env));
        const canonicalSource = await realpath(join(codexHome, "darkroom", "source"));
        await Promise.all([
          writeFile(fake.plugin, `${canonicalSource}\n`),
          writeFile(fake.marketplace, `${canonicalSource}\n`),
        ]);
        const tracked = [
          join(claudeDir, ".cc-settings-version"),
          join(claudeDir, "settings.json"),
          join(claudeDir, "AGENTS.md"),
          join(home, ".claude.json"),
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          fake.plugin,
          fake.marketplace,
          plist,
          loaded,
        ];
        const before = await snapshotPaths(tracked);
        const plistMode = (await stat(plist)).mode & 0o777;
        await writeFile(join(home, ".fake-launchctl-calls"), "");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) [ -e "$HOME/.fake-launchctl-loaded" ] && exit 0; exit 113;;\n  bootout) rm -f "$HOME/.fake-launchctl-loaded"; exit 0;;\n  bootstrap) if [ -e "$HOME/.bootstrap-failed-after-plist-write" ]; then touch "$HOME/.fake-launchctl-loaded"; exit 0; fi; touch "$HOME/.bootstrap-failed-after-plist-write"; echo permission denied >&2; exit 1;;\nesac\n',
        );
        await chmod(launchctl, 0o755);

        const failed = await runCodex(home, ["--auto-update=on"], "both", env);

        expect(failed.exitCode).not.toBe(0);
        expect(existsSync(join(home, ".bootstrap-failed-after-plist-write"))).toBe(true);
        expect(await readFile(join(home, ".fake-launchctl-calls"), "utf8")).toContain("bootstrap");
        await expectPathsExact(before);
        expect((await stat(plist)).mode & 0o777).toBe(plistMode);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test.skipIf(process.platform !== "darwin")(
    "scheduler compensation fails closed when restoring an unloaded state cannot boot out the failed job",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cc-both-schedule-compensation-bootout-"));
      const claudeDir = join(home, ".claude");
      const codexHome = join(home, ".codex");
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        const fake = await createStatefulCodex(home);
        const launchctl = join(fake.bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) [ -e "$HOME/.fake-launchctl-loaded" ] && exit 0; printf \'Bad request.\\nCould not find service "com.darkroom.cc-settings-autoupdate" in domain for user gui: %s\\n\' "$(id -u)" >&2; exit 113;;\n  bootstrap) touch "$HOME/.fake-launchctl-loaded" "$HOME/.operation-bootstrap-failed"; echo bootstrap denied >&2; exit 1;;\n  bootout) if [ -e "$HOME/.operation-bootstrap-failed" ]; then touch "$HOME/.compensation-bootout-denied"; echo permission denied >&2; exit 1; fi; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);

        const failed = await runCodex(home, ["--auto-update=on"], "both", {
          CC_SKIP_CODEX_CLI: "0",
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(fake.bin),
        });

        expect(failed.exitCode).not.toBe(0);
        expect(`${failed.stdout}\n${failed.stderr}`).toMatch(/compensation.*incomplete|bootout/i);
        const calls = await readFile(join(home, ".fake-launchctl-calls"), "utf8");
        expect(calls, `${failed.stdout}\n${failed.stderr}`).toContain("bootstrap");
        expect(
          existsSync(join(home, ".operation-bootstrap-failed")),
          `${failed.stdout}\n${failed.stderr}`,
        ).toBe(true);
        expect(existsSync(join(home, ".compensation-bootout-denied"))).toBe(true);
        expect(existsSync(loaded)).toBe(true);
        expect(calls).toContain("bootout");
        expect(existsSync(plist)).toBe(true);
        expect(existsSync(join(claudeDir, ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    300_000,
  );

  test.skipIf(process.platform !== "darwin").each(["on", "off", "uninstall"] as const)(
    "an unowned scheduler enrollment is preserve-only during %s",
    async (operation) => {
      const home = await mkdtemp(join(tmpdir(), `cc-unowned-scheduler-${operation}-`));
      const plist = join(
        home,
        "Library",
        "LaunchAgents",
        "com.darkroom.cc-settings-autoupdate.plist",
      );
      const loaded = join(home, ".fake-launchctl-loaded");
      try {
        const bin = join(home, "bin");
        await mkdir(dirname(plist), { recursive: true });
        await mkdir(bin);
        await writeFile(plist, "unowned launch agent bytes\n");
        await chmod(plist, 0o640);
        await writeFile(loaded, "loaded by user\n");
        const launchctl = join(bin, "launchctl");
        await writeFile(
          launchctl,
          '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/.fake-launchctl-calls"\ncase "$1" in\n  print) exit 0;;\n  bootout|bootstrap) touch "$HOME/.unowned-scheduler-mutated"; exit 0;;\nesac\n',
        );
        await chmod(launchctl, 0o755);
        const before = await snapshotPaths([plist, loaded]);
        const args = operation === "uninstall" ? ["--uninstall"] : [`--auto-update=${operation}`];
        const result = await runCodex(home, args, "claude", {
          CC_SKIP_SCHEDULE: "0",
          CI: "false",
          PATH: prependTestPath(bin),
        });

        if (operation === "uninstall") expect(result.exitCode).toBe(0);
        else expect(result.exitCode).not.toBe(0);
        await expectPathsExact(before);
        expect((await stat(plist)).mode & 0o777).toBe(0o640);
        expect(existsSync(join(home, ".unowned-scheduler-mutated"))).toBe(false);
        expect(existsSync(join(home, ".claude", ".cc-settings-version"))).toBe(false);
        expect(existsSync(join(home, ".codex"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  test("a nonempty Claude archive cannot be relabeled as a managed-absent snapshot", async () => {
    const home = await mkdtemp(join(tmpdir(), "cc-managed-absent-nonempty-"));
    try {
      expectSuccess(await runCodex(home, [], "both"));
      const beforeIds = await sharedBackupIds(home);
      expectSuccess(await runCodex(home, ["--light"], "both"));
      const afterIds = await sharedBackupIds(home);
      const backupId = afterIds.claude.find(
        (id) => afterIds.codex.includes(id) && !beforeIds.claude.includes(id),
      );
      expect(backupId).toBeDefined();
      const archive = join(home, ".claude", "backups", `backup-${backupId}.tar.gz`);
      const sidecarPath = `${archive}.state.json`;
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as Record<string, unknown>;
      expect(sidecar.present).toBeInstanceOf(Array);
      expect((sidecar.present as unknown[]).length).toBeGreaterThan(0);
      sidecar.restore_scope = "managed-absent";
      sidecar.present = [];
      sidecar.shared_owned_files_present = [];
      sidecar.managed_files = null;
      sidecar.managed_files_manifest_version = null;
      sidecar.node_modules_target = null;
      await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
      const before = await snapshotPaths([
        join(home, ".claude", ".cc-settings-version"),
        join(home, ".claude", "settings.json"),
        join(home, ".claude", "AGENTS.md"),
        join(home, ".codex", ".cc-settings-version"),
        join(home, ".codex", "AGENTS.md"),
      ]);

      const rollback = await runCodex(home, [`--rollback=${backupId}`], "both");

      expect(rollback.exitCode).not.toBe(0);
      expect(`${rollback.stdout}\n${rollback.stderr}`).toMatch(
        /managed-absent|empty|archive|backup/i,
      );
      await expectPathsExact(before);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 240_000);

  test.each(["plugin", "marketplace"] as const)(
    "rollback rejects a false %s enrollment flag paired with a non-null source",
    async (kind) => {
      const home = await mkdtemp(join(tmpdir(), `cc-codex-inverse-${kind}-`));
      const codexHome = join(home, ".codex");
      try {
        const fake = await createStatefulCodex(home);
        const env = {
          CC_SKIP_CODEX_CLI: "0",
          PATH: prependTestPath(fake.bin),
        };
        expectSuccess(await runCodex(home, [], "codex", env));
        const beforeIds = new Set(await readdir(join(codexHome, "backups", "cc-settings")));
        expectSuccess(await runCodex(home, ["--light"], "codex", env));
        const backupId = (await readdir(join(codexHome, "backups", "cc-settings"))).find(
          (id) => !beforeIds.has(id),
        );
        expect(backupId).toBeDefined();
        const manifestPath = join(
          codexHome,
          "backups",
          "cc-settings",
          backupId as string,
          "manifest.json",
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          pluginState: Record<string, unknown>;
        };
        expect(manifest.pluginState).not.toBeNull();
        if (kind === "plugin") manifest.pluginState.pluginInstalled = false;
        else manifest.pluginState.marketplaceEnrolled = false;
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        const before = await snapshotPaths([
          join(codexHome, ".cc-settings-version"),
          join(codexHome, "AGENTS.md"),
          fake.plugin,
          fake.marketplace,
        ]);
        const backupsBefore = await readdir(join(codexHome, "backups", "cc-settings"));
        await writeFile(fake.calls, "");

        const rollback = await runCodex(home, [`--rollback=${backupId}`], "codex", env);

        expect(rollback.exitCode).not.toBe(0);
        expect(`${rollback.stdout}\n${rollback.stderr}`).toMatch(
          /plugin|marketplace|source|inconsistent|invalid/i,
        );
        await expectPathsExact(before);
        expect(await readdir(join(codexHome, "backups", "cc-settings"))).toEqual(backupsBefore);
        expect(await readFile(fake.calls, "utf8")).not.toMatch(
          /marketplace add|marketplace remove|plugin add|plugin remove/,
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
