#!/usr/bin/env bun
// PreToolUse hook — remind to fetch docs before installing packages.
// Port of scripts/check-docs-before-install.sh. Triggers on bun add, npm
// install, npx add, pnpm add, `bun i`, `npm i`.
//
// Reads TOOL_INPUT_command from env (hook contract). Exits 0 no matter what
// — a regex/string-handling crash here must never block a package install.

try {
  const cmd = process.env.TOOL_INPUT_command ?? "";
  if (cmd) {
    // Same regex shape as the bash version: match well-known install verbs.
    const INSTALL = /(bun add|npm install|npx add|pnpm add|bun i |npm i )\s/;
    if (INSTALL.test(cmd)) {
      // Strip everything up to and including the install verb, then take the first
      // arg. Mirrors the `sed | awk | sed` pipeline in the bash version.
      const stripped = cmd.replace(/.*(bun add|npm install|npx add|pnpm add|bun i|npm i)\s+/, "");
      const firstArg = (stripped.split(/\s+/)[0] ?? "").replace(/@[^/]*$/, "");

      if (firstArg && !firstArg.startsWith("-")) {
        console.log(`[Hook] Installing '${firstArg}' — did you fetch docs first?`);
        console.log(`  Run: /docs ${firstArg} (or use context7 MCP to get latest API docs)`);
        console.log(`  Run: bun info ${firstArg} (to check latest version)`);
      }
    }
  }
} catch {
  // fail-open: never block install on a hook bug
}
