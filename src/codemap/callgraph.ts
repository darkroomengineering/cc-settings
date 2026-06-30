// Call graph + symbol context + impact.
//
// Calls are name-based (cheap, language-faithful enough for "who calls X").
// Impact is symbol-resolved: identifiers are pre-filtered by text, then compared
// via checker.getSymbolAtLocation to the target's symbol — following import
// aliases with getAliasedSymbol so a re-imported `foo` in another file still
// counts. If the target symbol can't be resolved, impact falls back to name
// matching so it still returns the obvious references.

import type * as TS from "typescript";
import {
  getContext as buildContext,
  type CodemapContext,
  enclosingName,
  lineOf,
  relPath,
} from "./program.ts";
import { fileSymbols } from "./structure.ts";
import type {
  CallEdge,
  CallsResult,
  ContextResult,
  ImpactResult,
  Reference,
  SymbolRef,
} from "./types.ts";

/** The simple callee name of a call expression's target. */
function calleeName(ts: typeof import("typescript"), expr: TS.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function inProjectSourceFiles(ctx: CodemapContext): TS.SourceFile[] {
  const roots = new Set(ctx.rootFiles);
  return ctx.program.getSourceFiles().filter((sf) => roots.has(sf.fileName));
}

export async function getCalls(projectDir: string): Promise<CallsResult | null> {
  const ctx = await buildContext(projectDir);
  if (!ctx) return null;
  const { ts } = ctx;
  const edges: CallEdge[] = [];
  for (const sf of inProjectSourceFiles(ctx)) {
    const file = relPath(ctx.projectDir, sf.fileName);
    const visit = (node: TS.Node): void => {
      if (ts.isCallExpression(node)) {
        const to = calleeName(ts, node.expression);
        if (to) {
          edges.push({
            from: enclosingName(ts, node) ?? "<module>",
            to,
            file,
            line: lineOf(ts, sf, node),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }
  return { project: ctx.projectDir, edges };
}

interface Decl {
  sf: TS.SourceFile;
  node: TS.Node;
  nameNode: TS.Node;
}

/** Locate a declaration by name (`foo` or `Class.method`), returning the node
 *  to scan for callees and the identifier to resolve the symbol from. */
function findDecl(ctx: CodemapContext, name: string): Decl | null {
  const { ts } = ctx;
  const parts = name.split(".");
  const head = parts[0] ?? name;
  const method = parts[1];

  for (const sf of inProjectSourceFiles(ctx)) {
    let found: Decl | null = null;
    const visit = (node: TS.Node): void => {
      if (found) return;
      if (method) {
        if (
          ts.isMethodDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === method &&
          node.parent &&
          ts.isClassDeclaration(node.parent) &&
          node.parent.name?.text === head
        ) {
          found = { sf, node, nameNode: node.name };
        }
      } else if (ts.isFunctionDeclaration(node) && node.name?.text === head) {
        found = { sf, node, nameNode: node.name };
      } else if (ts.isClassDeclaration(node) && node.name?.text === head) {
        found = { sf, node, nameNode: node.name };
      } else if (ts.isInterfaceDeclaration(node) && node.name.text === head) {
        found = { sf, node, nameNode: node.name };
      } else if (ts.isTypeAliasDeclaration(node) && node.name.text === head) {
        found = { sf, node, nameNode: node.name };
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === head
      ) {
        const init = node.initializer;
        const body =
          init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : node;
        found = { sf, node: body, nameNode: node.name };
      }
      if (!found) ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    if (found) return found;
  }
  return null;
}

function lineTextOf(sf: TS.SourceFile, node: TS.Node): string {
  const text = sf.getFullText();
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const start = sf.getPositionOfLineAndCharacter(line, 0);
  const nl = text.indexOf("\n", start);
  return text.slice(start, nl < 0 ? text.length : nl).trim();
}

export async function getContext(projectDir: string, name: string): Promise<ContextResult | null> {
  const ctx = await buildContext(projectDir);
  if (!ctx) return null;
  const { ts } = ctx;
  const decl = findDecl(ctx, name);
  if (!decl) return null;

  const info = fileSymbols(ctx, decl.sf).find((s) => s.name === name);
  const file = relPath(ctx.projectDir, decl.sf.fileName);

  // Callees: call expressions inside the declaration body.
  const callees: SymbolRef[] = [];
  const collect = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const to = calleeName(ts, node.expression);
      if (to) callees.push({ name: to, file, line: lineOf(ts, decl.sf, node) });
    }
    ts.forEachChild(node, collect);
  };
  ts.forEachChild(decl.node, collect);

  // Callers: calls to this simple name anywhere in the project.
  const simple = name.includes(".") ? (name.split(".").pop() ?? name) : name;
  const callers: SymbolRef[] = [];
  for (const sf of inProjectSourceFiles(ctx)) {
    const cf = relPath(ctx.projectDir, sf.fileName);
    const visit = (node: TS.Node): void => {
      if (ts.isCallExpression(node) && calleeName(ts, node.expression) === simple) {
        callers.push({
          name: enclosingName(ts, node) ?? "<module>",
          file: cf,
          line: lineOf(ts, sf, node),
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }

  return {
    name,
    file,
    line: info?.line ?? lineOf(ts, decl.sf, decl.node),
    signature: info?.signature,
    doc: info?.doc,
    callers,
    callees,
  };
}

export async function getImpact(projectDir: string, name: string): Promise<ImpactResult | null> {
  const ctx = await buildContext(projectDir);
  if (!ctx) return null;
  const { ts, checker } = ctx;
  const simple = name.includes(".") ? (name.split(".").pop() ?? name) : name;

  // Resolve the target's declaration symbol once; references must resolve to it.
  const decl = findDecl(ctx, name);
  const targetSym = decl ? (checker.getSymbolAtLocation(decl.nameNode) ?? null) : null;

  const references: Reference[] = [];
  for (const sf of inProjectSourceFiles(ctx)) {
    const cf = relPath(ctx.projectDir, sf.fileName);
    const visit = (node: TS.Node): void => {
      if (ts.isIdentifier(node) && node.text === simple) {
        let ok = !targetSym; // no resolvable target ⇒ fall back to name match
        if (targetSym) {
          let sym = checker.getSymbolAtLocation(node);
          if (sym && sym.flags & ts.SymbolFlags.Alias) {
            try {
              sym = checker.getAliasedSymbol(sym);
            } catch {
              // not an alias after all — keep the original
            }
          }
          ok = sym === targetSym;
        }
        if (ok)
          references.push({ file: cf, line: lineOf(ts, sf, node), text: lineTextOf(sf, node) });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }

  return { symbol: name, references };
}
