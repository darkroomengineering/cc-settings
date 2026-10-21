#!/usr/bin/env bun
// Config Guard — PreToolUse hook (Bash). Asks the user before a shell command
// writes `.mcp.json` or anything under `.claude-plugin/` in a way permission
// globs cannot see:
//   output redirection (`>`, `>>`, `>|`, `&>`, `<>`) onto the file
//   tee onto it
//   sed -i / perl -i editing it in place
// The rest of the guard is ask rules in config/30-permissions.json: Edit (which
// also governs Write), cp, mv, ln, `claude mcp add|add-json|remove` and
// `claude plugin install|marketplace add`. Do not duplicate those here.
//
// It asks instead of blocking: setting up an MCP server or a plugin is
// legitimate, and only the user knows whether they asked for it. Fail-open.

import { OP, parseShellCommand, scanShell, shellWords, splitPipes } from "../lib/hook-command.ts";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";

const REASON_TAIL =
  "MCP servers and plugin manifests load code into every session; approve only if you asked for this change.";

// Output operators after shellWords' fd/`&` prefix is stripped.
const WRITE_OPS = new Set([">", ">>", ">|", "<>", ">&"]);
const IN_PLACE_FLAG_RE = /^-[A-Za-z]*i|^--in-place(?:=|$)/;

/** `.mcp.json` anywhere, or any path through a `.claude-plugin` directory. */
export function isProtectedConfig(path: string): boolean {
  const parts = path.split(/[/\\]+/);
  return parts.at(-1) === ".mcp.json" || parts.includes(".claude-plugin");
}

function redirectTargets(stage: string): string[] {
  const words = shellWords(stage);
  const targets: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if (!w.startsWith(OP)) continue;
    const op = w.slice(OP.length).replace(/^(?:\d+|&)/, "");
    const next = words[i + 1];
    if (!WRITE_OPS.has(op) || next === undefined || next.startsWith(OP)) continue;
    // `2>&1` duplicates a descriptor; it writes no file.
    if (op === ">&" && /^\d+-?$|^-$/.test(next)) continue;
    targets.push(next);
  }
  return targets;
}

/** What a Bash command writes to a protected file, one phrase per write. */
export function configWrites(command: string): string[] {
  const found: string[] = [];
  for (const seg of scanShell(command).segments) {
    // The whole segment, not each pipe stage: splitPipes cuts `>|` in two.
    for (const t of redirectTargets(seg.clean)) {
      if (isProtectedConfig(t)) found.push(`redirects output into ${t}`);
    }
    for (const stage of splitPipes(seg.clean)) {
      const { word, args } = parseShellCommand(stage);
      const operands = args.filter((a) => !a.startsWith("-") && isProtectedConfig(a));
      if (word === "tee") {
        for (const f of operands) found.push(`writes ${f} through tee`);
      } else if (
        (word === "sed" || word === "perl") &&
        args.some((a) => IN_PLACE_FLAG_RE.test(a))
      ) {
        for (const f of operands) found.push(`edits ${f} in place with ${word}`);
      }
    }
  }
  return found;
}

export async function main(io: HookIO = processIO): Promise<void> {
  const { tool_name: tool } = await io.hookInput<{ tool_name: string }>({
    tool_name: "TOOL_NAME",
  });
  if (tool !== "Bash") return;
  const { command } = await io.toolInput<{ command: unknown }>();
  if (typeof command !== "string") return;
  const found = configWrites(command);
  if (found.length > 0) io.ask(`[Config Guard] ${found.join("; ")}. ${REASON_TAIL}`);
}

if (import.meta.main) await runHook(main);
