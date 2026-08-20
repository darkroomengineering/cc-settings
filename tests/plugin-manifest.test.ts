// Plugin/marketplace manifest contract: keeps the Claude and Codex manifests
// in sync with the repo so neither installable surface can drift silently.
//
// - Every version-bearing file must match the installer VERSION in src/setup.ts,
//   which is the single source of truth (see CHANGELOG's Versioning note). Four
//   places carry it: both plugin manifests, package.json, and the CHANGELOG's top heading.
//   Each has drifted at least once — plugin.json sat at 8.1.0 for two major
//   versions, and package.json sat at 13.4.3 across three releases because
//   nothing tested it.
// - plugin.json mcpServers must be a subset of config/20-mcp.json (source of
//   truth), matching on the portable transport fields.
// - marketplace.json must point at the plugin defined in this repo.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const VERSION_CONST_RE = /\bconst VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/;

interface McpServerConfig {
  command?: string;
  args?: string[];
  type?: string;
  url?: string;
  [key: string]: unknown;
}

async function readJson(relPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(ROOT, relPath), "utf8"));
}

/** The one source of truth every other version must follow. */
async function installerVersion(): Promise<string> {
  const setup = await readFile(join(ROOT, "src/setup.ts"), "utf8");
  const match = setup.match(VERSION_CONST_RE);
  expect(match?.[1], 'src/setup.ts has no `const VERSION = "x.y.z"`').toBeDefined();
  return match?.[1] as string;
}

describe("version sync — every version-bearing file tracks src/setup.ts", () => {
  test("plugin.json version matches src/setup.ts VERSION", async () => {
    const plugin = await readJson(".claude-plugin/plugin.json");
    expect(plugin.version).toBe(await installerVersion());
  });

  test("Codex plugin.json version matches src/setup.ts VERSION", async () => {
    const plugin = await readJson(".codex-plugin/plugin.json");
    expect(plugin.version).toBe(await installerVersion());
  });

  test("package.json version matches src/setup.ts VERSION", async () => {
    const pkg = await readJson("package.json");
    expect(pkg.version).toBe(await installerVersion());
  });

  test("CHANGELOG's newest entry matches src/setup.ts VERSION", async () => {
    const changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf8");
    // First `## [x.y.z]` heading in the file — entries are newest-first.
    const newest = changelog.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
    expect(newest?.[1], "CHANGELOG.md has no `## [x.y.z]` entry").toBeDefined();
    expect(newest?.[1]).toBe(await installerVersion());
  });
});

describe("plugin manifest — mcpServers sync with config/20-mcp.json", () => {
  test("every plugin server matches its config fragment counterpart", async () => {
    const plugin = await readJson(".claude-plugin/plugin.json");
    const fragment = await readJson("config/20-mcp.json");
    const pluginServers = (plugin.mcpServers ?? {}) as Record<string, McpServerConfig>;
    const configServers = (fragment.mcpServers ?? {}) as Record<string, McpServerConfig>;

    expect(Object.keys(pluginServers).length).toBeGreaterThan(0);

    for (const [name, server] of Object.entries(pluginServers)) {
      const source = configServers[name];
      expect(source, `plugin server "${name}" missing from config/20-mcp.json`).toBeDefined();
      if (!source) continue;
      expect(server.command).toBe(source.command as string | undefined);
      expect(server.args).toEqual(source.args as string[] | undefined);
      expect(server.type).toBe(source.type as string | undefined);
      expect(server.url).toBe(source.url as string | undefined);
    }
  });

  test("plugin servers carry only documented plugin-manifest fields", async () => {
    const plugin = await readJson(".claude-plugin/plugin.json");
    const pluginServers = (plugin.mcpServers ?? {}) as Record<string, McpServerConfig>;
    const allowed = new Set(["command", "args", "env", "cwd", "type", "url", "headers"]);
    for (const [name, server] of Object.entries(pluginServers)) {
      for (const key of Object.keys(server)) {
        expect(allowed.has(key), `plugin server "${name}" has non-portable field "${key}"`).toBe(
          true,
        );
      }
    }
  });
});

describe("marketplace manifest", () => {
  test("self-referential plugin entry matches plugin.json", async () => {
    const marketplace = await readJson(".claude-plugin/marketplace.json");
    const claudePlugin = await readJson(".claude-plugin/plugin.json");
    const codexPlugin = await readJson(".codex-plugin/plugin.json");

    expect(marketplace.name).toBe("cc-settings");
    expect((marketplace.owner as { name?: string })?.name).toBeTruthy();

    const entries = marketplace.plugins as Array<{ name: string; source: unknown }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe(claudePlugin.name as string);
    expect(entries[0]?.name).toBe(codexPlugin.name as string);
    expect(entries[0]?.source).toBe("./");
  });
});

describe("Codex plugin manifest", () => {
  test("points at the shared skill source instead of a copied fork", async () => {
    const plugin = await readJson(".codex-plugin/plugin.json");
    expect(plugin.skills).toBe("./skills/");
    expect(plugin.name).toBe("darkroom");
  });

  test("identity stays aligned with the Claude plugin", async () => {
    const claudePlugin = await readJson(".claude-plugin/plugin.json");
    const codexPlugin = await readJson(".codex-plugin/plugin.json");

    expect(codexPlugin.name).toBe(claudePlugin.name);
    expect(codexPlugin.author).toEqual(claudePlugin.author);
    expect(codexPlugin.repository).toBe(claudePlugin.repository);
    expect(codexPlugin.license).toBe(claudePlugin.license);
  });

  test("references a fixed HTTPS-only Figma MCP wrapper", async () => {
    const plugin = await readJson(".codex-plugin/plugin.json");
    const wrapper = await readJson(".mcp.json");
    const servers = wrapper.mcpServers as Record<string, McpServerConfig>;

    expect(plugin.mcpServers).toBe("./.mcp.json");
    expect(Object.keys(servers)).toEqual(["figma"]);
    expect(servers.figma).toEqual({ type: "http", url: "https://mcp.figma.com/mcp" });
    for (const [name, server] of Object.entries(servers)) {
      const allowed =
        server.type === "http" ? ["type", "url", "headers"] : ["command", "args", "env", "cwd"];
      for (const key of Object.keys(server)) {
        expect(allowed).toContain(key);
      }
      if (server.type !== "http") {
        expect(typeof server.command, `${name} must use a portable stdio command`).toBe("string");
        expect(Array.isArray(server.args), `${name} must pass stdio arguments as an array`).toBe(
          true,
        );
      }
    }
  });

  test("rejects mutable or unversioned local MCP package arguments", async () => {
    const wrapper = await readJson(".mcp.json");
    const servers = wrapper.mcpServers as Record<string, McpServerConfig>;
    for (const [name, server] of Object.entries(servers)) {
      if (!server.command) continue;
      for (const arg of server.args ?? []) {
        if (arg.startsWith("-")) continue;
        expect(arg, `${name} uses a mutable package tag`).not.toMatch(
          /@(latest|next|canary|beta)$/i,
        );
        expect(arg, `${name} local package arg must pin an immutable version`).toMatch(/@\d/);
      }
    }
  });
});

describe("Codex hook package", () => {
  test("uses only portable events, fields, paths, and bounded shutdown work", async () => {
    const manifest = await readJson("hooks/hooks.json");
    const hooks = manifest.hooks as Record<
      string,
      Array<{
        if?: unknown;
        hooks?: Array<{
          type?: string;
          command?: string;
          commandWindows?: string;
          timeout?: number;
          if?: unknown;
        }>;
      }>
    >;
    const supportedEvents = new Set(["PreToolUse", "UserPromptSubmit", "PreCompact", "SessionEnd"]);

    expect(Object.keys(hooks).length).toBeGreaterThan(0);
    for (const [event, groups] of Object.entries(hooks)) {
      expect(supportedEvents.has(event), `unsupported Codex hook event ${event}`).toBe(true);
      for (const group of groups) {
        expect(group.if, `${event} must not use Claude-only if predicates`).toBeUndefined();
        for (const hook of group.hooks ?? []) {
          expect(
            hook.if,
            `${event} command must not use Claude-only if predicates`,
          ).toBeUndefined();
          if (hook.type === "command") {
            expect(hook.command?.trim().length).toBeGreaterThan(0);
            expect(hook.commandWindows).toBeDefined();
            expect((hook.commandWindows ?? "").trim().length).toBeGreaterThan(0);
            expect(hook.command).toContain("$PLUGIN_ROOT");
            expect(hook.command).not.toMatch(/(?:^|\s)CC_SETTINGS_HOME\s*=/);
            expect(hook.command).not.toContain(".claude");
            expect(hook.command).not.toMatch(/codex-verify|quota-steer/);
            expect(hook.commandWindows).toMatch(
              /["']%PLUGIN_ROOT%[\\/]src[\\/]scripts[\\/]codex-hook\.ts["']/i,
            );
            const posixTarget = hook.command?.match(/["'](src\/[a-z0-9_./-]+\.ts)["']/i)?.[1];
            const windowsTarget = hook.commandWindows?.match(
              /["'](src[\\/][a-z0-9_./\\-]+\.ts)["']/i,
            )?.[1];
            expect(posixTarget).toBeDefined();
            expect(windowsTarget?.replaceAll("\\", "/")).toBe(posixTarget);
            const posixArgs = hook.command?.slice(
              (hook.command?.indexOf(`"${posixTarget}"`) ?? -1) + (posixTarget?.length ?? 0) + 2,
            );
            const windowsNormalized = hook.commandWindows?.replaceAll("\\", "/") ?? "";
            const windowsArgs = windowsNormalized.slice(
              windowsNormalized.indexOf(`"${posixTarget}"`) + (posixTarget?.length ?? 0) + 2,
            );
            const expectedPosixArgs = posixArgs?.trim();
            expect(expectedPosixArgs).toBeDefined();
            expect(windowsArgs.trim()).toBe(expectedPosixArgs as string);
          }
          if (event === "SessionEnd") expect(hook.timeout).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

describe("Codex command policy", () => {
  const codex = Bun.which("codex");

  async function check(command: string[]): Promise<Record<string, unknown>> {
    if (!codex) throw new Error("codex executable unavailable");
    const child = Bun.spawn(
      [
        codex,
        "execpolicy",
        "check",
        "--rules",
        join(ROOT, "codex/rules/darkroom.rules"),
        ...command,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout) as Record<string, unknown>;
  }

  test("ships an execpolicy rule file", async () => {
    expect(
      (await readFile(join(ROOT, "codex/rules/darkroom.rules"), "utf8")).length,
    ).toBeGreaterThan(0);
  });

  test.skipIf(!codex)(
    "classifies destructive and read-only commands at the CLI boundary",
    async () => {
      expect((await check(["git", "push", "--force", "origin", "main"])).decision).toBe(
        "forbidden",
      );
      expect((await check(["git", "status", "--short"])).matchedRules).toEqual([]);
      expect((await check(["gh", "api", "--method", "DELETE", "repos/o/r"])).decision).toBe(
        "prompt",
      );
      expect((await check(["gh", "api", "repos/o/r", "--method", "DELETE"])).decision).toBe(
        "prompt",
      );
      for (const command of [
        ["git", "push", "origin", "main", "--force"],
        ["git", "push", "-uf", "origin", "main"],
        ["git", "push", "origin", "+main"],
        ["git", "restore", "."],
        ["git", "stash", "clear"],
        ["git", "worktree", "remove", "--force", "path"],
        ["rm", "-rf", "."],
      ]) {
        const result = await check(command);
        expect(["prompt", "forbidden"], command.join(" ")).toContain(result.decision as string);
        expect((result.matchedRules as unknown[]).length, command.join(" ")).toBeGreaterThan(0);
      }
    },
  );
});

describe("standalone Codex workflow branches", () => {
  function standaloneSection(content: string): string {
    return content.match(/## Standalone Codex[^\n]*\n([\s\S]*?)(?=\n## |$)/i)?.[1] ?? "";
  }

  test.each([
    "skills/fix/SKILL.md",
    "skills/orchestrate/SKILL.md",
    "skills/refactor/SKILL.md",
    "skills/review/SKILL.md",
    "skills/ship/SKILL.md",
    "skills/verify/SKILL.md",
  ])("%s uses the current native agent lifecycle", async (path) => {
    const branch = standaloneSection(await readFile(join(ROOT, path), "utf8"));
    expect(branch.length).toBeGreaterThan(0);
    for (const name of [
      "spawn_agent",
      "followup_task",
      "send_message",
      "wait_agent",
      "interrupt_agent",
    ]) {
      expect(branch, `${path} must name ${name}`).toContain(name);
    }
    for (const obsoleteName of ["send_input", "resume_agent", "close_agent"]) {
      expect(branch, `${path} must not name obsolete ${obsoleteName}`).not.toContain(obsoleteName);
    }
  });

  test("orchestration uses native agents without invoking the bridge", async () => {
    const content = await readFile(join(ROOT, "skills/orchestrate/SKILL.md"), "utf8");
    const branch = content.match(/## Standalone Codex orchestration([\s\S]*?)(?=\n## |$)/i)?.[1];
    expect(branch).toBeDefined();
    expect(branch).toContain("spawn_agent");
    expect(branch).toMatch(/never invoke the Claude-to-Codex bridge/i);
  });

  test("the Codex adapter and every standalone skill branch omit obsolete lifecycle names", async () => {
    const paths = [
      "codex/AGENTS.append.md",
      "skills/fix/SKILL.md",
      "skills/orchestrate/SKILL.md",
      "skills/refactor/SKILL.md",
      "skills/review/SKILL.md",
      "skills/ship/SKILL.md",
      "skills/verify/SKILL.md",
    ];
    for (const path of paths) {
      const content = await readFile(join(ROOT, path), "utf8");
      const contract = path.startsWith("skills/") ? standaloneSection(content) : content;
      for (const obsolete of ["send_input", "resume_agent", "close_agent"]) {
        expect(contract, `${path} must not name obsolete ${obsolete}`).not.toContain(obsolete);
      }
    }
  });

  test("standalone Codex lifecycle guidance waits and reuses agents without close directives", async () => {
    const paths = [
      "codex/AGENTS.append.md",
      "skills/fix/SKILL.md",
      "skills/orchestrate/SKILL.md",
      "skills/refactor/SKILL.md",
      "skills/review/SKILL.md",
      "skills/ship/SKILL.md",
      "skills/verify/SKILL.md",
    ];
    const closeDirective =
      /\b(?:close(?:\s+it|\s+(?:the|that|a)\s+(?:agent|explorer|writer|worker|thread)|\s+(?:spawned|running)\s+(?:agent|worker|thread))|closing\s+(?:an?\s+|the\s+)?(?:agent|worker|thread))\b/i;
    for (const path of paths) {
      const content = await readFile(join(ROOT, path), "utf8");
      const contract = path.startsWith("skills/") ? standaloneSection(content) : content;
      expect(contract, `${path} directs Codex to close a spawned agent`).not.toMatch(
        closeDirective,
      );
      if (!contract.includes("spawn_agent")) continue;
      expect(contract, `${path} must wait for spawned work`).toContain("wait_agent");
      expect(contract, `${path} must reuse idle agents`).toContain("followup_task");
      expect(contract, `${path} must wait for completion or idle state`).toMatch(
        /(?:wait_agent[\s\S]{0,160}(?:finish|idle)|(?:finish|idle)[\s\S]{0,160}wait_agent)/i,
      );
    }
  });

  test.each([
    "skills/fix/SKILL.md",
    "skills/proof-of-work/SKILL.md",
    "skills/refactor/SKILL.md",
    "skills/review/SKILL.md",
    "skills/ship/SKILL.md",
    "skills/verify/SKILL.md",
  ])("%s explicitly avoids self-invoking the Claude-to-Codex bridge", async (path) => {
    const branch = standaloneSection(await readFile(join(ROOT, path), "utf8"));
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).toMatch(/never spawn\s+`codex-verifier`/i);
    expect(branch).toMatch(/(?:never\s+run|never\s+call|or\s+call)\s+`codex-run\.ts`/i);
  });

  test("host-specific workflows keep their standalone Codex safety contracts", async () => {
    const [cc, bridge, tldr, freeze, autoresearch] = await Promise.all([
      readFile(join(ROOT, "skills/cc/SKILL.md"), "utf8"),
      readFile(join(ROOT, "skills/codex/SKILL.md"), "utf8"),
      readFile(join(ROOT, "skills/tldr/SKILL.md"), "utf8"),
      readFile(join(ROOT, "skills/freeze/SKILL.md"), "utf8"),
      readFile(join(ROOT, "skills/autoresearch/SKILL.md"), "utf8"),
    ]);
    expect(cc).toContain("--target=codex");
    expect(standaloneSection(bridge)).toMatch(
      /Never recursively invoke `codex-run\.ts`|do not.*recurs/i,
    );
    expect(standaloneSection(tldr)).toMatch(/rg --files/);
    expect(standaloneSection(tldr)).toMatch(/rg -n/);
    expect(standaloneSection(freeze)).toMatch(/fail(?:s)? closed|refuse|stop/i);
    expect(standaloneSection(autoresearch)).toMatch(/fail(?:s)? closed|refuse|stop/i);
  });

  test("cc update trusts only the exact GitHub HTTPS origin before pull or setup", async () => {
    const cc = await readFile(join(ROOT, "skills/cc/SKILL.md"), "utf8");
    expect(cc).not.toMatch(/remote get-url origin[^\n]*grep/);
    expect(cc).toContain(
      '[ "$NORMALIZED_ORIGIN" = "https://github.com/darkroomengineering/cc-settings" ]',
    );
    const expression = cc.match(/NORMALIZED_ORIGIN=.*sed -E '([^']+)'/)?.[1];
    expect(expression).toBeDefined();

    const accepted = [
      "https://github.com/darkroomengineering/cc-settings",
      "https://github.com/darkroomengineering/cc-settings.git",
      "https://github.com/darkroomengineering/cc-settings/",
      "https://github.com/darkroomengineering/cc-settings.git/",
    ];
    const rejected = [
      "https://evil.example/darkroomengineering/cc-settings",
      "https://github.com/darkroomengineering/cc-settings-extra",
      "https://github.com@evil.example/darkroomengineering/cc-settings",
      "https://evil.example/github.com/darkroomengineering/cc-settings",
      "https://github.com/darkroomengineering/cc-settings?ref=main",
      "https://github.com/darkroomengineering/cc-settings#main",
      "file:///tmp/cc-settings",
      "/tmp/cc-settings",
    ];
    const trusted = "https://github.com/darkroomengineering/cc-settings";
    const normalize = async (origin: string): Promise<string> => {
      const proc = Bun.spawn(["sed", "-E", expression as string], {
        stdin: new Blob([`${origin}\n`]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      return stdout.trimEnd();
    };

    for (const origin of accepted) expect(await normalize(origin), origin).toBe(trusted);
    for (const origin of rejected) expect(await normalize(origin), origin).not.toBe(trusted);
    expect(cc.indexOf("remote get-url origin")).toBeLessThan(cc.indexOf("pull --ff-only origin"));
  });
});

describe("Codex CLI package acceptance", () => {
  const codex = Bun.which("codex");

  test.skipIf(!codex)(
    "the real CLI follows full, light, rollback, and uninstall plugin state",
    async () => {
      if (!codex) throw new Error("codex executable unavailable");
      const home = await mkdtemp(join(tmpdir(), "cc-codex-package-"));
      const codexHome = join(home, ".codex");
      try {
        await mkdir(codexHome, { recursive: true });
        const env = {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CODEX_HOME: codexHome,
          CC_SKIP_DEPS: "1",
          CC_SKIP_SCHEDULE: "1",
          CC_SKIP_CODEX_CLI: "0",
          NO_COLOR: "1",
        };
        const run = async (command: string[]): Promise<string> => {
          const child = Bun.spawn(command, { env, stdout: "pipe", stderr: "pipe" });
          const [exitCode, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
          expect(exitCode, `${command.join(" ")}\n${stdout}\n${stderr}`).toBe(0);
          return stdout;
        };
        const installed = async (): Promise<
          Array<{ name?: string; installed?: boolean; enabled?: boolean }>
        > => {
          const parsed = JSON.parse(await run([codex, "plugin", "list", "--json"])) as {
            installed?: Array<{ name?: string; installed?: boolean; enabled?: boolean }>;
          };
          return parsed.installed ?? [];
        };

        await run(["bun", join(ROOT, "src/setup.ts"), `--source=${ROOT}`, "--target=codex"]);
        expect(await installed()).toContainEqual(
          expect.objectContaining({ name: "darkroom", installed: true, enabled: true }),
        );

        await run([
          "bun",
          join(ROOT, "src/setup.ts"),
          `--source=${ROOT}`,
          "--target=codex",
          "--light",
        ]);
        expect(await installed()).not.toContainEqual(
          expect.objectContaining({ name: "darkroom", installed: true, enabled: true }),
        );
        expect(
          JSON.parse(await readFile(join(codexHome, ".cc-settings-version"), "utf8")).profile,
        ).toBe("light");
        expect(existsSync(join(codexHome, "agents", "implementer.toml"))).toBe(false);
        expect(existsSync(join(codexHome, "rules", "darkroom.rules"))).toBe(false);

        await run([
          "bun",
          join(ROOT, "src/setup.ts"),
          `--source=${ROOT}`,
          "--target=codex",
          "--rollback",
        ]);
        expect(await installed()).toContainEqual(
          expect.objectContaining({ name: "darkroom", installed: true, enabled: true }),
        );
        expect(
          JSON.parse(await readFile(join(codexHome, ".cc-settings-version"), "utf8")).profile,
        ).toBe("full");
        expect(existsSync(join(codexHome, "agents", "implementer.toml"))).toBe(true);
        expect(existsSync(join(codexHome, "rules", "darkroom.rules"))).toBe(true);

        await run([
          "bun",
          join(ROOT, "src/setup.ts"),
          `--source=${ROOT}`,
          "--target=codex",
          "--uninstall",
        ]);
        expect(await installed()).not.toContainEqual(
          expect.objectContaining({ name: "darkroom", installed: true, enabled: true }),
        );
        expect(existsSync(join(codexHome, ".cc-settings-version"))).toBe(false);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { timeout: 60_000 },
  );
});
