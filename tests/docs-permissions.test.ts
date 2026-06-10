// Freshness test for the auto-generated permissions block in docs/settings-reference.md.
//
// Asserts that the text currently between the BEGIN/END markers equals the
// output of buildPermissionsBlock(). A hand-edit to the block, or a change to
// config/30-permissions.json without re-running `bun run docs:permissions`,
// will fail this test.
//
// Fix: run `bun run docs:permissions` and commit the result.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BEGIN, buildPermissionsBlock, END } from "../src/lib/permissions-doc.ts";

const ROOT = resolve(import.meta.dir, "..");

describe("docs/settings-reference.md permissions block is fresh", () => {
  test("generated block matches buildPermissionsBlock() output", async () => {
    const docPath = resolve(ROOT, "docs", "settings-reference.md");
    const content = await readFile(docPath, "utf8");

    const beginIdx = content.indexOf(BEGIN);
    const endIdx = content.indexOf(END);

    if (beginIdx === -1 || endIdx === -1) {
      throw new Error(
        `Markers not found in docs/settings-reference.md.\nExpected:\n  ${BEGIN}\n  ${END}`,
      );
    }

    // Extract the text between the markers (exclusive of the markers themselves)
    const actual = content.slice(beginIdx + BEGIN.length, endIdx);

    const expected = `\n${buildPermissionsBlock(ROOT)}\n`;

    if (actual !== expected) {
      throw new Error(
        "docs/settings-reference.md permissions block is stale.\n" +
          "Run `bun run docs:permissions` and commit the result.",
      );
    }

    expect(actual).toBe(expected);
  });
});
