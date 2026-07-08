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
// Reads TOOL_INPUT_command from env (the PreToolUse delivery contract; see
// docs/hooks-reference.md).

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { blockDecision } from "../lib/hook-runtime.ts";
import { claudePath, isoNow } from "../lib/platform.ts";
import { redactSecrets } from "../lib/redact.ts";

const HOOK_VERSION = "1.0.0";
const LOG_FILE = claudePath("safety-net.log");

// --- Utilities ------------------------------------------------------------
//
// Secret redaction moved to src/lib/redact.ts (canonical, shared with
// codex.ts and log-bash.ts) — see M23 in docs/audits/codebase-audit-2026-07-08.md.

async function logBlocked(cmd: string, reason: string): Promise<void> {
  const redacted = redactSecrets(cmd);
  const timestamp = isoNow();
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

// Quote-aware tokenizer: groups double/single-quoted spans into a single
// token (dequoted) instead of splitting on the whitespace inside them, so
// `rm -rf "$HOME/Library/Application Support"` reads as ONE target token
// instead of three naive whitespace-split fragments (the last of which would
// otherwise win via extractRmTarget's last-token heuristic and be misread as
// a harmless relative path).
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

function extractRmTarget(args: string): string {
  let result = "";
  for (const raw of tokenizeArgs(args)) {
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

function startsWithHomePath(target: string): boolean {
  return HOME_PATH_PREFIXES.some((p) => target.startsWith(p));
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

  const target = extractRmTarget(rmPortion);
  if (!target) block("rm -rf with no clear target path", cmd);

  // ALWAYS BLOCK: dangerous root/home/cwd paths.
  if (target === "/" || target === "/*") block("rm -rf targeting root filesystem", cmd);
  if (target === "~" || target === "~/" || target === "~/*")
    block("rm -rf targeting home directory", cmd);
  if (target === "." || target === "./") block("rm -rf targeting current directory", cmd);
  if (target === ".." || target === "../") block("rm -rf targeting parent directory", cmd);
  if (isExactHomePath(target)) {
    block("rm -rf targeting home directory", cmd);
  }

  // ALLOW: safe temp directories.
  if (target.startsWith("/tmp/") || target.startsWith("/var/tmp/")) return;

  // ALLOW: known build-artifact directories.
  const base = target.split(/[\\/]/).pop() ?? target;
  if (ALLOWED_RM_BASES.has(base)) return;

  // ALLOW: absolute paths under PWD.
  const pwd = process.cwd();
  if (pwd && target.startsWith(`${pwd}/`)) return;

  // ALLOW: relative paths within the project (no /, ~, $HOME, ..).
  if (
    !target.startsWith("/") &&
    !target.startsWith("~") &&
    !startsWithHomePath(target) &&
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
  /^(--bare|--no-pager|--no-replace-objects)\s*/, // boolean flags
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
      const padded = ` ${subargs} `;
      if (/(^|\s)--force(\s|$)/.test(padded))
        block("git push --force can overwrite remote history", cmd);
      // Bundled short flags: `-uf`, `-fu`, etc. all include a force flag
      // even though the literal string "-f" never appears standalone.
      if (/(^|\s)-[a-zA-Z]*f[a-zA-Z]*(\s|$)/.test(padded))
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
  if (depth >= MAX_DEPTH) return;

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

// --- Rule: multi-command splitting ---------------------------------------
//
// Rules fall into two tiers with opposite scope requirements:
//
//   • Full-string rules (attribution, find/xargs, shell + interpreter unwrap)
//     must see the command BEFORE the lossy split. Multi-line commit bodies
//     and quoted `bash -c '...'` / `python -c '...'` payloads routinely span
//     `;`/`&&`/`||`, and these patterns are detected anywhere in the string —
//     they never benefit from splitting, only suffer from it.
//
//   • Per-segment rules (rm, git) must run on EACH segment, because their
//     parsers latch onto the first subcommand: `git checkout -b x &&
//     git checkout -- .` looks safe to checkGitDestructive on the full string
//     (it sees `checkout -b`) but is destructive in its second segment.
//
// Splitting on quotes-unaware delimiters is intentional: full-string rules
// already ran on the intact command, so a mangled segment can only ever cause
// an additional rm/git match, never miss one.
//
// Bare newlines (and the Unicode line/paragraph separators) are treated as
// command separators too — `rm -rf /\nrm -rf node_modules` is one string with
// no `;`/`&&`/`||`, but two distinct shell commands. checkRmRf/checkGitDestructive
// evaluate every occurrence within a segment regardless (defense in depth for
// paths that reach them without going through this split, e.g. bash -c/-e
// unwrap), but splitting here keeps segment boundaries as tight as possible.
// checkAiAttribution intentionally still runs on the UNSPLIT full string
// (analyzeFullString) since multi-line commit bodies rely on that.

function analyzeFullString(cmd: string): void {
  checkAiAttribution(cmd);
  checkFindXargs(cmd);
  unwrapAndAnalyze(cmd, 0);
  checkInterpreterOneliners(cmd, 0);
}

function analyzeSegment(cmd: string): void {
  checkRmRf(cmd);
  checkGitDestructive(cmd);
}

// Built via new RegExp so \uNNNN escapes stay as explicit codepoints in the
// source text rather than invisible literal characters (encoding-safe;
// mirrors src/lib/audit-hooks.ts's COMPOUND_SEP).
const SEGMENT_SPLIT_RE = /\s*(?:&&|\|\||;|\r?\n|\r|\u2028|\u2029)\s*/;

function splitCommands(cmd: string): void {
  analyzeFullString(cmd);
  for (const raw of cmd.split(SEGMENT_SPLIT_RE)) {
    const seg = raw.trim();
    if (seg) analyzeSegment(seg);
  }
}

// --- Recursion target -----------------------------------------------------
//
// Inner commands extracted from `bash -c '...'` or interpreter one-liners are
// fresh command strings with quotes intact, so the full destructive battery is
// re-run on them (depth-bounded by MAX_DEPTH). Attribution is omitted: it has
// already matched against the outer string, which contains the inner verbatim.

function analyzeCommand(cmd: string, depth: number): void {
  checkRmRf(cmd);
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
      blockDecision(`[Safety Net] ${err.reason}`);
    }
    // Unexpected: fail-open.
    return;
  }
}

await main();
