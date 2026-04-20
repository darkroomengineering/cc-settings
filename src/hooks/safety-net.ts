#!/usr/bin/env bun
// Safety Net — PreToolUse hook that blocks destructive Bash commands.
// Port of scripts/safety-net.sh.
//
// Decision protocol (identical to bash):
//   exit 0                → ALLOW (silent)
//   exit 2 + JSON stdout  → BLOCK — {"decision":"block","reason":"[Safety Net] ..."}
//
// Fail-open: any unexpected error → exit 0. Only intentional block() calls
// surface exit 2.
//
// Reads TOOL_INPUT_command from env to match the bash contract. The shadow
// wrapper (scripts/safety-net-shadow.sh) runs both implementations for 7
// days before cutover; see docs/migration-coexistence.md.

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HOOK_VERSION = "1.0.0";
const LOG_FILE = join(homedir(), ".claude", "safety-net.log");

// --- Utilities ------------------------------------------------------------

function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    .replace(/ghp_[A-Za-z0-9]{10,}/g, "[REDACTED]")
    .replace(/AKIA[A-Z0-9]{12,}/g, "[REDACTED]")
    .replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/password=[^ &"]+/g, "password=[REDACTED]")
    .replace(/token=[^ &"]+/g, "token=[REDACTED]")
    .replace(/secret=[^ &"]+/g, "secret=[REDACTED]");
}

async function logBlocked(cmd: string, reason: string): Promise<void> {
  const redacted = redactSecrets(cmd);
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const cwd = process.cwd() || "unknown";
  const line = `${JSON.stringify({
    timestamp,
    command: redacted.replace(/\n/g, " "),
    reason,
    cwd,
    version: HOOK_VERSION,
  })}\n`;
  try {
    await mkdir(dirname(LOG_FILE), { recursive: true });
    await appendFile(LOG_FILE, line);
  } catch {
    // never let logging failure block the decision
  }
}

class BlockDecision extends Error {
  constructor(
    public readonly reason: string,
    public readonly command: string,
  ) {
    super(reason);
    this.name = "BlockDecision";
  }
}

function block(reason: string, cmd = ""): never {
  throw new BlockDecision(reason, cmd);
}

// --- Rule: rm -rf detection -----------------------------------------------

function extractRmTarget(args: string): string {
  let result = "";
  for (const raw of args.split(/\s+/)) {
    const token = raw.trim();
    if (!token) continue;
    // Short flags (-rf, -r, -f)
    if (/^-[a-zA-Z]+$/.test(token)) continue;
    // Known long flags
    if (
      token === "--recursive" ||
      token === "--force" ||
      token === "--interactive" ||
      token === "--one-file-system" ||
      token === "--no-preserve-root" ||
      token === "--preserve-root" ||
      token === "--verbose" ||
      token.startsWith("--interactive=")
    ) {
      continue;
    }
    result = token;
  }
  return result;
}

function checkRmRf(cmd: string): void {
  if (!/(^|\s)rm\s/.test(cmd)) return;

  // Extract everything after 'rm' up to a command separator.
  const m = cmd.match(/(^|\s)rm\s+([^;&|]+)/);
  const rmPortion = m ? (m[2] ?? "").trim() : "";

  // Need to detect recursive + force. The flags may be combined (-rf), split
  // (-r -f), or long (--recursive / --force).
  const hasRecursive =
    /\s-[a-zA-Z]*[rR]/.test(` ${rmPortion}`) || /\s--recursive(\s|$)/.test(` ${rmPortion}`);
  const hasForce =
    /\s-[a-zA-Z]*[fF]/.test(` ${rmPortion}`) || /\s--force(\s|$)/.test(` ${rmPortion}`);

  if (!hasRecursive || !hasForce) return;

  const target = extractRmTarget(rmPortion);
  if (!target) block("rm -rf with no clear target path", cmd);

  // ALWAYS BLOCK: dangerous root/home/cwd paths.
  if (target === "/" || target === "/*") block("rm -rf targeting root filesystem", cmd);
  if (target === "~" || target === "~/" || target === "~/*")
    block("rm -rf targeting home directory", cmd);
  if (target === "." || target === "./") block("rm -rf targeting current directory", cmd);
  if (target === ".." || target === "../") block("rm -rf targeting parent directory", cmd);
  if (
    target === "$HOME" ||
    target === "$HOME/" ||
    target === "$HOME/*" ||
    target === "${HOME}" ||
    target === "${HOME}/" ||
    target === "${HOME}/*"
  ) {
    block("rm -rf targeting home directory", cmd);
  }

  // ALLOW: safe temp directories.
  if (target.startsWith("/tmp/") || target.startsWith("/var/tmp/")) return;

  // ALLOW: known build-artifact directories.
  const base = target.split(/[\\/]/).pop() ?? target;
  const ALLOWED_BASES = new Set([
    "node_modules",
    ".next",
    "dist",
    ".turbo",
    "build",
    ".cache",
    "__pycache__",
    ".pytest_cache",
    "coverage",
  ]);
  if (ALLOWED_BASES.has(base)) return;

  // ALLOW: absolute paths under PWD.
  const pwd = process.cwd();
  if (pwd && target.startsWith(`${pwd}/`)) return;

  // ALLOW: relative paths within the project (no /, ~, $HOME, ..).
  if (
    !target.startsWith("/") &&
    !target.startsWith("~") &&
    !target.startsWith("$HOME") &&
    !target.startsWith("${HOME}") &&
    target !== "." &&
    target !== "./" &&
    target !== ".." &&
    target !== "../" &&
    !target.includes("../")
  ) {
    return;
  }

  block(`rm -rf with unrecognized target path: ${target}`, cmd);
}

// --- Rule: AI attribution --------------------------------------------------

function checkAiAttribution(cmd: string): void {
  const isCommit = /git\s+commit/.test(cmd);
  const isPr = /gh\s+pr\s+create/.test(cmd);
  if (!isCommit && !isPr) return;

  const coAuthored = /Co-Authored-By.*Claude|Co-Authored-By.*Anthropic|noreply@anthropic/i;
  const generated = /Generated with.*Claude|Generated by.*Claude|AI-assisted|🤖.*Claude|🤖/i;

  if (isCommit) {
    if (coAuthored.test(cmd))
      block("AI attribution detected in commit message — stealth mode is on", cmd);
    if (generated.test(cmd))
      block("AI fingerprint detected in commit message — stealth mode is on", cmd);
  }
  if (isPr) {
    if (coAuthored.test(cmd)) block("AI attribution detected in PR — stealth mode is on", cmd);
    // PR generated pattern doesn't need the trailing "Claude" — the 🤖 alone is enough.
    const prGenerated = /Generated with.*Claude|Generated by.*Claude|AI-assisted|🤖/i;
    if (prGenerated.test(cmd))
      block("AI fingerprint detected in PR description — stealth mode is on", cmd);
  }
}

// --- Rule: git destructive ops --------------------------------------------

function stripGitGlobalOpts(rest: string): string {
  let r = rest;
  while (true) {
    const m1 = r.match(/^-[Cc]\s+\S+\s*/);
    if (m1) {
      r = r.slice(m1[0].length);
      continue;
    }
    const m2 = r.match(/^--(git-dir|work-tree)=\S+\s*/);
    if (m2) {
      r = r.slice(m2[0].length);
      continue;
    }
    const m3 = r.match(/^--(git-dir|work-tree)\s+\S+\s*/);
    if (m3) {
      r = r.slice(m3[0].length);
      continue;
    }
    const m4 = r.match(/^(--bare|--no-pager|--no-replace-objects)\s*/);
    if (m4) {
      r = r.slice(m4[0].length);
      continue;
    }
    break;
  }
  return r;
}

function checkGitDestructive(cmd: string): void {
  if (!/(^|\s)git\s/.test(cmd)) return;

  const m = cmd.match(/git\s+(.*)/);
  if (!m) return;
  const afterGlobal = stripGitGlobalOpts((m[1] ?? "").trimStart());
  if (!afterGlobal) return;

  const [sub = "", ...rest] = afterGlobal.split(/\s+/);
  const subargs = rest.join(" ");

  switch (sub) {
    case "checkout": {
      // ALLOW: branch creation/orphan
      if (/^-b\s/.test(subargs) || /^-B\s/.test(subargs) || /^--orphan\s/.test(subargs)) return;
      // BLOCK: git checkout -- <anything>
      if (/\s--\s|^--\s/.test(` ${subargs} `)) {
        block("git checkout -- discards uncommitted changes", cmd);
      }
      if (subargs.includes("--pathspec-from-file")) {
        block("git checkout --pathspec-from-file discards uncommitted changes", cmd);
      }
      return;
    }
    case "restore": {
      const hasStaged = /(^|\s)(--staged|-S)(\s|$)/.test(` ${subargs} `);
      const hasWorktree = /(^|\s)(--worktree|-W)(\s|$)/.test(` ${subargs} `);
      if (hasStaged) {
        if (hasWorktree) block("git restore --worktree discards working tree changes", cmd);
        return;
      }
      if (hasWorktree) block("git restore --worktree discards working tree changes", cmd);
      if (subargs.trim().length > 0) {
        block("git restore without --staged discards working tree changes", cmd);
      }
      return;
    }
    case "reset": {
      if (/(^|\s)--hard(\s|$)/.test(` ${subargs} `))
        block("git reset --hard discards all uncommitted changes", cmd);
      if (/(^|\s)--merge(\s|$)/.test(` ${subargs} `))
        block("git reset --merge can discard uncommitted changes", cmd);
      return;
    }
    case "clean": {
      if (/(-n|--dry-run)/.test(` ${subargs} `)) return;
      if (/(-[a-zA-Z]*f|--force)/.test(` ${subargs} `)) {
        block("git clean -f permanently deletes untracked files", cmd);
      }
      return;
    }
    case "push": {
      if (subargs.includes("--force-with-lease")) return;
      if (/\s(--force|-f)\s/.test(` ${subargs} `))
        block("git push --force can overwrite remote history", cmd);
      if (/(--force|-f)$/.test(subargs))
        block("git push --force can overwrite remote history", cmd);
      return;
    }
    case "branch": {
      if (/\s-D\s/.test(` ${subargs} `))
        block("git branch -D force-deletes branch without merge check", cmd);
      if (/(^|\s)-D$/.test(subargs))
        block("git branch -D force-deletes branch without merge check", cmd);
      return;
    }
    case "stash": {
      const stashAction = (subargs.split(/\s+/)[0] ?? "").trim();
      if (stashAction === "drop") block("git stash drop permanently deletes stashed changes", cmd);
      if (stashAction === "clear")
        block("git stash clear permanently deletes all stashed changes", cmd);
      return;
    }
    case "worktree": {
      if (/remove\s+.*(--force|-f)/.test(subargs))
        block("git worktree remove --force can discard changes", cmd);
      return;
    }
    default:
      return;
  }
}

// --- Rule: find / xargs ---------------------------------------------------

function checkFindXargs(cmd: string): void {
  if (/find\s+.*-delete/.test(cmd)) block("find -delete permanently removes files", cmd);
  if (/find\s+.*-exec(dir)?\s+rm/.test(cmd)) block("find -exec rm permanently removes files", cmd);
  if (/xargs\s+(.*\s)?rm\s+.*-[a-zA-Z]*r/.test(cmd))
    block("xargs rm -r is a bulk destructive operation", cmd);
  if (/xargs\s+(.*\s)?(bash|sh)\s+-c/.test(cmd))
    block("xargs with shell -c enables arbitrary command execution", cmd);
}

// --- Rule: shell wrapper recursion (bash -c / sh -c) ---------------------

const MAX_DEPTH = 3;

function unwrapAndAnalyze(cmd: string, depth: number): void {
  if (depth >= MAX_DEPTH) return;
  if (!/(bash|\/bash|sh|\/sh|zsh|\/zsh)\s+-c\s/.test(cmd)) return;

  let inner: string | null = null;
  const sq = cmd.match(/-c\s+'([^']+)'/);
  if (sq) inner = sq[1] ?? null;
  if (!inner) {
    const dq = cmd.match(/-c\s+"([^"]+)"/);
    if (dq) inner = dq[1] ?? null;
  }
  if (!inner) {
    const unq = cmd.match(/-c\s+([^;&|"']+)/);
    if (unq) inner = unq[1] ?? null;
  }
  if (inner) analyzeCommand(inner, depth + 1);
}

// --- Rule: interpreter -c/-e with dangerous calls -------------------------

function checkInterpreterOneliners(cmd: string, depth: number): void {
  if (!/(python3?|node|ruby|perl)\s+-[ec]\s/.test(cmd)) return;
  const dangerous =
    /(os\.system\(|subprocess\.|child_process|execSync\(|system\(|exec\(|popen\(|spawn\()/;
  if (!dangerous.test(cmd)) return;

  const m = cmd.match(/(os\.system|subprocess\.(run|call|Popen)|execSync)\(['"]([^'"]+)['"]/);
  if (m?.[3] && depth < MAX_DEPTH) analyzeCommand(m[3], depth + 1);
}

// --- Rule: multi-command splitting ---------------------------------------

function splitCommands(cmd: string): void {
  // Pipe to xargs (full-pipeline check).
  if (/\|\s*xargs\s/.test(cmd)) checkFindXargs(cmd);

  // AI attribution runs on the full string (covers multi-line commit bodies).
  checkAiAttribution(cmd);
  unwrapAndAnalyze(cmd, 0);
  checkInterpreterOneliners(cmd, 0);

  // Split on ; && || and analyze each segment.
  const segments = cmd.split(/\s*(?:&&|\|\||;)\s*/);
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg) continue;
    analyzeCommand(seg, 0);
  }
}

// --- Core analysis --------------------------------------------------------

function analyzeCommand(cmd: string, depth: number): void {
  checkRmRf(cmd);
  checkAiAttribution(cmd);
  checkGitDestructive(cmd);
  checkFindXargs(cmd);
  unwrapAndAnalyze(cmd, depth);
  checkInterpreterOneliners(cmd, depth);
}

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const COMMAND = process.env.TOOL_INPUT_command ?? "";
  if (!COMMAND) return;

  // Fast path: skip entirely if none of the high-risk verbs appear.
  if (!/\b(rm|git|gh|find|xargs|bash|sh|zsh|python|python3|node|ruby|perl)\b/.test(COMMAND)) {
    return;
  }

  try {
    splitCommands(COMMAND);
  } catch (err) {
    if (err instanceof BlockDecision) {
      await logBlocked(err.command, err.reason);
      process.stdout.write(
        `${JSON.stringify({
          decision: "block",
          reason: `[Safety Net] ${err.reason}`,
        })}\n`,
      );
      process.exit(2);
    }
    // Unexpected: fail-open.
    return;
  }
}

await main();
