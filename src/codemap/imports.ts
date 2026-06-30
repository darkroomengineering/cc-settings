// Import graph: forward (a file's imports) and inverse (who imports a target).
// Module specifiers are resolved with ts.resolveModuleName against a minimal
// host (ts.sys fileExists/readFile), so "./a" → the actual a.ts path — matching
// the same resolution the compiler uses.

import { resolve } from "node:path";
import type * as TS from "typescript";
import { type CodemapContext, getContext, relPath } from "./program.ts";
import { findSourceFile } from "./structure.ts";
import type { ImportEdge, ImportersResult, ImportsResult } from "./types.ts";

/** The string specifier of an import or re-export declaration, if it has one. */
function moduleSpecifierOf(ts: typeof import("typescript"), n: TS.Node): string | undefined {
  if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
    return n.moduleSpecifier.text;
  }
  if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
    return n.moduleSpecifier.text;
  }
  return undefined;
}

function resolveSpecifier(ctx: CodemapContext, spec: string, fromFile: string): string | undefined {
  const host = { fileExists: ctx.ts.sys.fileExists, readFile: ctx.ts.sys.readFile };
  const resolved = ctx.ts.resolveModuleName(
    spec,
    fromFile,
    ctx.program.getCompilerOptions(),
    host,
  ).resolvedModule;
  return resolved?.resolvedFileName;
}

export async function getImports(projectDir: string, file: string): Promise<ImportsResult | null> {
  const ctx = await getContext(projectDir);
  if (!ctx) return null;
  const sf = findSourceFile(ctx, file);
  if (!sf) return null;

  const imports: ImportEdge[] = [];
  const from = relPath(ctx.projectDir, sf.fileName);
  sf.forEachChild((n) => {
    const spec = moduleSpecifierOf(ctx.ts, n);
    if (!spec) return;
    const resolved = resolveSpecifier(ctx, spec, sf.fileName);
    imports.push({
      from,
      to: resolved ? relPath(ctx.projectDir, resolved) : spec,
      specifier: spec,
    });
  });
  return { file: from, imports };
}

export async function getImporters(
  projectDir: string,
  target: string,
): Promise<ImportersResult | null> {
  const ctx = await getContext(projectDir);
  if (!ctx) return null;
  const { ts } = ctx;
  const targetAbs = resolve(projectDir, target);

  const importers: string[] = [];
  for (const f of ctx.rootFiles) {
    const sf = ctx.program.getSourceFile(f);
    if (!sf) continue;
    let hit = false;
    sf.forEachChild((n) => {
      if (hit) return;
      const spec = moduleSpecifierOf(ts, n);
      if (!spec) return;
      const resolved = resolveSpecifier(ctx, spec, sf.fileName);
      if (resolved && resolve(resolved) === targetAbs) hit = true;
      // Fall back to specifier matching for unresolved (e.g. package-name) targets.
      else if (!resolved && (spec === target || spec.endsWith(`/${target}`))) hit = true;
    });
    if (hit) importers.push(relPath(ctx.projectDir, f));
  }
  return { target, importers: importers.sort() };
}
