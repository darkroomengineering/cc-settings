#!/usr/bin/env bun
// Safety Net — PreToolUse hook that blocks destructive Bash commands.
// Port of scripts/safety-net.sh.
//
// Decision protocol (identical to bash):
//   exit 0                → ALLOW (silent)
//   exit 0 + JSON stdout  → ASK — permissionDecision "ask" for a push to main or
//                           master; a block anywhere in the command wins over it
//   exit 2 + JSON stdout  → BLOCK — {"decision":"block","reason":"[Safety Net] ..."}
//   exit 1 + stderr       → unexpected internal error; fails CLOSED (the
//                           "onFailure": "block" wiring in config/40-hooks.json
//                           only fires on exit codes other than 0 and 2)
//
// hooks/dispatch.ts calls main(io) in-process: io.block ends the run as a block, and
// any other throw becomes a block with the same fail-closed reason.
//
// Empty or missing input is not an error: exit 0.
//
// Reads tool_input.command from the stdin JSON payload (see
// docs/hooks-reference.md "Tool Input").
//
// CC_SAFETY_GH_LOGIN overrides the GitHub login that counts as "your own
// account" for outside-org gh writes (set it to skip the `gh api user` lookup;
// the tests use it). Defined-but-empty means "no personal login": only the org
// is allowed. Hooks run as `bun --no-env-file`, so a project .env cannot set it.
// CC_SAFETY_TEST_CRASH makes the hook throw, to exercise the fail-closed path.

import { existsSync, lstatSync, readFileSync, writeSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import {
  type ParsedShellCommand,
  PROCESS_SUBSTITUTION_RE,
  parseShellCommand,
  type ShellScan,
  type ShellSegment,
  SUBSTITUTION,
  scanShell,
  shellWords,
  splitPipes,
} from "../lib/hook-command.ts";
import { type HookIO, processIO } from "../lib/hook-runtime.ts";
import { claudePath, isoNow } from "../lib/platform.ts";
import { redactSecrets } from "../lib/redact.ts";

const HOOK_VERSION = "1.0.0";
const LOG_FILE = claudePath("safety-net.log");

// --- Utilities ------------------------------------------------------------
//
// Secret redaction lives in src/lib/redact.ts (canonical, shared with
// codex.ts and log-bash.ts).

async function logBlocked(cmd: string, reason: string): Promise<void> {
  const redacted = redactSecrets(cmd);
  const timestamp = isoNow();
  let cwd = "unknown";
  try {
    cwd = process.cwd();
  } catch {
    // cwd was removed; the decision still stands
  }
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

// Quote-aware tokenizer: groups double/single-quoted spans into a single
// token (dequoted) instead of splitting on the whitespace inside them, so
// `rm -rf "$HOME/Library/Application Support"` reads as ONE target token
// instead of three naive whitespace-split fragments that lose the real path.
function tokenizeArgs(args: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = args.length;
  while (i < n) {
    while (i < n && /\s/.test(args[i] as string)) i++;
    if (i >= n) break;
    let tok = "";
    while (i < n && !/\s/.test(args[i] as string)) {
      const c = args[i] as string;
      if (c === '"' || c === "'") {
        const quote = c;
        i++;
        const start = i;
        while (i < n && args[i] !== quote) i++;
        tok += args.slice(start, i);
        if (i < n) i++; // skip closing quote
      } else {
        tok += c;
        i++;
      }
    }
    tokens.push(tok);
  }
  return tokens;
}

function extractRmTargets(args: string): string[] {
  const targets: string[] = [];
  let optionsEnded = false;
  for (const raw of tokenizeArgs(args)) {
    const token = raw.trim();
    if (!token) continue;
    if (optionsEnded) {
      targets.push(token);
      continue;
    }
    if (token === "--") {
      optionsEnded = true;
      continue;
    }
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
    targets.push(token);
  }
  return targets;
}

// Six literal forms of "the user's home dir" that rm -rf must reject. Used
// both for the explicit BLOCK list (equality) and the ALLOW list (startsWith).
// biome-ignore lint/suspicious/noTemplateCurlyInString: bash var string
const HOME_PATH_PREFIXES = ["$HOME", "${HOME}"] as const;

function isExactHomePath(target: string): boolean {
  for (const p of HOME_PATH_PREFIXES) {
    if (target === p || target === `${p}/` || target === `${p}/*`) return true;
  }
  return false;
}

// Known build-artifact directories that are always safe to rm -rf. Hoisted
// to module scope since it's identical across every occurrence analyzed.
const ALLOWED_RM_BASES = new Set([
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

function analyzeRmPortion(rmPortion: string, cmd: string): void {
  // Need to detect recursive + force. The flags may be combined (-rf), split
  // (-r -f), or long (--recursive / --force).
  const hasRecursive =
    /\s-[a-zA-Z]*[rR]/.test(` ${rmPortion}`) || /\s--recursive(\s|$)/.test(` ${rmPortion}`);
  const hasForce =
    /\s-[a-zA-Z]*[fF]/.test(` ${rmPortion}`) || /\s--force(\s|$)/.test(` ${rmPortion}`);

  if (!hasRecursive || !hasForce) return;

  const targets = extractRmTargets(rmPortion);
  if (targets.length === 0) block("rm -rf with no clear target path", cmd);
  for (const target of targets) analyzeRmTarget(target, cmd);
}

function analyzeRmTarget(target: string, cmd: string): void {
  // ALWAYS BLOCK: dangerous root/home/cwd paths.
  if (target === "/" || target === "/*") block("rm -rf targeting root filesystem", cmd);
  if (target === "~" || target === "~/" || target === "~/*")
    block("rm -rf targeting home directory", cmd);
  if (target === "." || target === "./") block("rm -rf targeting current directory", cmd);
  if (target === ".." || target === "../") block("rm -rf targeting parent directory", cmd);
  if (isExactHomePath(target)) {
    block("rm -rf targeting home directory", cmd);
  }

  // Shell expansion cannot be resolved safely without executing the command.
  if (/[$`\\]/.test(target) || target.startsWith("~")) {
    block(`rm -rf with unresolved target path: ${target}`, cmd);
  }

  // A removed cwd leaves relative paths meaningless (nothing to delete) and
  // absolute paths with no "under PWD" allowance.
  const cwd = safeCwd();
  if (cwd === null && !isAbsolute(target)) return;
  const pwd = cwd === null ? null : resolve(cwd);
  const absolute = resolve(pwd ?? "/", target);
  if (absolute === pwd || absolute === resolve("/")) {
    block("rm -rf targeting current directory or root filesystem", cmd);
  }
  const within = (root: string): boolean =>
    absolute.startsWith(`${resolve(pwd ?? "/", root)}${sep}`);

  // Normalize before checking containment so '..' cannot escape a safe prefix.
  if (within("/tmp") || within("/var/tmp")) return;

  // ALLOW: known build-artifact directories.
  const base = basename(absolute);
  if (ALLOWED_RM_BASES.has(base)) return;

  // ALLOW: absolute paths under PWD.
  if (pwd !== null && within(pwd)) return;

  block(`rm -rf with unrecognized target path: ${target}`, cmd);
}

function checkRmRf(cmd: string): void {
  // Evaluate EVERY 'rm' occurrence in the string, not just the first — a
  // single-match `cmd.match(...)` latches onto the first invocation and lets
  // a second `rm -rf /` later in the same (unsplit) string ride along
  // unchecked. The capture excludes newlines so an embedded `\n` still acts
  // as a hard stop between two rm invocations even if upstream splitting
  // missed it.
  // The optional path prefix catches /bin/rm, ./rm, and env /usr/bin/rm —
  // a whitespace-bare `rm` matcher misses path-qualified invocations.
  // Accepted residual (advisory posture, see SECURITY.md "Enforcement
  // boundary"): a QUOTED executable ("/bin/rm" -rf /) is not matched —
  // admitting quotes here would false-positive on quoted strings that merely
  // contain rm (echo "rm -rf /"). Robust coverage needs the shared
  // shell-aware tokenizer (DT1 follow-up), not a wider regex.
  const re = /(^|[\s;&|])(?:[^\s;&|]*\/)?rm\s+([^;&|\n]+)/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop idiom
  while ((m = re.exec(cmd))) {
    const rmPortion = (m[2] ?? "").trim();
    if (rmPortion) analyzeRmPortion(rmPortion, cmd);
  }
}

// --- Rule: AI attribution --------------------------------------------------

function checkAiAttribution(cmd: string): void {
  const isCommit = /git\s+commit/i.test(cmd);
  const isPr = /gh\s+pr\s+create/i.test(cmd);
  if (!isCommit && !isPr) return;

  const coAuthored = /Co-Authored-By.*Claude|Co-Authored-By.*Anthropic|noreply@anthropic/i;
  // The bare 🤖 alternative subsumes any "🤖.*Claude" form, so commits and PRs
  // share ONE fingerprint regex; only the reason wording differs. A command can
  // be both (git commit && gh pr create) — the commit wording wins, matching
  // the original check order.
  const generated = /Generated with.*Claude|Generated by.*Claude|AI-assisted|🤖/i;

  if (coAuthored.test(cmd)) {
    block(
      `AI attribution detected in ${isCommit ? "commit message" : "PR"} — stealth mode is on`,
      cmd,
    );
  }
  if (generated.test(cmd)) {
    block(
      `AI fingerprint detected in ${isCommit ? "commit message" : "PR description"} — stealth mode is on`,
      cmd,
    );
  }
}

// --- Rule: git destructive ops --------------------------------------------

// Path values are quote-aware: `git -C "/repo with spaces" reset --hard`
// must strip the whole quoted path, or the leftover fragment hides the verb
// from the destructive-op matcher.
// The double-quoted atom tolerates backslash-escaped quotes inside the value
// ("/repo \" x") so an embedded escape can't split the strip mid-path.
const GIT_GLOBAL_OPT_PATTERNS = [
  /^-[Cc]\s+("(?:[^"\\]|\\.)*"|'[^']*'|\S+)\s*/, // -C <path>
  /^--(git-dir|work-tree)=("(?:[^"\\]|\\.)*"|'[^']*'|\S+)\s*/, // --git-dir=<path> / --work-tree=<path>
  /^--(git-dir|work-tree)\s+("(?:[^"\\]|\\.)*"|'[^']*'|\S+)\s*/, // --git-dir <path> / --work-tree <path>
  /^--(namespace|super-prefix|attr-source)\s+("(?:[^"\\]|\\.)*"|'[^']*'|\S+)\s*/, // options with a separate value
  /^--?[A-Za-z][\w-]*(?:=\S*)?\s*/, // any other global option: --bare, -P, --no-optional-locks, ...
];

function stripGitGlobalOpts(rest: string): string {
  let r = rest;
  outer: while (r.length > 0) {
    for (const pat of GIT_GLOBAL_OPT_PATTERNS) {
      const m = r.match(pat);
      if (m) {
        r = r.slice(m[0].length);
        continue outer;
      }
    }
    break;
  }
  return r;
}

// A bareword `git checkout <target>` argument that looks like a pathspec
// (rather than a branch/ref name) is just as destructive as the explicit
// `git checkout -- <target>` form: it silently discards uncommitted changes
// to that path. Git itself disambiguates branch-vs-path by checking refs, a
// distinction we can't replicate — so this is a heuristic, not a parser.
// Accepted false-positive: branch names containing a dot near the end (e.g.
// `release-1.0`) will be misread as a path and blocked; this trades a rare
// annoyance for closing the common `git checkout .` / `git checkout <file>`
// bypass.
function looksLikePathspec(token: string): boolean {
  if (token === "." || token === "..") return true;
  if (token.startsWith("./") || token.startsWith("../") || token.startsWith("/")) return true;
  if (token.includes("*") || token.includes("?")) return true;
  const lastSegment = token.includes("/") ? (token.split("/").pop() ?? token) : token;
  return /\.[a-zA-Z0-9]{1,10}$/.test(lastSegment);
}

function analyzeGitAfterVerb(afterVerb: string, cmd: string): void {
  const afterGlobal = stripGitGlobalOpts(afterVerb.trimStart());
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
      // BLOCK: bareword pathspec-looking targets (`git checkout .`,
      // `git checkout src/file.ts`) — same hazard as the `--` form, just
      // without the explicit separator.
      const positional = subargs.split(/\s+/).filter((t) => t && !t.startsWith("-"));
      if (positional.some((t) => looksLikePathspec(t))) {
        block("git checkout <path> discards uncommitted changes without --", cmd);
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
    // `git reset --hard`, `git clean -f`, and `git worktree remove --force` are
    // allowed so agents can finish cleanup without a manual handoff.
    case "reset": {
      if (/(^|\s)--merge(\s|$)/.test(` ${subargs} `))
        block("git reset --merge can discard uncommitted changes", cmd);
      return;
    }
    case "send-pack":
    case "push": {
      if (subargs.includes("--force-with-lease")) {
        const targets = subargs.split(/\s+/).filter((t) => t && !t.startsWith("-"));
        // Without a refspec (`git push --force-with-lease [remote]`) the
        // destination is the current branch, so resolve it.
        const refspecs = targets.length > 1 ? targets.slice(1) : [currentBranch() ?? ""];
        if (refspecs.some((t) => /(^|:)(refs\/heads\/)?(main|master)$/.test(t)))
          block(`git ${sub} --force-with-lease to main or master rewrites shared history`, cmd);
        return;
      }
      const padded = ` ${subargs} `;
      if (/(^|\s)--force(\s|$)/.test(padded))
        block(`git ${sub} --force can overwrite remote history`, cmd);
      // Bundled short flags: `-uf`, `-fu`, etc. all include a force flag
      // even though the literal string "-f" never appears standalone.
      if (/(^|\s)-[a-zA-Z]*f[a-zA-Z]*(\s|$)/.test(padded))
        block(`git ${sub} --force can overwrite remote history`, cmd);
      return;
    }
    // `git branch -D` and `git stash drop` are reflog-recoverable, so the
    // permission layer asks instead of this hook blocking (config/30-permissions.json
    // `ask`). `git stash clear` stays a hard block: it discards every entry.
    case "stash": {
      const stashAction = (subargs.split(/\s+/)[0] ?? "").trim();
      if (stashAction === "clear")
        block("git stash clear permanently deletes all stashed changes", cmd);
      return;
    }
    default:
      return;
  }
}

const branchCache = new Map<string, string | null>();

// The branch checked out in `dir`: its name, "" when HEAD is detached, null
// when it cannot be read (git missing or failing, not a repository). HEAD is
// read from disk so that a push spends its one git process on the `git config`
// read below; git is asked only when the file cannot answer.
function currentBranch(dir?: string): string | null {
  const key = dir ?? safeCwd() ?? "";
  let branch = branchCache.get(key);
  if (branch === undefined) {
    branch = headFileBranch(key) ?? gitCurrentBranch(dir);
    branchCache.set(key, branch);
  }
  return branch;
}

function gitCurrentBranch(dir?: string): string | null {
  try {
    const r = Bun.spawnSync(["git", "branch", "--show-current"], {
      stderr: "ignore",
      cwd: dir,
      timeout: 1000,
    });
    return r.exitCode === 0 ? r.stdout.toString().trim() : null;
  } catch {
    return null; // git not installed or cwd gone
  }
}

// A small regular file's text; null for anything else (a FIFO or device would
// block the read, a symlink can point anywhere, a huge file is not git's).
function smallFile(path: string): string | null {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size >= 4096) return null;
  return readFileSync(path, "utf8");
}

// A bare git directory is a repository boundary, never a child of the worktree
// that happens to contain it.
function repoLocation(dir: string): { top: string; gitDir: string } | null {
  if (!dir || process.env.GIT_DIR || process.env.GIT_WORK_TREE) return null;
  try {
    for (let d = resolve(dir); ; d = dirname(d)) {
      const dotGit = join(d, ".git");
      const stat = lstatSync(dotGit, { throwIfNoEntry: false });
      if (stat) {
        // A worktree or submodule has a `.git` file pointing at its git dir.
        const linked = stat.isDirectory()
          ? dotGit
          : smallFile(dotGit)?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
        if (!linked) return null;
        return { top: d, gitDir: resolve(d, linked) };
      }
      if (
        existsSync(join(d, "HEAD")) &&
        lstatSync(join(d, "objects"), { throwIfNoEntry: false })?.isDirectory() &&
        lstatSync(join(d, "refs"), { throwIfNoEntry: false })?.isDirectory()
      )
        return null;
      if (dirname(d) === d) return null;
    }
  } catch {
    return null;
  }
}

function headFileBranch(dir: string): string | null {
  const repo = repoLocation(dir);
  if (!repo) return null;
  try {
    const head = smallFile(join(repo.gitDir, "HEAD"))?.trim();
    if (head === undefined) return null;
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1];
    if (ref) return ref === ".invalid" ? null : ref;
    return /^[0-9a-f]{40,64}$/.test(head) ? "" : null;
  } catch {
    return null;
  }
}

// `gh api` DELETE is allowed for cleanup (refs, releases, comments), but a
// DELETE on the repository root endpoint deletes the repo, which `gh repo
// delete` guards in the permission layer.
function checkGhApiRepoDelete(cmd: string): void {
  const m = cmd.match(/(^|[\s;&|])(?:[^\s;&|]*\/)?gh\s+api\s+(.*)$/is);
  if (!m?.[2]) return;
  const rest = m[2];
  if (!/(-X[\s=]*|--method[\s=]+)['"]?DELETE\b/i.test(rest)) return;
  const tokens = rest.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ""));
  if (tokens.some((t) => /^repos\/[^/\s]+\/[^/\s]+$/i.test(ghApiPath(t) ?? "")))
    block("gh api DELETE on a repository endpoint deletes the repository", cmd);
}

const MAX_GIT_WORDS = 256;

function checkGitDestructive(cmd: string): void {
  // Evaluate EVERY 'git' occurrence in the string, not just the first —
  // `cmd.match(/git\s+(.*)/)` (no /g, and `.` doesn't cross newlines without
  // /s) only ever inspected the first invocation, letting a second
  // `git checkout -- .` later in the same string ride along unchecked.
  const re = /(^|[\s;&|])(?:[^\s;&|]*\/)?git\s+/gi;
  let m: RegExpExecArray | null;
  let seen = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop idiom
  while ((m = re.exec(cmd))) {
    // Each occurrence reads the rest of the command, so the work grows with
    // the square of their number. Past the cap the rest goes unread: block.
    if (++seen > MAX_GIT_WORDS) block("git appears too many times in one command to analyze", cmd);
    const afterVerb = cmd.slice(m.index + m[0].length);
    analyzeGitAfterVerb(afterVerb, cmd);
  }
}

// --- Rule: find / xargs ---------------------------------------------------

function checkFindXargs(cmd: string): void {
  if (/find\s+.*-delete/i.test(cmd)) block("find -delete permanently removes files", cmd);
  if (/find\s+.*-exec(dir)?\s+rm/i.test(cmd)) block("find -exec rm permanently removes files", cmd);
  if (/xargs\s+(.*\s)?rm\s+.*-[a-zA-Z]*r/i.test(cmd))
    block("xargs rm -r is a bulk destructive operation", cmd);
  if (/xargs\s+(.*\s)?(bash|sh)\s+-c/i.test(cmd))
    block("xargs with shell -c enables arbitrary command execution", cmd);
}

// --- Rule: process kills by search ----------------------------------------
//
// Killing by search instead of by PID takes out bystanders. `lsof -ti :3000`
// lists every process with a socket on the port, including a browser that has
// the page open, so `lsof -ti :3000 | xargs kill` crashes the browser (it did,
// 2026-10-04). `pkill -f` / `killall` match by name or argv, which browsers
// also carry (tab URLs, --app flags), and `fuser -k` hits every socket user.
//
// Allowed: `kill <pid>`, `kill $VAR`, `kill $(cat pidfile)`, and lsof limited
// to the listening socket (`-sTCP:LISTEN`), which only ever names the server.
// Accepted residual: a search and a kill in different segments
// (`for p in $(lsof -ti :3000); do kill $p; done`) is not linked up.

const KILL_PREFIX_RE =
  /^(?:(?:sudo|exec|nohup|command)\s+(?:-\S+\s+)*|env\s+(?:-\S+\s+|\S+=\S*\s+)*|timeout\s+(?:-\S+\s+)*\S+\s+)*/i;
const LISTEN_ONLY_RE = /-s\s*TCP:LISTEN\b/i;

function stageCommand(stage: string): { word: string; args: string } {
  const rest = stage.trim().replace(KILL_PREFIX_RE, "");
  const m = rest.match(/^(?:[^\s;&|]*\/)?([^\s/]+)\s*(.*)$/s);
  return { word: (m?.[1] ?? "").toLowerCase(), args: m?.[2] ?? "" };
}

function isProcessSearch(text: string): boolean {
  if (/(^|[\s|(`])(pgrep|pidof|ps|fuser)(\s|$)/i.test(text)) return true;
  return /(^|[\s|(`])lsof(\s|$)/i.test(text) && !LISTEN_ONLY_RE.test(text);
}

function checkProcessKill(segment: string, subs: string[]): void {
  // Segments are already split on ;/&&/||/&/newlines, so an unquoted `|` is a pipe.
  const stages = splitPipes(segment);
  for (let i = 0; i < stages.length; i++) {
    const { word, args } = stageCommand(stages[i] ?? "");
    if (word === "pkill" || word === "killall") {
      block(`${word} matches by name and can hit the browser; kill the PID you started`, segment);
    }
    if (word === "fuser" && /(^|\s)-[a-zA-Z]*k/.test(` ${args}`)) {
      block("fuser -k kills every process on the port, including connected browsers", segment);
    }
    if (word === "xargs" && /(^|\s)kill(\s|$)/i.test(args)) {
      if (isProcessSearch(stages.slice(0, i).join("|"))) {
        block(
          "kill fed by a process search can hit the browser; use lsof -sTCP:LISTEN or the PID you started",
          segment,
        );
      }
    }
    if (word === "kill") {
      for (const sub of subs) {
        if (isProcessSearch(sub)) {
          block(
            "kill fed by a process search can hit the browser; use lsof -sTCP:LISTEN or the PID you started",
            segment,
          );
        }
      }
      const targets = args.split(/\s+/).filter(Boolean);
      if (targets.length >= 2 && targets.at(-1) === "-1") {
        block("kill -1 signals every process you own", segment);
      }
    }
  }
}

// --- Shell state across a command line -------------------------------------
//
// Rules see one simple command at a time, plus what earlier commands in the
// same shell set: exported variables (`export GH_REPO=x`) and the directory
// after `cd`/`pushd`. A subshell (`( ... )`, `$( ... )`, `<( ... )`) gets a copy
// of its parent's state and leaves the parent's untouched.

interface ShellCtx {
  /** Exported variables. */
  env: Record<string, string>;
  /** Plain shell variables (`GH_REPO=x;`): children never see them, but a later
   *  `export GH_REPO` promotes them. */
  vars: Record<string, string>;
  /** Names `export NAME` marked with no value yet; a later `NAME=x` reaches children. */
  exported: Set<string>;
  /** Directory the command runs in; null once a `cd` target cannot be read. */
  dir: string | null;
  /** Directories the command may run in instead: where the shell is when a
   *  `cd` behind `&&` or `||` did not run. */
  elseDirs: Array<string | null>;
  /** Directories in front of each `cd` after `&&`. That `cd` ran if the rest
   *  of its `&&` chain does, so they join `elseDirs` when the chain ends. */
  chainDirs: Array<string | null>;
  /** The line has a quote or substitution that never closed. */
  unterminated: boolean;
  /** Shared by every scope of one line: repositories change on disk. */
  repo: RepoState;
  /** Shared by every scope of one line. */
  opaque: OpaqueVars;
  /** Operator in front of the command being read; null at the start of a scope. */
  after: ShellSegment["joiner"];
  /** Names assigned after `&&`: their value holds until that `&&` chain ends. */
  chained: Set<string>;
  /** What a variable assigned from a substitution, or read from a here-string,
   *  may hold. An added reading only: the variable itself stays unread. */
  guesses: Map<string, string>;
  /** Text of each `alias NAME=TEXT` on the line: a command word of that name
   *  may run it. */
  aliases: Map<string, string>;
}

// Variables whose value the hook does not trust anywhere on the line, because
// something other than a plain assignment or `export` sets them. Marking is
// line-wide: the order loops, branches and functions run in is not followed.
interface OpaqueVars {
  all: boolean;
  names: Set<string>;
  /** Characters IFS is set to somewhere on the line: words may split on them. */
  ifs: string;
  /** IFS is set to something the hook cannot read (`read IFS`, `printf -v IFS`). */
  ifsUnread: boolean;
}

// The command word in lower case, because macOS and Windows filesystems resolve
// `GIT` and `Rm` to git and rm. `typed` keeps the spelling: the shell matches
// its builtins (`cd`, `export`) and variable names exactly.
interface Command extends ParsedShellCommand {
  typed: string;
}

function parseCommand(stage: string): Command {
  const c = parseShellCommand(stage);
  return { ...c, word: c.word.toLowerCase(), typed: c.word };
}

function shellQuote(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

// `words` read as a command that keeps the assignments, redirections and
// wrapper state of `c`.
function reparse(words: string[], c: Command): Command {
  const again = parseCommand(words.map(shellQuote).join(" "));
  return {
    ...c,
    word: again.word,
    typed: again.typed,
    args: again.args,
    env: { ...c.env, ...again.env },
    viaXargs: c.viaXargs || again.viaXargs,
    xargsReshapes: c.xargsReshapes || again.xargsReshapes,
    chdirs: [...c.chdirs, ...again.chdirs],
  };
}

interface RepoState {
  /** Branch an earlier `git checkout`/`git switch` left in a directory: a name,
   *  "" for a detached HEAD, null when it cannot be read. */
  heads: Map<string, string | null>;
  configChanged: Set<string>;
  /** An earlier `git worktree`, `git clone`, or a checkout in a directory the
   *  hook cannot read: no branch can be trusted after it. */
  changed: boolean;
}

// The hook's working directory: the payload's `cwd`, else the process's.
let baseDir: string | null = null;

function safeCwd(): string | null {
  try {
    return process.cwd();
  } catch {
    return null; // the directory was removed
  }
}

function rootCtx(): ShellCtx {
  return {
    env: {},
    vars: {},
    exported: new Set(),
    dir: baseDir ?? safeCwd(),
    elseDirs: [],
    chainDirs: [],
    unterminated: false,
    repo: { heads: new Map(), configChanged: new Set(), changed: false },
    opaque: { all: false, names: new Set(), ifs: "", ifsUnread: false },
    after: null,
    chained: new Set(),
    guesses: new Map(),
    aliases: new Map(),
  };
}

function cloneCtx(ctx: ShellCtx): ShellCtx {
  return {
    ...ctx,
    env: { ...ctx.env },
    vars: { ...ctx.vars },
    exported: new Set(ctx.exported),
    elseDirs: [...ctx.elseDirs],
    chainDirs: [],
    after: null,
    chained: new Set(),
    guesses: new Map(ctx.guesses),
    aliases: new Map(ctx.aliases),
  };
}

const BLOCK_OPEN_RE =
  /^(?:(?:then|do|else|elif|[{!])\s+)*(?:if|while|until|for|select|case)(?:\s|$)/;
const BLOCK_CLOSE_RE = /^(?:fi|done|esac)(?:\s|$)/;
const FUNCTION_DEF_RE = /(?<![\w-])[A-Za-z_][\w-]*\s*\(\s*\)\s*[{(]|(?:^|[\s;&|({])function\s/;
const GROUP_AFTER_JOIN_RE = /(?:&&|\|\|)\s*\{/;
const ARRAY_ASSIGN_RE = /(?:^|[\s;&|({])([A-Za-z_]\w*)\+?=\(/g;
const DEFAULT_ASSIGN_RE = /\$\{([A-Za-z_]\w*):{0,2}=/g;
const VAR_SETTERS = new Set([
  "read",
  "declare",
  "local",
  "typeset",
  "readonly",
  "unset",
  "mapfile",
  "readarray",
  "getopts",
  "let",
]);

function markOpaqueVars(cmd: string, scan: ShellScan, opaque: OpaqueVars): void {
  // IFS decides how every unquoted variable splits into words, so setting it
  // leaves no variable trusted. `value` is what it is set to, when that is on
  // the line as text.
  const setsIfs = (value: string | undefined): void => {
    opaque.all = true;
    if (value === undefined || /[$`]/.test(value)) opaque.ifsUnread = true;
    else opaque.ifs += value;
  };
  // `text` starts with the name a setter is given: `B`, `B=main`, `B+=x`.
  const mark = (text: string | undefined): void => {
    const name = text?.match(/^[A-Za-z_]\w*/)?.[0];
    if (!name) return;
    opaque.names.add(name);
    if (name === "IFS") setsIfs(text?.match(/^IFS\+?=(.*)$/s)?.[1]);
  };
  // A function body, or a `{ }` group after `&&` or `||`, may never run.
  if (FUNCTION_DEF_RE.test(cmd) || GROUP_AFTER_JOIN_RE.test(cmd)) opaque.all = true;
  for (const m of cmd.matchAll(ARRAY_ASSIGN_RE)) mark(m[1]);
  for (const m of cmd.matchAll(DEFAULT_ASSIGN_RE)) mark(m[1]);
  // Open `if`, loop and `case` blocks: an assignment inside one may not run.
  let depth = 0;
  for (const seg of scan.segments) {
    for (const stage of splitPipes(seg.clean)) {
      const c = parseCommand(stage);
      if (BLOCK_OPEN_RE.test(stage)) depth++;
      else if (BLOCK_CLOSE_RE.test(stage)) depth--;
      if (depth < 0 || c.word === "eval" || c.word === "source" || c.word === ".") {
        opaque.all = true;
      }
      // A sourced file can set IFS.
      if (c.word === "source" || c.word === ".") opaque.ifsUnread = true;
      // An assignment inside a block may not run, and a prefix assignment
      // outlives its command on a special builtin in `sh`.
      if (depth > 0 || c.word !== "") for (const name of Object.keys(c.env)) opaque.names.add(name);
      if (c.env.IFS !== undefined) setsIfs(c.env.IFS);
      if (c.word === "export") {
        for (const arg of c.args) if (/^IFS\+?=/.test(arg)) mark(arg);
      }
      // A nameref makes an assignment to one name change another.
      if (
        /^(?:declare|local|typeset)$/.test(c.word) &&
        c.args.some((t) => /^-[a-zA-Z]*n/.test(t))
      ) {
        opaque.all = true;
        opaque.ifsUnread = true; // the nameref may point at IFS
      }
      // `B+=x` and `B[0]=x` reach the parser as a command word.
      if (/^[A-Za-z_]\w*(?:\+=|\[)/.test(c.typed)) mark(c.typed);
      if (c.word === "for" || c.word === "select") mark(c.args[0]);
      if (c.word === "read") mark("REPLY");
      if (VAR_SETTERS.has(c.word) || (depth > 0 && c.word === "export")) c.args.forEach(mark);
      if (c.word === "printf" || c.word === "print") {
        const at = c.args.indexOf("-v");
        mark(at >= 0 ? c.args[at + 1] : c.args.find((t) => /^-v./.test(t))?.slice(2));
      }
    }
  }
  if (depth !== 0) opaque.all = true;
}

function knownVar(name: string, ctx: ShellCtx): string | undefined {
  if (ctx.opaque.all || ctx.opaque.names.has(name)) return undefined;
  return ctx.vars[name] ?? ctx.env[name];
}

const VAR_REF_RE = /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g;

function expandVars(word: string, ctx: ShellCtx): string {
  return word.replace(
    VAR_REF_RE,
    (m, braced, bare) => knownVar((braced ?? bare) as string, ctx) ?? m,
  );
}

// Unquoted text splits on whitespace and on every character IFS is set to on
// the line.
function splitWords(text: string, ctx: ShellCtx): string[] {
  const extra = ctx.opaque.ifs.replace(/[\\\]^-]/g, "\\$&");
  return text.split(new RegExp(`[\\s${extra}]+`)).filter(Boolean);
}

// A command word with its variables filled in; null when one of them is not
// known, or when another expansion is left (`${=G}`, `${!N}`, `$@`, a
// substitution). A value goes in as it is: bash does not expand it again.
function expandCommandWord(word: string, ctx: ShellCtx): string | null {
  let known = true;
  const text = word.replace(VAR_REF_RE, (m, braced, bare) => {
    const value = knownVar((braced ?? bare) as string, ctx);
    if (value === undefined || value.includes(SUBSTITUTION)) known = false;
    return value ?? m;
  });
  return known && !/[$`]/.test(word.replace(VAR_REF_RE, "")) ? text : null;
}

// Readings past the two that are always kept cost a full pass of the rules
// each, so only the first few are added.
const MAX_ADDED_READINGS = 16;

// Commands a glob in a command word may name (`/usr/bin/g?t`, `/bin/r[m]`).
const GLOB_COMMANDS = ["git", "rm"];
const GLOB_BRACKET_RE = /^\[[!^]?\]?(?:\[:[a-z]+:\]|\[=[^\]]+=\]|\[\.[^\]]+\.\]|[^\]])*\]/;
const MAX_GLOB_WORD = 256;

function globCommands(word: string): string[] {
  if (!/[?*[]/.test(word)) return [];
  // A longer word is not matched: it may name any of them.
  if (word.length > MAX_GLOB_WORD) return GLOB_COMMANDS;
  const glob = word.toLowerCase().replace(/\*+/g, "*");
  return GLOB_COMMANDS.filter((name) => globMatches(glob, name));
}

// Whether a shell glob matches all of `name`. A `[` without its `]` is a
// literal character, so the test command `[` matches nothing here.
function globMatches(glob: string, name: string): boolean {
  if (glob === "") return name === "";
  if (glob[0] === "*") {
    return globMatches(glob.slice(1), name) || (name !== "" && globMatches(glob, name.slice(1)));
  }
  const ch = name[0];
  if (ch === undefined) return false;
  if (glob[0] === "?") return globMatches(glob.slice(1), name.slice(1));
  const bracket = glob.match(GLOB_BRACKET_RE)?.[0];
  if (bracket === undefined) return glob[0] === ch && globMatches(glob.slice(1), name.slice(1));
  return inBracket(bracket, ch) && globMatches(glob.slice(bracket.length), name.slice(1));
}

function inBracket(bracket: string, ch: string): boolean {
  // A character class (`[[:alpha:]]`), an equivalence class (`[[=g=]]`) and a
  // collating symbol (`[[.g.]]`) are not decoded: each may hold any character.
  if (/\[[:=.]/.test(bracket)) return true;
  const negated = /^\[[!^]/.test(bracket);
  const set = bracket.slice(negated ? 2 : 1, -1);
  let found = false;
  for (let i = 0; i < set.length; i++) {
    const from = set[i] as string;
    const to = set[i + 1] === "-" ? set[i + 2] : undefined;
    if (to === undefined) found ||= from === ch;
    else {
      found ||= from <= ch && ch <= to;
      i += 2;
    }
  }
  return found !== negated;
}

// The commands a stage may run when its command word is literal text: the word
// as typed, the words a `{a,b}` list in it expands to (`{git,push} origin main`)
// and, for each of those, every guarded command a glob in it matches.
function literalForms(c: Command): Command[] {
  const forms = [c];
  const braced = braceExpand(c.typed);
  if (braced === null) pendingAsks.push(UNREAD_COMMAND_ASK);
  else if (braced.length > 1) forms.push(reparse([...braced, ...c.args], c));
  for (const form of [...forms]) {
    // A glob with no arguments is a `case` pattern or an array element far
    // more often than a command, and git or rm alone does nothing.
    if (form.args.length === 0) continue;
    for (const name of globCommands(form.typed)) forms.push(reparse([name, ...form.args], c));
  }
  return forms;
}

// The commands a stage may run when its command word is not literal text. The
// first two are always among them: the word may be git (`$GIT push`), and it
// may be empty, which leaves the next word as the command (`$UNSET git push`).
// Every other reading is added to those two and never used in their place:
// the word with its variables filled in and split as bash does
// (`G="git push"; $G origin main`), the word with each variable filled in
// with whatever the line last held for it (`read H <<< in; $G$H`), the word
// with a substitution's printed text pasted in
// (`$(echo git push origin main)`), and, when the word still cannot be read,
// every value the line holds (`${=G}`, `${!N}`).
// A variable reference with or without a modifier (`${H:-}`, `${=G}`): the
// modifier may leave the held value as it is. `${!N}` names another variable.
const HELD_REF_RE = /\$\{[=~^]*([A-Za-z_]\w*)[^{}]*\}|\$([A-Za-z_]\w*)/g;

function commandForms(c: Command, ctx: ShellCtx, seg: ShellSegment): Command[] {
  if (!/[$`]/.test(c.typed)) return literalForms(c);
  const forms = [c, reparse(c.args, c)];
  // A reading left out, or split by an IFS the hook cannot read, may be the
  // one that matters, so the command asks.
  let unfollowed = ctx.opaque.ifsUnread;
  const add = (text: string): void => {
    if (forms.length >= 2 + MAX_ADDED_READINGS) unfollowed = true;
    else forms.push(reparse([...splitWords(text, ctx), ...c.args], c));
  };
  const texts = new Set([c.typed]);
  // Every variable filled in with what the line last held for it, trusted or
  // not, so that a command split across them is read joined (`$G$H`).
  const joined = c.typed.replace(HELD_REF_RE, (m, braced, bare) => {
    const name = (braced ?? bare) as string;
    return ctx.guesses.get(name) ?? ctx.vars[name] ?? ctx.env[name] ?? m;
  });
  if (!/[$`]/.test(joined)) texts.add(joined);
  if (c.typed.includes(SUBSTITUTION)) {
    if (seg.subs.length > MAX_ADDED_READINGS) unfollowed = true;
    for (const inner of seg.subs.slice(0, MAX_ADDED_READINGS)) {
      const output = processSubstitutionOutput(inner);
      if (output !== null) texts.add(c.typed.replaceAll(SUBSTITUTION, () => output));
    }
  }
  let unread = false;
  const readings = new Set<string>();
  for (const text of texts) {
    const expanded = expandCommandWord(text, ctx);
    if (expanded === null) unread = true;
    else readings.add(expanded);
  }
  for (const text of readings) add(text);
  if (unread) {
    const held = [...Object.values(ctx.vars), ...Object.values(ctx.env), ...ctx.guesses.values()];
    for (const value of new Set(held)) add(value);
  }
  if (unfollowed) pendingAsks.push(UNREAD_COMMAND_ASK);
  return forms;
}

function trackState(c: Command, ctx: ShellCtx, seg: ShellSegment): void {
  const assigned = (name: string, value: string): void => {
    // A name assigned after `||` may keep its earlier value.
    if (ctx.after === "&&") ctx.chained.add(name);
    else if (ctx.after === "||") ctx.opaque.names.add(name);
    // `G=$(echo git push)`: the printed text is what the value may be. The
    // value itself keeps its placeholder, which leaves the variable unread.
    const sole = seg.subs.length === 1 && seg.clean.split(SUBSTITUTION).length === 2;
    const output =
      sole && value.includes(SUBSTITUTION)
        ? processSubstitutionOutput(seg.subs[0] as string)
        : null;
    if (output === null) ctx.guesses.delete(name);
    else
      ctx.guesses.set(
        name,
        value.replace(SUBSTITUTION, () => output),
      );
  };
  if (c.word === "") {
    // Assigning to an exported name (earlier in the line or in the session's
    // environment) updates what children see; bash keeps the export flag.
    for (const [name, value] of Object.entries(c.env)) {
      assigned(name, value);
      if (name in ctx.env || ctx.exported.has(name) || process.env[name] !== undefined) {
        ctx.env[name] = value;
      } else ctx.vars[name] = value;
    }
  } else if (c.typed === "export") {
    for (const t of c.args) {
      const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/s);
      if (!m) continue;
      const name = m[1] as string;
      if (m[2] !== undefined) assigned(name, m[2]);
      const value = m[2] ?? ctx.vars[name];
      if (value !== undefined) ctx.env[name] = value;
      else ctx.exported.add(name);
    }
  } else if (c.typed === "read" && c.hereStrings[0] !== undefined) {
    // `read -r G <<< 'git push'`: the here-string is what the names may hold.
    const names = c.args.filter((t) => /^[A-Za-z_]\w*$/.test(t));
    for (const name of names.length > 0 ? names : ["REPLY"]) {
      ctx.guesses.set(name, c.hereStrings[0]);
    }
  } else if (c.typed === "cd" || c.typed === "pushd" || c.typed === "popd") {
    const target = c.args.find((t) => !t.startsWith("-"));
    // Where the command leaves a shell that was in `dir`.
    const move = (dir: string | null): string | null => {
      if (c.typed === "popd") return null;
      if (target === undefined) return homedir();
      if (target === "~" || target.startsWith("~/")) return join(homedir(), target.slice(1));
      // Bash expands `~` only at the start of a word; Windows short names (`RUNNER~1`) carry one mid-path.
      if (/[$`*?[]/.test(target) || target.startsWith("~") || target === "-" || !dir) return null;
      return resolve(dir, target);
    };
    const before = [ctx.dir, ...ctx.elseDirs];
    ctx.dir = move(ctx.dir);
    ctx.elseDirs = otherDirs(ctx.elseDirs.map(move));
    // Behind `||` the command may not have run; behind `&&` it ran if the
    // rest of its chain does.
    if (ctx.after === "||") ctx.elseDirs = otherDirs([...ctx.elseDirs, ...before]);
    else if (ctx.after === "&&") ctx.chainDirs.push(...before);
  } else if (c.typed === "alias") {
    for (const t of c.args) {
      const m = t.match(/^([^=\s]+)=(.*)$/s);
      if (m) ctx.aliases.set(m[1] as string, m[2] as string);
    }
  }
}

// Past this many the alternatives are not followed: the directory is unknown.
const MAX_ELSE_DIRS = 8;

function otherDirs(dirs: Array<string | null>): Array<string | null> {
  const unique = [...new Set(dirs)];
  return unique.length > MAX_ELSE_DIRS ? [null] : unique;
}

// One context for each directory the command may run in.
function dirReadings(ctx: ShellCtx): ShellCtx[] {
  const others = ctx.elseDirs.filter((dir) => dir !== ctx.dir);
  if (others.length === 0) return [ctx];
  return [ctx.dir, ...others].map((dir) => ({ ...ctx, dir, elseDirs: [] }));
}

// Ends the command in front of `joiner`. A value assigned after `&&` holds only
// for the rest of its `&&` chain: past it, the assignment may not have run. The
// same goes for a `cd`.
function endCommand(ctx: ShellCtx, joiner: ShellSegment["joiner"]): void {
  if (joiner !== "&&") {
    for (const name of ctx.chained) ctx.opaque.names.add(name);
    ctx.chained.clear();
    ctx.elseDirs = otherDirs([...ctx.elseDirs, ...ctx.chainDirs]);
    ctx.chainDirs = [];
  }
  ctx.after = joiner;
}

// --- Rule: git hook skips ---------------------------------------------------
//
// `--no-verify` (and any unambiguous prefix git accepts), `commit -n`, hook
// runner switches in the environment, and a `core.hooksPath` override all let a
// commit, push, or merge skip the repo's hooks. The rule reads the parsed
// command, not the text, so a commit message that merely mentions a flag
// passes.

function isHookSkipEnv(name: string, rawValue: string): boolean {
  const value = rawValue.toLowerCase();
  if (name === "HUSKY" || name === "LEFTHOOK") return value === "0" || value === "false";
  if (/^(SKIP|SKIP_HOOKS?|HUSKY_SKIP_HOOKS|SKIP_SIMPLE_GIT_HOOKS|LEFTHOOK_EXCLUDE)$/.test(name)) {
    return value !== "" && value !== "0" && value !== "false";
  }
  if (/^GIT_CONFIG_KEY_\d+$/.test(name)) return value === "core.hookspath";
  if (name === "GIT_CONFIG_PARAMETERS") return value.includes("core.hookspath");
  return false;
}

// `commit -m <msg>` and friends take a value; skip it so a message that happens
// to read `--no-verify` is not mistaken for the flag.
const COMMIT_VALUE_FLAGS = new Set([
  "-m",
  "-F",
  "-C",
  "-c",
  "-t",
  "--message",
  "--file",
  "--author",
  "--date",
  "--template",
  "--reuse-message",
  "--reedit-message",
]);
const GIT_VALUE_OPTS = new Set([
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--attr-source",
]);
const NO_VERIFY_RE = /^--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?$/;

// `-n` bundled into short flags, stopping at the first flag that takes a value
// (`-m<msg>`, `-C<commit>`): everything after it is that value, not more flags.
function hasShortNoVerify(token: string): boolean {
  if (!/^-[a-zA-Z]+/.test(token)) return false;
  for (const ch of token.slice(1)) {
    if (ch === "n") return true;
    if ("mFCctuS".includes(ch)) return false;
  }
  return false;
}

function checkGitHookSkips(c: Command, ctx: ShellCtx, seg: ShellSegment, cmd: string): void {
  // A command word the hook cannot read (`$G commit`) may be git.
  if (c.word !== "git" && !c.typed.includes("$")) return;
  const readings = c.word === "git" ? subcommandReadings(c.args, ctx, seg) : [];
  for (const args of [c.args, ...readings]) checkHookSkipArgs(args, c, ctx, cmd);
}

function checkHookSkipArgs(a: string[], c: Command, ctx: ShellCtx, cmd: string): void {
  const configKeys: string[] = [];
  let i = 0;
  while (i < a.length && (a[i] as string).startsWith("-")) {
    const t = a[i] as string;
    if (t === "-c" || t === "--config-env") {
      configKeys.push(a[i + 1] ?? "");
      i += 2;
    } else if (t.startsWith("--config-env=")) {
      configKeys.push(t.slice("--config-env=".length));
      i++;
    } else {
      i += GIT_VALUE_OPTS.has(t) ? 2 : 1;
    }
  }
  const sub = a[i] ?? "";
  const rest = a.slice(i + 1);
  const hooksPathKey = configKeys.some((k) => k.split("=")[0]?.toLowerCase() === "core.hookspath");

  if (sub === "config") {
    const pos = rest.filter((t) => !t.startsWith("-"));
    const reads = rest.some((t) =>
      /^--(?:get|get-all|get-regexp|unset|unset-all|list)$|^-l$/.test(t),
    );
    if (!reads && pos[0]?.toLowerCase() === "core.hookspath" && pos.length >= 2) {
      block("git config sets core.hooksPath, which disables the repo's git hooks", cmd);
    }
    return;
  }
  if (sub !== "commit" && sub !== "push" && sub !== "merge") return;

  const reason = `git ${sub} skips git hooks`;
  if (hooksPathKey) block(`${reason} (-c core.hooksPath)`, cmd);
  for (const [name, value] of Object.entries({ ...ctx.env, ...c.env })) {
    if (isHookSkipEnv(name, value)) block(`${reason} (${name} is set)`, cmd);
  }
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j] as string;
    if (t === "--") break;
    if (NO_VERIFY_RE.test(t)) block(`${reason} (--no-verify)`, cmd);
    if (sub === "commit") {
      if (COMMIT_VALUE_FLAGS.has(t)) j++;
      else if (hasShortNoVerify(t)) block(`${reason} (-n is --no-verify for commit)`, cmd);
    }
  }
}

// --- Rule: updates of main or master ----------------------------------------
//
// A push to main or master asks the user through the permission prompt. Org repos
// whose rulesets require a PR reject it anyway, but repos without one accept it,
// and an agent reads a history of direct pushes as permission. GitHub org rulesets
// already block deleting and force-pushing main, so deletes are not checked here.
//
// The rule reads `git push`, `git subtree push` and `git send-pack` (and `gh api`
// branch writes, in the gh rule). A forced update of main blocks. A destination,
// remote, branch or repository that cannot be read (a variable not set earlier
// on the line, a command substitution, xargs input, an earlier checkout, an
// unreadable `-C`, `--git-dir`, config set on the command line) asks, and so
// does a push that recurses into submodules, whose branches are not known. A
// push to a remote on the local disk is not checked. A bare push reads the push
// settings in git config, with one `git config` call made only when the answer
// matters. SECURITY.md lists what the rule does not see.

const pendingAsks: string[] = [];
const MAIN_PUSH_ASK =
  "git push to main or master: approve only if the user asked for a direct push in this conversation; otherwise push a branch and open a PR";
const UNKNOWN_PUSH_ASK =
  "git push to a branch or repository the hook cannot read (a variable, command substitution, xargs input, an earlier checkout, or config set on the command line): approve only if it does not update main or master, or the user asked for a direct push";
const UNREAD_COMMAND_ASK =
  "a command word or script the hook cannot read in full (more substitutions or values than it follows, a brace list it does not expand, or words split by an IFS it cannot read): approve only if it does not push to main or master, skip git hooks, write to another owner's repository or read a secret file";
const SUBMODULE_PUSH_ASK =
  "git push --recurse-submodules=on-demand also pushes each submodule's current branch, which may be main or master: approve only if the user asked for that push";

// Options of each ref-updating command that take a separate value.
const REF_UPDATE_VALUE_OPTS = {
  push: new Set([
    "-o",
    "--push-option",
    "--repo",
    "--recurse-submodules",
    "--receive-pack",
    "--exec",
  ]),
  "send-pack": new Set(["--receive-pack", "--exec", "--remote", "--push-option"]),
  "subtree push": new Set([
    "-P",
    "--prefix",
    "-m",
    "--message",
    "--annotate",
    "-b",
    "--branch",
    "--onto",
  ]),
};

interface RefUpdate {
  verb: keyof typeof REF_UPDATE_VALUE_OPTS;
  /** The repository argument as written; undefined when git picks the remote. */
  remote: string | undefined;
  /** Refspecs as written; null when git picks them (`git push`, `git push origin`). */
  refspecs: string[] | null;
  everyBranch: boolean;
  /** `--force`, `-f` or `--force-with-lease`. */
  forced: boolean;
  /** `send-pack --stdin` reads its refs from stdin. */
  fromStdin: boolean;
  submodules: boolean;
}

// Options in front of a git subcommand: the directories `-C` moves into, whether
// `--git-dir`/`--work-tree` point git at another repository, and the config keys
// `-c`/`--config-env` set. `sub` is the index of the subcommand.
interface GitGlobals {
  sub: number;
  dirs: string[];
  otherRepo: boolean;
  configKeys: string[];
}

function readGitGlobals(args: string[]): GitGlobals {
  const g: GitGlobals = { sub: 0, dirs: [], otherRepo: false, configKeys: [] };
  let i = 0;
  while (i < args.length && (args[i] as string).startsWith("-")) {
    const t = args[i] as string;
    const next = args[i + 1] ?? "";
    if (t === "-C") g.dirs.push(next);
    else if (t === "-c" || t === "--config-env") g.configKeys.push(next.split("=")[0] as string);
    else if (t.startsWith("--config-env=")) {
      g.configKeys.push(t.slice("--config-env=".length).split("=")[0] as string);
    } else if (/^--(?:git-dir|work-tree)(?:=|$)/.test(t)) g.otherRepo = true;
    i += t === "-c" || t === "--config-env" || GIT_VALUE_OPTS.has(t) ? 2 : 1;
  }
  g.sub = i;
  return g;
}

// More readings of a git command's arguments when its subcommand is not literal
// text (`git $P`, `git $(echo push)`); none when it is. A variable the hook
// trusts is filled in. Any other word is read as nothing, which leaves the next
// word as the subcommand (`git $UNSET push`), as `push`, and as each guess the
// line holds: a variable's guess, or a substitution's printed text.
function subcommandReadings(args: string[], ctx: ShellCtx, seg: ShellSegment): string[][] {
  const at = readGitGlobals(args).sub;
  const word = args[at];
  if (word === undefined || !/[$`]/.test(word)) return [];
  const put = (text: string): string[] => [
    ...args.slice(0, at),
    ...splitWords(text, ctx),
    ...args.slice(at + 1),
  ];
  const trusted = expandVars(word, ctx);
  if (!/[$`]/.test(trusted)) return [put(trusted)];
  const guessed = word.replace(VAR_REF_RE, (m, braced, bare) => {
    const name = (braced ?? bare) as string;
    return ctx.guesses.get(name) ?? knownVar(name, ctx) ?? m;
  });
  const texts = new Set(["", "push", guessed]);
  if (word.includes(SUBSTITUTION) && seg.subs.length > MAX_ADDED_READINGS) {
    pendingAsks.push(UNREAD_COMMAND_ASK);
  }
  for (const inner of seg.subs.slice(0, MAX_ADDED_READINGS)) {
    const output = processSubstitutionOutput(inner);
    if (output !== null) texts.add(guessed.replaceAll(SUBSTITUTION, () => output));
  }
  return [...texts].filter((text) => !/[$`]/.test(text)).map(put);
}

// Null when the args are not a ref update, or one that changes nothing
// (`--dry-run`, `--delete`, a subtree push without its ref).
function readRefUpdate(args: string[]): (RefUpdate & { globals: GitGlobals }) | null {
  const globals = readGitGlobals(args);
  let i = globals.sub;
  let verb: RefUpdate["verb"];
  if (args[i] === "push" || args[i] === "send-pack") verb = args[i] as RefUpdate["verb"];
  else if (args[i] === "subtree") {
    // `git subtree -P lib push`: subtree takes its options on either side of the verb.
    let j = i + 1;
    while (j < args.length && (args[j] as string).startsWith("-")) {
      j += REF_UPDATE_VALUE_OPTS["subtree push"].has(args[j] as string) ? 2 : 1;
    }
    if (args[j] !== "push") return null;
    verb = "subtree push";
    i = j;
  } else return null;
  const subtree = verb === "subtree push";
  const positional: string[] = [];
  let everyBranch = false;
  let tagsOnly = false;
  let forced = false;
  let fromStdin = false;
  let submodules = false;
  let optionsEnded = false;
  let repoRemote: string | undefined;
  for (let j = i + 1; j < args.length; j++) {
    const t = args[j] as string;
    if (optionsEnded || !t.startsWith("-")) positional.push(t);
    else if (t === "--") optionsEnded = true;
    // For `git subtree`, `-d` is --debug.
    else if (!subtree && /^(?:-n|--dry-run|-d|--delete)$/.test(t)) return null;
    else if (t === "--all" || t === "--branches" || t === "--mirror") everyBranch = true;
    else if (t === "--tags") tagsOnly = true;
    else if (t === "--stdin") fromStdin = true;
    else if (t === "--force" || t.startsWith("--force-with-lease")) forced = true;
    else if (!subtree && /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t)) forced = true;
    else if (/^--recurse-submodules=(?:on-demand|only)$/.test(t)) submodules = true;
    else if (t === "--recurse-submodules") {
      submodules ||= /^(?:on-demand|only)$/.test(args[j + 1] ?? "");
      j++;
    } else if (verb === "push" && t === "--repo") repoRemote = args[++j];
    else if (verb === "push" && t.startsWith("--repo=")) repoRemote = t.slice("--repo=".length);
    else if (REF_UPDATE_VALUE_OPTS[verb].has(t)) j++;
  }
  const remote = repoRemote ?? positional[0];
  const refs = repoRemote === undefined ? positional.slice(1) : positional;
  let refspecs: string[] | null;
  if (subtree) {
    if (refs.length === 0) return null;
    refspecs = refs.slice(0, 1);
  } else if (verb === "send-pack") {
    // Without refs, send-pack updates every ref both sides have.
    refspecs = refs.length > 0 || everyBranch || fromStdin ? refs : [":"];
  } else {
    refspecs = refs.length > 0 ? refs : tagsOnly ? [] : null;
  }
  return { verb, remote, refspecs, everyBranch, forced, fromStdin, submodules, globals };
}

// `git config` values a push depends on, by canonical key (section and name
// lowercased). Null when git failed, so callers fall back to the current
// branch and grant no local-remote exemption: the hook fails open on its own
// errors, toward asking.
type GitConfig = Map<string, string[]>;
const PUSH_CONFIG_RE =
  "^(push\\.default|remote\\.pushdefault|remote\\..+\\.(url|pushurl|push|mirror)|branch\\..+\\.(merge|remote|pushremote)|url\\..+\\.(insteadof|pushinsteadof))$";
const configCache = new Map<string, GitConfig | null>();

function pushConfig(dir: string): GitConfig | null {
  const cached = configCache.get(dir);
  if (cached !== undefined) return cached;
  let config: GitConfig | null = null;
  try {
    const r = Bun.spawnSync(["git", "config", "-z", "--get-regexp", PUSH_CONFIG_RE], {
      cwd: dir,
      stderr: "ignore",
      timeout: 1000,
    });
    // Exit 1 means no key matched.
    if (r.exitCode === 0 || r.exitCode === 1) {
      config = new Map();
      for (const entry of r.stdout.toString().split("\0")) {
        if (!entry) continue;
        const nl = entry.indexOf("\n");
        const name = nl < 0 ? entry : entry.slice(0, nl);
        config.set(name, [...(config.get(name) ?? []), nl < 0 ? "" : entry.slice(nl + 1)]);
      }
    }
  } catch {
    // git missing or the directory is gone
  }
  configCache.set(dir, config);
  return config;
}

// Config set on the command line or in the environment, which the hook's own
// `git config` read does not see. `url` keys change where a remote points, so
// the local-remote exemption no longer holds; `route` keys change which refs a
// push without refspecs sends. A config file swapped in through the
// environment can do both.
const URL_KEY_RE = /^(?:url\..+\.(?:insteadof|pushinsteadof)|remote\..+\.(?:url|pushurl))$/;
const ROUTE_KEY_RE =
  /^(?:push\.default|remote\.pushdefault|remote\..+\.(?:push|mirror)|branch\..+\.(?:merge|remote|pushremote))$/;

function configOverride(
  keys: string[],
  env: Record<string, string>,
): { url: boolean; route: boolean } {
  let url = false;
  let route = false;
  const all = [...keys];
  for (const [name, value] of Object.entries(env)) {
    if (/^GIT_CONFIG_KEY_\d+$/.test(name)) all.push(value);
    else if (name === "GIT_CONFIG_PARAMETERS") {
      const text = value.toLowerCase();
      url ||= /url\..*\.(?:insteadof|pushinsteadof)|remote\..*\.(?:url|pushurl)/.test(text);
      route ||=
        /push\.default|remote\.pushdefault|remote\..*\.(?:push|mirror)|branch\..*\.(?:merge|remote|pushremote)/.test(
          text,
        );
    } else if (/^GIT_CONFIG(?:_GLOBAL|_SYSTEM)?$/.test(name)) {
      url = true;
      route = true;
    }
  }
  for (const key of all) {
    url ||= URL_KEY_RE.test(key.toLowerCase());
    route ||= ROUTE_KEY_RE.test(key.toLowerCase());
  }
  return { url, route };
}

// The directory git runs in: the shell's, then each `env -C`, then each
// `git -C`. Null when one of them cannot be read, or when GIT_DIR,
// GIT_WORK_TREE, `--git-dir` or `--work-tree` point git at another repository.
function gitRepoDir(
  c: ParsedShellCommand,
  globals: GitGlobals,
  ctx: ShellCtx,
  env: Record<string, string>,
): string | null {
  if (globals.otherRepo || env.GIT_DIR !== undefined || env.GIT_WORK_TREE !== undefined) {
    return null;
  }
  let dir = ctx.dir;
  for (const raw of [...c.chdirs, ...globals.dirs]) {
    if (/[$`]/.test(raw)) return null;
    const path = raw === "~" || raw.startsWith("~/") ? join(homedir(), raw.slice(1)) : raw;
    if (isAbsolute(path)) dir = path;
    else if (dir === null) return null;
    else dir = resolve(dir, path);
  }
  return dir;
}

// The branch checked out in `dir` at this point of the line: what a checkout or
// switch earlier on the line left, else what is on disk. Null when unknown: the
// directory cannot be read or does not exist yet, or a `git worktree` or
// `git clone` ran earlier on the line.
function branchIn(dir: string | null, ctx: ShellCtx): string | null {
  if (dir === null || ctx.repo.changed) return null;
  const top = repoLocation(dir)?.top;
  if (top === undefined) return null;
  return ctx.repo.heads.has(top) ? (ctx.repo.heads.get(top) ?? null) : currentBranch(top);
}

// The branch a `git checkout` / `git switch` leaves: a name, "" for a detached
// HEAD, null when it cannot be read, undefined when the branch does not change
// (a checkout of paths).
function checkedOutBranch(sub: string, args: string[]): string | null | undefined {
  const readable = (name: string | undefined): string | null =>
    name === undefined || /^(?:HEAD|@)$|@\{|[$`^~:]/.test(name) ? null : name;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i] as string;
    if (t === "--") return sub === "checkout" ? undefined : null;
    if (
      /^-[bB]$|^--orphan$/.test(t) ||
      (sub === "switch" && /^-[cC]$|^--(?:force-)?create$/.test(t))
    ) {
      return readable(args[i + 1]);
    }
    if (/^--(?:orphan|create|force-create)=/.test(t)) return readable(t.slice(t.indexOf("=") + 1));
    if (/^-[bB].+/.test(t) || (sub === "switch" && /^-[cC].+/.test(t))) {
      return readable(t.slice(2));
    }
    if (t === "--detach" || (sub === "switch" && t === "-d")) return "";
    if (t === "-t" || t.startsWith("--track")) return null;
    // `-` is the previous branch.
    if (!t.startsWith("-") || t === "-") positional.push(t);
  }
  if (positional.length === 0) return undefined;
  if (positional.length > 1) return sub === "checkout" ? undefined : null;
  const name = positional[0] as string;
  if (sub === "checkout" && looksLikePathspec(name)) return undefined;
  return name === "-" ? null : readable(name);
}

const GIT_BUILTINS = new Set(
  `add am annotate apply archive backfill bisect blame branch bugreport bundle
cat-file check-attr check-ignore check-mailmap check-ref-format checkout checkout--worker
checkout-index cherry cherry-pick clean clone column commit commit-graph commit-tree config
count-objects credential credential-cache credential-cache--daemon credential-store describe
diagnose diff diff-files diff-index diff-pairs diff-tree difftool fast-export fast-import
fetch fetch-pack fmt-merge-msg for-each-ref for-each-repo format-patch format-rev fsck
fsck-objects fsmonitor--daemon gc get-tar-commit-id grep hash-object help history hook
index-pack init init-db interpret-trailers last-modified log ls-files ls-remote ls-tree
mailinfo mailsplit maintenance merge merge-base merge-file merge-index merge-ours
merge-recursive merge-recursive-ours merge-recursive-theirs merge-subtree merge-tree
mktag mktree multi-pack-index mv name-rev notes pack-objects pack-redundant pack-refs
patch-id pickaxe prune prune-packed pull push range-diff read-tree rebase receive-pack
reflog refs remote remote-ext remote-fd repack replace replay repo rerere reset restore
rev-list rev-parse revert rm send-pack shortlog show show-branch show-index show-ref
sparse-checkout stage stash status stripspace submodule submodule--helper subtree switch
symbolic-ref tag unpack-file unpack-objects update-index update-ref update-server-info
upload-archive upload-archive--writer upload-pack url-parse var verify-commit verify-pack
verify-tag version whatchanged worktree write-tree`.split(/\s+/),
);

// Repository changes reach every scope because they happen on disk.
function trackRepo(c: ParsedShellCommand, ctx: ShellCtx): void {
  if (c.word !== "git") return;
  const globals = readGitGlobals(c.args);
  const sub = c.args[globals.sub];
  if (sub === "worktree" || sub === "clone") {
    ctx.repo.changed = true;
    return;
  }
  const args = c.args.slice(globals.sub + 1);
  let configRead = false;
  if (sub === "config") {
    for (let i = 0; i < args.length; i++) {
      const t = args[i] as string;
      if (/^(?:--get(?:-all|-regexp|-urlmatch)?|--list|-l)$/.test(t)) configRead = true;
      else if (/^(?:--file|-f|--blob|--type|--default|--comment)$/.test(t)) i++;
      else if (!t.startsWith("-")) {
        configRead ||= t === "get" || t === "list";
        break;
      }
    }
  }
  const configWrite =
    sub === "config" &&
    !configRead &&
    (args.filter((t) => !t.startsWith("-")).length > 1 ||
      args.some((t) =>
        /^(?:--(?:add|replace-all|unset(?:-all)?|rename-section|remove-section|edit)|-e|set|unset|rename-section|remove-section)$/.test(
          t,
        ),
      ));
  const configChanged =
    configWrite ||
    (sub === "remote" && args.some((t) => /^(?:add|set-url|rename)$/.test(t))) ||
    (sub === "branch" && args.some((t) => /^-u|^--set-upstream-to(?:=|$)/.test(t)));
  let branch: string | null | undefined;
  if (sub === "checkout" || sub === "switch") branch = checkedOutBranch(sub, args);
  else if (
    (sub === "branch" && args.some((t) => /^-[mM]/.test(t))) ||
    (sub === "rebase" && args.some((t) => !t.startsWith("-"))) ||
    (sub !== undefined && !GIT_BUILTINS.has(sub))
  )
    branch = null;
  if (branch === undefined && !configChanged) return;
  const dir = gitRepoDir(c, globals, ctx, { ...ctx.env, ...c.env });
  const top = dir === null ? undefined : repoLocation(dir)?.top;
  if (top === undefined) ctx.repo.changed = true;
  else {
    if (branch !== undefined) ctx.repo.heads.set(top, branch);
    if (configChanged) ctx.repo.configChanged.add(top);
  }
}

function lastValue(config: GitConfig, key: string): string | undefined {
  return config.get(key)?.at(-1);
}

// The remote a push without one goes to.
function defaultRemote(branch: string, config: GitConfig | null): string {
  if (!config) return "origin";
  return (
    lastValue(config, `branch.${branch}.pushremote`) ??
    lastValue(config, "remote.pushdefault") ??
    lastValue(config, `branch.${branch}.remote`) ??
    "origin"
  );
}

// The refspecs a push without one uses: the remote's `push` lines, else what
// push.default picks. Unreadable config keeps the current branch.
function implicitRefspecs(
  remote: string | null,
  branch: string,
  config: GitConfig | null,
): string[] {
  if (!config) return [branch];
  const configured = remote === null ? undefined : config.get(`remote.${remote}.push`);
  if (configured?.length) return configured;
  const mode = (lastValue(config, "push.default") ?? "simple").toLowerCase();
  if (mode === "nothing") return [];
  if (mode === "matching") return [":"];
  if (mode === "upstream" || mode === "tracking") {
    return [lastValue(config, `branch.${branch}.merge`) ?? branch];
  }
  return [branch];
}

// Git reads a repository argument with `://` as a URL, one with a `:` before
// any `/` as scp-style `host:path`, and anything else as a local path.
function isLocalUrl(url: string): boolean {
  if (/^file:\/\//i.test(url)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return false;
  if (/^[A-Za-z]:[\\/]/.test(url)) return true;
  const colon = url.indexOf(":");
  const slash = url.indexOf("/");
  return colon < 0 || (slash >= 0 && slash < colon);
}

// True when every URL the push goes to is on the local disk. Unreadable config,
// a remote name with no URL in config, or a URL an insteadOf rule rewrites is
// not local.
function isLocalRemote(remote: string | null, config: GitConfig | null): boolean {
  if (!remote || !config) return false;
  const urls =
    config.get(`remote.${remote}.pushurl`) ??
    config.get(`remote.${remote}.url`) ??
    (/[/\\:]|^[.~]/.test(remote) ? [remote] : []);
  const rewrites = [...config]
    .filter(([key]) => /^url\..+\.(?:insteadof|pushinsteadof)$/.test(key))
    .flatMap(([, values]) => values);
  return (
    urls.length > 0 &&
    urls.every((url) => isLocalUrl(url) && !rewrites.some((p) => p && url.startsWith(p)))
  );
}

// `$(git branch --show-current)` and its equivalents name the current branch.
const CURRENT_BRANCH_SUB_RE =
  /^\s*git\s+(?:branch\s+--show-current|rev-parse\s+--abbrev-ref\s+HEAD|symbolic-ref\s+--short\s+HEAD)\s*$/;

// A word with its `$NAME` / `${NAME}` expanded from assignments made earlier on
// the line; null when an expansion is left that the hook cannot read. Bash
// expands a word before a prefix assignment on the same command applies, and
// the hook's own environment is not the Bash tool's shell, so neither is used.
function expandWord(
  word: string,
  ctx: ShellCtx,
  seg: ShellSegment,
  branch: () => string | null,
): string | null {
  // Placeholders are filled in before variables are expanded: one inside a
  // variable's value stands for a substitution on an earlier command, whose
  // body this segment does not hold, so it stays unread.
  let out = word;
  if (
    out.includes(SUBSTITUTION) &&
    seg.subs.length > 0 &&
    seg.subs.every((s) => CURRENT_BRANCH_SUB_RE.test(s))
  ) {
    const current = branch();
    if (current) out = out.replaceAll(SUBSTITUTION, () => current);
  }
  out = expandVars(out, ctx);
  return /[$`]/.test(out) ? null : out;
}

interface BraceList {
  at: number;
  end: number;
  parts: string[];
}

// The first `{a,b}` list in a word. Bash expands an outer list before the
// lists inside it, which decides the order of the words
// (`{{git,push},origin}` is `git push origin`).
function braceList(word: string): BraceList | null {
  for (let at = word.indexOf("{"); at >= 0; at = word.indexOf("{", at + 1)) {
    if (word[at - 1] === "$") continue;
    const parts: string[] = [];
    let depth = 0;
    let from = at + 1;
    for (let i = at + 1; i < word.length; i++) {
      const ch = word[i];
      if (ch === "{") depth++;
      else if (ch === "}" && depth > 0) depth--;
      else if (ch === "," && depth === 0) {
        parts.push(word.slice(from, i));
        from = i + 1;
      } else if (ch === "}") {
        if (parts.length === 0) break;
        return { at, end: i + 1, parts: [...parts, word.slice(from, i)] };
      }
    }
  }
  return null;
}

const MAX_BRACE_WORD = 2000;
const MAX_BRACE_WORDS = 64;

// The words bash makes of one word with `{a,b}` lists; null for a `{a..b}`
// sequence, or a word or list too long to follow.
function braceExpand(word: string): string[] | null {
  if (!word.includes("{")) return [word];
  if (word.length > MAX_BRACE_WORD) return null;
  const words = [word];
  for (;;) {
    const at = words.findIndex((w) => braceList(w) !== null);
    if (at < 0) break;
    const w = words[at] as string;
    const list = braceList(w) as BraceList;
    if (words.length + list.parts.length - 1 > MAX_BRACE_WORDS) return null;
    const head = w.slice(0, list.at);
    const tail = w.slice(list.end);
    words.splice(at, 1, ...list.parts.map((part) => `${head}${part}${tail}`));
  }
  return words.some((w) => /(?<!\$)\{[^{}]*\.\.[^{}]*\}/.test(w)) ? null : words;
}

// Git completes a destination `main` or `heads/main` to `refs/heads/main`. A
// wildcard destination may be main when one of those names starts with the
// part before its `*` (`*`, `refs/*`, `refs/heads/*`, `ma*`).
const MAIN_REFS = [
  "main",
  "master",
  "heads/main",
  "heads/master",
  "refs/heads/main",
  "refs/heads/master",
];

function mayBeMain(dst: string): boolean {
  const star = dst.indexOf("*");
  if (star < 0) return MAIN_REFS.includes(dst);
  const prefix = dst.slice(0, star);
  return MAIN_REFS.some((ref) => ref.startsWith(prefix));
}

const MAX_NESTED_GIT = 8;

function checkMainPush(
  c: Command,
  ctx: ShellCtx,
  previous: Command | undefined,
  seg: ShellSegment,
  cmd: string,
): void {
  // A wrapper the parser does not know (`script -q /dev/null git push`) leaves
  // git among the arguments, as `git submodule foreach git push` does. Past
  // MAX_NESTED_GIT such words the rest is not read, so the command asks.
  if (c.word !== "echo" && c.word !== "printf") {
    const nested = c.args.flatMap((t, at) => (basename(t).toLowerCase() === "git" ? [at] : []));
    if (nested.length > MAX_NESTED_GIT) pendingAsks.push(UNKNOWN_PUSH_ASK);
    for (const at of nested.slice(0, MAX_NESTED_GIT)) {
      checkGitPush(reparse(c.args.slice(at), c), ctx, previous, seg, cmd);
    }
  }
  // A command word the hook cannot read (`$(SUB)`, `$GIT`) may be git.
  if (c.word === "git" || c.typed.includes("$")) checkGitPush(c, ctx, previous, seg, cmd);
}

// Reads one git command as a push, under each reading of its arguments: as
// typed, with `{a,b}` lists expanded, and with variables filled in and split
// into words. Every reading is checked, so one can add an ask or a block and
// none can take one away.
function checkGitPush(
  c: Command,
  ctx: ShellCtx,
  previous: Command | undefined,
  seg: ShellSegment,
  cmd: string,
): void {
  // `echo main | xargs git push origin` adds the piped words to the arguments.
  const piped = c.viaXargs && previous ? literalOutput(previous, seg) : null;
  // The words may differ from the piped text: xargs strips quotes and
  // backslashes, printf rewrites `%`, and xargs can be told to split or place
  // its input another way.
  let unknown =
    c.viaXargs &&
    (piped === null ||
      c.xargsReshapes ||
      /[\\'"]/.test(piped) ||
      (previous?.word === "printf" && piped.includes("%")));
  const typed = piped === null ? c.args : [...c.args, ...piped.split(/\s+/).filter(Boolean)];
  const braced: string[] = [];
  for (const arg of typed) {
    const words = braceExpand(arg);
    if (words === null) unknown = true;
    braced.push(...(words ?? [arg]));
  }
  const split = braced.flatMap((arg) => {
    const filled = arg.replace(VAR_REF_RE, (m, bracedName, bare) => {
      const name = (bracedName ?? bare) as string;
      return ctx.guesses.get(name) ?? knownVar(name, ctx) ?? m;
    });
    return filled === arg ? [arg] : splitWords(filled, ctx);
  });
  const readings = [typed, braced, split];
  if (c.word === "git") {
    readings.push(...readings.flatMap((args) => subcommandReadings(args, ctx, seg)));
  }
  const read = new Set<string>();
  for (const args of readings) {
    const key = args.join("\0");
    if (read.has(key)) continue;
    read.add(key);
    checkRefUpdate(c, args, unknown, ctx, seg, cmd);
  }
}

function checkRefUpdate(
  c: Command,
  args: string[],
  unreadWords: boolean,
  ctx: ShellCtx,
  seg: ShellSegment,
  cmd: string,
): void {
  let unknown = unreadWords;
  const u = readRefUpdate(args);
  if (!u) return;

  const env = { ...ctx.env, ...c.env };
  const dir = gitRepoDir(c, u.globals, ctx, env);
  const override = configOverride(u.globals.configKeys, env);
  if (dir !== null && ctx.repo.configChanged.has(repoLocation(dir)?.top ?? "")) {
    override.url = true;
    override.route = true;
  }
  const branch = (): string | null => branchIn(dir, ctx);
  const shellBranch = (): string | null => branchIn(ctx.dir, ctx);
  const config = (): GitConfig | null => (dir === null ? null : pushConfig(dir));
  if (u.fromStdin) unknown = true;
  const remote = u.remote === undefined ? undefined : expandWord(u.remote, ctx, seg, shellBranch);
  // Routing set on the line also remaps a refspec without a destination.
  if (remote === null || override.route) unknown = true;
  const target = (): string | null =>
    remote === undefined ? defaultRemote(branch() ?? "", config()) : remote;
  let specs: string[] = [];
  if (u.refspecs !== null) specs = u.refspecs;
  else {
    const current = branch();
    if (current === null || override.route) unknown = true;
    else specs = implicitRefspecs(target(), current, config());
  }
  // A remote with `mirror` set pushes every ref, as `--mirror` does.
  const mirrored = (): boolean => {
    const r = target();
    const value = r === null ? undefined : config()?.get(`remote.${r}.mirror`)?.at(-1);
    return value !== undefined && !/^(?:false|no|off|0)$/i.test(value);
  };
  let toMain = u.everyBranch || (u.refspecs === null && mirrored());
  let forcedSpec = false;
  // A refspec without a destination goes where the remote's `push` lines map
  // it, so check every configured destination too.
  if (u.refspecs !== null && u.refspecs.some((r) => !r.includes(":"))) {
    const r = target();
    const mapped = r === null ? undefined : config()?.get(`remote.${r}.push`);
    if (mapped?.length) specs = [...specs, ...mapped];
  }
  for (const raw of specs) {
    const spec = u.refspecs === null ? raw : expandWord(raw, ctx, seg, shellBranch);
    if (spec === null) {
      unknown = true;
      continue;
    }
    // The shell matches `?` and `[` against file names before git runs.
    if (/[?[]/.test(spec)) unknown = true;
    const s = spec.replace(/^\+/, "");
    if (s.startsWith(":") && s !== ":") continue; // a delete
    let dst = s === ":" ? "*" : s.slice(s.lastIndexOf(":") + 1);
    let upstream: string | null = null;
    if (dst === "HEAD" || dst === "@") {
      const current = branch();
      if (current === null) {
        unknown = true;
        continue;
      }
      dst = current;
    } else if (u.refspecs !== null && !s.includes(":") && !spec.startsWith("+")) {
      // With push.default=upstream, git sends a branch named without a
      // destination to that branch's upstream, unless the name carries a `+`:
      // `git push origin +main` updates main itself. The upstream is an added
      // destination; the name as typed stays checked.
      const settings = config();
      const mode = settings ? (lastValue(settings, "push.default") ?? "") : "";
      if (settings && /^(?:upstream|tracking)$/i.test(mode)) {
        const short = dst.replace(/^(?:refs\/)?heads\//, "");
        upstream = lastValue(settings, `branch.${short}.merge`) ?? null;
      }
    }
    if (!mayBeMain(dst) && !(upstream !== null && mayBeMain(upstream))) continue;
    toMain = true;
    if (spec.startsWith("+")) forcedSpec = true;
  }

  if (toMain && (u.forced || forcedSpec)) {
    block(`git ${u.verb} forces an update of main or master, which rewrites shared history`, cmd);
  }
  if (u.submodules) pendingAsks.push(SUBMODULE_PUSH_ASK);
  if (!toMain && !unknown) return;
  if (
    !override.url &&
    !(override.route && remote === undefined) &&
    isLocalRemote(target(), config())
  )
    return;
  pendingAsks.push(toMain ? MAIN_PUSH_ASK : UNKNOWN_PUSH_ASK);
}

// --- Rule: secret file content readers -------------------------------------
//
// Printing, copying, or uploading a credential file puts its contents into the
// transcript or onto the network. Blocked: readers/copiers/uploaders whose
// input is a secret path (plus the flat word scan below for .env and dotenvx).
// Not blocked: commands that only name the path
// (`ssh -i ~/.ssh/id_ed25519`, `chmod 600`, `ls`), writes into it
// (`cp .env.example .env`, `echo X >> .env`), and public keys (`*.pub`). `sed -i` on
// a .env file is blocked by the flat word scan below, like any other reader.
// Accepted residual: paths built at runtime (`$(echo ~)/.ssh`), interpreter
// one-liners (`python -c 'print(open(".env").read())'`), and recursive greps
// over a directory that happens to contain one.

const SECRET_HOME_RE =
  /^(?:~|\$HOME|\$\{HOME\}|\/(?:Users|home)\/[^/]+|\/root)\/(?:\.(?:ssh|aws|gnupg)(?:\/|$)|\.(?:netrc|git-credentials|npmrc)$|\.config\/gh\/hosts\.yml$|\.docker\/config\.json$|\.kube\/config$)/i;
const SECRET_ENV_FILE_RE = /^\.env(?:rc|\.[^/]*|\*)?$/i;
const ENV_TEMPLATE_RE = /\.(?:example|sample|template)$/i;

// `~user/x` → `~/x`, and `.` / `..` / `//` segments resolved.
function normalizePath(path: string): string {
  return posix.normalize(path.replace(/^~[A-Za-z0-9_.-]+\//, "~/"));
}

function isSecretPath(raw: string): boolean {
  const path = normalizePath(raw);
  if (SECRET_HOME_RE.test(path)) return !path.endsWith(".pub");
  const base = path.slice(path.lastIndexOf("/") + 1);
  return SECRET_ENV_FILE_RE.test(base) && !ENV_TEMPLATE_RE.test(base);
}

// A relative path is also tried against the directory the command runs in
// (`cd ~ && cat .ssh/id_rsa`).
function isSecretIn(raw: string, ctx: ShellCtx): boolean {
  if (isSecretPath(raw)) return true;
  const rel = !raw.startsWith("/") && !raw.startsWith("~") && !raw.startsWith("$");
  return rel && ctx.dir !== null && isSecretPath(homeRelative(join(ctx.dir, raw)));
}

// SECRET_HOME_RE matches POSIX spellings, so a resolved Windows path
// (`C:\Users\me\.ssh\id_rsa`) is rewritten as `~/.ssh/id_rsa` first.
function homeRelative(path: string): string {
  const rel = relative(homedir(), path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return path;
  return `~/${rel.replaceAll(sep, "/")}`;
}

const SECRET_READERS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "bat",
  "batcat",
  "tac",
  "nl",
  "sort",
  "cut",
  "diff",
  "cmp",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "awk",
  "gawk",
  "sed",
  "strings",
  "xxd",
  "od",
  "hexdump",
  "hd",
  "base64",
  "paste",
  "dd",
  // GNU coreutils under Homebrew's `g` prefix.
  "gcat",
  "ghead",
  "gtail",
  "gtac",
  "gnl",
  "gsort",
  "gcut",
  "gdiff",
  "ggrep",
  "gsed",
  "god",
  "gbase64",
  "gpaste",
  "gdd",
  "source",
  ".",
]);
// The first positional of these is the pattern, not a file (unless -e/-f is used).
const PATTERN_FIRST = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"]);
const COPY_VALUE_FLAGS: Record<string, string[]> = {
  cp: ["-t", "--target-directory", "-S", "--suffix"],
  scp: ["-i", "-P", "-o", "-F", "-J", "-l", "-c", "-S"],
  rsync: [
    "-e",
    "--rsh",
    "--exclude",
    "--include",
    "--filter",
    "-f",
    "--exclude-from",
    "--include-from",
    "--port",
    "--rsync-path",
  ],
};

function positionals(args: string[], valueFlags: string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i] as string;
    if (valueFlags.includes(t)) i++;
    else if (!t.startsWith("-")) out.push(t);
  }
  return out;
}

// --- Rule: dotenvx and .env readers, by flat word scan ---------------------
//
// `dotenvx get` prints decrypted values, `keypair` prints the private key, and
// `decrypt` writes plaintext back into the file (`dec` is its alias). Wrappers are
// not followed, because each wrapper (`env -iu X`, `sudo -Eu root`, `nice`,
// `timeout --signal KILL 5`, `pnpm --shell-mode exec`, `coproc`, `bun exec '...'`)
// has its own flag grammar and every parser gap was a bypass. Instead the command
// string becomes one flat list of words and position is ignored:
//  - after any word naming dotenvx, a `get`, `decrypt`, `dec` or `keypair` word blocks,
//    up to the `--` that follows a `run` (what comes after it is a command of its own,
//    and a later dotenvx word starts its own scan);
//  - a word naming a secret .env file blocks when any word is a known reader.
// Accepted false positives (the user can run the command with `!`): `dotenvx set get v`,
// `grep .env README.md`, `git commit -m "dotenvx get"`, `sed -i s/a/b/ .env`.
const DOTENVX_PRINTERS = new Set(["get", "decrypt", "dec", "keypair"]);
// The bin, its script, or the package, with an optional version: `dotenvx`,
// `node_modules/.bin/dotenvx`, `.../@dotenvx/dotenvx/src/cli/dotenvx.js`, `@dotenvx/dotenvx@1`,
// `github:dotenvx/dotenvx#main`.
const DOTENVX_TOKEN_RE =
  /(?:^|[\\/:])(?:@dotenvx[\\/])?dotenvx(?:[@#][^\\/]*)?(?:\.(?:[cm]?js|cmd|exe|ps1|git))?$/i;
// Output redirections write the file named after them; they do not read it.
const OUTPUT_REDIRECT_RE = /\d*>>?[|&]?\s*[^\s;|&()<>]+/g;

// Three views of the string: quotes and backslashes as word breaks (so quoted strings are
// split again); quotes removed (so `dot"env"x` and `g$'et'` are one word); and the shell's
// own word decoding. Every `\_` becomes a space (`env -S 'cat\_.env'`), and a backslash
// before a newline joins the word. Operators, parentheses, backticks, `=` and `,` always
// break words.
function flatWordLists(text: string): string[][] {
  // A backslash followed by a newline is a continuation, so it joins the word.
  const spaced = text.replace(/\\\r?\n/g, "").replace(/\\_/g, " ");
  const breaks = /[\s;|&()<>`=,]+/;
  return [
    spaced.split(/[\s;|&()<>`"'\\=,]+/).filter(Boolean),
    // `$'et'` and `$"et"` are quoted words with a `$` in front.
    spaced
      .replace(/\$(?=["'])/g, "")
      .replace(/["'\\]/g, "")
      .split(breaks)
      .filter(Boolean),
    // The shell's own decoding of ANSI-C quotes: `$'\x67et'`, `$'g\145t'`.
    shellWords(spaced)
      .flatMap((w) => w.split(breaks))
      .filter(Boolean),
  ];
}

function isSecretEnvWord(word: string): boolean {
  const base = word.slice(word.lastIndexOf("/") + 1);
  return SECRET_ENV_FILE_RE.test(base) && !ENV_TEMPLATE_RE.test(base);
}

function checkFlatWords(cmd: string): void {
  for (const words of flatWordLists(cmd)) {
    for (const [i, word] of words.entries()) {
      if (!DOTENVX_TOKEN_RE.test(word)) continue;
      let sawRun = false;
      for (const [j, next] of words.slice(i + 1).entries()) {
        const w = next.toLowerCase();
        if (next === "--") {
          if (!sawRun) continue;
          // `-l run -- get K`: `run` was a flag's value, so the verb follows the `--`.
          const after = (words[i + j + 2] ?? "").toLowerCase();
          if (DOTENVX_PRINTERS.has(after)) {
            block(`dotenvx ${after} would expose decrypted .env values or the private key`, cmd);
          }
          break;
        } else if (DOTENVX_PRINTERS.has(w)) {
          block(`dotenvx ${w} would expose decrypted .env values or the private key`, cmd);
        } else if (w === "run") {
          sawRun = true;
        }
      }
    }
  }
  for (const words of flatWordLists(cmd.replace(OUTPUT_REDIRECT_RE, " "))) {
    const reader = words.find((w) => SECRET_READERS.has(basename(w).toLowerCase()));
    const file = words.find(isSecretEnvWord);
    if (reader && file) block(`${basename(reader)} would expose the contents of ${file}`, cmd);
  }
}

function checkSecretReaders(c: ParsedShellCommand, ctx: ShellCtx, cmd: string): void {
  // Case-insensitive filesystems resolve `CAT` to cat.
  const word = c.word.toLowerCase();
  const { args } = c;
  const deny = (path: string): never =>
    block(`${word || "redirect"} would expose the contents of ${path}`, cmd);
  const secret = (path: string): boolean => isSecretIn(path, ctx);

  for (const path of c.reads) if (secret(path)) deny(path);

  if (SECRET_READERS.has(word)) {
    // sed -i rewrites the file in place; it does not print it.
    if (word === "sed" && args.some((t) => /^-[a-zA-Z]*i|^--in-place/.test(t))) return;
    let files = positionals(args);
    if (
      PATTERN_FIRST.has(word) &&
      !args.some((t) => /^-[a-zA-Z]*[ef]|^--(?:regexp|file)/.test(t))
    ) {
      files = files.slice(1);
    }
    for (const path of files) if (secret(path)) deny(path);
    return;
  }

  switch (word) {
    case "cp":
    case "scp":
    case "rsync": {
      const files = positionals(args, COPY_VALUE_FLAGS[word]);
      const toDir = args.some((t) => t === "-t" || t.startsWith("--target-directory"));
      for (const path of toDir ? files : files.slice(0, -1)) if (secret(path)) deny(path);
      return;
    }
    case "zip":
      for (const path of positionals(args).slice(1)) if (secret(path)) deny(path);
      return;
    case "tar": {
      const creates =
        args.some((t) => /^-[a-zA-Z]*[cru][a-zA-Z]*$|^--(?:create|append|update)$/.test(t)) ||
        /^[a-zA-Z]*[cru]/.test(args[0] ?? "");
      if (!creates) return;
      let from: string | null = null; // -C <dir>: members are relative to it
      for (let i = 0; i < args.length; i++) {
        const t = args[i] as string;
        if (t === "-C" || t === "--directory") from = args[++i] ?? null;
        else if (t.startsWith("--directory=")) from = t.slice("--directory=".length);
        if (from !== null && secret(from)) deny(from);
        if (t.startsWith("-")) continue;
        if (secret(t) || (from !== null && secret(posix.join(from, t)))) deny(t);
      }
      return;
    }
    case "curl": {
      for (let i = 0; i < args.length; i++) {
        const t = args[i] as string;
        const upload =
          t === "-T" || t === "--upload-file"
            ? args[i + 1]
            : (t.match(/^--upload-file=(.+)$/) ?? t.match(/^-T(.+)$/))?.[1];
        if (upload && secret(upload)) deny(upload);
        const ref = t.match(/@([^;]+)/) ?? t.match(/=<([^;]+)/);
        if (ref?.[1] && secret(ref[1])) deny(ref[1]);
      }
      return;
    }
    case "gh": {
      // Uploading a secret file: `gist create .env`, `-F .env`, `-F body=@.env`.
      for (const t of args) {
        const candidates = [t, t.replace(/^--[\w-]+=/, ""), t.match(/@([^;]+)/)?.[1] ?? ""];
        for (const path of candidates) if (path && secret(path)) deny(path);
      }
      return;
    }
    case "openssl": {
      const at = args.indexOf("-in");
      const path = at >= 0 ? args[at + 1] : undefined;
      if (path && secret(path)) deny(path);
      return;
    }
  }
}

// --- Rule: gh writes outside the org ---------------------------------------
//
// An agent commented on a third-party repo with the user's identity
// (2026-07-07). `gh` writes (pr/issue/release/repo mutations, `gh api` POST/
// PUT/PATCH/DELETE) must target `darkroomengineering` or the user's own
// account. Owners come from -R/--repo, GH_REPO, positional github.com URLs, and
// the `gh api` path, all united; only when none is given does it fall back to
// the git remotes of the directory the command runs in, every one of which must
// be allowed. An unresolvable owner blocks. Non-org owners are queued and
// checked against the user's login after the synchronous rules ran, so `gh` is
// only called when a write targets one.

const GH_ORG = "darkroomengineering";
const GH_WRITES: Record<string, Set<string>> = {
  pr: new Set([
    "create",
    "comment",
    "review",
    "merge",
    "edit",
    "close",
    "reopen",
    "ready",
    "update-branch",
  ]),
  issue: new Set([
    "create",
    "comment",
    "edit",
    "close",
    "reopen",
    "delete",
    "transfer",
    "lock",
    "unlock",
    "pin",
    "unpin",
  ]),
  release: new Set(["create", "edit", "delete", "upload"]),
  repo: new Set(["edit"]),
};
// Options whose value is free text; a URL there is content, not a target.
const GH_CONTENT_FLAGS = new Set([
  "-b",
  "--body",
  "-t",
  "--title",
  "-F",
  "--body-file",
  "-n",
  "--notes",
]);
const GH_API_VALUE_FLAGS = new Set([
  "-X",
  "--method",
  "-H",
  "--header",
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "--input",
  "-q",
  "--jq",
  "-t",
  "--template",
  "--hostname",
  "--cache",
  "-p",
  "--preview",
]);
const GH_API_BODY_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);
const GH_PLACEHOLDER_OWNER = /^(?:\{owner\}|:owner)$/;

interface PendingOwnerCheck {
  owners: string[];
  what: string;
  cmd: string;
}
const pendingOwnerChecks: PendingOwnerCheck[] = [];

interface GhApiCall {
  endpoint: string;
  method: string;
  /** Values of -f/-F/--field/--raw-field, the text a graphql query lives in. */
  fields: string[];
  hasInput: boolean;
}

function parseGhApi(tokens: string[]): GhApiCall {
  let method: string | undefined;
  let endpoint = "";
  let hasBody = false;
  let hasInput = false;
  const fields: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    const attachedMethod = t.match(/^(?:-X=?|--method=)(.+)$/);
    const attachedBody = t.match(/^(?:--(?:field|raw-field|input)=|-[fF]=?)(.+)$/);
    if (t === "-X" || t === "--method") {
      method = tokens[++i];
    } else if (attachedMethod) {
      method = attachedMethod[1];
    } else if (GH_API_BODY_FLAGS.has(t)) {
      hasBody = true;
      if (t === "--input") hasInput = true;
      fields.push(tokens[++i] ?? "");
    } else if (attachedBody) {
      hasBody = true;
      if (t.startsWith("--input=")) hasInput = true;
      fields.push(attachedBody[1] as string);
    } else if (GH_API_VALUE_FLAGS.has(t)) {
      i++;
    } else if (!t.startsWith("-") && !endpoint) {
      endpoint = t;
    }
  }
  return {
    endpoint,
    method: (method ?? (hasBody ? "POST" : "GET")).toUpperCase(),
    fields,
    hasInput,
  };
}

// The path of a `gh api` endpoint as the server routes it: scheme, host and
// query removed, percent-escapes decoded (`heads%2Fmain`, `m%61in`). Null when
// an escape cannot be decoded.
function ghApiPath(endpoint: string): string | null {
  const path = endpoint.replace(/^https?:\/\/[^/]+(?:\/api\/v3)?/i, "").replace(/[?#].*$/s, "");
  try {
    return decodeURIComponent(path).replace(/^\/+|\/+$/g, "");
  } catch {
    return null;
  }
}

const GH_API_MAIN_ASK =
  "gh api write to main or master: approve only if the user asked for a direct change to that branch in this conversation; otherwise push a branch and open a PR";
const MAIN_BRANCH_RE = /^(?:refs\/)?(?:heads\/)?(?:main|master)$/;

// REST writes that move or change main: the ref itself, the branch endpoints
// (rename, protection), a merge into it, and a contents commit to it (which
// goes to the default branch when no `branch` field is sent). A forced ref
// update blocks; deleting the ref follows the `git push --delete` policy above
// and is not checked. gh sends the last of repeated fields, but any value naming
// main or forcing counts. A body read from a file (`--input`, `-F name=@file`)
// is not known, so it counts as touching main.
function checkGhApiMainWrite(api: GhApiCall, cmd: string): void {
  const path = /[$`]/.test(api.endpoint) ? null : ghApiPath(api.endpoint);
  if (path === null) {
    pendingAsks.push(GH_API_MAIN_ASK);
    return;
  }
  const rest = path.match(/^repos\/[^/]+\/[^/]+\/(.*)$/is)?.[1];
  if (rest === undefined) return;
  const values = (name: string): string[] =>
    api.fields.filter((f) => f.startsWith(`${name}=`)).map((f) => f.slice(name.length + 1));
  const named = (name: string): boolean =>
    api.hasInput ||
    values(name).some((v) => MAIN_BRANCH_RE.test(v) || v.startsWith("@") || /[$`]/.test(v));
  let touches = false;
  const ref = rest.match(/^git\/refs\/heads\/(.+)$/s)?.[1];
  if (ref !== undefined) {
    if (api.method === "DELETE") return;
    touches = MAIN_BRANCH_RE.test(ref) || ref.includes("$");
    if (touches && values("force").some((v) => /^(?:true|1)$/i.test(v))) {
      block("gh api forces an update of main or master, which rewrites shared history", cmd);
    }
  } else if (/^branches\/[^/]+/.test(rest)) {
    const branch = rest.split("/")[1] as string;
    touches = MAIN_BRANCH_RE.test(branch) || branch.includes("$");
  } else if (rest === "git/refs") {
    touches = api.method === "POST" && named("ref");
  } else if (rest === "merges") {
    touches = named("base");
  } else if (/^contents\//.test(rest) && (api.method === "PUT" || api.method === "DELETE")) {
    touches = values("branch").length === 0 || named("branch");
  }
  if (touches) pendingAsks.push(GH_API_MAIN_ASK);
}

// `owner/repo`, `HOST/owner/repo`, or a repo URL → owner.
function ownerOfRepoSpec(spec: string): string | null {
  const parts = spec
    .replace(/^https?:\/\//i, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (parts.length === 2) return parts[0] ?? null;
  if (parts.length >= 3) return parts[1] ?? null;
  return null;
}

function remoteOwners(dir: string | null): string[] {
  if (dir === null) return [];
  let out = "";
  try {
    const r = Bun.spawnSync(["git", "-C", dir, "remote", "-v"], { stderr: "ignore" });
    if (r.exitCode === 0) out = r.stdout.toString();
  } catch {
    return []; // git missing: owner unknown
  }
  const owners = new Set<string>();
  for (const line of out.split("\n")) {
    const url = line.split(/\s+/)[1] ?? "";
    const m =
      url.match(/^[\w.-]+@[^:/]+:([^/]+)\//) ??
      url.match(/^[a-z+]+:\/\/(?:[^@/]+@)?[^/]+\/([^/]+)\//i);
    if (m?.[1]) owners.add(m[1]);
  }
  return [...owners];
}

// Owners a `gh pr|issue|release|repo|api` call targets; null when unknown.
function ghTargetOwners(
  c: ParsedShellCommand,
  ctx: ShellCtx,
  sub: string,
  endpoint: string | null,
): string[] | null {
  const specs: string[] = [];
  const owners = new Set<string>();
  const t = c.args;
  for (let i = 0; i < t.length; i++) {
    const tok = t[i] as string;
    if (tok === "-R" || tok === "--repo") specs.push(t[++i] ?? "");
    else if (tok.startsWith("--repo=")) specs.push(tok.slice(7));
    else if (tok.startsWith("-R=")) specs.push(tok.slice(3));
    else if (/^-R./.test(tok)) specs.push(tok.slice(2));
    else if (!tok.startsWith("-")) {
      const prev = t[i - 1] ?? "";
      const isContent = GH_CONTENT_FLAGS.has(prev) || (sub === "close" && prev === "-c");
      const url = isContent ? null : tok.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\//i);
      if (url?.[1]) owners.add(url[1]);
    }
  }
  if (endpoint !== null) {
    const path = ghApiPath(endpoint);
    if (path === null) return null;
    const m = path.match(/^repos\/([^/]+)\//i);
    if (m?.[1] && !GH_PLACEHOLDER_OWNER.test(m[1])) owners.add(m[1]);
  }
  for (const spec of [c.env.GH_REPO, ctx.env.GH_REPO, process.env.GH_REPO]) {
    if (!spec) continue;
    const owner = ownerOfRepoSpec(spec);
    if (!owner) return null;
    owners.add(owner);
  }
  for (const spec of specs) {
    const owner = ownerOfRepoSpec(spec);
    if (!owner) return null;
    owners.add(owner);
  }
  if (owners.size > 0) return [...owners];
  const remotes = remoteOwners(ctx.dir);
  return remotes.length > 0 ? remotes : null;
}

function checkGhWrites(c: ParsedShellCommand, ctx: ShellCtx, cmd: string): void {
  if (c.word !== "gh") return;
  const pos: string[] = [];
  for (let i = 0; i < c.args.length; i++) {
    const t = c.args[i] as string;
    if (t === "-R" || t === "--repo") i++;
    else if (!t.startsWith("-")) pos.push(t);
  }
  const [group = "", sub = ""] = pos;

  if (
    group === "auth" &&
    (sub === "token" ||
      (sub === "status" && c.args.some((t) => t === "-t" || t === "--show-token")))
  ) {
    block("gh auth would print the GitHub token", cmd);
  }

  let what = `${group} ${sub}`;
  let endpoint: string | null = null;
  if (group === "api") {
    const api = parseGhApi(c.args.slice(c.args.indexOf("api") + 1));
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(api.method)) return;
    what = "api write";
    endpoint = api.endpoint;
    checkGhApiMainWrite(api, cmd);
    // A graphql mutation names its target by opaque node id, so the owner
    // cannot be read; a query (also sent as POST) only reads.
    if (/^\/?graphql$/.test(api.endpoint)) {
      const opaque = api.hasInput || api.fields.some((f) => f.includes("@"));
      if (opaque || api.fields.some((f) => /\bmutation\b/i.test(f))) {
        block("gh api graphql mutation: the target repository owner cannot be determined", cmd);
      }
      return;
    }
  } else if (!GH_WRITES[group]?.has(sub)) {
    return;
  }

  const owners = ctx.unterminated ? null : ghTargetOwners(c, ctx, sub, endpoint);
  if (!owners) {
    block(
      `gh ${what}: cannot tell which repository owner it targets; pass -R darkroomengineering/<repo>`,
      cmd,
    );
  }
  const outside = owners.filter((o) => o.toLowerCase() !== GH_ORG);
  if (outside.length > 0) pendingOwnerChecks.push({ owners: outside, what, cmd });
}

// The user's own GitHub login: CC_SAFETY_GH_LOGIN, else `gh api user`. Null when
// it cannot be determined, which leaves only the org allowed. Nothing is cached:
// a cache file would be one more writable input to this decision.
function ghLogin(): string | null {
  const override = process.env.CC_SAFETY_GH_LOGIN;
  if (override !== undefined) return override.trim() || null;
  try {
    const r = Bun.spawnSync(["gh", "api", "user", "--jq", ".login"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 2000,
    });
    return r.exitCode === 0 ? r.stdout.toString().trim() || null : null;
  } catch {
    return null; // gh missing: fail closed to the org only
  }
}

function resolvePendingOwnerChecks(): void {
  if (pendingOwnerChecks.length === 0) return;
  const login = (ghLogin() ?? "").toLowerCase();
  for (const { owners, what, cmd } of pendingOwnerChecks) {
    const bad = owners.find((o) => o.toLowerCase() !== login);
    if (bad) {
      block(
        `gh ${what} targets ${bad}, outside ${GH_ORG} and your own account; ask the user before writing to another owner's repo`,
        cmd,
      );
    }
  }
}

// --- Rule: shell wrapper recursion (bash -c / sh -c) ---------------------

const MAX_DEPTH = 3;

function unwrapAndAnalyze(cmd: string, depth: number): void {
  if (!/(bash|\/bash|sh|\/sh|zsh|\/zsh)\s+-c\s/i.test(cmd)) return;
  if (depth >= MAX_DEPTH) block("shell nesting too deep to analyze", cmd);

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

function extractDashCPayload(cmd: string): string | null {
  const sq = cmd.match(/-[ec]\s+'([^']*)'/);
  if (sq) return sq[1] ?? null;
  const dq = cmd.match(/-[ec]\s+"([^"]*)"/);
  if (dq) return dq[1] ?? null;
  const unq = cmd.match(/-[ec]\s+([^;&|\n]+)/);
  if (unq) return unq[1] ?? null;
  return null;
}

function checkInterpreterOneliners(cmd: string, depth: number): void {
  if (!/(python3?|node|ruby|perl)\s+-[ec]\s/i.test(cmd)) return;
  const dangerous =
    /(os\.system\(|subprocess\.|child_process|execSync\(|system\(|exec\(|popen\(|spawn\()/;
  if (!dangerous.test(cmd)) return;
  if (depth >= MAX_DEPTH) block("interpreter nesting too deep to analyze", cmd);

  const payload = extractDashCPayload(cmd);
  if (!payload) return;

  // Preferred: extract the literal string argument to the call — covers the
  // common single-string form: os.system("rm -rf /").
  const m = payload.match(/(os\.system|subprocess\.(run|call|Popen)|execSync)\(['"]([^'"]+)['"]/);
  if (m?.[3]) analyzeCommand(m[3], depth + 1);

  // Best-effort: list-arg form, e.g. subprocess.run(["rm","-rf","/"]), where
  // there's no single quoted string arg to extract. Normalize the call's
  // punctuation (quotes/brackets/parens/commas) to spaces so the arg list
  // reads like a shell command line, then recurse the whole payload. This is
  // a net, not a parser: it will also re-scan payloads already handled above,
  // which is harmless (checkRmRf/checkGitDestructive are idempotent no-ops on
  // safe input).
  const normalized = payload.replace(/["'[\](),]/g, " ");
  if (normalized !== payload) analyzeCommand(normalized, depth + 1);
}

// --- Command analysis -----------------------------------------------------
//
// Rules fall into two tiers with opposite scope requirements:
//
//   • Full-string rules (attribution, find/xargs, shell + interpreter unwrap)
//     must see the command BEFORE it is split. Multi-line commit bodies and
//     quoted `bash -c '...'` / `python -c '...'` payloads routinely span
//     `;`/`&&`/`||`, and these patterns are detected anywhere in the string.
//
//   • Per-command rules (rm, git, gh, secrets, kills) run on each simple
//     command from scanShell, which splits on `;` `&&` `||` `&` newlines and
//     parentheses but never inside quotes, `$(...)`, backticks, or heredoc
//     bodies. Substitution bodies are scanned as commands of their own. The
//     git hook, gh, and secret rules read the parsed command (words, not
//     text), so a commit message or comment body that merely mentions a flag
//     or URL does not trigger them.

function analyzeFullString(cmd: string): void {
  checkAiAttribution(cmd);
  checkFindXargs(cmd);
  unwrapAndAnalyze(cmd, 0);
  checkInterpreterOneliners(cmd, 0);
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

// What a command writes to stdout when that is plain text we can read:
// `echo '...'`, `printf '...'`, `cat <<'EOF'`, `cat <<< '...'`.
function literalOutput(c: Command, seg: ShellSegment): string | null {
  const unescapeNewlines = (text: string): string =>
    text.replaceAll("\\n", "\n").replaceAll("\\t", "\t");
  if (c.word === "echo" || c.word === "printf") {
    const rest = c.args.filter((t, i) => !(i === 0 && /^-[neE]+$/.test(t)));
    return unescapeNewlines(rest.join(" "));
  }
  if (c.word === "cat" && positionals(c.args).length === 0) {
    const word = c.heredocWords[0];
    if (word !== undefined) return seg.heredocs.find((h) => h.word === word)?.body ?? null;
    return c.hereStrings[0] ?? null;
  }
  return null;
}

// The text a `<( ... )` or `$( ... )` substitution would produce, when its
// last command prints literal text. A guess: escapes, formats and globs can
// change what the shell makes of it, so it only ever adds a reading.
function processSubstitutionOutput(inner: string): string | null {
  const last = scanShell(inner).segments.at(-1);
  if (!last) return null;
  const stage = splitPipes(last.clean).at(-1);
  return stage === undefined ? null : literalOutput(parseCommand(stage), last);
}

// Scripts a shell or `eval` stage will run that are not on its command line:
// a heredoc or here-string on its stdin, the literal output of the pipe stage
// feeding it, a `<( ... )` script operand, or `eval`'s joined arguments.
function scriptsRunBy(c: Command, previous: Command | undefined, seg: ShellSegment): string[] {
  if (c.word === "eval") return [c.args.join(" ")];
  if (!SHELLS.has(c.word)) return [];
  const hasCommandString = c.args.some((t) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t));
  if (hasCommandString) return [];

  const scripts: string[] = [];
  const files: string[] = [];
  for (const t of positionals(c.args, ["-o", "-O", "+o", "+O"])) {
    const sub = t.match(PROCESS_SUBSTITUTION_RE);
    const output = sub ? processSubstitutionOutput(seg.subs[Number(sub[1])] ?? "") : null;
    if (output !== null) scripts.push(output);
    else if (!sub) files.push(t);
  }
  // Without a script file argument the shell reads its script from stdin.
  if (files.length === 0 || c.args.includes("-s")) {
    for (const word of c.heredocWords) {
      const body = seg.heredocs.find((h) => h.word === word)?.body;
      if (body !== undefined) scripts.push(body);
    }
    scripts.push(...c.hereStrings);
    const piped = previous ? literalOutput(previous, seg) : null;
    if (piped !== null) scripts.push(piped);
  }
  return scripts;
}

// The command `git submodule foreach` runs in each submodule, as one script
// (git hands a single argument to the shell); "" for any other command.
function submoduleCommand(c: Command): string {
  if (c.word !== "git") return "";
  const args = c.args.slice(readGitGlobals(c.args).sub);
  let at = args.indexOf("foreach") + 1;
  if (args[0] !== "submodule" || at === 0) return "";
  while (args[at]?.startsWith("-")) at++;
  return args.slice(at).join(" ");
}

// `HUSKY=0 bash -c '...'`: the script runs with the assignments in front.
function unwrapShellStage(
  c: Command,
  previous: Command | undefined,
  seg: ShellSegment,
  ctx: ShellCtx,
  depth: number,
): void {
  const inner: ShellCtx = cloneCtx({ ...ctx, env: { ...ctx.env, ...c.env } });
  const scripts: string[] = [];
  if (SHELLS.has(c.word)) {
    const at = c.args.findIndex((t) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t));
    // The script is the first operand after the options: `bash -c -- '...'`,
    // `bash -c -e '...'`, `bash -c -o pipefail '...'`.
    let j = at + 1;
    while (at >= 0 && j < c.args.length && /^[-+]/.test(c.args[j] as string)) {
      const t = c.args[j] as string;
      j += /^[-+][oO]$/.test(t) ? 2 : 1;
      if (t === "--") break;
    }
    const script = at >= 0 ? c.args[j] : undefined;
    if (script) scripts.push(script);
  }
  scripts.push(...scriptsRunBy(c, previous, seg));
  const foreach = submoduleCommand(c);
  if (foreach) {
    // Each submodule is a checkout of its own, on a branch the hook does not read.
    inner.dir = null;
    inner.elseDirs = [];
    scripts.push(foreach);
  }
  const alias = ctx.aliases.get(c.typed);
  if (alias !== undefined) {
    // The shell does not expand an alias again inside its own text.
    inner.aliases.delete(c.typed);
    // The script quotes each argument, which hides a flag from the rules that
    // read text (`alias r=rm`, then `r -rf ~`).
    checkSegmentText([alias, ...c.args].join(" "), seg.subs);
    scripts.push([alias, ...c.args.map(shellQuote)].join(" "));
  }
  if (scripts.length === 0) return;
  if (depth >= MAX_DEPTH) block("shell nesting too deep to analyze", c.word);
  for (const script of scripts) {
    analyzeCommand(script, depth + 1, inner);
    if (!script.includes(SUBSTITUTION)) continue;
    if (seg.subs.length > MAX_ADDED_READINGS) pendingAsks.push(UNREAD_COMMAND_ASK);
    // `eval "$(echo git push origin main)"`: the script may also be what a
    // substitution prints.
    for (const body of seg.subs.slice(0, MAX_ADDED_READINGS)) {
      const output = processSubstitutionOutput(body);
      if (output === null) continue;
      analyzeCommand(
        script.replaceAll(SUBSTITUTION, () => output),
        depth + 1,
        inner,
      );
    }
  }
}

function checkSegmentText(text: string, subs: string[]): void {
  checkRmRf(text);
  checkGitDestructive(text);
  checkGhApiRepoDelete(text);
  checkProcessKill(text, subs);
}

function analyzeSegment(seg: ShellSegment, ctx: ShellCtx, depth: number): void {
  const text = seg.clean;
  checkSegmentText(text, seg.subs);
  const stages = splitPipes(text).map(parseCommand);
  stages.forEach((typed, i) => {
    if (i > 0) invalidateCheckoutBranches(ctx);
    const forms = commandForms(typed, ctx, seg);
    const dirs = dirReadings(ctx);
    for (const c of forms) {
      // The rules that read text have seen the segment as typed, which is not
      // this command when its words were filled in or split out of a string.
      if (c !== typed || c.resplit) checkSegmentText([c.word, ...c.args].join(" "), seg.subs);
      for (const at of dirs) {
        checkSecretReaders(c, at, text);
        checkGhWrites(c, at, text);
        checkGitHookSkips(c, at, seg, text);
        checkMainPush(c, at, stages[i - 1], seg, text);
        unwrapShellStage(c, stages[i - 1], seg, at, depth);
        if (forms.length === 1) trackRepo(c, at);
      }
    }
    // A checkout tracked under several directories ran in only one of them.
    if (dirs.length > 1) invalidateCheckoutBranches(ctx);
    // What a command word that is not literal text runs is not known, and an
    // alias runs its text in this shell, so neither is the directory, the
    // branch or any variable after it.
    if (forms.length > 1 || ctx.aliases.has(typed.typed)) {
      ctx.dir = null;
      ctx.elseDirs = [];
      ctx.chainDirs = [];
      ctx.repo.changed = true;
      ctx.opaque.all = true;
    }
    // Pipeline stages and background commands run in subshells, so only a
    // lone foreground command changes state.
    if (stages.length === 1 && seg.joiner !== "&") trackState(typed, ctx, seg);
  });
  if (stages.length > 1) invalidateCheckoutBranches(ctx);
}

function invalidateCheckoutBranches(ctx: ShellCtx): void {
  for (const top of ctx.repo.heads.keys()) ctx.repo.heads.set(top, null);
}

function analyzeShell(cmd: string, depth: number, inherited: ShellCtx): void {
  const scan = scanShell(cmd);
  for (const reading of scan.readings ?? [scan]) analyzeReading(cmd, reading, depth, inherited);
}

function analyzeReading(cmd: string, scan: ShellScan, depth: number, inherited: ShellCtx): void {
  const base: ShellCtx = cloneCtx({
    ...inherited,
    unterminated: scan.unterminated || inherited.unterminated,
  });
  markOpaqueVars(cmd, scan, base.opaque);
  // Each subshell scope starts from a copy of its parent's state when its
  // first command is reached, and never writes back.
  const scopes = new Map<number, ShellCtx>([[0, base]]);
  const ctxOf = (scope: number): ShellCtx => {
    let ctx = scopes.get(scope);
    if (!ctx) {
      ctx = cloneCtx(ctxOf(scan.scopeParents[scope] as number));
      scopes.set(scope, ctx);
    }
    return ctx;
  };
  const pipelines = new Map<number, ShellSegment>();
  for (const scanned of scan.segments) {
    const first = pipelines.get(scanned.scope);
    const seg = first
      ? {
          ...scanned,
          clean: `${first.clean} | ${scanned.clean.replace(/\$\(PSUB(\d+)\)/g, (_m, index) => `$(PSUB${Number(index) + first.subs.length})`)}`,
          subs: [...first.subs, ...scanned.subs],
          heredocs: [...first.heredocs, ...scanned.heredocs],
        }
      : scanned;
    if (seg.joiner === "|") {
      const ctx = ctxOf(scanned.scope);
      trackRepo(parseCommand(scanned.clean), ctx);
      invalidateCheckoutBranches(ctx);
      pipelines.set(seg.scope, seg);
      continue;
    }
    pipelines.delete(seg.scope);
    const ctx = ctxOf(seg.scope);
    analyzeSegment(seg, ctx, depth);
    endCommand(ctx, seg.joiner);
    if (seg.joiner !== "&&") invalidateCheckoutBranches(ctx);
  }
  for (const seg of pipelines.values()) {
    const ctx = ctxOf(seg.scope);
    analyzeSegment(seg, ctx, depth);
    endCommand(ctx, null);
    invalidateCheckoutBranches(ctx);
  }
  if (scan.unterminated) {
    // The split is unreliable past an open quote, so check the raw pieces too,
    // with the quote characters blanked: fail toward blocking.
    for (const piece of cmd.split(/[;&|\n]+/)) {
      const text = piece.replace(/["'`]/g, " ");
      const c = parseCommand(text);
      const seg: ShellSegment = { clean: text, subs: [], heredocs: [], scope: 0, joiner: null };
      checkSecretReaders(c, base, cmd);
      checkGhWrites(c, base, cmd);
      checkGitHookSkips(c, base, seg, cmd);
      checkMainPush(c, base, undefined, seg, cmd);
    }
  }
}

function splitCommands(cmd: string): void {
  analyzeFullString(cmd);
  checkFlatWords(cmd);
  analyzeShell(cmd, 0, rootCtx());
}

// --- Recursion target -----------------------------------------------------
//
// Inner commands extracted from `bash -c '...'` or interpreter one-liners are
// fresh command strings with quotes intact, so the full battery is re-run on
// them (depth-bounded by MAX_DEPTH). Attribution is omitted: it has already
// matched against the outer string, which contains the inner verbatim.

function analyzeCommand(cmd: string, depth: number, ctx: ShellCtx = rootCtx()): void {
  checkFindXargs(cmd);
  unwrapAndAnalyze(cmd, depth);
  checkInterpreterOneliners(cmd, depth);
  analyzeShell(cmd, depth, ctx);
}

// --- Main ------------------------------------------------------------------

// Fast path: skip entirely if none of the high-risk verbs or secret-path
// markers appear. The markers let a reader (`cat`, `<`, `curl @file`, ...) reach
// the secret-reader rule without listing every reader here.
const FAST_PATH_VERBS_RE =
  /\b(rm|git|gh|push|find|xargs|kill|pkill|killall|fuser|bash|sh|zsh|python|python3|node|ruby|perl)\b/i;
const SECRET_MARKER_RE =
  /\.(?:ssh|aws|gnupg|netrc|git-credentials|npmrc|kube)\b|\.docker\/config|hosts\.yml|\.env(?:rc|\b)|dotenvx/i;

function failClosed(err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  writeSync(2, `[Safety Net] internal error, failing closed: ${detail}\n`);
  process.exit(1);
}

export async function main(io: HookIO = processIO): Promise<void> {
  try {
    const { command } = await io.toolInput<{ command: unknown }>();
    const COMMAND = typeof command === "string" ? command : "";
    if (!COMMAND) return;
    if (process.env.CC_SAFETY_TEST_CRASH) throw new Error("induced crash");
    // Quotes and backslashes can split a name (`".e""nv"`, `.\env`), so the
    // fast path also looks at the text with them removed.
    const plain = COMMAND.replace(/\\\r?\n/g, "").replace(/["'\\]/g, "");
    const interesting = (text: string): boolean =>
      FAST_PATH_VERBS_RE.test(text) || SECRET_MARKER_RE.test(text);
    // A `$` or a backtick can build any of those words at run time (`$A$B`
    // for git), and so can a glob or a brace list (`r?`, `r{m,}`), so a command
    // holding one is analyzed as well.
    if (
      !/[$`?*[{]/.test(COMMAND) &&
      !interesting(COMMAND) &&
      !interesting(plain) &&
      !interesting(shellWords(COMMAND).join(" "))
    ) {
      return;
    }

    const { cwd } = await io.hookInput<{ cwd: unknown }>();
    baseDir = typeof cwd === "string" && cwd ? cwd : null;
    pendingAsks.length = 0;
    branchCache.clear();
    configCache.clear();
    splitCommands(COMMAND);
    resolvePendingOwnerChecks();
    // Asks wait until every check has run, so any block in the command wins.
    if (pendingAsks.length > 0) {
      io.ask([...new Set(pendingAsks)].map((reason) => `[Safety Net] ${reason}`).join("\n"));
    }
  } catch (err) {
    if (err instanceof BlockDecision) {
      await logBlocked(err.command, err.reason);
      io.block(`[Safety Net] ${err.reason}`);
    }
    throw err;
  }
}

// A direct run turns any non-block error into the fail-closed exit; the dispatcher
// turns the same throw into a block decision.
if (import.meta.main) await main().catch(failClosed);
