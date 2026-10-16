#!/usr/bin/env bun
// Safety Net — PreToolUse hook that blocks destructive Bash commands.
// Port of scripts/safety-net.sh.
//
// Decision protocol (identical to bash):
//   exit 0                → ALLOW (silent)
//   exit 2 + JSON stdout  → BLOCK — {"decision":"block","reason":"[Safety Net] ..."}
//   exit 1 + stderr       → unexpected internal error; fails CLOSED (the
//                           "onFailure": "block" wiring in config/40-hooks.json
//                           only fires on exit codes other than 0 and 2)
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

import { writeSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import {
  type ParsedShellCommand,
  PROCESS_SUBSTITUTION_RE,
  parseShellCommand,
  type ShellSegment,
  scanShell,
  shellWords,
  splitPipes,
} from "../lib/hook-command.ts";
import { blockDecision, readHookInput, readToolInput } from "../lib/hook-runtime.ts";
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
  const re = /(^|[\s;&|])(?:[^\s;&|]*\/)?rm\s+([^;&|\n]+)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop idiom
  while ((m = re.exec(cmd))) {
    const rmPortion = (m[2] ?? "").trim();
    if (rmPortion) analyzeRmPortion(rmPortion, cmd);
  }
}

// --- Rule: AI attribution --------------------------------------------------

function checkAiAttribution(cmd: string): void {
  const isCommit = /git\s+commit/.test(cmd);
  const isPr = /gh\s+pr\s+create/.test(cmd);
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
    case "push": {
      if (subargs.includes("--force-with-lease")) {
        const targets = subargs.split(/\s+/).filter((t) => t && !t.startsWith("-"));
        // Without a refspec (`git push --force-with-lease [remote]`) the
        // destination is the current branch, so resolve it.
        const refspecs = targets.length > 1 ? targets.slice(1) : [currentBranch()];
        if (refspecs.some((t) => /(^|:)(refs\/heads\/)?(main|master)$/.test(t)))
          block("git push --force-with-lease to main or master rewrites shared history", cmd);
        return;
      }
      const padded = ` ${subargs} `;
      if (/(^|\s)--force(\s|$)/.test(padded))
        block("git push --force can overwrite remote history", cmd);
      // Bundled short flags: `-uf`, `-fu`, etc. all include a force flag
      // even though the literal string "-f" never appears standalone.
      if (/(^|\s)-[a-zA-Z]*f[a-zA-Z]*(\s|$)/.test(padded))
        block("git push --force can overwrite remote history", cmd);
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

// Fails open to "" (no match) when git is unavailable or HEAD is detached.
function currentBranch(): string {
  try {
    const r = Bun.spawnSync(["git", "branch", "--show-current"], { stderr: "ignore" });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return ""; // git not installed or cwd gone
  }
}

// `gh api` DELETE is allowed for cleanup (refs, releases, comments), but a
// DELETE on the repository root endpoint deletes the repo, which `gh repo
// delete` guards in the permission layer.
function checkGhApiRepoDelete(cmd: string): void {
  const m = cmd.match(/(^|\s)gh\s+api\s+(.*)$/s);
  if (!m?.[2]) return;
  const rest = m[2];
  if (!/(-X\s*|--method[\s=]+)['"]?DELETE\b/i.test(rest)) return;
  const tokens = rest.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ""));
  if (tokens.some((t) => /^\/?repos\/[^/\s]+\/[^/\s]+\/?$/.test(t)))
    block("gh api DELETE on a repository endpoint deletes the repository", cmd);
}

function checkGitDestructive(cmd: string): void {
  // Evaluate EVERY 'git' occurrence in the string, not just the first —
  // `cmd.match(/git\s+(.*)/)` (no /g, and `.` doesn't cross newlines without
  // /s) only ever inspected the first invocation, letting a second
  // `git checkout -- .` later in the same string ride along unchecked.
  const re = /(^|\s)git\s+/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop idiom
  while ((m = re.exec(cmd))) {
    const afterVerb = cmd.slice(m.index + m[0].length);
    analyzeGitAfterVerb(afterVerb, cmd);
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
  /^(?:(?:sudo|exec|nohup|command)\s+(?:-\S+\s+)*|env\s+(?:-\S+\s+|\S+=\S*\s+)*|timeout\s+(?:-\S+\s+)*\S+\s+)*/;
const LISTEN_ONLY_RE = /-s\s*TCP:LISTEN\b/i;

function stageCommand(stage: string): { word: string; args: string } {
  const rest = stage.trim().replace(KILL_PREFIX_RE, "");
  const m = rest.match(/^(?:[^\s;&|]*\/)?([^\s/]+)\s*(.*)$/s);
  return { word: m?.[1] ?? "", args: m?.[2] ?? "" };
}

function isProcessSearch(text: string): boolean {
  if (/(^|[\s|(`])(pgrep|pidof|ps|fuser)(\s|$)/.test(text)) return true;
  return /(^|[\s|(`])lsof(\s|$)/.test(text) && !LISTEN_ONLY_RE.test(text);
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
    if (word === "xargs" && /(^|\s)kill(\s|$)/.test(args)) {
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
  /** The line has a quote or substitution that never closed. */
  unterminated: boolean;
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
  return { env: {}, vars: {}, exported: new Set(), dir: baseDir ?? safeCwd(), unterminated: false };
}

function cloneCtx(ctx: ShellCtx): ShellCtx {
  return { ...ctx, env: { ...ctx.env }, vars: { ...ctx.vars }, exported: new Set(ctx.exported) };
}

function trackState(c: ParsedShellCommand, ctx: ShellCtx): void {
  if (c.word === "") {
    // Assigning to an exported name (earlier in the line or in the session's
    // environment) updates what children see; bash keeps the export flag.
    for (const [name, value] of Object.entries(c.env)) {
      if (name in ctx.env || ctx.exported.has(name) || process.env[name] !== undefined) {
        ctx.env[name] = value;
      } else ctx.vars[name] = value;
    }
  } else if (c.word === "export") {
    for (const t of c.args) {
      const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/s);
      if (!m) continue;
      const name = m[1] as string;
      const value = m[2] ?? ctx.vars[name];
      if (value !== undefined) ctx.env[name] = value;
      else ctx.exported.add(name);
    }
  } else if (c.word === "cd" || c.word === "pushd") {
    const target = c.args.find((t) => !t.startsWith("-"));
    if (target === undefined) ctx.dir = homedir();
    else if (target === "~" || target.startsWith("~/")) ctx.dir = join(homedir(), target.slice(1));
    else if (/[$`*?[~]/.test(target) || target === "-" || !ctx.dir) ctx.dir = null;
    else ctx.dir = resolve(ctx.dir, target);
  } else if (c.word === "popd") {
    ctx.dir = null;
  }
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

function checkGitHookSkips(c: ParsedShellCommand, ctx: ShellCtx, cmd: string): void {
  if (c.word !== "git") return;
  const a = c.args;
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

// --- Rule: secret file content readers -------------------------------------
//
// Printing, copying, or uploading a credential file puts its contents into the
// transcript or onto the network. Blocked: readers/copiers/uploaders whose
// input is a secret path. Not blocked: commands that only name the path
// (`ssh -i ~/.ssh/id_ed25519`, `chmod 600`, `ls`), writes into it
// (`cp .env.example .env`, `echo X >> .env`, `sed -i`), and public keys
// (`*.pub`).
// Accepted residual: paths built at runtime (`$(echo ~)/.ssh`), interpreter
// one-liners (`python -c 'print(open(".env").read())'`), and recursive greps
// over a directory that happens to contain one.

const SECRET_HOME_RE =
  /^(?:~|\$HOME|\$\{HOME\}|\/(?:Users|home)\/[^/]+|\/root)\/(?:\.(?:ssh|aws|gnupg)(?:\/|$)|\.(?:netrc|git-credentials|npmrc)$|\.config\/gh\/hosts\.yml$|\.docker\/config\.json$|\.kube\/config$)/;
const SECRET_ENV_FILE_RE = /^\.env(?:rc|\.[^/]*|\*)?$/;
const ENV_TEMPLATE_RE = /\.(?:example|sample|template)$/;

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
  return rel && ctx.dir !== null && isSecretPath(join(ctx.dir, raw));
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

function checkSecretReaders(c: ParsedShellCommand, ctx: ShellCtx, cmd: string): void {
  const { word, args } = c;
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
        if (secret(t) || (from !== null && secret(join(from, t)))) deny(t);
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
    const attachedMethod = t.match(/^(?:-X|--method=)(.+)$/);
    const attachedBody = t.match(/^(?:--(?:field|raw-field|input)=|-[fF])(.+)$/);
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
    const m = endpoint.match(/^(?:https?:\/\/api\.github\.com)?\/?repos\/([^/]+)\//i);
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
  if (!/(bash|\/bash|sh|\/sh|zsh|\/zsh)\s+-c\s/.test(cmd)) return;
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
  if (!/(python3?|node|ruby|perl)\s+-[ec]\s/.test(cmd)) return;
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
function literalOutput(c: ParsedShellCommand, seg: ShellSegment): string | null {
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

// The text a `<( ... )` process substitution would produce, when it is literal.
function processSubstitutionOutput(inner: string): string | null {
  const last = scanShell(inner).segments.at(-1);
  if (!last) return null;
  const stage = splitPipes(last.clean).at(-1);
  return stage === undefined ? null : literalOutput(parseShellCommand(stage), last);
}

// Scripts a shell or `eval` stage will run that are not on its command line:
// a heredoc or here-string on its stdin, the literal output of the pipe stage
// feeding it, a `<( ... )` script operand, or `eval`'s joined arguments.
function scriptsRunBy(
  c: ParsedShellCommand,
  previous: ParsedShellCommand | undefined,
  seg: ShellSegment,
): string[] {
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

// `HUSKY=0 bash -c '...'`: the script runs with the assignments in front.
function unwrapShellStage(
  c: ParsedShellCommand,
  previous: ParsedShellCommand | undefined,
  seg: ShellSegment,
  ctx: ShellCtx,
  depth: number,
): void {
  const inner: ShellCtx = cloneCtx({ ...ctx, env: { ...ctx.env, ...c.env } });
  const scripts: string[] = [];
  if (SHELLS.has(c.word)) {
    const at = c.args.findIndex((t) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t));
    const script = at >= 0 ? c.args[at + 1] : undefined;
    if (script) scripts.push(script);
  }
  scripts.push(...scriptsRunBy(c, previous, seg));
  if (scripts.length === 0) return;
  if (depth >= MAX_DEPTH) block("shell nesting too deep to analyze", c.word);
  for (const script of scripts) analyzeCommand(script, depth + 1, inner);
}

function analyzeSegment(seg: ShellSegment, ctx: ShellCtx, depth: number): void {
  const text = seg.clean;
  checkRmRf(text);
  checkGitDestructive(text);
  checkGhApiRepoDelete(text);
  checkProcessKill(text, seg.subs);
  const stages = splitPipes(text).map(parseShellCommand);
  stages.forEach((c, i) => {
    checkSecretReaders(c, ctx, text);
    checkGhWrites(c, ctx, text);
    checkGitHookSkips(c, ctx, text);
    unwrapShellStage(c, stages[i - 1], seg, ctx, depth);
    // Pipeline stages run in subshells, so only a lone command changes state.
    if (stages.length === 1) trackState(c, ctx);
  });
}

function analyzeShell(cmd: string, depth: number, inherited: ShellCtx): void {
  const scan = scanShell(cmd);
  const base: ShellCtx = cloneCtx({
    ...inherited,
    unterminated: scan.unterminated || inherited.unterminated,
  });
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
  for (const seg of scan.segments) analyzeSegment(seg, ctxOf(seg.scope), depth);
  if (scan.unterminated) {
    // The split is unreliable past an open quote, so check the raw pieces too,
    // with the quote characters blanked: fail toward blocking.
    for (const piece of cmd.split(/[;&|\n]+/)) {
      const c = parseShellCommand(piece.replace(/["'`]/g, " "));
      checkSecretReaders(c, base, cmd);
      checkGhWrites(c, base, cmd);
      checkGitHookSkips(c, base, cmd);
    }
  }
}

function splitCommands(cmd: string): void {
  analyzeFullString(cmd);
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
  /\b(rm|git|gh|find|xargs|kill|pkill|killall|fuser|bash|sh|zsh|python|python3|node|ruby|perl)\b/;
const SECRET_MARKER_RE =
  /\.(?:ssh|aws|gnupg|netrc|git-credentials|npmrc|kube)\b|\.docker\/config|hosts\.yml|\.env(?:rc|\b)/;

function failClosed(err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  writeSync(2, `[Safety Net] internal error, failing closed: ${detail}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    const { command } = await readToolInput<{ command: unknown }>();
    const COMMAND = typeof command === "string" ? command : "";
    if (!COMMAND) return;
    if (process.env.CC_SAFETY_TEST_CRASH) throw new Error("induced crash");
    // Quotes and backslashes can split a name (`".e""nv"`, `.\env`), so the
    // fast path also looks at the text with them removed.
    const plain = COMMAND.replace(/\\\r?\n/g, "").replace(/["'\\]/g, "");
    const interesting = (text: string): boolean =>
      FAST_PATH_VERBS_RE.test(text) || SECRET_MARKER_RE.test(text);
    if (
      !interesting(COMMAND) &&
      !interesting(plain) &&
      !interesting(shellWords(COMMAND).join(" "))
    ) {
      return;
    }

    const { cwd } = await readHookInput<{ cwd: unknown }>();
    baseDir = typeof cwd === "string" && cwd ? cwd : null;
    splitCommands(COMMAND);
    resolvePendingOwnerChecks();
  } catch (err) {
    if (err instanceof BlockDecision) {
      await logBlocked(err.command, err.reason);
      blockDecision(`[Safety Net] ${err.reason}`);
    }
    failClosed(err);
  }
}

await main();
