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
      expect(report).toContain("does NOT exist");
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
  test("CLAUDE.md/AGENTS.md present with sizes; rules/ counted as path-conditioned", async () => {
    const claude = await makeTmpDir();
    const home = await makeTmpDir();
    try {
      await writeFile(join(claude, "CLAUDE.md"), "hello world");
      await mkdir(join(claude, "rules"), { recursive: true });
      await writeFile(join(claude, "rules", "react.md"), "# react rule");
      await writeFile(join(claude, "rules", "git.md"), "# git rule");

      const data = await gatherWhatsOn(installPaths(claude, home));
      expect(data.alwaysOn.claudeMd.present).toBe(true);
      expect(data.alwaysOn.claudeMd.bytes).toBe("hello world".length);
      expect(data.alwaysOn.agentsMd.present).toBe(false);
      expect(data.alwaysOn.rulesCount).toBe(2);

      const report = formatWhatsOn(data);
      expect(report).toContain("PATH-CONDITIONED");
    } finally {
      await cleanup(claude, home);
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
