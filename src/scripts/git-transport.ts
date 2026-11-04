#!/usr/bin/env bun
// Prints the `Git push:` line(s) for the repo in the current directory, the same
// text SessionStart prints. The ship skill runs it before the first push.
//
//   bun "$HOME/.claude/src/scripts/git-transport.ts"

import { gitTransportAwareness } from "../lib/git-transport.ts";

if (import.meta.main) {
  for (const line of await gitTransportAwareness()) console.log(line);
}
