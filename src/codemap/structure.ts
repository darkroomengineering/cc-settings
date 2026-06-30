// Structure extraction: per-file symbol inventory plus the tree/arch overviews.
// fileSymbols + signatureOf are the shared primitives the callgraph and
// change-impact modules build on, so they live here and are exported.

import { resolve } from "node:path";
import type * as TS from "typescript";
import {
  type CodemapContext,
  getContext,
  isExported,
  leadingDoc,
  lineOf,
  relPath,
} from "./program.ts";
import type {
  ArchResult,
  FileStructure,
  StructureResult,
  SymbolInfo,
  SymbolKind,
  TreeResult,
} from "./types.ts";

/** One-line signature for callables; undefined for non-callable declarations. */
export function signatureOf(
  ts: typeof import("typescript"),
  sf: TS.SourceFile,
  node: TS.Node,
): string | undefined {
  const render = (name: string, fn: TS.SignatureDeclaration): string => {
    const params = fn.parameters.map((p) => p.getText(sf)).join(", ");
    const ret = fn.type ? `: ${fn.type.getText(sf)}` : "";
    return `${name}(${params})${ret}`.trim();
  };
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    const name = node.name && ts.isIdentifier(node.name) ? node.name.text : "";
    return render(name, node);
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return render("", node);
  }
  return undefined;
}

/** Top-level (and class-member) symbols declared in a source file. */
export function fileSymbols(ctx: CodemapContext, sf: TS.SourceFile): SymbolInfo[] {
  const { ts, projectDir } = ctx;
  const file = relPath(projectDir, sf.fileName);
  const out: SymbolInfo[] = [];
  const push = (name: string, kind: SymbolKind, node: TS.Node, exported: boolean): void => {
    out.push({
      name,
      kind,
      file,
      line: lineOf(ts, sf, node),
      exported,
      signature: signatureOf(ts, sf, node),
      doc: leadingDoc(ts, sf, node),
    });
  };

  sf.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      push(node.name.text, "function", node, isExported(ts, node));
    } else if (ts.isClassDeclaration(node) && node.name) {
      const cls = node.name.text;
      push(cls, "class", node, isExported(ts, node));
      for (const m of node.members) {
        if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) {
          push(`${cls}.${m.name.text}`, "method", m, false);
        }
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      push(node.name.text, "interface", node, isExported(ts, node));
    } else if (ts.isTypeAliasDeclaration(node)) {
      push(node.name.text, "type", node, isExported(ts, node));
    } else if (ts.isEnumDeclaration(node)) {
      push(node.name.text, "enum", node, isExported(ts, node));
    } else if (ts.isVariableStatement(node)) {
      const exported = isExported(ts, node);
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const isFn =
          !!d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));
        const node2 = isFn && d.initializer ? d.initializer : d;
        const sig = isFn && d.initializer ? signatureOf(ts, sf, d.initializer) : undefined;
        out.push({
          name: d.name.text,
          kind: isFn ? "function" : "variable",
          file,
          line: lineOf(ts, sf, node2),
          exported,
          signature: sig ? `${d.name.text}${sig.replace(/^\(/, "(")}` : undefined,
          doc: leadingDoc(ts, sf, node),
        });
      }
    }
  });
  return out;
}

function inProjectSourceFiles(ctx: CodemapContext): TS.SourceFile[] {
  const roots = new Set(ctx.rootFiles);
  return ctx.program.getSourceFiles().filter((sf) => roots.has(sf.fileName));
}

export async function getStructure(projectDir: string, max = 200): Promise<StructureResult | null> {
  const ctx = await getContext(projectDir);
  if (!ctx) return null;
  const symbols: SymbolInfo[] = [];
  for (const sf of inProjectSourceFiles(ctx)) {
    for (const s of fileSymbols(ctx, sf)) {
      symbols.push(s);
      if (symbols.length >= max) break;
    }
    if (symbols.length >= max) break;
  }
  return { project: ctx.projectDir, files: ctx.rootFiles.length, symbols };
}

/** Find an in-project source file by relative or absolute path. */
export function findSourceFile(ctx: CodemapContext, file: string): TS.SourceFile | undefined {
  const target = resolve(ctx.projectDir, file);
  return inProjectSourceFiles(ctx).find(
    (sf) => resolve(sf.fileName) === target || relPath(ctx.projectDir, sf.fileName) === file,
  );
}

export async function resolveFile(projectDir: string, file: string): Promise<FileStructure | null> {
  const ctx = await getContext(projectDir);
  if (!ctx) return null;
  const sf = findSourceFile(ctx, file);
  if (!sf) return null;
  return { file: relPath(ctx.projectDir, sf.fileName), symbols: fileSymbols(ctx, sf) };
}

export async function getTree(
  projectDir: string,
  extensions?: string[],
): Promise<TreeResult | null> {
  const ctx = await getContext(projectDir);
  if (!ctx) return null;
  let files = ctx.rootFiles.map((f) => relPath(ctx.projectDir, f));
  if (extensions && extensions.length > 0) {
    files = files.filter((f) => extensions.some((e) => f.endsWith(e)));
  }
  return { project: ctx.projectDir, files: files.sort() };
}

export async function getArch(projectDir: string): Promise<ArchResult | null> {
  const ctx = await getContext(projectDir);
  if (!ctx) return null;
  const { ts } = ctx;
  const modules = inProjectSourceFiles(ctx).map((sf) => {
    let imports = 0;
    sf.forEachChild((n) => {
      if (ts.isImportDeclaration(n)) imports++;
    });
    const exports = fileSymbols(ctx, sf).filter((s) => s.exported).length;
    return { file: relPath(ctx.projectDir, sf.fileName), exports, imports };
  });
  modules.sort((a, b) => b.exports - a.exports || a.file.localeCompare(b.file));
  return { project: ctx.projectDir, modules };
}
