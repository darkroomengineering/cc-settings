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

  test("duplicate top-level keys are flagged (Bun.YAML keeps the last silently)", () => {
    // The `yaml` package threw "Map keys must be unique"; Bun.YAML returns
    // { name: "bar" } with no error. The lint path must still catch this.
    const md = `---
name: foo
description: a skill
name: bar
---
`;
    const result = parseFrontmatterStrict(md);
    expect(result.data).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toContain("name");
  });

  test("indented repeats are NOT false-flagged as duplicate top-level keys", () => {
    // A nested key reusing a top-level name, plus a block scalar containing a
    // colon line — neither is a column-0 key, so neither trips the detector.
    const md = `---
name: outer
metadata:
  name: inner
description: |
  intro
  name: not a key
---
`;
    const result = parseFrontmatterStrict(md);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toMatchObject({ name: "outer", metadata: { name: "inner" } });
  });
});
