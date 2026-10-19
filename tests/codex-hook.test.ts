import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const ADAPTER = resolve(REPO, "src/scripts/codex-hook.ts");

/** The adapter refuses a PLUGIN_ROOT other than its own checkout, so a test
 *  root gets its own copy of the adapter and runs that. */
async function adapterIn(pluginRoot: string): Promise<string> {
  if (resolve(pluginRoot) === REPO) return ADAPTER;
  await mkdir(join(pluginRoot, "src", "scripts"), { recursive: true });
  await mkdir(join(pluginRoot, "src", "lib"), { recursive: true });
  const copy = join(pluginRoot, "src", "scripts", "codex-hook.ts");
  await copyFile(ADAPTER, copy);
  await copyFile(
    join(REPO, "src", "lib", "merge-keyed.ts"),
    join(pluginRoot, "src", "lib", "merge-keyed.ts"),
  );
  await copyFile(join(REPO, "src", "bunfig.toml"), join(pluginRoot, "src", "bunfig.toml"));
  return copy;
}

interface AdapterResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runAdapter(
  pluginRoot: string,
  target: string,
  rawInput: string,
  extraEnv: Record<string, string> = {},
  cwd?: string,
): Promise<AdapterResult> {
  const child = Bun.spawn(["bun", await adapterIn(pluginRoot), target, "forwarded-arg"], {
    ...(cwd ? { cwd } : {}),
    env: {
      ...process.env,
      PLUGIN_ROOT: pluginRoot,
      PLUGIN_DATA: join(pluginRoot, "plugin-data"),
      ...extraEnv,
    },
    stdin: new Blob([rawInput]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("Codex hook adapter", () => {
  test("preserves stdin, maps Codex fields, forwards args, and propagates child output and exit", async () => {
    const pluginRoot = await mkdtemp(join(tmpdir(), "cc-codex-hook-"));
    try {
      await mkdir(join(pluginRoot, "safe"), { recursive: true });
      await writeFile(
        join(pluginRoot, "safe", "target.ts"),
        [
          "const raw = await Bun.stdin.text();",
          "console.log(JSON.stringify({",
          "  raw,",
          "  source: process.env.CC_SETTINGS_SOURCE,",
          "  home: process.env.CC_SETTINGS_HOME,",
          "  prompt: process.env.PROMPT,",
          "  session: process.env.CLAUDE_SESSION_ID,",
          "  codeSession: process.env.CLAUDE_CODE_SESSION_ID,",
          "  toolInput: process.env.TOOL_INPUT,",
          "  command: process.env.TOOL_INPUT_command,",
          "  count: process.env.TOOL_INPUT_count,",
          "  enabled: process.env.TOOL_INPUT_enabled,",
          "  unsafeKey: process.env['TOOL_INPUT_bad-key'],",
          "  args: process.argv.slice(2),",
          "}));",
          "console.error('target-stderr');",
          "process.exit(7);",
          "",
        ].join("\n"),
      );

      const raw =
        '{\n  "session_id":"session-42", "prompt":"ship it", "tool_input":{"command":"git status", "count":3, "enabled":true, "bad-key":"ignored", "nested":{"x":1}}\n}\n';
      const result = await runAdapter(pluginRoot, "safe/target.ts", raw);

      expect(result.exitCode).toBe(7);
      expect(result.stderr).toContain("target-stderr");
      const observed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(observed.raw).toBe(raw);
      expect(observed.source).toBe(realpathSync.native(pluginRoot));
      expect(observed.home).toBe(join(pluginRoot, "plugin-data"));
      expect(observed.prompt).toBe("ship it");
      expect(observed.session).toBe("session-42");
      expect(observed.codeSession).toBe("session-42");
      expect(JSON.parse(observed.toolInput as string)).toEqual({
        command: "git status",
        count: 3,
        enabled: true,
        "bad-key": "ignored",
        nested: { x: 1 },
      });
      expect(observed.command).toBe("git status");
      expect(observed.count).toBe("3");
      expect(observed.enabled).toBe("true");
      expect(observed.unsafeKey).toBeUndefined();
      expect(observed.args).toEqual(["forwarded-arg"]);
    } finally {
      await rm(pluginRoot, { recursive: true, force: true });
    }
  });

  test.each(["../outside.ts", "safe/missing.ts"])(
    "rejects unsafe or unknown target %s with exit 2",
    async (target) => {
      const pluginRoot = await mkdtemp(join(tmpdir(), "cc-codex-hook-reject-"));
      try {
        const result = await runAdapter(pluginRoot, target, "{}\n");
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("[codex-hook]");
      } finally {
        await rm(pluginRoot, { recursive: true, force: true });
      }
    },
  );

  // User-level hooks written by the installer get neither PLUGIN_ROOT nor PLUGIN_DATA.
  test("without PLUGIN_ROOT it runs targets from its own checkout and keeps data under CODEX_HOME", async () => {
    const tree = await mkdtemp(join(tmpdir(), "cc-codex-hook-self-"));
    const codexHome = join(tree, "codex-home");
    try {
      await mkdir(join(tree, "checkout", "src", "scripts"), { recursive: true });
      await mkdir(join(tree, "checkout", "src", "lib"), { recursive: true });
      await copyFile(ADAPTER, join(tree, "checkout", "src", "scripts", "codex-hook.ts"));
      await copyFile(
        resolve(import.meta.dir, "../src/lib/merge-keyed.ts"),
        join(tree, "checkout", "src", "lib", "merge-keyed.ts"),
      );
      await copyFile(
        resolve(import.meta.dir, "../src/bunfig.toml"),
        join(tree, "checkout", "src", "bunfig.toml"),
      );
      await writeFile(
        join(tree, "checkout", "src", "probe.ts"),
        "console.log(JSON.stringify({ home: process.env.CC_SETTINGS_HOME, source: process.env.CC_SETTINGS_SOURCE }));\n",
      );
      const env: Record<string, string | undefined> = { ...process.env, CODEX_HOME: codexHome };
      delete env.PLUGIN_ROOT;
      delete env.CLAUDE_PLUGIN_ROOT;
      delete env.PLUGIN_DATA;
      const run = async (target: string) => {
        const child = Bun.spawn(
          ["bun", join(tree, "checkout", "src", "scripts", "codex-hook.ts"), target],
          {
            cwd: tree,
            env: env as Record<string, string>,
            stdin: new Blob(["{}\n"]),
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
      };

      const ok = await run("src/probe.ts");
      expect(ok.exitCode).toBe(0);
      const observed = JSON.parse(ok.stdout) as { home: string; source: string };
      const dataDir = join(codexHome, "plugins", "data", "darkroom-cc-settings");
      expect(observed.home).toBe(dataDir);
      expect(existsSync(dataDir)).toBe(true);
      expect(await Bun.file(join(tree, "checkout", "src", "probe.ts")).exists()).toBe(true);
      expect(observed.source.endsWith("checkout")).toBe(true);

      // The traversal check still applies to the self-located root.
      await writeFile(join(tree, "outside.ts"), "console.log('escaped');\n");
      const escaped = await run("../../outside.ts");
      expect(escaped.exitCode).toBe(2);
      expect(escaped.stdout).not.toContain("escaped");
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  }, 30_000);

  // A repository's bunfig.toml `preload` runs inside every bun started in its directory.
  test("a project bunfig.toml preload never runs in the adapter or the hook it starts", async () => {
    const project = await mkdtemp(join(tmpdir(), "cc-codex-hook-preload-"));
    try {
      const marker = join(project, "preload-ran");
      await writeFile(join(project, "bunfig.toml"), 'preload = ["./p.ts"]\n');
      await writeFile(join(project, "p.ts"), `await Bun.write(${JSON.stringify(marker)}, "x");\n`);
      const run = async (...flags: string[]) => {
        const child = Bun.spawn(
          ["bun", "--no-env-file", ...flags, ADAPTER, "src/hooks/safety-net.ts"],
          {
            cwd: project,
            env: { ...process.env, PLUGIN_ROOT: REPO },
            stdin: new Blob([JSON.stringify({ tool_input: { command: "ls" } })]),
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        return await child.exited;
      };

      expect(await run(`--config=${join(REPO, "src", "bunfig.toml")}`)).toBe(0);
      expect(existsSync(marker)).toBe(false);

      // Without --config the project's preload does run, so the check above can fail.
      await run();
      expect(existsSync(marker)).toBe(true);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }, 30_000);

  // A repository's .env can set PLUGIN_ROOT for any bun run in its directory.
  test("a PLUGIN_ROOT outside its own checkout never runs that root's code", async () => {
    const repo = await mkdtemp(join(tmpdir(), "cc-codex-hook-hostile-"));
    try {
      await mkdir(join(repo, "src", "hooks"), { recursive: true });
      const marker = join(repo, "pwned");
      await writeFile(
        join(repo, "src", "hooks", "safety-net.ts"),
        `await Bun.write(${JSON.stringify(marker)}, "x");\n`,
      );
      const env: Record<string, string | undefined> = { ...process.env };
      delete env.PLUGIN_ROOT;
      delete env.CLAUDE_PLUGIN_ROOT;
      delete env.PLUGIN_DATA;
      const runIn = async (args: string[], extra: Record<string, string> = {}) => {
        const child = Bun.spawn(["bun", ...args, ADAPTER, "src/hooks/safety-net.ts"], {
          cwd: repo,
          env: { ...env, ...extra } as Record<string, string>,
          stdin: new Blob(["{}\n"]),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [exitCode, stderr] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ]);
        return { exitCode, stderr };
      };

      const viaEnv = await runIn([], { PLUGIN_ROOT: repo });
      expect(viaEnv.exitCode).toBe(2);
      expect(viaEnv.stderr).toContain("PLUGIN_ROOT must be the checkout");

      await writeFile(join(repo, ".env"), "PLUGIN_ROOT=.\n");
      const viaDotenv = await runIn([]);
      expect(viaDotenv.exitCode).toBe(2);
      // The generated user hooks pass --no-env-file, so the .env is never read.
      const ignored = await runIn(["--no-env-file"]);
      expect(ignored.stderr).not.toContain("PLUGIN_ROOT");
      expect(existsSync(marker)).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});
