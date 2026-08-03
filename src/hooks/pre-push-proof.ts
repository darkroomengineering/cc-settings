#!/usr/bin/env bun
// PreToolUse hook on `git push*`: run the project's full proof gate
// (typecheck + test + lint, detected from package.json) and BLOCK the push
// when it's red.
//
// Why here: pre-pr-proof.ts gates `gh pr create`/`gh pr ready`, but repos that
// push straight to `main` (including cc-settings itself) never hit that PR
// boundary — their only local gate was commit-time tsc (pre-commit-tsc.ts).
// This adds the full battery at the push boundary specifically to catch that
// straight-to-main flow. Feature-branch pushes get double-gated (push, then
// later PR-ready) — accepted, since pushes are rare enough that the ~30s
// battery doesn't hurt.
//
// Scope is deliberately narrow:
//   - No exemption for branch or remote — gating every push, including
//     feature branches, is the point (straight-to-main is what this closes).
//   - `--dry-run` / `-n` are EXEMPT — nothing is actually pushed.
//   - `--help` is EXEMPT — informational, not a push.
//   - Exemption tokens are matched exact-token, not substring, so a REAL push
//     like `git push --push-option=--dry-run origin main` still gates (the
//     `--dry-run` there is text inside a different flag's value, not the
//     standalone dry-run flag).
//
// Accepted semantics: the battery verifies the CURRENT working tree (same as
// pre-pr-proof.ts), not the ref actually being pushed. `git push origin
// other-branch:main` runs the battery against HEAD, not `other-branch`. This
// mirrors pre-pr-proof's identical limitation and is accepted rather than
// solved — checking out/verifying the pushed ref would require a worktree
// dance disproportionate to the risk.
//
// Portability: invokes the INSTALLED proof runner (~/.claude/src/scripts/proof.ts),
// which detects the CURRENT project's own package.json scripts and exits 0 when
// a repo has no verify scripts — so non-JS / script-less repos pass through
// transparently. (Do NOT shell out to `bun run proof`: that script only exists
// in the cc-settings repo, not in the consumer repos this hook runs in.)
//
// Block protocol: a red gate calls blockDecision() (JSON decision + exit 2), the
// documented PreToolUse block signal — a plain non-zero exit does NOT block.
// Fail-open on infrastructure errors only (couldn't spawn the runner): a hook
// bug must never wedge a push.
//
// Deliberately NOT deduped against pre-pr-proof.ts: a fresh battery runs at
// each boundary crossed (push, then PR-ready) rather than caching a verdict
// across them — proof.ts caches nothing, and a push can happen without a PR
// ever following (or vice versa), so there's no single result to share.

import { blockDecision, runHook } from "../lib/hook-runtime.ts";

/** Split a command line on unquoted shell separators (&&, ||, ;, &, |,
 *  newline). A naive `cmd.split(/&&|\|\||[;&|\n]/)` also splits INSIDE quoted
 *  strings — `echo "safe; git push"` would wrongly produce a ` git push`
 *  segment and get gated. This walks the string tracking single/double-quote
 *  state and only splits when unquoted. Not a full shell parser (no escape
 *  handling, no nested substitution) — just enough to stop quoted separators
 *  from being mistaken for real ones. Exported for the splitter tests. */
export function splitShellSegments(cmd: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "&" || ch === "|" || ch === ";" || ch === "\n") {
      if ((ch === "&" || ch === "|") && cmd[i + 1] === ch) i++; // swallow && / ||
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

/** True if one shell segment is a `git push` invocation that should be gated.
 *  Tokenizes on whitespace and walks past, in order: leading `VAR=value` env
 *  assignments, an optional `command` builtin prefix, the literal `git`, then
 *  a tolerant loop of git global options before the `push` subcommand —
 *  covers `git -C child push`, `git -c k=v push`, `command git push`,
 *  `GIT_TRACE=1 git push`, `git --git-dir=… push`, etc. The loop treats any
 *  `-flag` optionally followed by a bare value token as one global option, so
 *  it never needs to special-case every git global flag — over-matching (a
 *  false gate on a non-push git invocation with an unusual flag/arg shape) is
 *  acceptable; missing a real push is not.
 *
 *  Exemption check on the tail (everything after `push`) is exact-token, not
 *  substring — `--push-option=--dry-run` must NOT exempt a real push just
 *  because `--dry-run` appears inside a different flag's value. Exported for
 *  the exemption tests. */
function segmentIsGatedPush(seg: string): boolean {
  const tokens = seg.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i] as string)) i++;
  if (tokens[i] === "command") i++;
  if (tokens[i] !== "git") return false;
  i++;
  while (i < tokens.length && tokens[i] !== "push") {
    const tok = tokens[i] as string;
    if (!tok.startsWith("-")) return false; // not a recognized global-option shape
    i++;
    // Tolerantly consume a following bare token as this flag's value (`-C
    // child`, `-c k=v`, `--exec-path /path`) — but never swallow `push` itself.
    if (i < tokens.length && !(tokens[i] as string).startsWith("-") && tokens[i] !== "push") i++;
  }
  if (tokens[i] !== "push") return false; // ran out of tokens before finding `push`
  const tail = tokens.slice(i + 1);
  if (tail.some((t) => t === "--dry-run" || t === "-n" || t === "--help")) return false;
  return true;
}

/** Whether the full command line should trigger the proof gate. Splits on
 *  unquoted shell separators and gates if ANY segment is a non-exempt push,
 *  so an exempt one (`… --dry-run`) can't shadow a gated one (`… && git
 *  push`). Exported for the exemption tests. */
export function shouldGate(cmd: string): boolean {
  return splitShellSegments(cmd).some((seg) => segmentIsGatedPush(seg));
}

async function main(): Promise<void> {
  // Self-gate: the group-level `if:` filter isn't reliably applied by every
  // Claude Code build (see pre-commit-tsc.ts), so re-check the command here.
  const cmd = process.env.TOOL_INPUT_command ?? "";
  if (!shouldGate(cmd)) return; // allow

  const proc = Bun.spawn(["bun", `${process.env.HOME}/.claude/src/scripts/proof.ts`], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code === 0) return; // green, or no verify scripts → allow

  const combined = `${out}${err}`;
  // Distinguish a genuine red gate from a runner that couldn't execute (missing
  // or broken proof.ts → nonzero bun exit with no proof report). Only block on a
  // recognizable proof verdict; otherwise fail-open — never block a push on infra.
  if (!/Proof of work:|review-ready/.test(combined)) return;

  const report = combined.trimEnd().split("\n").slice(-30).join("\n");
  blockDecision(
    "Pre-push proof gate: verification is red — not review-ready. Fix the failing " +
      `gate below, then push again. Reproduce with: bun "$HOME/.claude/src/scripts/proof.ts"\n\n${report}`,
  ); // emits the block decision + exit 2
}

// Guard the self-execution so tests can import shouldGate without running the
// gate (and calling process.exit).
if (import.meta.main) {
  // Couldn't spawn the runner (bun missing, etc.) — fail-open, never block a
  // push on a hook bug. A genuine red gate calls blockDecision() (exit 2) inside main.
  await runHook(main);
  process.exit(0);
}
