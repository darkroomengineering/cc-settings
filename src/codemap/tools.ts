// Single source of truth for the codemap engine's tool surface. mcp-server.ts
// derives tools/list + tools/call dispatch from this registry; cli.ts derives
// its verb dispatch from it too — so the two command surfaces (MCP JSON-RPC
// and the CLI) can't drift apart the way two hand-maintained switches did.
//
// Each entry carries both an MCP-facing `handler(args)` (keyed off flexible
// arg names via `str()`, since MCP callers vary in what key they send — e.g.
// "entry"/"name"/"function" for the same symbol) and a `buildCliArgs` that
// reproduces the CLI's historical flag/positional precedence by folding the
// positional arg into the *last* key in that same precedence chain before
// handing off to the same `str()`-driven handler. Output shapes, arg
// precedence, and error messages are unchanged from the pre-registry
// mcp-server.ts SUPPORTED map / cli.ts switch.

import {
  getArch,
  getCalls,
  getChangeImpact,
  getContext,
  getImpact,
  getImporters,
  getImports,
  getStatus,
  getStructure,
  getTree,
  resolveFile,
} from "./index.ts";

export type Args = Record<string, unknown>;

/** First non-empty string among the given keys — handles the flexible arg names
 *  callers use (entry/name/function, module/target). */
export function str(a: Args, ...keys: string[]): string {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

// Fallback project dir when a caller (MCP tool call) omits `project`: the
// server's own `--project DIR` startup flag, else ".". CLI invocations never
// hit this fallback — cli.ts always resolves + supplies `project` explicitly
// before calling a handler.
const PROJECT = (() => {
  const i = process.argv.indexOf("--project");
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : ".";
})();

export const proj = (a: Args): string => str(a, "project") || PROJECT;

export const objSchema = (props: Record<string, string>): Record<string, unknown> => ({
  type: "object",
  properties: Object.fromEntries(
    Object.entries(props).map(([k, t]) => [k, { type: t === "number" ? "number" : "string" }]),
  ),
});

// Matches the CLI's original `max ? Number(max) : 200` (max_results as a CLI
// flag string) while leaving the MCP path (max_results as a genuine JSON
// number) untouched.
function maxResultsOf(a: Args): number {
  const v = a.max_results;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") return Number(v);
  return 200;
}

export interface CodemapTool {
  /** Canonical name — the MCP tool name and primary CLI verb. */
  name: string;
  description: string;
  /** MCP `inputSchema`. */
  inputSchema: Record<string, unknown>;
  handler: (a: Args) => Promise<unknown>;
  /** Extra CLI verb spellings that dispatch to this tool (e.g. "change-impact"
   *  alongside "change_impact"). Never exposed as separate MCP tool names. */
  cliAliases?: string[];
  /** Build the Args object for a CLI invocation from parsed flags + the
   *  first positional arg, reproducing the CLI's original per-verb precedence. */
  buildCliArgs: (flags: Record<string, string>, arg: string, project: string) => Args;
}

export const TOOLS: CodemapTool[] = [
  {
    name: "structure",
    description: "List functions/classes/methods/interfaces/types/enums/exported vars per file.",
    inputSchema: objSchema({ project: "string", max_results: "number" }),
    handler: (a) => getStructure(proj(a), maxResultsOf(a)),
    buildCliArgs: (flags, _arg, project) => ({
      project,
      max_results: flags.max_results ?? flags.max,
    }),
  },
  {
    name: "extract",
    description: "Full symbol structure of a single file.",
    inputSchema: objSchema({ project: "string", file: "string" }),
    handler: (a) => resolveFile(proj(a), str(a, "file")),
    buildCliArgs: (flags, arg, project) => ({ project, file: flags.file ?? arg }),
  },
  {
    name: "tree",
    description: "List in-project source files.",
    inputSchema: objSchema({ project: "string" }),
    handler: (a) => getTree(proj(a)),
    buildCliArgs: (_flags, _arg, project) => ({ project }),
  },
  {
    name: "arch",
    description: "Per-file export/import counts (architecture overview).",
    inputSchema: objSchema({ project: "string" }),
    handler: (a) => getArch(proj(a)),
    buildCliArgs: (_flags, _arg, project) => ({ project }),
  },
  {
    name: "imports",
    description: "Resolved imports of a file.",
    inputSchema: objSchema({ project: "string", file: "string" }),
    handler: (a) => getImports(proj(a), str(a, "file")),
    buildCliArgs: (flags, arg, project) => ({ project, file: flags.file ?? arg }),
  },
  {
    name: "importers",
    description: "Files that import a given file/module (reverse import lookup).",
    inputSchema: objSchema({ project: "string", module: "string" }),
    handler: (a) => getImporters(proj(a), str(a, "module", "target", "file")),
    buildCliArgs: (flags, arg, project) => ({
      project,
      module: flags.module,
      target: flags.target,
      file: arg,
    }),
  },
  {
    name: "calls",
    description: "Name-based call edges across the project.",
    inputSchema: objSchema({ project: "string" }),
    handler: (a) => getCalls(proj(a)),
    buildCliArgs: (_flags, _arg, project) => ({ project }),
  },
  {
    name: "context",
    description: "Signature, doc, immediate callers and callees of a symbol.",
    inputSchema: objSchema({ project: "string", entry: "string" }),
    handler: (a) => getContext(proj(a), str(a, "entry", "name", "function")),
    buildCliArgs: (flags, arg, project) => ({
      project,
      entry: flags.entry,
      name: flags.name,
      function: flags.function ?? arg,
    }),
  },
  {
    name: "impact",
    description: "All references to a symbol (who would break if it changed).",
    inputSchema: objSchema({ project: "string", function: "string" }),
    handler: (a) => getImpact(proj(a), str(a, "function", "name", "entry")),
    buildCliArgs: (flags, arg, project) => ({
      project,
      function: flags.function,
      name: flags.name,
      entry: flags.entry ?? arg,
    }),
  },
  {
    name: "change_impact",
    description: "Symbols changed in the git working tree and the files they affect.",
    inputSchema: objSchema({ project: "string" }),
    handler: (a) => getChangeImpact(proj(a)),
    cliAliases: ["change-impact"],
    buildCliArgs: (_flags, _arg, project) => ({ project }),
  },
  {
    name: "status",
    description: "Engine availability and project file count.",
    inputSchema: objSchema({ project: "string" }),
    handler: (a) => getStatus(proj(a)),
    buildCliArgs: (_flags, _arg, project) => ({ project }),
  },
];

// Registered for MCP contract completeness; not implemented by the native
// engine. CLI has no dispatch path for these names (falls through to
// "unknown verb", matching pre-registry behavior).
export const UNSUPPORTED = ["semantic", "slice", "cfg", "dfg", "dead", "diagnostics", "search"];

/** Strict name lookup — MCP tools/call only ever matched the exact registered
 *  tool name, never a CLI alias (e.g. "change-impact" was never a valid MCP
 *  tool name). */
export function findToolByName(name: string): CodemapTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** CLI verb lookup — matches the canonical name or any CLI alias. */
export function findCliTool(name: string): CodemapTool | undefined {
  return TOOLS.find((t) => t.name === name || t.cliAliases?.includes(name));
}
