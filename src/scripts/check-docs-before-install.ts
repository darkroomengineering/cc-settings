#!/usr/bin/env bun
// PreToolUse hook — remind to fetch docs before installing packages.
// Port of scripts/check-docs-before-install.sh. Triggers on bun add, npm
// install, npx add, pnpm add, `bun i`, `npm i`.
//
// Reads TOOL_INPUT_command from env (hook contract). Exits 0 no matter what
// — a regex/string-handling crash here must never block a package install.
//
// Delivery: plain console.log stdout on a PreToolUse hook never reaches the
// model (verified against Claude Code 2.1.220 by a headless marker probe,
// replicated twice — see docs/hooks-reference.md "Sync vs Async Behavior").
// The reminder below is emitted via the hookSpecificOutput.additionalContext
// envelope instead.

import { emitAdditionalContext } from "../lib/hook-runtime.ts";

try {
  const cmd = process.env.TOOL_INPUT_command ?? "";
  if (cmd) {
    // Same regex shape as the bash version: match well-known install verbs.
    // `bun i`/`npm i` must NOT include the trailing space here — the outer
    // `\s` already supplies the single separator after the verb, same as the
    // long-form alternatives. Including it (as before) required a SECOND
    // whitespace char that a normal single-space invocation never has.
    const INSTALL = /(bun add|npm install|npx add|pnpm add|bun i|npm i)\s/;
    if (INSTALL.test(cmd)) {
      // Strip everything up to and including the install verb, then take the first
      // arg. Mirrors the `sed | awk | sed` pipeline in the bash version.
      const stripped = cmd.replace(/.*(bun add|npm install|npx add|pnpm add|bun i|npm i)\s+/, "");
      const firstArg = (stripped.split(/\s+/)[0] ?? "").replace(/@[^/]*$/, "");

      if (firstArg && !firstArg.startsWith("-")) {
        const message = [
          `[Hook] Installing '${firstArg}' — did you fetch docs first?`,
          `  Run: /docs ${firstArg} (or use context7 MCP to get latest API docs)`,
          `  Run: bun info ${firstArg} (to check latest version)`,
        ].join("\n");
        emitAdditionalContext("PreToolUse", message);
      }
    }
  }
} catch {
  // fail-open: never block install on a hook bug
}
