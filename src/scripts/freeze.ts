#!/usr/bin/env bun
// CLI for the /freeze skill — set, clear, or show the edit-scope boundary.
//   freeze.ts set <dir>   restrict Edit/Write to <dir>
//   freeze.ts off         lift the boundary
//   freeze.ts status      show the current boundary

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getActiveFreeze, writeFreeze } from "../lib/freeze.ts";

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  // Mirrors the session_id Claude Code passes to hooks; set automatically and
  // available inside Bash tool subprocesses — this script always runs via the
  // Bash tool (invoked by the /freeze skill). Tagging the freeze with it lets
  // getActiveFreeze self-heal a boundary forgotten from a different session.
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID ?? null;

  switch (cmd) {
    case "set": {
      const dir = rest.join(" ").trim();
      if (!dir) {
        console.error("usage: freeze.ts set <dir>");
        return 1;
      }
      const abs = resolve(process.cwd(), dir);
      if (!existsSync(abs)) {
        console.error(`freeze: directory does not exist: ${abs}`);
        return 1;
      }
      if (!statSync(abs).isDirectory()) {
        console.error(`freeze: not a directory: ${abs}`);
        return 1;
      }
      await writeFreeze(abs, sessionId);
      console.log(`Freeze boundary set: ${abs}`);
      console.log("Edit/Write outside this directory will be blocked. Lift with: freeze.ts off");
      return 0;
    }
    case "off": {
      const { root } = await getActiveFreeze(sessionId);
      await writeFreeze(null);
      console.log(root ? `Freeze boundary cleared (was: ${root}).` : "No freeze boundary was set.");
      return 0;
    }
    case "status": {
      const { root } = await getActiveFreeze(sessionId);
      console.log(root ? `Freeze boundary: ${root}` : "No freeze boundary set.");
      return 0;
    }
    default:
      console.error("usage: freeze.ts [set <dir> | off | status]");
      return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
