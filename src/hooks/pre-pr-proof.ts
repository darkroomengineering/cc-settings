#!/usr/bin/env bun
// PreToolUse hook on `gh pr create` / `gh pr ready`: run the project's full
// proof gate (typecheck + test + lint, detected from package.json) and BLOCK
// opening/ready-ing a PR when it's red.
//
// Why here: opening a PR is the "this is ready for review" signal — the point
// past which red tests become a reviewer's problem and a red-CI fix-forward
// loop (the #1 recurring friction in the team's usage). A commit-time typecheck
// already exists (pre-commit-tsc.ts); this adds the full test+lint suite at the
// readiness boundary, without gating frequent WIP pushes.
//
// Scope is deliberately narrow:
//   - Feature-branch `git push` stays UNGATED — WIP pushes are fine.
//   - `gh pr create --draft` is EXEMPT — a draft is explicitly not-ready
//     (but `--draft=false` / `--draft false` is a real PR and IS gated).
//   - `gh pr ready` (promoting a draft) IS gated — that's the ready signal —
//     except `gh pr ready --undo`, which reverts a PR back to draft.
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
// bug must never wedge PR creation.

import { blockDecision, runHook } from "../lib/hook-runtime.ts";

/** True if one shell segment is a `gh pr create/ready` invocation that should be
 *  gated. Matches `gh` with optional global options before `pr` (e.g.
 *  `gh -R owner/repo pr create`). Exempts an enabled draft (`--draft` / `-d`,
 *  but not `--draft=false` / `--draft false`) and `gh pr ready --undo`. */
function segmentIsGatedReadiness(seg: string): boolean {
  const m = seg.match(/\bgh\b[^\n]*?\bpr\s+(create|ready)\b(.*)$/s);
  if (!m) return false;
  const sub = m[1];
  const tail = m[2] ?? "";
  // `gh pr ready --undo` reverts a PR to draft — not a readiness promotion.
  if (sub === "ready" && /--undo\b/.test(tail)) return false;
  // A draft create is explicitly not-ready — exempt unless the flag is disabled.
  const draftEnabled =
    (/--draft\b/.test(tail) || /(?:^|\s)-d\b/.test(tail)) && !/--draft(?:=|\s+)false\b/.test(tail);
  if (sub === "create" && draftEnabled) return false;
  return true;
}

/** Whether the full command line should trigger the proof gate. Splits on shell
 *  separators and gates if ANY segment is a non-exempt readiness invocation, so
 *  an exempt one (`… --draft`) can't shadow a gated one (`… && gh pr ready`).
 *  Exported for the exemption tests. */
export function shouldGate(cmd: string): boolean {
  return cmd.split(/&&|\|\||[;&|\n]/).some((seg) => segmentIsGatedReadiness(seg));
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
  // recognizable proof verdict; otherwise fail-open — never block a PR on infra.
  if (!/Proof of work:|review-ready/.test(combined)) return;

  const report = combined.trimEnd().split("\n").slice(-30).join("\n");
  blockDecision(
    "Pre-PR proof gate: verification is red — not review-ready. Fix the failing " +
      "gate below, or open a draft (gh pr create --draft) if this is intentional " +
      `WIP.\n\n${report}`,
  ); // emits the block decision + exit 2
}

// Guard the self-execution so tests can import shouldGate without running the
// gate (and calling process.exit).
if (import.meta.main) {
  // Couldn't spawn the runner (bun missing, etc.) — fail-open, never block a PR
  // on a hook bug. A genuine red gate calls blockDecision() (exit 2) inside main.
  await runHook(main);
  process.exit(0);
}
