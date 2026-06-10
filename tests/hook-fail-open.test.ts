// Hook fail-open regression — two layers:
//
//   1. Static: every TS script wired in config/40-hooks.json contains at least
//      one `try {`, `.catch(`, or `runHook(`. Cheap lint-grade lock on the
//      convention. See CHANGELOG v10.6.1.
//   2. Behavioral: every wired hook command (config/40-hooks.json PLUS the
//      statusline command from config/10-core.json) is actually spawned with
//      garbage stdin and garbage TOOL_INPUT env, and must exit 0. This applies
//      to the blocking PreToolUse hooks too (safety-net, pre-edit-validate,
//      freeze-guard): fail-open means a hook only blocks on a POSITIVE match
//      against well-formed input — unparseable input must never block.
//
// HOME is sandboxed to a tmp dir so the spawned hooks can't touch the real
// ~/.claude state.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

interface HookEntry {
  command?: string;
}
interface HookGroup {
  hooks: HookEntry[];
}

/** `bun "$HOME/.claude/<rel>.ts" [args…]` → { rel, args }, or null. */
function parseWiredCommand(cmd: string): { rel: string; args: string[] } | null {
  const m = cmd.match(/^bun\s+"\$HOME\/\.claude\/([^"\s]+\.ts)"(?:\s+(.*))?$/);
  if (!m?.[1]) return null;
  const args = (m[2] ?? "").split(/\s+/).filter((a) => a.length > 0);
  return { rel: m[1], args };
}

/**
 * Pull every TS script path referenced by config/40-hooks.json, normalized
 * relative to the repo root.
 */
async function collectWiredScripts(): Promise<string[]> {
  const raw = await readFile(resolve(ROOT, "config", "40-hooks.json"), "utf8");
  const cfg = JSON.parse(raw) as { hooks?: Record<string, HookGroup[]> };
  const scripts = new Set<string>();
  const events = cfg.hooks ?? {};
  for (const groups of Object.values(events)) {
    for (const group of groups) {
      for (const entry of group.hooks ?? []) {
        const cmd = entry.command ?? "";
        // Match `bun "$HOME/.claude/<rel>"` and capture the relative path.
        const m = cmd.match(/\$HOME\/\.claude\/([^"\s]+\.ts)/);
        if (m?.[1]) scripts.add(m[1]);
      }
    }
  }
  return [...scripts];
}

/** Every wired hook command (incl. args) + the statusline command. */
async function collectWiredCommands(): Promise<Array<{ rel: string; args: string[] }>> {
  const seen = new Map<string, { rel: string; args: string[] }>();
  const add = (cmd: string) => {
    const parsed = parseWiredCommand(cmd);
    if (parsed) seen.set(`${parsed.rel} ${parsed.args.join(" ")}`, parsed);
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

  const coreRaw = await readFile(resolve(ROOT, "config", "10-core.json"), "utf8");
  const core = JSON.parse(coreRaw) as { statusLine?: { command?: string } };
  if (core.statusLine?.command) add(core.statusLine.command);

  return [...seen.values()];
}

describe("hook scripts fail open — static", () => {
  test("every script wired in config/40-hooks.json has try/catch or .catch()", async () => {
    const scripts = await collectWiredScripts();
    expect(scripts.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const rel of scripts) {
      const path = resolve(ROOT, rel);
      const src = await readFile(path, "utf8").catch(() => "");
      if (!src) {
        failures.push(`${rel}: file not readable`);
        continue;
      }
      const hasTry = /\btry\s*\{/.test(src);
      const hasCatch = /\.catch\s*\(/.test(src);
      // `runHook(main)` from src/lib/hook-runtime.ts is the v11.1.1 shared
      // fail-open wrapper — equivalent to an inline try/catch.
      const hasRunHook = /\brunHook\s*\(/.test(src);
      if (!hasTry && !hasCatch && !hasRunHook) {
        failures.push(rel);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} hook script(s) lack fail-open handling:\n  ${failures.join("\n  ")}\n` +
          "Wrap the top-level body in try/catch (see safety-net.ts) or use .catch(() => {}) " +
          "on every IO call. A hook crash must never propagate to the parent operation.",
      );
    }
  });
});

describe("hook scripts fail open — behavioral", () => {
  test("every wired command exits 0 on garbage stdin + garbage TOOL_INPUT", async () => {
    const cmds = await collectWiredCommands();
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
