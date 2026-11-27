// Freshness test for the generated hook tables in docs/hooks-reference.md, and
// for hook-bench's coverage of the synchronous hooks in config/40-hooks.json.
//
// Fix a stale doc: run `bun run docs:hooks` and commit the result.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HookEntry } from "../src/lib/hook-frequency.ts";
import { HOOK_DESCRIPTIONS, loadHookConfig, renderHooksDoc } from "../src/lib/hooks-doc.ts";
import { benchCoverage } from "../src/scripts/hook-bench.ts";

const ROOT = resolve(import.meta.dir, "..");
const doc = readFileSync(resolve(ROOT, "docs", "hooks-reference.md"), "utf8");
const entries = loadHookConfig(ROOT);

function entry(over: Partial<HookEntry>): HookEntry {
  return {
    id: "x",
    event: "Stop",
    matcher: null,
    filter: null,
    command: 'bun "$HOME/.claude/src/hooks/x.ts"',
    async: false,
    timeout: null,
    onFailure: null,
    ...over,
  };
}

describe("docs/hooks-reference.md hook tables", () => {
  test("match the config, with every wired hook described and placed", () => {
    const { text, problems } = renderHooksDoc(doc, entries);
    expect(problems).toEqual([]);
    if (text !== doc) {
      throw new Error("docs/hooks-reference.md hook tables are stale. Run `bun run docs:hooks`.");
    }
  });

  test("fails a wired hook with no description, no region, or a stale description key", () => {
    const wired = [...entries, entry({ id: "new-hook", event: "Stop" })];
    const { problems } = renderHooksDoc(doc, wired, {
      ...HOOK_DESCRIPTIONS,
      "Stop gone-hook": "removed",
    });
    expect(problems).toContain(
      "Stop new-hook has no description in HOOK_DESCRIPTIONS (src/lib/hooks-doc.ts)",
    );
    expect(problems).toContain('HOOK_DESCRIPTIONS["Stop gone-hook"] names no wired hook');
    const orphan = [...entries, entry({ id: "lonely", event: "CwdChanged" })];
    expect(renderHooksDoc(doc, orphan).problems.join("\n")).toContain(
      "CwdChanged lonely (selector CwdChanged) is in no region",
    );
  });

  test("fails a region whose selector matches no wired hook", () => {
    const extra = `${doc}\n<!-- BEGIN AUTOGEN:hooks FileChanged -->\n\n<!-- END AUTOGEN:hooks -->\n`;
    expect(renderHooksDoc(extra, entries).problems).toContain(
      'region "FileChanged": selector FileChanged matches no wired hook',
    );
  });
});

describe("hook-bench coverage", () => {
  test("every synchronous hook has a payload or a skip reason, and no key is stale", () => {
    expect(benchCoverage(entries)).toEqual([]);
  });

  test("flags an uncovered synchronous hook and keys that name no synchronous hook", () => {
    const problems = benchCoverage([
      ...entries.filter((e) => e.id !== "verify-hooks" && e.id !== "ask-gate"),
      entry({ id: "new-sync-hook" }),
    ]);
    expect(problems).toEqual([
      "new-sync-hook: synchronous hook with no payload in buildCases and no SKIP reason",
      "ask-gate: payload in buildCases names no synchronous hook",
      "verify-hooks: SKIP entry names no synchronous hook",
    ]);
  });

  test("flags a synchronous entry whose matcher accepts none of its id's payloads", () => {
    const notebook = entry({
      id: "dispatch PreToolUse",
      event: "PreToolUse",
      matcher: "NotebookEdit",
    });
    expect(benchCoverage([...entries, notebook])).toEqual([
      "dispatch PreToolUse (PreToolUse, matcher NotebookEdit): no payload in buildCases has a tool its matcher accepts",
    ]);
  });
});
