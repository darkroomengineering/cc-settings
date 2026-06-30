// Plain result shapes for the native TS codemap engine. Zod-free on purpose:
// these cross the MCP boundary as JSON and are produced by the TypeScript
// compiler walk, not parsed from untrusted input — a schema would add weight
// without buying validation. The engine covers the daily-80% (structure, calls,
// imports, impact, change-impact); semantic search, dataflow, slicing and
// dead-code are intentionally out of scope (see mcp-server.ts unsupported list).

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable";

export interface SymbolInfo {
  /** Bare name, or `Class.method` for methods. */
  name: string;
  kind: SymbolKind;
  /** Posix-relative path from the project root. */
  file: string;
  /** 1-based line of the declaration. */
  line: number;
  exported: boolean;
  signature?: string;
  /** One-line summary from the leading JSDoc/comment, if any. */
  doc?: string;
}

export interface StructureResult {
  project: string;
  files: number;
  symbols: SymbolInfo[];
}

export interface FileStructure {
  file: string;
  symbols: SymbolInfo[];
}

export interface TreeResult {
  project: string;
  files: string[];
}

export interface ArchModule {
  file: string;
  exports: number;
  imports: number;
}

export interface ArchResult {
  project: string;
  modules: ArchModule[];
}

export interface ImportEdge {
  from: string;
  /** Resolved posix-relative path, or the raw specifier when it can't be resolved (e.g. a bare package). */
  to: string;
  specifier: string;
}

export interface ImportsResult {
  file: string;
  imports: ImportEdge[];
}

export interface ImportersResult {
  target: string;
  importers: string[];
}

export interface CallEdge {
  /** Enclosing symbol name, or "<module>" for top-level calls. */
  from: string;
  to: string;
  file: string;
  line: number;
}

export interface CallsResult {
  project: string;
  edges: CallEdge[];
}

export interface SymbolRef {
  name: string;
  file: string;
  line: number;
}

export interface ContextResult {
  name: string;
  file: string;
  line: number;
  signature?: string;
  doc?: string;
  callers: SymbolRef[];
  callees: SymbolRef[];
}

export interface Reference {
  file: string;
  line: number;
  text: string;
}

export interface ImpactResult {
  symbol: string;
  references: Reference[];
}

export interface ChangeImpactResult {
  changedFiles: string[];
  changedSymbols: SymbolInfo[];
  /** Files that import a changed file or reference a changed exported symbol. */
  affected: string[];
}

export interface StatusResult {
  engine: "native-ts";
  /** True when `typescript` resolved and a program was built for the project. */
  available: boolean;
  project: string;
  files: number;
  languages: "ts-js";
}
