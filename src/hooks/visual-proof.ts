#!/usr/bin/env bun
// Visual Proof — PreToolUse hook. Blocks `gh pr create`, and `gh pr edit` with
// a body, when the branch changes stylesheets or markup and the body carries
// neither an image nor the "Screenshots: before/after needed" line that
// rules/git.md asks for (agents cannot attach images through `gh`).
//
// It only judges a body it can read: `--body <literal>` or `--body-file <path>`.
// `--fill`, `--web`, the editor, stdin, `$(...)` and variables pass unchecked.
// Blocks rather than asks: the agent fixes it by editing the body.
// Fail-open: any error, or any git failure, allows the call.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseShellCommand, SUBSTITUTION, scanShell, splitPipes } from "../lib/hook-command.ts";
import { type HookIO, processIO, runHook } from "../lib/hook-runtime.ts";

const DESIGN_RE = /\.(?:css|scss|sass|less|html|vue|svelte|astro|tsx|jsx)$/i;
const SCREENSHOTS_LINE_RE = /screenshots:\s*(?:\*\*|__)?\s*before\s*\/\s*after\s+needed/i;
const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]*)/g;
const HTML_IMAGE_RE = /<img\b([^>]*)/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*["']?([^"'\s>]*)/i;
// Committed-file URLs 404 in the PR view until the branch is merged.
const COMMITTED_IMAGE_HOST_RE = /^(?:https?:)?\/\/raw\.githubusercontent\.com\//i;
const UNRESOLVED_RE = /\$(?:[A-Za-z_{]|\(PSUB)/;
const BODYLESS_FLAGS = new Set([
  "--fill",
  "--fill-first",
  "--fill-verbose",
  "-f",
  "--web",
  "-w",
  "--editor",
  "-e",
]);
// `gh pr edit` flags that take a value, so the value is not read as the PR argument.
const EDIT_VALUE_FLAGS = new Set([
  "--body",
  "-b",
  "--body-file",
  "-F",
  "--title",
  "-t",
  "--base",
  "-B",
  "--milestone",
  "-m",
  "--repo",
  "-R",
  "--add-label",
  "--remove-label",
  "--add-reviewer",
  "--remove-reviewer",
  "--add-assignee",
  "--remove-assignee",
  "--add-project",
  "--remove-project",
]);
const IMAGE_URL_RE = /^(?:https?:)?\/\/[^/\s]+\.[^/\s]+\/\S+/i;
const GIT_TIMEOUT_MS = 1000;
const LISTED_FILES = 5;

interface PrCommand {
  args: string[];
  cwd: string;
}

/** The value of the last `--long`/`-s` flag in `args`, in any of the
 *  `--long v`, `--long=v`, `-s v`, `-sv` forms. */
export function flagValue(args: string[], long: string, short: string): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") break;
    if (a === long || a === short) value = args[++i];
    else if (a.startsWith(`${long}=`)) value = a.slice(long.length + 1);
    else if (a.startsWith(short) && a.length > short.length && !a.startsWith("--")) {
      value = a.slice(short.length).replace(/^=/, "");
    }
  }
  return value;
}

function ghPositionals(args: string[]): string[] {
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "-R" || a === "--repo") i++;
    else if (!a.startsWith("-")) pos.push(a);
  }
  return pos;
}

/** Every `gh pr create` and `gh pr edit` in the command, with the directory a
 *  literal `cd` earlier in the command moved it to. */
export function prCommands(command: string, cwd: string): PrCommand[] {
  const scan = scanShell(command);
  if (scan.unterminated) return [];
  const found: PrCommand[] = [];
  let dir = cwd;
  for (const seg of scan.segments) {
    for (const stage of splitPipes(seg.clean)) {
      const { word, args } = parseShellCommand(stage);
      if (word === "cd" && seg.scope === 0 && args.length === 1) {
        const target = args[0] as string;
        dir =
          target === "-" || target.startsWith("~") || unresolved(target)
            ? ""
            : resolve(dir, target);
      }
      if (word !== "gh" || dir === "") continue;
      const [group, sub] = ghPositionals(args);
      if (group !== "pr") continue;
      // An edit naming a PR can target any branch; the local diff says nothing about it.
      if (sub === "create" || (sub === "edit" && !editTarget(args))) found.push({ args, cwd: dir });
    }
  }
  return found;
}

/** True when `gh pr edit` names a PR (number, URL or branch) instead of the current branch's. */
export function editTarget(args: string[]): boolean {
  let seen = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") return i + 1 < args.length;
    if (EDIT_VALUE_FLAGS.has(a)) i++;
    else if (!a.startsWith("-") && ++seen > 2) return true;
  }
  return false;
}

function unresolved(text: string): boolean {
  return text.includes(SUBSTITUTION) || UNRESOLVED_RE.test(text);
}

/** The PR body the command writes, or null when it cannot be read here. */
export async function prBody({ args, cwd }: PrCommand): Promise<string | null> {
  if (args.some((a) => BODYLESS_FLAGS.has(a))) return null;
  const file = flagValue(args, "--body-file", "-F");
  if (file !== undefined) {
    if (file === "-" || unresolved(file)) return null;
    return readFile(resolve(cwd, file), "utf8").catch(() => null);
  }
  const body = flagValue(args, "--body", "-b");
  if (body === undefined || unresolved(body)) return null;
  return body;
}

export interface Proof {
  ok: boolean;
  /** The body embeds only raw.githubusercontent.com images. */
  committedOnly: boolean;
}

export function bodyProof(body: string): Proof {
  if (SCREENSHOTS_LINE_RE.test(body)) return { ok: true, committedOnly: false };
  const urls = [
    ...[...body.matchAll(MD_IMAGE_RE)].map((m) => m[1] ?? ""),
    ...[...body.matchAll(HTML_IMAGE_RE)].map((m) => (m[1] ?? "").match(SRC_ATTR_RE)?.[1] ?? ""),
  ];
  const valid = urls.filter((u) => IMAGE_URL_RE.test(u));
  const hosted = valid.filter((u) => !COMMITTED_IMAGE_HOST_RE.test(u));
  return { ok: hosted.length > 0, committedOnly: valid.length > 0 && hosted.length === 0 };
}

function git(cwd: string, args: string[]): string | null {
  try {
    const proc = Bun.spawnSync(["git", "-C", cwd, ...args], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      timeout: GIT_TIMEOUT_MS,
    });
    return proc.exitCode === 0 ? proc.stdout.toString() : null;
  } catch {
    return null;
  }
}

/** Design files changed between the PR base and HEAD; null when git cannot
 *  tell. `--base X` is tried as `origin/X`, then `X`; without it the base is
 *  `origin/HEAD`, then `origin/main`. */
export function changedDesignFiles(args: string[], cwd: string): string[] | null {
  const base = flagValue(args, "--base", "-B");
  const candidates =
    base === undefined
      ? ["origin/HEAD", "origin/main"]
      : base.startsWith("origin/")
        ? [base]
        : [`origin/${base}`, base];
  for (const ref of candidates) {
    if (ref.startsWith("-") || unresolved(ref)) return null;
    const out = git(cwd, ["diff", "--name-only", "-z", `${ref}...HEAD`, "--"]);
    if (out !== null) return out.split("\0").filter((p) => DESIGN_RE.test(p));
  }
  return null;
}

function reason(files: string[], proof: Proof): string {
  const shown = files.slice(0, LISTED_FILES).join(", ");
  const more = files.length > LISTED_FILES ? ` and ${files.length - LISTED_FILES} more` : "";
  const committed = proof.committedOnly
    ? " Its raw.githubusercontent.com image does not count: that URL 404s until the branch is merged."
    : "";
  return (
    `[Visual Proof] This branch changes design files (${shown}${more}) but the PR body has no before/after image.${committed} ` +
    'Agents cannot attach images through gh, so add a "Screenshots: before/after needed" line for the author (rules/git.md), ' +
    "or embed an image hosted outside the repository, then rerun the command."
  );
}

/** The block reason for this command, or null to allow it. Never throws. */
export async function verdict(command: string, cwd: string): Promise<string | null> {
  try {
    for (const pr of prCommands(command, cwd)) {
      const body = await prBody(pr);
      if (body === null) continue;
      const proof = bodyProof(body);
      if (proof.ok) continue;
      const files = changedDesignFiles(pr.args, pr.cwd);
      if (files && files.length > 0) return reason(files, proof);
    }
  } catch {
    // Fail open.
  }
  return null;
}

export async function main(io: HookIO = processIO): Promise<void> {
  const { tool_name: tool, cwd: rawCwd } = await io.hookInput<{ tool_name: string; cwd: string }>({
    tool_name: "TOOL_NAME",
  });
  if (tool !== "Bash") return;
  const { command } = await io.toolInput<{ command: unknown }>();
  if (typeof command !== "string") return;
  const cwd = typeof rawCwd === "string" && rawCwd ? rawCwd : process.cwd();
  // io.block throws under the dispatcher; it must stay outside any catch.
  const blocked = await verdict(command, cwd);
  if (blocked) io.block(blocked);
}

if (import.meta.main) await runHook(main);
