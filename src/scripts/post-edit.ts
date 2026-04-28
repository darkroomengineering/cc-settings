#!/usr/bin/env bun
// PostToolUse Write|Edit hook — auto-format, console.log warning, review reminder.
// Port of scripts/post-edit.sh.
//
// TOOL_INPUT_file_path comes via env. Never fails the hook: all side effects
// are best-effort.

import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { hasCommand } from "../lib/platform.ts";

const filePath = process.env.TOOL_INPUT_file_path ?? "";
if (!filePath) process.exit(0);

const ext = extname(filePath).toLowerCase();
const BIOMABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css"]);
const JSTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const COMPONENT = new Set([".tsx", ".jsx"]);

// 1. Auto-format with biome.
if (BIOMABLE.has(ext)) {
  if (hasCommand("biome")) {
    const proc = Bun.spawn(["biome", "check", "--write", filePath], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  }
}

// 2. console.log warning for JS/TS files.
if (JSTS.has(ext) && existsSync(filePath)) {
  try {
    const text = readFileSync(filePath, "utf8");
    const hits: Array<{ line: number; content: string }> = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/console\.log/.test(line)) {
        hits.push({ line: i + 1, content: line.replace(/^\s+/, "") });
      }
    }
    if (hits.length > 0) {
      process.stderr.write("\n");
      process.stderr.write(`[Hook] console.log found in ${filePath}\n`);
      for (const h of hits) process.stderr.write(`  Line ${h.line}: ${h.content}\n`);
      process.stderr.write("[Hook] Remove before committing\n\n");
    }
  } catch {
    // File disappeared between Edit and read — ignore.
  }
}

// 3. Notify the TLDR daemon that this file changed, so semantic indexes stay
//    fresh without manual `tldr warm` runs. Fire-and-forget; the daemon may not
//    be running (no daemon = no-op exit code).
if (hasCommand("tldr")) {
  const proc = Bun.spawn(["tldr", "daemon", "notify", filePath, "--project", "."], {
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref?.();
  void proc.exited.catch(() => {});
}

// 4. Auto-review + Visual QA reminder for component files.
if (COMPONENT.has(ext)) {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🔍 AUTO-REVIEW: ${basename(filePath)}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("Code Review:");
  console.log("  • A11y: alt, aria-label, semantic elements, keyboard");
  console.log("  • UI: Tailwind defaults, animations (transform/opacity)");
  console.log("  • Perf: barrel imports, waterfalls, memoization");
  console.log("");
  console.log("Visual QA (if dev server running):");
  console.log("  • Run /qa to validate with pinchtab");
  console.log("  • Screenshot + accessibility tree analysis");
  console.log("  • Touch targets, contrast, layout validation");
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}
