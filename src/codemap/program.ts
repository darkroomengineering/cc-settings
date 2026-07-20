// TypeScript program construction + shared AST helpers for the codemap engine.
//
// `typescript` is a cc-settings devDep; at end-user runtime it resolves through
// the node_modules symlink installTsSources creates under ~/.claude/src. We load
// it via a dynamic import wrapped in try/catch so a broken symlink degrades
// gracefully (getContext → null) instead of crashing the MCP server. The static
// `import type * as TS` is erased at compile time, so it adds no runtime dep —
// it only types the annotations below.

import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type * as TS from "typescript";

type TSModule = typeof import("typescript");

let tsCache: TSModule | null | undefined;

/** Load the TypeScript compiler, or null if it can't be resolved. Cached. */
export async function loadTypeScript(): Promise<TSModule | null> {
  if (tsCache !== undefined) return tsCache;
  try {
    const mod = (await import("typescript")) as unknown as { default?: TSModule } & TSModule;
    const ts = (mod.default ?? mod) as TSModule;
    tsCache = typeof ts?.createProgram === "function" ? ts : null;
  } catch {
    tsCache = null;
  }
  return tsCache;
}

export interface CodemapContext {
  ts: TSModule;
  program: TS.Program;
  checker: TS.TypeChecker;
  /** Absolute project root. */
  projectDir: string;
  /** Absolute paths of in-project source files (no .d.ts, no node_modules). */
  rootFiles: string[];
}

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage"]);

// readdirSync wrapped so a permission/ENOENT error yields []. The return type
// is inferred (no annotation) so it picks the Dirent[] string overload —
// annotating with ReturnType<typeof readdirSync> resolves to the Buffer variant.
function readDirSafe(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Recursive source glob — the fallback when a project has no tsconfig.json.
function globSources(projectDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readDirSafe(dir)) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const dot = entry.name.lastIndexOf(".");
        const ext = dot >= 0 ? entry.name.slice(dot) : "";
        if (SOURCE_EXTS.has(ext) && !entry.name.endsWith(".d.ts")) out.push(join(dir, entry.name));
      }
    }
  };
  walk(projectDir);
  return out;
}

function defaultOptions(ts: TSModule): TS.CompilerOptions {
  return {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
  };
}

async function buildContext(projectDir: string): Promise<CodemapContext | null> {
  const ts = await loadTypeScript();
  if (!ts) return null;

  let fileNames: string[];
  let options: TS.CompilerOptions;

  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  const parsed = configPath
    ? ts.getParsedCommandLineOfConfigFile(
        configPath,
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: () => {},
        },
      )
    : undefined;

  if (parsed && parsed.fileNames.length > 0) {
    fileNames = parsed.fileNames;
    options = parsed.options;
  } else {
    fileNames = globSources(projectDir);
    options = defaultOptions(ts);
  }
  if (fileNames.length === 0) return null;

  const program = ts.createProgram(fileNames, options);
  const checker = program.getTypeChecker();
  const rootFiles = program
    .getSourceFiles()
    .map((sf) => sf.fileName)
    .filter((f) => !f.endsWith(".d.ts") && !f.includes("node_modules"));

  return { ts, program, checker, projectDir, rootFiles };
}

// Building a ts.Program is the expensive step. A short TTL cache keyed by the
// absolute project dir lets a burst of MCP calls (a single user question often
// fans out to several) reuse one build, while still picking up edits within a
// few seconds. Not an invalidation system — just burst coalescing.
const TTL_MS = 5000;
const cache = new Map<string, { at: number; ctx: CodemapContext | null }>();

export async function getContext(projectDir: string): Promise<CodemapContext | null> {
  const abs = resolve(projectDir);
  const hit = cache.get(abs);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.ctx;
  const ctx = await buildContext(abs);
  cache.set(abs, { at: now, ctx });
  return ctx;
}

// --- AST helpers (shared across structure/imports/callgraph) ----------------

/** In-project source files from the built program, filtered to `ctx.rootFiles`
 *  (excludes .d.ts and node_modules, which `program.getSourceFiles()` alone
 *  does not). Shared by callgraph.ts and structure.ts. */
export function inProjectSourceFiles(ctx: CodemapContext): TS.SourceFile[] {
  const roots = new Set(ctx.rootFiles);
  return ctx.program.getSourceFiles().filter((sf) => roots.has(sf.fileName));
}

/** Posix-relative path from the project root. */
export function relPath(projectDir: string, fileName: string): string {
  return relative(projectDir, fileName).split(sep).join("/");
}

// `_ts` is unused but kept for signature symmetry with the other helpers (so
// callers thread `ctx.ts` uniformly); underscore satisfies the linter.
export function lineOf(_ts: TSModule, sf: TS.SourceFile, node: TS.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** First leading comment/JSDoc above a node, flattened to a one-line summary. */
export function leadingDoc(ts: TSModule, sf: TS.SourceFile, node: TS.Node): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sf.getFullText(), node.getFullStart());
  const last = ranges?.[ranges.length - 1];
  if (!last) return undefined;
  const cleaned = sf
    .getFullText()
    .slice(last.pos, last.end)
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*\*\s?/, "")
        .replace(/^\s*\/\/\s?/, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .trim();
  return cleaned || undefined;
}

/** True when a declaration carries the `export` modifier. */
export function isExported(ts: TSModule, node: TS.Node): boolean {
  return (ts.getCombinedModifierFlags(node as TS.Declaration) & ts.ModifierFlags.Export) !== 0;
}

/** Name of the nearest enclosing function/method/class/arrow-const, if any. */
export function enclosingName(ts: TSModule, node: TS.Node): string | undefined {
  let cur: TS.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isClassDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    cur = cur.parent;
  }
  return undefined;
}
