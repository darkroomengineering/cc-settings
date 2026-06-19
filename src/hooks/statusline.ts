#!/usr/bin/env bun
// Statusline hook — port of scripts/statusline.sh.
// Reads statusline payload JSON from stdin, writes a single status line to
// stdout. Budget p95 < 100ms (bash baseline ~104ms → TS target ~20ms).
//
// Hardened: the whole build runs inside main() under a try/catch — any
// unexpected error (git binary missing → Bun.spawn throws synchronously,
// payload weirdness, state-file corruption) still prints a degraded
// statusline (model/cwd only) and exits 0, never a blank line.

import { existsSync } from "node:fs";
import { basename } from "node:path";
import { readCodexVerdict } from "../lib/codex.ts";
import { runGit as runGitLib } from "../lib/git.ts";
import { readHookInput, readState } from "../lib/hook-runtime.ts";
import { ageMs, formatAge, maxUnreviewed, type ReviewQueueState } from "../lib/review-queue.ts";

type Payload = {
  model?: { display_name?: string };
  workspace?: { current_dir?: string };
  context_window?: {
    used_percentage?: number;
    context_window_size?: number;
  };
  rate_limits?: {
    five_hour?: {
      used_percentage?: number;
      // Unix epoch seconds (per Claude Code statusline docs). Tolerate ISO
      // strings too — older Claude Code builds emitted them and our tests
      // used to mock with ISO.
      resets_at?: number | string;
    };
    seven_day?: {
      used_percentage?: number;
      resets_at?: number | string;
    };
  };
  // 2.1.119 — effort level + thinking flag are now in statusline stdin.
  effort?: { level?: string };
  thinking?: { enabled?: boolean };
};

function formatTokens(n: number): string {
  if (n > 500_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

// Statusline git reads are hot-path and read-only: --no-optional-locks avoids
// contending with a concurrent git process holding the index lock. The spawn
// itself lives in lib/git.ts; this adapter just binds the flag + working tree.
async function runGit(args: string[], cwd: string): Promise<string> {
  return runGitLib(["--no-optional-locks", ...args], { cwd });
}

async function buildGitStatus(cwd: string): Promise<string | null> {
  if (!existsSync(cwd)) return null;

  // No `rev-parse --git-dir` probe: `git branch --show-current` already
  // returns "" outside a repo (runGit swallows errors), which short-circuits
  // below. All four lookups are independent — one parallel wave instead of
  // three sequential rounds.
  const [branch, dirtyUnstaged, dirtyStaged, counts] = await Promise.all([
    runGit(["branch", "--show-current"], cwd),
    Bun.spawn(["git", "-C", cwd, "--no-optional-locks", "diff", "--quiet"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited,
    Bun.spawn(["git", "-C", cwd, "--no-optional-locks", "diff", "--cached", "--quiet"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited,
    // Ahead/behind in ONE spawn: `--left-right --count @{upstream}...HEAD`
    // prints "<behind>\t<ahead>" (left = upstream-only commits, right =
    // HEAD-only). No upstream → git errors → "" (same fallback as the old
    // two-spawn version).
    runGit(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd),
  ]);
  if (!branch) return null;

  const cyan = "\x1b[36m";
  const yellow = "\x1b[33m";
  const reset = "\x1b[0m";

  const dirty = dirtyUnstaged !== 0 || dirtyStaged !== 0 ? `${yellow}✱${reset}` : "";

  let upstream = "";
  if (counts) {
    const [behind = "", ahead = ""] = counts.split(/\s+/);
    if (Number(ahead) > 0) upstream += "↑";
    if (Number(behind) > 0) upstream += "↓";
  }

  return `${cyan}${branch}${reset}${dirty}${upstream}`;
}

function formatTimeToReset(value: number | string): string | null {
  // Claude Code emits Unix epoch *seconds* (integer). Anything ≥ 1e9 is
  // clearly seconds, not milliseconds, and not a meaningful ISO date.
  let resetMs: number;
  if (typeof value === "number") {
    resetMs = value > 1e12 ? value : value * 1000;
  } else {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 1e9) {
      resetMs = asNum > 1e12 ? asNum : asNum * 1000;
    } else {
      resetMs = Date.parse(value);
    }
  }
  if (Number.isNaN(resetMs)) return null;
  const deltaMs = resetMs - Date.now();
  if (deltaMs <= 0) return null;
  const totalMin = Math.round(deltaMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}

const dimSep = "\x1b[2m | \x1b[0m";

// Degraded-path capture: filled as soon as the payload parses, so the catch
// block at the bottom can still print the model/cwd segment.
let model = "";
let dirName = "";

async function main(): Promise<void> {
  const input = await readHookInput<Payload>();

  model = input.model?.display_name ?? "";
  const currentDir = input.workspace?.current_dir ?? "";
  dirName = currentDir ? basename(currentDir) : "";

  const used = input.context_window?.used_percentage;
  const tokensAvailable = input.context_window?.context_window_size ?? 0;
  const tokensUsed = used !== undefined ? Math.round(tokensAvailable * (used / 100)) : 0;

  const gitStatus = currentDir ? await buildGitStatus(currentDir) : null;

  const rateUsed = input.rate_limits?.five_hour?.used_percentage;
  const rateResetsAt = input.rate_limits?.five_hour?.resets_at;

  const effortLevel = input.effort?.level;
  const thinkingEnabled = input.thinking?.enabled === true;

  const parts: string[] = [];
  if (model) {
    // Suffix model with effort marker — e.g. "Opus 4.8 ⚙xhigh" or "Opus 4.8 ⚙xhigh+".
    // `+` = thinking enabled. Used `+` instead of `†` (dagger) because the dagger
    // glyph reads as a "t" in many monospace terminal fonts, making "xhigh†" look
    // like "xhight".
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
    const marker = effortLevel ? `${dim} ⚙${effortLevel}${thinkingEnabled ? "+" : ""}${reset}` : "";
    parts.push(`${model}${marker}`);
  }
  if (dirName) parts.push(dirName);
  if (gitStatus) parts.push(gitStatus);

  if (used !== undefined) {
    const usedInt = Math.round(used);
    const filled = Math.floor(usedInt / 10);
    const empty = 10 - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    parts.push(`${bar} ${usedInt}% (${formatTokens(tokensUsed)}/${formatTokens(tokensAvailable)})`);
  }

  if (rateUsed !== undefined) {
    const rInt = Math.round(rateUsed);
    const red = "\x1b[31m";
    const yellow = "\x1b[33m";
    const green = "\x1b[32m";
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
    const color = rInt >= 80 ? red : rInt >= 50 ? yellow : green;
    const ttr = rateResetsAt ? formatTimeToReset(rateResetsAt) : null;
    const suffix = ttr ? `${dim} ↻${ttr}${reset}` : "";
    parts.push(`${color}⚡${rInt}%${reset}${suffix}`);
  }

  // Review-queue backpressure: agents spawned since the last commit, awaiting
  // your review (written by tool-cadence.ts). Suppressed at 0 — yellow
  // under the threshold, red at/over CC_MAX_UNREVIEWED.
  const reviewQueue = await readState<ReviewQueueState>("review-queue.json", { awaiting: 0 });
  if (reviewQueue.awaiting > 0) {
    const yellow = "\x1b[33m";
    const red = "\x1b[31m";
    const reset = "\x1b[0m";
    const color = reviewQueue.awaiting >= maxUnreviewed() ? red : yellow;
    const age = ageMs(reviewQueue, Date.now());
    const ageLabel = age > 0 ? ` (${formatAge(age)})` : "";
    parts.push(`${color}⚠ ${reviewQueue.awaiting} review${ageLabel}${reset}`);
  }

  // cc-settings install staleness — surfaced only when the cached SessionStart
  // drift check found the repo's packaged version ahead of what's installed.
  // Suppressed otherwise (like the review queue), so it costs nothing when current.
  const drift = await readState<{ stale?: boolean; installed?: string | null }>(
    "version-drift.json",
    { stale: false },
  );
  if (drift.stale && drift.installed) {
    const yellow = "\x1b[33m";
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
    parts.push(`${yellow}⬆ cc v${drift.installed}${dim} stale${reset}`);
  }

  // Codex bridge availability badge — reads the cached verdict written by
  // codex-verify.ts at SessionStart (no spawn here, hot-path safe).
  // "not-installed" and "unknown" → silent (no clutter for teammates without Codex).
  const codexVerdict = await readCodexVerdict();
  {
    const green = "\x1b[32m";
    const yellow = "\x1b[33m";
    const reset = "\x1b[0m";
    if (codexVerdict.state === "available") {
      parts.push(`${green}codex ✓${reset}`);
    } else if (codexVerdict.state === "unauthenticated" || codexVerdict.state === "no-access") {
      parts.push(`${yellow}codex auth?${reset}`);
    } else if (codexVerdict.state === "rate-limited") {
      parts.push(`${yellow}codex ⏳${reset}`);
    }
    // "not-installed" | "unknown" → push nothing
  }

  process.stdout.write(`${parts.join(dimSep)}\n`);
}

try {
  await main();
} catch {
  // Degraded statusline — never blank, never a non-zero exit.
  const parts = [model, dirName].filter((p) => p.length > 0);
  process.stdout.write(`${parts.join(dimSep)}\n`);
  process.exit(0);
}
