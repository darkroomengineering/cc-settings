#!/usr/bin/env bun
// CLI for the native codemap engine — mirrors the MCP tool surface for manual
// use and debugging:
//   bun src/codemap/cli.ts <verb> [arg] [--project DIR] [--file F] [--max N]
// Prints JSON. Unknown verbs and a null result (no TypeScript / not a TS project)
// are reported as a structured object, never a crash.

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

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else {
        flags[a.slice(2)] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const verb = positional[0] ?? "status";
const arg = positional[1] ?? "";
const project = flags.project ?? ".";
const file = flags.file ?? arg;
const max = flags.max_results ?? flags.max;
const maxN = max ? Number(max) : 200;

let result: unknown;
switch (verb) {
  case "structure":
    result = await getStructure(project, maxN);
    break;
  case "extract":
    result = await resolveFile(project, file);
    break;
  case "tree":
    result = await getTree(project);
    break;
  case "arch":
    result = await getArch(project);
    break;
  case "imports":
    result = await getImports(project, file);
    break;
  case "importers":
    result = await getImporters(project, flags.module ?? flags.target ?? arg);
    break;
  case "calls":
    result = await getCalls(project);
    break;
  case "context":
    result = await getContext(project, flags.entry ?? flags.name ?? flags.function ?? arg);
    break;
  case "impact":
    result = await getImpact(project, flags.function ?? flags.name ?? flags.entry ?? arg);
    break;
  case "change_impact":
  case "change-impact":
    result = await getChangeImpact(project);
    break;
  case "status":
    result = await getStatus(project);
    break;
  default:
    result = { error: `unknown verb: ${verb}` };
}

console.log(JSON.stringify(result, null, 2));
