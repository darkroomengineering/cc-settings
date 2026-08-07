// Markdown link validator. Docs are the discovery surface — a link that 404s or
// jumps nowhere is a tax paid by exactly the person who was trying to learn the
// thing. This catches both failures before they ship.
//
// Two checks, both intra-repo only (external URLs are never fetched):
//   - a relative file target must exist on disk
//   - an `#anchor` must resolve to a heading in the target markdown file
//
// The anchor half exists because section renames are silent: moving MANUAL.md's
// "## Light vs Full" to "## Install Tiers (Light vs Full)" broke a link in
// docs/install.md with no error anywhere, and a `#whats-on` link had never
// matched its heading at all.
//
// Imported by:
//   - src/scripts/lint-links.ts  — CLI (`bun run lint:links`)
//   - tests/lint-links.test.ts

import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { formatLintFindings, hasLintErrors, type LintSeverity } from "./lint-frontmatter.ts";

export type LinkSeverity = LintSeverity;

export interface LinkFinding {
  file: string;
  severity: LinkSeverity;
  rule: string;
  message: string;
}

export interface LinkResult {
  findings: LinkFinding[];
  fileCount: number;
  linkCount: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

// Schemes we never resolve. Anything with a scheme that isn't a relative path.
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** GitHub's heading-slug algorithm: lowercase, drop punctuation, spaces to
 *  hyphens. Backticks, em dashes, apostrophes, and parentheses all vanish, which
 *  is why `## What's on — and how to turn it off` becomes a double hyphen. */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s/g, "-");
}

/** Blank every character of a matched region except newlines, so offsets and
 *  line structure survive the substitution. */
function blank(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

/** Strip fenced code blocks AND inline code spans, so neither headings nor links
 *  inside them count. A doc showing `# Example` in a bash block must not mint a
 *  phantom anchor, and prose that *quotes* a link as an example — `[a](./b.md)`
 *  in backticks — must not be validated as a real one.
 *
 *  Both halves are load-bearing. Skipping the inline half made this linter report
 *  two false positives on its first run: a CHANGELOG entry describing a past
 *  URL-matching bug, and a skill-authoring doc showing how to write a relative
 *  link. Neither was a link; both were backticked examples. */
function stripCode(text: string): string {
  return stripInline(stripFences(text));
}

/** Inline spans: a run of N backticks, minimal content, the same run again. */
function stripInline(text: string): string {
  return text.replace(/(`+)[\s\S]*?\1/g, blank);
}

function stripFences(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence === null && open?.[1] !== undefined) {
      fence = open[1][0] as string;
      out.push("");
      continue;
    }
    if (fence !== null) {
      // A closing fence uses the same character; length need not match exactly.
      if (open?.[1] !== undefined && open[1][0] === fence) fence = null;
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Every anchor a markdown file offers: heading slugs plus explicit HTML ids.
 *  Duplicate headings get GitHub's `-1`, `-2` … suffixes. */
export function anchorsOf(text: string): Set<string> {
  const body = stripCode(text);
  const anchors = new Set<string>();
  const seen = new Map<string, number>();

  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading?.[1] === undefined) continue;
    const base = slugify(heading[1]);
    if (base === "") continue;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }

  // Hand-written targets: <a id="x"> / <a name="x">.
  for (const m of body.matchAll(/<a\s[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
    if (m[1] !== undefined) anchors.add(m[1]);
  }

  return anchors;
}

interface Link {
  label: string;
  target: string;
}

function linksOf(text: string): Link[] {
  const body = stripCode(text);
  // Inline links only: [label](target). Reference-style links resolve through a
  // definition list and are not used anywhere in this repo.
  return [...body.matchAll(/\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)].map((m) => ({
    label: m[1] ?? "",
    target: m[2] ?? "",
  }));
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
}

/** Validate every intra-repo markdown link under `root`. */
export async function lintLinksDir(root: string): Promise<LinkResult> {
  if (!existsSync(root)) return { findings: [], fileCount: 0, linkCount: 0 };

  const paths: string[] = [];
  await walk(root, paths);
  paths.sort();

  // Anchor sets are computed once per file and reused across every inbound link.
  const anchorCache = new Map<string, Set<string>>();
  const findings: LinkFinding[] = [];
  let linkCount = 0;

  for (const path of paths) {
    const text = await readFile(path, "utf8");
    anchorCache.set(path, anchorsOf(text));
  }

  for (const path of paths) {
    const rel = relative(root, path);
    const text = await readFile(path, "utf8");

    for (const { label, target } of linksOf(text)) {
      if (EXTERNAL.test(target)) continue;
      linkCount++;

      const [rawPath = "", ...fragParts] = target.split("#");
      const fragment = decodeURIComponent(fragParts.join("#"));
      const filePart = decodeURIComponent(rawPath);

      // Resolve the file half. An empty path means "this file".
      const targetPath = filePart === "" ? path : resolve(dirname(path), filePart);

      // Never look outside the tree being linted.
      if (!normalize(targetPath).startsWith(normalize(root))) continue;

      if (filePart !== "" && !existsSync(targetPath)) {
        findings.push({
          file: rel,
          severity: "error",
          rule: "missing-file",
          message: `[${label}](${target}) — ${relative(root, targetPath)} does not exist`,
        });
        continue;
      }

      if (fragment === "") continue;

      const anchors = anchorCache.get(targetPath);
      // Fragments into non-markdown files (e.g. a line ref) aren't ours to check.
      if (anchors === undefined) continue;

      if (!anchors.has(fragment)) {
        const where = filePart === "" ? "this file" : relative(root, targetPath);
        findings.push({
          file: rel,
          severity: "error",
          rule: "missing-anchor",
          message: `[${label}](${target}) — no heading in ${where} slugs to "${fragment}"`,
        });
      }
    }
  }

  return { findings, fileCount: paths.length, linkCount };
}

export function formatFindings(result: LinkResult): string {
  return formatLintFindings(result.findings, result.fileCount, {
    noun: "markdown file",
    getItem: (f) => f.file,
  });
}

export function hasErrors(result: LinkResult): boolean {
  return hasLintErrors(result.findings);
}
