#!/usr/bin/env bun
// PostToolUse Write|Edit hook — auto-format, console.log warning, review reminder.
// Port of scripts/post-edit.sh.
//
// tool_input.file_path comes via the stdin JSON payload. Never fails the hook: all side effects
// are best-effort.

import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { resolveEngine } from "../lib/code-intel-engine.ts";
import { emitAdditionalContext, readToolInput } from "../lib/hook-runtime.ts";
import { hasCommand } from "../lib/platform.ts";

const { file_path: filePath = "" } = await readToolInput<{ file_path: string }>();
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

// 3. Notify the code-intel engine's daemon that this file changed, so indexes
//    stay fresh without manual warm runs. Only a daemon-backed engine (e.g.
//    llm-tldr) has a daemon to notify; native-ts has none, so this is skipped.
//    Fire-and-forget; the daemon may not be running (no daemon = no-op exit).
const { engine } = await resolveEngine();
const daemonVerb = engine.cli.verbMap.daemon;
if (engine.cli.supportsDaemon && daemonVerb && hasCommand(engine.cli.command)) {
  const proc = Bun.spawn([engine.cli.command, daemonVerb, "notify", filePath, "--project", "."], {
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref?.();
  void proc.exited.catch(() => {});
}

// 4. Auto-review + Visual QA reminder for component files.
// Plain console.log stdout on a PostToolUse hook never reaches the model
// (verified against Claude Code 2.1.220 by a headless marker probe,
// replicated twice — see docs/hooks-reference.md "Sync vs Async Behavior").
// Emitted via the hookSpecificOutput.additionalContext envelope instead.
if (COMPONENT.has(ext)) {
  const banner = `[review] ${basename(filePath)} edited: check a11y labels, alt text, 44px targets, transform/opacity-only animation.`;
  emitAdditionalContext("PostToolUse", banner);
}
