// Guards the installed runtime dependency set. The installer runs
// `bun install --production` in ~/.claude/src, which skips devDependencies, so
// any bare package a shipped src/*.ts file imports at runtime must be listed
// in package.json `dependencies`. A package missing there resolves in the repo
// but fails on every install (e.g. the native-ts code-intel engine cannot
// import "typescript" and every mcp__tldr__* tool fails).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentClaudeManagedSourceFiles } from "../src/lib/claude-managed-file-manifests.ts";

const ROOT = join(import.meta.dir, "..");

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;
const dependencies = pkg.dependencies ?? {};

// Blank out comments while keeping newlines so reported line numbers stay right.
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// Runtime specifiers only: `import type` / `export type` are erased.
const PATTERNS: RegExp[] = [
  /\b(?:import|export)\s+(?!type\s)[\w*${},\s]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  // `typeof import("x")` is a type position, erased like `import type`.
  /(?<!\btypeof\s+)\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

function packageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("node:") || specifier === "bun" || specifier.startsWith("bun:")) {
    return null;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? null);
}

function runtimePackages(file: string): { name: string; line: number }[] {
  const text = stripComments(readFileSync(join(ROOT, file), "utf8"));
  const found: { name: string; line: number }[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const name = packageName(match[1] ?? "");
      if (!name) continue;
      const line = text.slice(0, match.index).split("\n").length;
      found.push({ name, line });
    }
  }
  return found;
}

describe("shipped runtime imports", () => {
  test("every bare package imported by a shipped src/*.ts file is in dependencies", () => {
    const shipped = currentClaudeManagedSourceFiles("full").filter(
      (f) => f.destination.startsWith("src/") && f.destination.endsWith(".ts"),
    );
    expect(shipped.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const { source } of shipped) {
      for (const { name, line } of runtimePackages(source)) {
        if (!(name in dependencies)) missing.push(`${source}:${line} imports "${name}"`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("typescript is a production dependency (native-ts engine imports it at runtime)", () => {
    expect(dependencies).toHaveProperty("typescript");
    expect(pkg.devDependencies ?? {}).not.toHaveProperty("typescript");
  });
});
