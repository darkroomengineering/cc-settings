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
import { findToolByName } from "../src/codemap/tools.ts";
import { git, makeRepo } from "./support/git.ts";

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
  test("instantiated generic methods retain their declaration's callers", async () => {
    const project = await mkdtemp(join(tmpdir(), "ccmap-generic-"));
    try {
      await writeFile(
        join(project, "box.ts"),
        'export class Box<T> { use(value: T) { return value; } }\nconst box = new Box<string>();\nexport function caller() { return box.use("foo"); }\n',
      );
      const context = await getContext(project, "Box.use");
      expect(context?.callers.some((caller) => caller.file === "box.ts" && caller.line === 3)).toBe(
        true,
      );
      const impact = await getImpact(project, "Box.use");
      expect(
        impact?.references.some((reference) => reference.file === "box.ts" && reference.line === 3),
      ).toBe(true);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
  test("renamed imports retain their symbol's callers without unrelated names", async () => {
    const project = await mkdtemp(join(tmpdir(), "ccmap-alias-"));
    try {
      // Name lookup selects the first declaration. Pin the intended target
      // before its unrelated namesake instead of relying on directory order.
      await writeFile(
        join(project, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { module: "esnext", moduleResolution: "bundler", noEmit: true },
          files: ["a.ts", "b.ts", "c.ts"],
        }),
      );
      await writeFile(join(project, "a.ts"), "export function auditedTarget() { return 1; }\n");
      await writeFile(
        join(project, "b.ts"),
        'import { auditedTarget as renamed } from "./a";\nexport function caller() { return renamed(); }\n',
      );
      await writeFile(
        join(project, "c.ts"),
        "function auditedTarget() { return 2; }\nexport function unrelated() { return auditedTarget(); }\n",
      );
      const impact = await getImpact(project, "auditedTarget");
      expect(impact).not.toBeNull();
      expect(
        impact?.references.some((reference) => reference.file === "b.ts" && reference.line === 2),
      ).toBe(true);
      expect(impact?.references.some((reference) => reference.file === "c.ts")).toBe(false);
      const context = await getContext(project, "auditedTarget");
      expect(context?.callers.some((caller) => caller.file === "b.ts")).toBe(true);
      expect(context?.callers.some((caller) => caller.file === "c.ts")).toBe(false);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  for (const extension of ["mjs", "cjs"]) {
    test(`config-less .${extension} projects appear in structure and change impact`, async () => {
      const project = await makeRepo("ccmap-js-module");
      try {
        const name = `entry.${extension}`;
        const source = (value: number) =>
          extension === "mjs"
            ? `export function moduleEntry() { return ${value}; }\n`
            : `function moduleEntry() { return ${value}; }\nmodule.exports = { moduleEntry };\n`;
        await writeFile(join(project, name), source(1));
        await git(project, ["add", name]);
        await git(project, ["commit", "-qm", "module baseline"]);
        await writeFile(join(project, name), source(2));
        const tree = await getTree(project);
        expect(tree?.files).toContain(name);
        const impact = await getChangeImpact(project);
        expect(impact?.changedFiles).toContain(name);
        if (extension === "mjs") {
          expect(impact?.changedSymbols.some((symbol) => symbol.name === "moduleEntry")).toBe(true);
        }
      } finally {
        await rm(project, { recursive: true, force: true });
      }
    });
  }
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

  // FIX C regression: a wrong/missing argument key must return a structured
  // error, never a silent empty result — an empty result is indistinguishable
  // from a true "no references found".
  describe("FIX C: missing required argument returns a structured error", () => {
    test.skipIf(!engineAvailable)(
      "impact: wrong arg key ('symbol' instead of 'function')",
      async () => {
        const tool = findToolByName("impact");
        if (!tool) throw new Error("impact tool missing from registry");
        const result = (await tool.handler({ symbol: "foo", project: dir })) as Record<
          string,
          unknown
        >;
        expect(result.error).toBe("missing-required-argument");
        expect(result.tool).toBe("impact");
        expect(result.expected).toEqual(["function", "name", "entry"]);
      },
    );

    test.skipIf(!engineAvailable)(
      "impact: correct arg key ('function') still returns real references",
      async () => {
        const tool = findToolByName("impact");
        if (!tool) throw new Error("impact tool missing from registry");
        const result = (await tool.handler({ function: "foo", project: dir })) as {
          references?: unknown[];
          error?: string;
        };
        expect(result.error).toBeUndefined();
        expect(result.references?.length ?? 0).toBeGreaterThan(0);
      },
    );

    test.skipIf(!engineAvailable)("context: empty entry returns a structured error", async () => {
      const tool = findToolByName("context");
      if (!tool) throw new Error("context tool missing from registry");
      const result = (await tool.handler({ project: dir })) as Record<string, unknown>;
      expect(result.error).toBe("missing-required-argument");
      expect(result.tool).toBe("context");
    });

    test.skipIf(!engineAvailable)("extract: empty file returns a structured error", async () => {
      const tool = findToolByName("extract");
      if (!tool) throw new Error("extract tool missing from registry");
      const result = (await tool.handler({ project: dir })) as Record<string, unknown>;
      expect(result.error).toBe("missing-required-argument");
      expect(result.tool).toBe("extract");
    });

    test.skipIf(!engineAvailable)("imports: empty file returns a structured error", async () => {
      const tool = findToolByName("imports");
      if (!tool) throw new Error("imports tool missing from registry");
      const result = (await tool.handler({ project: dir })) as Record<string, unknown>;
      expect(result.error).toBe("missing-required-argument");
      expect(result.tool).toBe("imports");
    });

    test.skipIf(!engineAvailable)(
      "importers: empty target returns a structured error",
      async () => {
        const tool = findToolByName("importers");
        if (!tool) throw new Error("importers tool missing from registry");
        const result = (await tool.handler({ project: dir })) as Record<string, unknown>;
        expect(result.error).toBe("missing-required-argument");
        expect(result.tool).toBe("importers");
      },
    );

    // structure/tree are unaffected — an empty/absent argument is legitimately
    // meaningful (whole-project scope), never a wrong-key mistake.
    test.skipIf(!engineAvailable)("structure with no extra args is NOT an error", async () => {
      const tool = findToolByName("structure");
      if (!tool) throw new Error("structure tool missing from registry");
      const result = (await tool.handler({ project: dir })) as Record<string, unknown>;
      expect(result.error).toBeUndefined();
    });
  });
});
