// Hook fail-open regression. Walks config/40-hooks.json, extracts every
// `command` that points at one of our shipped TS scripts, and asserts the
// script source contains at least one `try {` or `.catch(`. This locks in
// the fail-open contract: a hook crash must not propagate to the parent
// operation. See CHANGELOG v10.6.1.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

interface HookEntry {
  command?: string;
}
interface HookGroup {
  hooks: HookEntry[];
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

describe("hook scripts fail open", () => {
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
