#!/usr/bin/env bun
// CLI for the /freeze skill — set, clear, or show the edit-scope boundary.
//   freeze.ts set <dir>   restrict Edit/Write/MultiEdit to <dir>
//   freeze.ts off         lift the boundary
//   freeze.ts status      show the current boundary

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readFreeze, writeFreeze } from "../lib/freeze.ts";

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
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
      await writeFreeze(abs);
      console.log(`Freeze boundary set: ${abs}`);
      console.log(
        "Edit/Write/MultiEdit outside this directory will be blocked. Lift with: freeze.ts off",
      );
      return 0;
    }
    case "off": {
      const { root } = await readFreeze();
      await writeFreeze(null);
      console.log(root ? `Freeze boundary cleared (was: ${root}).` : "No freeze boundary was set.");
      return 0;
    }
    case "status": {
      const { root } = await readFreeze();
      console.log(root ? `Freeze boundary: ${root}` : "No freeze boundary set.");
      return 0;
    }
    default:
      console.error("usage: freeze.ts [set <dir> | off | status]");
      return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
