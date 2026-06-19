import { describe, expect, test } from "bun:test";
import { parseFrontmatterStrict } from "../src/lib/frontmatter.ts";

describe("parseFrontmatterStrict", () => {
  test("well-formed frontmatter returns data and no errors", () => {
    const md = `---
name: my-skill
description: Use when you want to do something useful with the skill system.
---

Body text here.
`;
    const result = parseFrontmatterStrict(md);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toMatchObject({ name: "my-skill" });
  });

  test("malformed YAML returns null data and a structured error message", () => {
    // "name: foo\n  bar: : :" produces a nested mapping error in compact context.
    // Bun.YAML throws on the first error with a message but no reliable
    // block-relative line/col (see frontmatter.ts), so we assert the message.
    const md = `---
name: foo
  bar: : :
---
`;
    const result = parseFrontmatterStrict(md);
    expect(result.data).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    const err = result.errors[0];
    if (!err) throw new Error("expected at least one error");
    expect(err.message).toBeTruthy();
  });

  test("file with no frontmatter block returns null data and empty errors", () => {
    const md = `# Just a markdown file

No frontmatter here at all.
`;
    const result = parseFrontmatterStrict(md);
    expect(result.data).toBeNull();
    expect(result.errors).toHaveLength(0);
  });
});
