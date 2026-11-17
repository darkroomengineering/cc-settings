// Hook fail-open regression: every wired hook command (config/40-hooks.json,
// the scripts dispatch.ts runs, and the statusline command from
// config/10-core.json) is spawned with garbage stdin and garbage TOOL_INPUT
// env, and must exit 0. This applies to the blocking PreToolUse hooks too
// (safety-net, pre-edit-validate, freeze-guard): fail-open means a hook only
// blocks on a POSITIVE match against well-formed input — unparseable input
// must never block.
//
// HOME is sandboxed to a tmp dir so the spawned hooks can't touch the real
// ~/.claude state.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

interface HookEntry {
  command?: string;
}
interface HookGroup {
  hooks: HookEntry[];
}

/** `bun [--no-env-file] [--config="$HOME/.claude/src/bunfig.toml"] "$HOME/.claude/<rel>.ts" [args…]` → { rel, args }, or null. */
function parseWiredCommand(cmd: string): { rel: string; args: string[] } | null {
  const m = cmd.match(
    /^bun(?:\s+--no-env-file)?(?:\s+--config="\$HOME\/\.claude\/src\/bunfig\.toml")?\s+"\$HOME\/\.claude\/([^"\s]+\.ts)"(?:\s+(.*))?$/,
  );
  if (!m?.[1]) return null;
  const args = (m[2] ?? "").split(/\s+/).filter((a) => a.length > 0);
  return { rel: m[1], args };
}

/**
 * The handler scripts src/hooks/dispatch.ts runs in-process, relative to the
 * repo root. Their wiring is the dispatcher's, but each one still runs as its
 * own script, so the fail-open contract is checked on them directly too.
 */
async function collectDispatchedScripts(): Promise<string[]> {
  const src = await readFile(resolve(ROOT, "src", "hooks", "dispatch.ts"), "utf8");
  return [...src.matchAll(/import\("(\.[^"]+\.ts)"\)/g)].map((m) =>
    posix.join("src/hooks", m[1] as string),
  );
}

/**
 * Every wired hook command (incl. args) + the statusline command, and any
 * wired command that names a script but has a shape the parser cannot spawn.
 */
async function collectWiredCommands(): Promise<{
  cmds: Array<{ rel: string; args: string[] }>;
  unparsed: string[];
}> {
  const seen = new Map<string, { rel: string; args: string[] }>();
  const unparsed: string[] = [];
  const add = (cmd: string) => {
    const parsed = parseWiredCommand(cmd);
    if (parsed) seen.set(`${parsed.rel} ${parsed.args.join(" ")}`, parsed);
    else if (/\$HOME\/\.claude\/[^"\s]+\.ts/.test(cmd)) unparsed.push(cmd);
  };

  const hooksRaw = await readFile(resolve(ROOT, "config", "40-hooks.json"), "utf8");
  const cfg = JSON.parse(hooksRaw) as { hooks?: Record<string, HookGroup[]> };
  for (const groups of Object.values(cfg.hooks ?? {})) {
    for (const group of groups) {
      for (const entry of group.hooks ?? []) {
        if (entry.command) add(entry.command);
      }
    }
  }

  for (const rel of await collectDispatchedScripts()) seen.set(`${rel} `, { rel, args: [] });

  const coreRaw = await readFile(resolve(ROOT, "config", "10-core.json"), "utf8");
  const core = JSON.parse(coreRaw) as { statusLine?: { command?: string } };
  if (core.statusLine?.command) add(core.statusLine.command);

  return { cmds: [...seen.values()], unparsed };
}

describe("hook scripts fail open", () => {
  test("every wired command exits 0 on garbage stdin + garbage TOOL_INPUT", async () => {
    const { cmds, unparsed } = await collectWiredCommands();
    expect(unparsed).toEqual([]);
    // Sanity: the collector must see the hook set AND the statusline.
    expect(cmds.length).toBeGreaterThan(10);
    expect(cmds.some((c) => c.rel.endsWith("statusline.ts"))).toBe(true);

    const home = await mkdtemp(join(tmpdir(), "cc-failopen-"));
    try {
      const results = await Promise.all(
        cmds.map(async ({ rel, args }) => {
          const proc = Bun.spawn(["bun", resolve(ROOT, rel), ...args], {
            env: {
              ...process.env,
              HOME: home,
              USERPROFILE: home,
              TOOL_INPUT: "{{{ not json",
              TOOL_INPUT_command: "not json{{{",
              TOOL_INPUT_file_path: "",
            },
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          });
          proc.stdin.write("not json{{{");
          proc.stdin.end();
          const exit = await proc.exited;
          return { cmd: [rel, ...args].join(" "), exit };
        }),
      );
      const failures = results.filter((r) => r.exit !== 0).map((r) => `${r.cmd} → exit ${r.exit}`);
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} hook command(s) did not fail open on garbage input:\n  ${failures.join("\n  ")}`,
        );
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);
});
