// Markdown link validator tests. Two rules (missing-file, missing-anchor) plus
// the parsing that decides what even counts as a link — which is where this
// linter's own first version was wrong: it validated backticked *examples* of
// links as if they were real, and reported two false positives on its first run.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anchorsOf, hasErrors, lintLinksDir, slugify } from "../src/lib/lint-links.ts";

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cc-lint-links-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

async function rules(files: Record<string, string>): Promise<string[]> {
  const dir = await fixture(files);
  try {
    return (await lintLinksDir(dir)).findings.map((f) => f.rule);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("slugify — GitHub heading anchors", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("Daily Workflows")).toBe("daily-workflows");
  });

  test("drops apostrophes and em dashes, leaving the doubled hyphen", () => {
    // The real MANUAL heading that a hand-written `#whats-on` link never matched.
    expect(slugify("What's on — and how to turn it off")).toBe("whats-on--and-how-to-turn-it-off");
  });

  test("drops parentheses", () => {
    expect(slugify("Install Tiers (Light vs Full)")).toBe("install-tiers-light-vs-full");
  });

  test("keeps underscores and existing hyphens", () => {
    expect(slugify("snake_case and kebab-case")).toBe("snake_case-and-kebab-case");
  });
});

describe("anchorsOf", () => {
  test("duplicate headings get GitHub's -1 suffix", () => {
    const a = anchorsOf("# Setup\n\n## Setup\n");
    expect(a.has("setup")).toBe(true);
    expect(a.has("setup-1")).toBe(true);
  });

  test("headings inside fenced blocks are not anchors", () => {
    const a = anchorsOf("# Real\n\n```bash\n# Not A Heading\n```\n");
    expect(a.has("real")).toBe(true);
    expect(a.has("not-a-heading")).toBe(false);
  });

  test("explicit HTML ids count", () => {
    expect(anchorsOf('<a id="custom-target"></a>\n').has("custom-target")).toBe(true);
  });
});

describe("lintLinksDir", () => {
  test("a valid cross-file anchor passes", async () => {
    expect(
      await rules({
        "a.md": "# A\n\nSee [B](./b.md#the-section).\n",
        "b.md": "# B\n\n## The Section\n",
      }),
    ).toEqual([]);
  });

  test("a same-file anchor passes", async () => {
    expect(await rules({ "a.md": "# Top\n\n[jump](#deeper)\n\n## Deeper\n" })).toEqual([]);
  });

  test("an anchor with no matching heading is an error", async () => {
    expect(
      await rules({
        "a.md": "# A\n\nSee [B](./b.md#gone).\n",
        "b.md": "# B\n\n## Still Here\n",
      }),
    ).toEqual(["missing-anchor"]);
  });

  test("a link to a file that does not exist is an error", async () => {
    expect(await rules({ "a.md": "# A\n\n[nope](./missing.md)\n" })).toEqual(["missing-file"]);
  });

  test("external URLs are never resolved", async () => {
    expect(
      await rules({
        "a.md": "# A\n\n[ext](https://example.com/#whatever) [mail](mailto:a@b.c)\n",
      }),
    ).toEqual([]);
  });

  test("a broken link inside a fenced block is ignored", async () => {
    expect(await rules({ "a.md": "# A\n\n```md\n[x](./missing.md)\n```\n" })).toEqual([]);
  });

  test("a broken link inside an inline code span is ignored", async () => {
    // The regression: prose that *quotes* a link as an example is not a link.
    // Both false positives on this linter's first run were this shape.
    expect(
      await rules({ "a.md": "# A\n\nWrite it as `[CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md)`.\n" }),
    ).toEqual([]);
  });

  test("a URL containing parentheses does not leak a phantom target", async () => {
    // `[function](.../Function_(mathematics))` — a flat [^)]* matcher stops at the
    // first `)` and reports the tail as a broken relative link.
    expect(
      await rules({
        "a.md": "# A\n\n[function](https://en.wikipedia.org/wiki/Function_(mathematics))\n",
      }),
    ).toEqual([]);
  });

  test("counts files and intra-repo links, skipping external ones", async () => {
    const dir = await fixture({
      "a.md": "# A\n\n[b](./b.md) [ext](https://example.com)\n",
      "b.md": "# B\n",
    });
    try {
      const result = await lintLinksDir(dir);
      expect(result.fileCount).toBe(2);
      expect(result.linkCount).toBe(1);
      expect(hasErrors(result)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
