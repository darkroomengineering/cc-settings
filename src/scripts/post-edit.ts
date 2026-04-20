#!/usr/bin/env bun
// PostToolUse Write|Edit hook — auto-format, console.log warning, review reminder.
// Port of scripts/post-edit.sh.
//
// TOOL_INPUT_file_path comes via env. Never fails the hook: all side effects
// are best-effort.

import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const filePath = process.env.TOOL_INPUT_file_path ?? "";
if (!filePath) process.exit(0);

const ext = extname(filePath).toLowerCase();
const BIOMABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css"]);
const JSTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const COMPONENT = new Set([".tsx", ".jsx"]);

async function hasCommand(cmd: string): Promise<boolean> {
  const proc = Bun.spawn(["sh", "-c", `command -v ${cmd}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

// 1. Auto-format with biome (skip on Windows where sh isn't available; fall
//    back to a direct spawn).
if (BIOMABLE.has(ext)) {
  const biomeOnPath =
    process.platform === "win32" ? Bun.which("biome") !== null : await hasCommand("biome");
  if (biomeOnPath) {
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

// 3. Auto-review + Visual QA reminder for component files.
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
