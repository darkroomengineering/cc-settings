#!/usr/bin/env bun
// PostToolUse async hook — runs tsc --noEmit and surfaces errors for the edited file.
// Port of scripts/post-edit-tsc.sh.
//
// Fires only for .ts/.tsx files, only when a tsconfig.json exists in cwd.
// Never fails the hook: errors are stdout-only.

import { existsSync } from "node:fs";

const filePath = process.env.TOOL_INPUT_file_path ?? "";
if (!filePath) process.exit(0);
if (!/\.tsx?$/.test(filePath)) process.exit(0);
if (!existsSync("tsconfig.json")) process.exit(0);

// Spawn tsc, filter to lines mentioning the edited file. Bash version used:
//   bunx tsc --noEmit 2>&1 | grep -E "$FILE_PATH" || true
const proc = Bun.spawn(["bunx", "tsc", "--noEmit"], { stdout: "pipe", stderr: "pipe" });
const [stdout, stderr] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
]);
await proc.exited;

const combined = `${stdout}${stderr}`;
// Escape regex metacharacters in the file path, then match line-by-line.
const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = new RegExp(escaped);
const matches = combined
  .split(/\r?\n/)
  .filter((line) => line && re.test(line))
  .join("\n");

if (matches) console.log(matches);
