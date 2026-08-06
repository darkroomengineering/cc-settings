// Unit tests for gatherWhatsOn()/formatWhatsOn() in src/scripts/whats-on.ts,
// plus a couple of CLI-level smoke tests (exit code + --json shape).
//
// Unit tests call gatherWhatsOn() directly against a fixture InstallPaths
// (same pattern as tests/status.test.ts) — no console capture needed. CLI
// tests spawn the script with HOME redirected to a fixture, matching
// tests/checkpoint.test.ts's spawn helper.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installPaths } from "../src/lib/platform.ts";
import { formatWhatsOn, gatherWhatsOn } from "../src/scripts/whats-on.ts";

const SCRIPT = resolve(import.meta.dir, "..", "src", "scripts", "whats-on.ts");

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cc-whats-on-test-"));
}

async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
}

describe("gatherWhatsOn — output style", () => {
  test("outputStyle set and style file present → report names the style", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(
        join(claude, "settings.json"),
        JSON.stringify({ outputStyle: "concise" }, null, 2),
      );
      await mkdir(join(claude, "output-styles"), { recursive: true });
      await writeFile(join(claude, "output-styles", "concise.md"), "# concise style\n");

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.outputStyle.name).toBe("concise");
      expect(data.outputStyle.fileExists).toBe(true);

      const report = formatWhatsOn(data);
      expect(report).toContain('"concise"');
      expect(report).not.toContain("does NOT exist");
      expect(report).toContain("MAIN conversation only");
    } finally {
      await cleanup(claude, home);
    }
  });

  test("outputStyle set and style file MISSING → report emits a loud warning", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(
        join(claude, "settings.json"),
        JSON.stringify({ outputStyle: "ghost-style" }, null, 2),
      );

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.outputStyle.name).toBe("ghost-style");
      expect(data.outputStyle.fileExists).toBe(false);

      const report = formatWhatsOn(data);
      expect(report).toContain("no file in ~/.claude/output-styles/ resolves to it");
      expect(report).toContain("ghost-style");
    } finally {
      await cleanup(claude, home);
    }
  });

  test("no outputStyle key → report says the built-in Default is in effect", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(join(claude, "settings.json"), JSON.stringify({}, null, 2));

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.outputStyle.name).toBeNull();
      expect(data.outputStyle.fileExists).toBeNull();

      const report = formatWhatsOn(data);
      expect(report).toContain("Default");
    } finally {
      await cleanup(claude, home);
    }
  });

  test("absent settings.json entirely → treated the same as no outputStyle key", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.outputStyle.name).toBeNull();
    } finally {
      await cleanup(claude, home);
    }
  });
});

describe("gatherWhatsOn — resilience to malformed/unmodelled settings.json", () => {
  test("invalid JSON → gatherWhatsOn does not throw, returns sane defaults", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(join(claude, "settings.json"), "NOT VALID JSON {{{{");
      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.outputStyle.name).toBeNull();
      expect(data.hooks.groupCount).toBe(0);
      expect(() => formatWhatsOn(data)).not.toThrow();
    } finally {
      await cleanup(claude, home);
    }
  });

  test("schema-violating settings.json (model as a number) → falls back to raw JSON, no throw", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(
        join(claude, "settings.json"),
        JSON.stringify({ model: 12345, outputStyle: "raw-fallback" }, null, 2),
      );
      const data = await gatherWhatsOn(installPaths(claude, home));
      // Settings schema fails on model:number, but outputStyle (a valid string)
      // still comes through via the raw-JSON fallback.
      expect(data.outputStyle.name).toBe("raw-fallback");
      expect(() => formatWhatsOn(data)).not.toThrow();
    } finally {
      await cleanup(claude, home);
    }
  });
});

describe("gatherWhatsOn — hooks section", () => {
  test("managed hook script referenced → row includes basename, event, and leading comment", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await mkdir(join(claude, "src", "hooks"), { recursive: true });
      await writeFile(
        join(claude, "src", "hooks", "example.ts"),
        "#!/usr/bin/env bun\n// Example hook — does the thing.\nconsole.log('hi');\n",
      );
      await writeFile(
        join(claude, "settings.json"),
        JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: 'bun "$HOME/.claude/src/hooks/example.ts"',
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        ),
      );

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.hooks.groupCount).toBe(1);
      expect(data.hooks.eventCount).toBe(1);
      expect(data.hooks.scripts).toHaveLength(1);
      expect(data.hooks.scripts[0]?.basename).toBe("example.ts");
      expect(data.hooks.scripts[0]?.events).toEqual(["SessionStart"]);
      expect(data.hooks.scripts[0]?.description).toBe("Example hook — does the thing.");
    } finally {
      await cleanup(claude, home);
    }
  });

  test("managed hook script with no leading comment → description is null, basename still shown", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await mkdir(join(claude, "src", "scripts"), { recursive: true });
      await writeFile(join(claude, "src", "scripts", "bare.ts"), "console.log('hi');\n");
      await writeFile(
        join(claude, "settings.json"),
        JSON.stringify(
          {
            hooks: {
              Stop: [
                {
                  hooks: [{ type: "command", command: 'bun "$HOME/.claude/src/scripts/bare.ts"' }],
                },
              ],
            },
          },
          null,
          2,
        ),
      );

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.hooks.scripts[0]?.basename).toBe("bare.ts");
      expect(data.hooks.scripts[0]?.description).toBeNull();

      const report = formatWhatsOn(data);
      expect(report).toContain("bare.ts");
    } finally {
      await cleanup(claude, home);
    }
  });
});

describe("gatherWhatsOn — inventory", () => {
  test("skills/agents/mcp/permissions counts populated from fixture", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await mkdir(join(claude, "skills", "explore"), { recursive: true });
      await mkdir(join(claude, "skills", "plan"), { recursive: true });
      await mkdir(join(claude, "agents"), { recursive: true });
      await writeFile(join(claude, "agents", "implementer.md"), "# implementer");
      await writeFile(join(home, ".claude.json"), JSON.stringify({ mcpServers: { context7: {} } }));
      await writeFile(
        join(claude, "settings.json"),
        JSON.stringify({ permissions: { allow: ["Bash(*)"], deny: [] } }, null, 2),
      );

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.inventory.skillsCount).toBe(2);
      expect(data.inventory.agentsCount).toBe(1);
      expect(data.inventory.mcpServers).toEqual(["context7"]);
      expect(data.inventory.permissionsAllowCount).toBe(1);
      expect(data.inventory.permissionsDenyCount).toBe(0);
    } finally {
      await cleanup(claude, home);
    }
  });
});

describe("gatherWhatsOn — always-on instructions", () => {
  test("CLAUDE.md present with size; AGENTS.md absent", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(join(claude, "CLAUDE.md"), "hello world");

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.alwaysOn.claudeMd.present).toBe(true);
      expect(data.alwaysOn.claudeMd.bytes).toBe("hello world".length);
      expect(data.alwaysOn.agentsMd.present).toBe(false);
    } finally {
      await cleanup(claude, home);
    }
  });

  // Finding 3(a): AGENTS.md is not auto-loaded by Claude Code — CLAUDE.md only
  // instructs the model to read it. The report must not describe it as
  // injected every turn the way CLAUDE.md genuinely is.
  test("AGENTS.md is NOT described as always-injected", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(join(claude, "AGENTS.md"), "# standards");

      const data = await gatherWhatsOn(installPaths(claude, home));
      const report = formatWhatsOn(data);
      // AGENTS.md's own line must say it is NOT auto-loaded.
      const agentsLine = report.split("\n").find((l) => l.trim().startsWith("AGENTS.md:"));
      expect(agentsLine).toBeDefined();
      expect(agentsLine).toContain("NOT auto-loaded");
      expect(agentsLine).not.toContain("always injected, every turn");
    } finally {
      await cleanup(claude, home);
    }
  });

  // Finding 3(b): a rule file WITHOUT `paths:` frontmatter is always-on, not
  // path-conditioned — split the two counts instead of lumping every rule
  // file under "path-conditioned".
  test("rules dir mixing one file with `paths:` and one without reports both counts correctly", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await mkdir(join(claude, "rules"), { recursive: true });
      // Always-on: no frontmatter at all (mirrors rules/README.md upstream).
      await writeFile(join(claude, "rules", "readme.md"), "# always loaded, no paths: key");
      // Path-conditioned: has a `paths:` frontmatter key.
      await writeFile(
        join(claude, "rules", "react.md"),
        '---\npaths:\n  - "**/*.tsx"\n---\n\n# react rule',
      );

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.alwaysOn.rules.alwaysOnCount).toBe(1);
      expect(data.alwaysOn.rules.pathConditionedCount).toBe(1);
      expect(data.alwaysOn.rules.alwaysOnNames).toEqual(["readme.md"]);

      const report = formatWhatsOn(data);
      expect(report).toContain("PATH-CONDITIONED");
      expect(report).toContain("readme.md");
    } finally {
      await cleanup(claude, home);
    }
  });
});

describe("gatherWhatsOn — output style resolution (Finding 2)", () => {
  // Claude Code resolves an output style by its frontmatter `name:` field,
  // falling back to the filename. A style file whose filename casing differs
  // from its frontmatter `name:` (e.g. output-styles/darkroom.md with
  // `name: Darkroom`) must resolve without a false "missing" warning — this
  // previously only passed by accident on case-insensitive filesystems.
  test("style file whose frontmatter name differs in case from the filename resolves without warning", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(
        join(claude, "settings.json"),
        JSON.stringify({ outputStyle: "Darkroom" }, null, 2),
      );
      await mkdir(join(claude, "output-styles"), { recursive: true });
      await writeFile(
        join(claude, "output-styles", "darkroom.md"),
        "---\nname: Darkroom\n---\n\nplain words only.\n",
      );

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.outputStyle.name).toBe("Darkroom");
      expect(data.outputStyle.fileExists).toBe(true);

      const report = formatWhatsOn(data);
      expect(report).not.toContain("does NOT");
    } finally {
      await cleanup(claude, home);
    }
  });

  // Same bug, made observable on ANY filesystem (the case-only variant above
  // happens to pass on macOS's case-insensitive APFS even with the naive
  // existsSync(`${name}.md`) check the finding flags, since "Darkroom.md" and
  // "darkroom.md" collide at the FS layer there — Linux is where it actually
  // warns falsely). Using a filename that doesn't match the configured name
  // AT ALL (not even case-insensitively) forces resolution through the
  // frontmatter `name:` field specifically, so this fails on every platform
  // without the fix.
  test("style resolves via frontmatter name when the filename doesn't match at all", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(
        join(claude, "settings.json"),
        JSON.stringify({ outputStyle: "MyStyle" }, null, 2),
      );
      await mkdir(join(claude, "output-styles"), { recursive: true });
      await writeFile(
        join(claude, "output-styles", "custom-file-name.md"),
        "---\nname: MyStyle\n---\n\nsome style body.\n",
      );

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.outputStyle.name).toBe("MyStyle");
      expect(data.outputStyle.fileExists).toBe(true);

      const report = formatWhatsOn(data);
      expect(report).not.toContain("does NOT");
    } finally {
      await cleanup(claude, home);
    }
  });
});

describe("gatherWhatsOn — scope (Finding 4)", () => {
  test("no project settings.json in cwd → scope.projectSettingsPath is null", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    const cwd = await makeTmpDir();
    try {
      const data = await gatherWhatsOn(installPaths(claude, home), cwd);
      expect(data.scope.projectSettingsPath).toBeNull();

      const report = formatWhatsOn(data);
      expect(report).toContain("USER-SCOPE INSTALLED state");
      expect(report).toContain("project .claude/settings.json");
      expect(report).not.toContain("NOTE: a project settings.json exists");
    } finally {
      await cleanup(claude, home, cwd);
    }
  });

  test("project settings.json present in cwd → report names it and warns it may override", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    const cwd = await makeTmpDir();
    try {
      await mkdir(join(cwd, ".claude"), { recursive: true });
      await writeFile(join(cwd, ".claude", "settings.json"), "{}");

      const data = await gatherWhatsOn(installPaths(claude, home), cwd);
      expect(data.scope.projectSettingsPath).toBe(join(cwd, ".claude", "settings.json"));

      const report = formatWhatsOn(data);
      expect(report).toContain("NOTE: a project settings.json exists");
      expect(report).toContain("may override");
    } finally {
      await cleanup(claude, home, cwd);
    }
  });
});

describe("whats-on.ts CLI", () => {
  async function spawnScript(
    args: string[],
    home: string,
  ): Promise<{ stdout: string; exit: number }> {
    const proc = Bun.spawn(["bun", SCRIPT, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    return { stdout, exit };
  }

  test("exits 0 and prints all six sections against a fixture install", async () => {
    const home = await makeTmpDir();
    try {
      await mkdir(join(home, ".claude"), { recursive: true });
      const { stdout, exit } = await spawnScript([], home);
      expect(exit).toBe(0);
      expect(stdout).toContain("OUTPUT STYLE");
      expect(stdout).toContain("ALWAYS-ON INSTRUCTIONS");
      expect(stdout).toContain("MODEL & EFFORT");
      expect(stdout).toContain("HOOKS");
      expect(stdout).toContain("INVENTORY");
      expect(stdout).toContain("MANUAL.md");
      expect(stdout).toContain("--status");
    } finally {
      await cleanup(home);
    }
  });

  test("malformed settings.json → CLI still exits 0 and prints a report", async () => {
    const home = await makeTmpDir();
    try {
      await mkdir(join(home, ".claude"), { recursive: true });
      await writeFile(join(home, ".claude", "settings.json"), "NOT VALID JSON {{{{");
      const { stdout, exit } = await spawnScript([], home);
      expect(exit).toBe(0);
      expect(stdout).toContain("OUTPUT STYLE");
    } finally {
      await cleanup(home);
    }
  });

  test("--json emits parseable JSON containing the output-style name", async () => {
    const home = await makeTmpDir();
    try {
      await mkdir(join(home, ".claude"), { recursive: true });
      await writeFile(
        join(home, ".claude", "settings.json"),
        JSON.stringify({ outputStyle: "json-test-style" }, null, 2),
      );
      const { stdout, exit } = await spawnScript(["--json"], home);
      expect(exit).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.outputStyle.name).toBe("json-test-style");
    } finally {
      await cleanup(home);
    }
  });
});
