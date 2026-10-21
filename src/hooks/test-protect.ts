#!/usr/bin/env bun
// Test Protect — PreToolUse hook. Asks the user before a tool call disables or
// deletes a test:
//   Edit   adds a skip/only/todo marker (SKIP_MARKERS) to a test file
//   Write  rewrites an existing test file with more markers than it has now
//   Bash   rm / unlink / git rm of a test, or mv / git mv that renames one to
//          a name no test runner picks up (`.bak`, `.disabled`, out of tests/)
//
// It asks instead of blocking: deleting the tests of removed code (/cc sync,
// the deslopper agent) is legitimate, and only the user can tell the cases apart.
// Fail-open: any error allows the call (the dispatcher skips a throwing handler).

import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { parseShellCommand, scanShell, splitPipes } from "../lib/hook-command.ts";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";

export const SKIP_MARKERS = [
  ".skip(",
  ".only(",
  ".todo(",
  "xit(",
  "xdescribe(",
  "xtest(",
  "describe.skip",
  "it.skip",
  "test.skip",
  "@Disabled",
  "t.Skip(",
  "@pytest.mark.skip",
  "pytest.skip(",
] as const;

const TEST_DIRS = new Set(["__tests__", "tests", "test", "e2e"]);
const TEST_NAME_RE = /(?:\.(?:test|spec)\.[A-Za-z0-9]+|_test\.(?:go|py))$|^test_.*\.py$/;
const DISABLED_SUFFIX_RE = /\.(?:bak|backup|disabled|skip|skipped|old|orig|off|ignored?)$/i;
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const REASON_TAIL = "Approve only if the test is obsolete, not to make the suite pass.";

function pathParts(path: string): string[] {
  return path.split(/[/\\]+/).filter((p) => p !== "" && p !== ".");
}

/** A test file: `*.test.*`, `*.spec.*`, `*_test.go|py`, `test_*.py`, or any
 *  file under a `__tests__`, `tests`, `test` or `e2e` directory. */
export function isTestFile(path: string): boolean {
  const parts = pathParts(path);
  const name = parts.pop();
  if (name === undefined) return false;
  return TEST_NAME_RE.test(name) || parts.some((p) => TEST_DIRS.has(p));
}

/** A test file, or a test directory itself (`rm -r tests`). */
function holdsTests(path: string): boolean {
  return isTestFile(path) || TEST_DIRS.has(pathParts(path).at(-1) ?? "");
}

function withMarkerBoundary(marker: string): RegExp {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `xit(` must not match `process.exit(`, nor `it.skip` match `submit.skip`.
  return new RegExp(/^\w/.test(marker) ? `(?<![\\w$.])${escaped}` : escaped, "g");
}

const MARKER_RES = SKIP_MARKERS.map((m) => [m, withMarkerBoundary(m)] as const);

/** Markers that occur more often in `after` than in `before`; a marker that
 *  is part of a longer reported one (`.skip(` in `it.skip(`) is left out. */
export function addedMarkers(before: string, after: string): string[] {
  const count = (re: RegExp, text: string): number => text.match(re)?.length ?? 0;
  const added: string[] = MARKER_RES.filter(([, re]) => count(re, after) > count(re, before)).map(
    ([m]) => m,
  );
  return added.filter((m) => !added.some((n) => n !== m && `${n}(`.includes(m)));
}

function insideCwd(path: string, cwd: string): boolean {
  const rel = relative(cwd, resolve(cwd, path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function displayPath(path: string, cwd: string): string {
  return insideCwd(path, cwd) ? relative(cwd, resolve(cwd, path)) : path;
}

function positionals(args: string[]): string[] {
  const end = args.indexOf("--");
  const opts = end < 0 ? args : args.slice(0, end);
  const rest = end < 0 ? [] : args.slice(end + 1);
  return [...opts.filter((a) => !a.startsWith("-")), ...rest];
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ?? false;
}

function renamedAway(src: string, dst: string): boolean {
  if (!holdsTests(src)) return false;
  const srcName = basename(src);
  const dstName = basename(dst);
  return (
    !holdsTests(dst) ||
    DISABLED_SUFFIX_RE.test(dstName) ||
    (TEST_NAME_RE.test(srcName) && !TEST_NAME_RE.test(dstName))
  );
}

async function moveFindings(args: string[], cwd: string): Promise<string[]> {
  let targetDir: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "-t" || a === "--target-directory") targetDir = args[++i];
    else if (a.startsWith("--target-directory=")) targetDir = a.slice(a.indexOf("=") + 1);
    else rest.push(a);
  }
  const operands = positionals(rest);
  const dest = targetDir ?? operands.pop();
  if (dest === undefined || operands.length === 0) return [];
  const intoDir =
    targetDir !== undefined ||
    operands.length > 1 ||
    /[/\\]$/.test(dest) ||
    (await isDirectory(resolve(cwd, dest)));
  const found: string[] = [];
  for (const src of operands) {
    const result = intoDir ? join(dest, basename(src)) : dest;
    const srcPath = displayPath(src, cwd);
    const leaves = insideCwd(src, cwd) && holdsTests(srcPath) && !insideCwd(result, cwd);
    if (leaves || renamedAway(srcPath, displayPath(result, cwd))) {
      found.push(`renames ${src} to ${result}, which no test runner picks up`);
    }
  }
  return found;
}

function deleteFindings(args: string[], cwd: string): string[] {
  return positionals(args)
    .filter((p) => holdsTests(displayPath(p, cwd)))
    .map((p) => `deletes ${p}`);
}

/** Splits `git [global opts] <sub> <args>` into the subcommand and its args. */
function gitSubcommand(args: string[]): { sub: string; subArgs: string[] } | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (GIT_VALUE_OPTS.has(a)) i++;
    else if (!a.startsWith("-")) return { sub: a, subArgs: args.slice(i + 1) };
  }
  return null;
}

export async function bashFindings(command: string, cwd: string): Promise<string[]> {
  const found: string[] = [];
  for (const seg of scanShell(command).segments) {
    for (const stage of splitPipes(seg.clean)) {
      const { word, args } = parseShellCommand(stage);
      if (word === "rm" || word === "unlink") found.push(...deleteFindings(args, cwd));
      else if (word === "mv") found.push(...(await moveFindings(args, cwd)));
      else if (word === "git") {
        const git = gitSubcommand(args);
        if (git?.sub === "rm") found.push(...deleteFindings(git.subArgs, cwd));
        else if (git?.sub === "mv") found.push(...(await moveFindings(git.subArgs, cwd)));
      }
    }
  }
  return found;
}

async function currentContent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

interface ToolInput {
  command?: unknown;
  file_path?: unknown;
  old_string?: unknown;
  new_string?: unknown;
  content?: unknown;
}

export async function main(io: HookIO = processIO): Promise<void> {
  const { tool_name: tool, cwd: rawCwd } = await io.hookInput<{ tool_name: string; cwd: string }>({
    tool_name: "TOOL_NAME",
  });
  const input = await io.toolInput<ToolInput>();
  const cwd = typeof rawCwd === "string" && rawCwd ? rawCwd : process.cwd();

  let findings: string[] = [];
  if (tool === "Bash" && typeof input.command === "string") {
    findings = await bashFindings(input.command, cwd);
  } else if ((tool === "Edit" || tool === "Write") && typeof input.file_path === "string") {
    const file = displayPath(input.file_path, cwd);
    if (!isTestFile(file)) return;
    let before: string | null;
    let after: unknown;
    if (tool === "Edit") {
      before = typeof input.old_string === "string" ? input.old_string : "";
      after = input.new_string;
    } else {
      before = await currentContent(resolve(cwd, input.file_path));
      after = input.content;
    }
    if (before === null || typeof after !== "string") return;
    const markers = addedMarkers(before, after);
    if (markers.length > 0) findings = [`adds ${markers.join(", ")} to ${file}`];
  }
  if (findings.length > 0) io.ask(`[Test Guard] ${findings.join("; ")}. ${REASON_TAIL}`);
}

if (import.meta.main) await runHook(main);
