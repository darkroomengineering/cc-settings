import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getArch,
  getCalls,
  getChangeImpact,
  getContext,
  getImpact,
  getImporters,
  getStatus,
  getStructure,
  getTree,
} from "../src/codemap/index.ts";

// Two-file TypeScript fixture: a.ts exports foo/bar (bar calls foo); b.ts
// imports foo and calls it. Enough to exercise structure, impact (cross-file),
// importers, and context (callers).
//
// Built via top-level await (not beforeAll) so the fixture exists on disk
// before we compute engineAvailable below — test.skipIf needs a resolved
// boolean at describe-registration time, which runs before any lifecycle hook.
const dir = await mkdtemp(join(tmpdir(), "ccmap-"));

await writeFile(
  join(dir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      allowJs: true,
      noEmit: true,
    },
    files: ["a.ts", "b.ts"],
  }),
);
await writeFile(
  join(dir, "a.ts"),
  "export function foo() {\n  return 1;\n}\n\nexport function bar() {\n  return foo();\n}\n",
);
await writeFile(
  join(dir, "b.ts"),
  'import { foo } from "./a";\n\nexport function useFoo() {\n  return foo();\n}\n',
);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

// Resolved once, up front, so a degraded TypeScript engine (broken
// node_modules symlink, resolution change) shows up as an explicit
// "skipped" in test output instead of four silent zero-assertion passes.
const engineAvailable = (await getStatus(dir)).available;

describe("native codemap", () => {
  test.skipIf(!engineAvailable)("structure lists exported symbols", async () => {
    const result = await getStructure(dir);
    expect(result).not.toBeNull();
    const foo = result?.symbols.find((s) => s.name === "foo");
    expect(foo?.exported).toBe(true);
    expect(result?.symbols.some((s) => s.name === "useFoo")).toBe(true);
  });

  test.skipIf(!engineAvailable)("impact finds the cross-file reference", async () => {
    const impact = await getImpact(dir, "foo");
    expect(impact).not.toBeNull();
    expect(impact?.references.some((r) => r.file === "b.ts")).toBe(true);
  });

  test.skipIf(!engineAvailable)("importers finds the file that imports the target", async () => {
    const importers = await getImporters(dir, "a.ts");
    expect(importers?.importers).toContain("b.ts");
  });

  test.skipIf(!engineAvailable)("context lists callers", async () => {
    const ctx = await getContext(dir, "foo");
    expect(ctx).not.toBeNull();
    expect(ctx?.callers.length ?? 0).toBeGreaterThan(0);
  });

  test.skipIf(!engineAvailable)("arch reports per-file export/import counts", async () => {
    const arch = await getArch(dir);
    expect(arch).not.toBeNull();
    const a = arch?.modules.find((m) => m.file === "a.ts");
    const b = arch?.modules.find((m) => m.file === "b.ts");
    expect(a?.exports).toBe(2); // foo, bar
    expect(a?.imports).toBe(0);
    expect(b?.exports).toBe(1); // useFoo
    expect(b?.imports).toBe(1); // "./a"
  });

  test.skipIf(!engineAvailable)("tree lists in-project source files", async () => {
    const tree = await getTree(dir);
    expect(tree).not.toBeNull();
    expect(tree?.files).toContain("a.ts");
    expect(tree?.files).toContain("b.ts");
  });

  test.skipIf(!engineAvailable)("calls finds name-based call edges", async () => {
    const calls = await getCalls(dir);
    expect(calls).not.toBeNull();
    expect(calls?.edges.some((e) => e.from === "bar" && e.to === "foo")).toBe(true);
    expect(calls?.edges.some((e) => e.from === "useFoo" && e.to === "foo")).toBe(true);
  });

  test.skipIf(!engineAvailable)(
    "changeImpact returns empty sets outside a git working tree",
    async () => {
      // The fixture dir lives under os.tmpdir() and is not a git repo, so
      // runGit's diff calls fail closed (empty stdout) — this exercises the
      // "no changes / not a repo" path without needing a real git fixture.
      const impact = await getChangeImpact(dir);
      expect(impact).not.toBeNull();
      expect(impact?.changedFiles).toEqual([]);
      expect(impact?.changedSymbols).toEqual([]);
      expect(impact?.affected).toEqual([]);
    },
  );
});
