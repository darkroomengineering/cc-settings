// Freshness test for the generated hook tables in docs/hooks-reference.md, and
// for hook-bench's coverage of the synchronous hooks in config/40-hooks.json.
//
// Fix a stale doc: run `bun run docs:hooks` and commit the result.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HookEntry } from "../src/lib/hook-frequency.ts";
import {
  HOOK_DESCRIPTIONS,
  loadHookConfig,
  renderHooksDoc,
  updateHooksDoc,
} from "../src/lib/hooks-doc.ts";
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
    const extra = `${doc}\n<!-- BEGIN AUTOGEN:hooks FileChanged -->\n\n<!-- END AUTOGEN:hooks FileChanged -->\n`;
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

describe("updateHooksDoc", () => {
  const NOTIFY_END = "<!-- END AUTOGEN:hooks Notification -->";
  const LAST_SPEC = [...doc.matchAll(/<!-- END AUTOGEN:hooks (.+?) -->/g)].at(-1)?.[1] ?? "";
  const LAST_END = `<!-- END AUTOGEN:hooks ${LAST_SPEC} -->`;

  async function run(text: string, check = false, wired: readonly HookEntry[] = entries) {
    const dir = await mkdtemp(join(tmpdir(), "docs-hooks-"));
    const path = join(dir, "hooks-reference.md");
    try {
      await writeFile(path, text);
      const result = await updateHooksDoc(path, wired, { check });
      return { ...result, after: await readFile(path, "utf8") };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const broken: [string, string, RegExp][] = [
    [
      "a lost END marker before the next region",
      doc.replace(NOTIFY_END, ""),
      /BEGIN "SessionEnd" inside "Notification"/,
    ],
    [
      "a lost END marker on the last region",
      doc.replace(LAST_END, ""),
      new RegExp(`"${LAST_SPEC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" has no END`),
    ],
    [
      "a nested BEGIN marker",
      doc.replace(NOTIFY_END, `<!-- BEGIN AUTOGEN:hooks Stop -->\n${NOTIFY_END}`),
      /BEGIN "Stop" inside "Notification"/,
    ],
    [
      "an END marker naming another region",
      doc.replace(NOTIFY_END, "<!-- END AUTOGEN:hooks Stop -->"),
      /END "Stop" closes "Notification"/,
    ],
    [
      "a duplicate region",
      `${doc}\n<!-- BEGIN AUTOGEN:hooks Stop -->\n\n<!-- END AUTOGEN:hooks Stop -->\n`,
      /a second region "Stop"/,
    ],
    [
      "an END marker with no selectors",
      doc.replace(NOTIFY_END, "<!-- END AUTOGEN:hooks -->"),
      /END marker names no selectors/,
    ],
  ];

  for (const [name, text, problem] of broken) {
    test(`refuses ${name} and leaves the file byte-identical`, async () => {
      expect(text).not.toBe(doc);
      const { problems, wrote, after } = await run(text);
      expect(problems.join("\n")).toMatch(problem);
      expect(wrote).toBe(false);
      expect(after).toBe(text);
    });
  }

  test("does not write when a wired hook has no description", async () => {
    const stale = doc.replace("| `notify.ts` | Sends desktop", "| `notify.ts` | Sends a desktop");
    const wired = [...entries, entry({ id: "new-hook", event: "Stop" })];
    const { problems, wrote, after } = await run(stale, false, wired);
    expect(problems.length).toBeGreaterThan(0);
    expect(wrote).toBe(false);
    expect(after).toBe(stale);
  });

  test("rewrites a stale table, and --check reports it without writing", async () => {
    const stale = doc.replace("| `notify.ts` | Sends desktop", "| `notify.ts` | Sends a desktop");
    expect(stale).not.toBe(doc);
    const checked = await run(stale, true);
    expect(checked).toMatchObject({ problems: [], stale: true, wrote: false, after: stale });
    const written = await run(stale);
    expect(written).toMatchObject({ problems: [], stale: true, wrote: true, after: doc });
  });
});
