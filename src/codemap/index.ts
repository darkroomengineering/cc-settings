// Public surface of the native TS codemap engine. The cli and mcp-server import
// only from here. program.getContext (the ts.Program builder) stays internal —
// getStatus is the only thing here that touches it.

import { getContext as buildContext } from "./program.ts";
import type { StatusResult } from "./types.ts";

export { getCalls, getContext, getImpact } from "./callgraph.ts";
export { getChangeImpact } from "./change-impact.ts";
export { getImporters, getImports } from "./imports.ts";
export { getArch, getStructure, getTree, resolveFile } from "./structure.ts";
export type * from "./types.ts";

/** Engine health — whether `typescript` resolved and a program built. */
export async function getStatus(projectDir: string): Promise<StatusResult> {
  const ctx = await buildContext(projectDir);
  return {
    engine: "native-ts",
    available: ctx !== null,
    project: projectDir,
    files: ctx?.rootFiles.length ?? 0,
    languages: "ts-js",
  };
}
