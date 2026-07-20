#!/usr/bin/env bun
// CLI for the native codemap engine — mirrors the MCP tool surface for manual
// use and debugging:
//   bun src/codemap/cli.ts <verb> [arg] [--project DIR] [--file F] [--max N]
// Prints JSON. Unknown verbs and a null result (no TypeScript / not a TS project)
// are reported as a structured object, never a crash.
//
// Verb dispatch derives from the shared registry in tools.ts — see that file
// for the full tool table and each verb's arg precedence.

import { findCliTool } from "./tools.ts";

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

const tool = findCliTool(verb);
const result: unknown = tool
  ? await tool.handler(tool.buildCliArgs(flags, arg, project))
  : { error: `unknown verb: ${verb}` };

console.log(JSON.stringify(result, null, 2));
