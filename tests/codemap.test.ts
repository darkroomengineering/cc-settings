import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getContext,
  getImpact,
  getImporters,
  getStatus,
  getStructure,
} from "../src/codemap/index.ts";

// Two-file TypeScript fixture: a.ts exports foo/bar (bar calls foo); b.ts
// imports foo and calls it. Enough to exercise structure, impact (cross-file),
// importers, and context (callers).
let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ccmap-"));
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
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

// Soft-skip the whole suite if the TypeScript compiler can't be resolved at
// runtime (broken node_modules symlink) — the engine degrades to null there.
async function available(): Promise<boolean> {
  return (await getStatus(dir)).available;
}

describe("native codemap", () => {
  test("structure lists exported symbols", async () => {
    if (!(await available())) return;
    const result = await getStructure(dir);
    expect(result).not.toBeNull();
    const foo = result?.symbols.find((s) => s.name === "foo");
    expect(foo?.exported).toBe(true);
    expect(result?.symbols.some((s) => s.name === "useFoo")).toBe(true);
  });

  test("impact finds the cross-file reference", async () => {
    if (!(await available())) return;
    const impact = await getImpact(dir, "foo");
    expect(impact).not.toBeNull();
    expect(impact?.references.some((r) => r.file === "b.ts")).toBe(true);
  });

  test("importers finds the file that imports the target", async () => {
    if (!(await available())) return;
    const importers = await getImporters(dir, "a.ts");
    expect(importers?.importers).toContain("b.ts");
  });

  test("context lists callers", async () => {
    if (!(await available())) return;
    const ctx = await getContext(dir, "foo");
    expect(ctx).not.toBeNull();
    expect(ctx?.callers.length ?? 0).toBeGreaterThan(0);
  });
});
