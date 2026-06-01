import { describe, expect, test } from "bun:test";
import { isWithinBoundary, toAbsolute } from "../src/lib/freeze.ts";

const CWD = "/repo";

describe("isWithinBoundary", () => {
  test("no root ⇒ always allowed", () => {
    expect(isWithinBoundary("/anywhere/file.ts", null, CWD)).toBe(true);
    expect(isWithinBoundary("/anywhere/file.ts", "", CWD)).toBe(true);
  });
  test("file inside boundary allowed", () => {
    expect(isWithinBoundary("/repo/src/a.ts", "/repo/src", CWD)).toBe(true);
  });
  test("the boundary dir itself allowed", () => {
    expect(isWithinBoundary("/repo/src", "/repo/src", CWD)).toBe(true);
  });
  test("file outside boundary blocked", () => {
    expect(isWithinBoundary("/repo/other/a.ts", "/repo/src", CWD)).toBe(false);
  });
  test("sibling-prefix is not inside (src vs src-extra)", () => {
    expect(isWithinBoundary("/repo/src-extra/a.ts", "/repo/src", CWD)).toBe(false);
  });
  test("relative file path resolved against cwd", () => {
    expect(isWithinBoundary("src/a.ts", "/repo/src", CWD)).toBe(true);
    expect(isWithinBoundary("other/a.ts", "/repo/src", CWD)).toBe(false);
  });
  test("'..' escape is blocked", () => {
    expect(isWithinBoundary("/repo/src/../secret.ts", "/repo/src", CWD)).toBe(false);
  });
  test("relative boundary resolved against cwd", () => {
    expect(isWithinBoundary("/repo/src/a.ts", "src", CWD)).toBe(true);
  });
});

describe("toAbsolute", () => {
  test("relative resolves against cwd", () => {
    expect(toAbsolute("src/a.ts", CWD)).toBe("/repo/src/a.ts");
  });
  test("absolute unchanged", () => {
    expect(toAbsolute("/x/y.ts", CWD)).toBe("/x/y.ts");
  });
});
