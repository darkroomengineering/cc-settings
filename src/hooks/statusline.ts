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
import { z } from "zod";
import { readCodexVerdict } from "../lib/codex.ts";
import { RAW_SEQUENCES } from "../lib/colors.ts";

// NOT lib/colors.ts's `palette`: that one gates every code on
// `process.stdout.isTTY`, and Claude Code captures the statusline via a pipe
// (isTTY false) — so the gated palette renders the whole statusline gray.
// Claude Code DOES interpret ANSI in statusline output, so gate only on
// NO_COLOR here. The VALUES stay single-sourced in colors.ts (RAW_SEQUENCES).
const NO = process.env.NO_COLOR === "1";
const c = (code: string): string => (NO ? "" : code);
const palette = {
  red: c(RAW_SEQUENCES.red),
  green: c(RAW_SEQUENCES.green),
  yellow: c(RAW_SEQUENCES.yellow),
  cyan: c(RAW_SEQUENCES.cyan),
  dim: c(RAW_SEQUENCES.dim),
  reset: c(RAW_SEQUENCES.reset),
} as const;

import { runGit as runGitLib, runProcessFull } from "../lib/git.ts";
import { readHookInput, readState, writeState } from "../lib/hook-runtime.ts";
import { claudePath } from "../lib/platform.ts";
import { type RateLimitsCache, writeRateLimitsCache } from "../lib/quota.ts";
import {
  ageMs,
  formatAge,
  maxUnreviewed,
  type ReviewQueueState,
  ReviewQueueStateSchema,
} from "../lib/review-queue.ts";
import {
  readInstalledVersion,
  refreshSessionInstallMap,
  SESSION_INSTALL_STATE,
  SessionInstallMapSchema,
} from "../lib/version-delta.ts";

// ReviewQueueStateSchema now lives in lib/review-queue.ts, next to the
// interface it validates (N2) — imported above. Shape-validated the same way
// quota.ts's RateLimitsCacheSchema is — a malformed review-queue.json/
// version-drift.json (partial write, future schema change, tampering) must
// degrade to "absent" instead of feeding NaN/garbage into the visible statusline.
const VersionDriftSchema = z.object({
  stale: z.boolean().optional(),
  installed: z.string().nullable().optional(),
});

// session_id → version map (SessionInstallMapSchema, imported): the PRIMARY
// writer is session-start.ts, which refreshes the entry on every launch and
// resume; the write in this file is a first-render FALLBACK for sessions that
// never got a SessionStart refresh.

type Payload = {
  session_id?: string;
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
  //
  // The two `diff --quiet` dirty checks go through runProcessFull (same
  // GIT_TIMEOUT_MS + SIGKILL bound as every other git spawn in the codebase)
  // instead of a raw Bun.spawn — a hung diff filter/textconv or a
  // network-mounted working tree must not block the whole statusline forever.
  const [branch, dirtyUnstaged, dirtyStaged, counts] = await Promise.all([
    runGit(["branch", "--show-current"], cwd),
    runProcessFull("git", ["-C", cwd, "--no-optional-locks", "diff", "--quiet"]),
    runProcessFull("git", ["-C", cwd, "--no-optional-locks", "diff", "--cached", "--quiet"]),
    // Ahead/behind in ONE spawn: `--left-right --count @{upstream}...HEAD`
    // prints "<behind>\t<ahead>" (left = upstream-only commits, right =
    // HEAD-only). No upstream → git errors → "" (same fallback as the old
    // two-spawn version).
    runGit(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd),
  ]);
  if (!branch) return null;

  const dirty =
    dirtyUnstaged.exit !== 0 || dirtyStaged.exit !== 0 ? `${palette.yellow}✱${palette.reset}` : "";

  let upstream = "";
  if (counts) {
    const [behind = "", ahead = ""] = counts.split(/\s+/);
    if (Number(ahead) > 0) upstream += "↑";
    if (Number(behind) > 0) upstream += "↓";
  }

  return `${palette.cyan}${branch}${palette.reset}${dirty}${upstream}`;
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

const dimSep = `${palette.dim} | ${palette.reset}`;

function cacheResetValue(value: number | string | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

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
  const weeklyRateUsed = input.rate_limits?.seven_day?.used_percentage;

  if (input.rate_limits) {
    try {
      const cache: RateLimitsCache = {
        five_hour: input.rate_limits.five_hour
          ? {
              used_percentage: input.rate_limits.five_hour.used_percentage,
              resets_at: cacheResetValue(input.rate_limits.five_hour.resets_at),
            }
          : undefined,
        seven_day: input.rate_limits.seven_day
          ? {
              used_percentage: input.rate_limits.seven_day.used_percentage,
              resets_at: cacheResetValue(input.rate_limits.seven_day.resets_at),
            }
          : undefined,
        updated_at: Date.now(),
      };
      await writeRateLimitsCache(cache);
    } catch {
      // Statusline rendering must stay fail-open; quota steering can miss a sample.
    }
  }

  const effortLevel = input.effort?.level;
  const thinkingEnabled = input.thinking?.enabled === true;

  const parts: string[] = [];
  if (model) {
    // Suffix model with effort marker — e.g. "Opus 4.8 ⚙xhigh" or "Opus 4.8 ⚙xhigh+".
    // `+` = thinking enabled. Used `+` instead of `†` (dagger) because the dagger
    // glyph reads as a "t" in many monospace terminal fonts, making "xhigh†" look
    // like "xhight".
    const marker = effortLevel
      ? `${palette.dim} ⚙${effortLevel}${thinkingEnabled ? "+" : ""}${palette.reset}`
      : "";
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
    const color = rInt >= 80 ? palette.red : rInt >= 50 ? palette.yellow : palette.green;
    const ttr = rateResetsAt ? formatTimeToReset(rateResetsAt) : null;
    const suffix = ttr ? `${palette.dim} ↻${ttr}${palette.reset}` : "";
    parts.push(`${color}⚡${rInt}%${palette.reset}${suffix}`);
  }

  if (weeklyRateUsed !== undefined && weeklyRateUsed >= 50) {
    const wInt = Math.round(weeklyRateUsed);
    const color = wInt >= 80 ? palette.red : palette.yellow;
    parts.push(`${color}wk${wInt}%${palette.reset}`);
  }

  // Review-queue backpressure: agents spawned since the last commit, awaiting
  // your review (written by tool-cadence.ts). Suppressed at 0 — yellow
  // under the threshold, red at/over CC_MAX_UNREVIEWED.
  const reviewQueueRaw = await readState<unknown>("review-queue.json", null);
  const reviewQueueParsed = ReviewQueueStateSchema.safeParse(reviewQueueRaw);
  const reviewQueue: ReviewQueueState = reviewQueueParsed.success
    ? reviewQueueParsed.data
    : { awaiting: 0 };
  if (reviewQueue.awaiting > 0) {
    const color = reviewQueue.awaiting >= maxUnreviewed() ? palette.red : palette.yellow;
    const age = ageMs(reviewQueue, Date.now());
    const ageLabel = age > 0 ? ` (${formatAge(age)})` : "";
    parts.push(`${color}⚠ ${reviewQueue.awaiting} review${ageLabel}${palette.reset}`);
  }

  // cc-settings install staleness — surfaced only when the cached SessionStart
  // drift check found the repo's packaged version ahead of what's installed.
  // Suppressed otherwise (like the review queue), so it costs nothing when current.
  const driftRaw = await readState<unknown>("version-drift.json", null);
  const driftParsed = VersionDriftSchema.safeParse(driftRaw);
  const drift = driftParsed.success ? driftParsed.data : { stale: false };
  if (drift.stale && drift.installed) {
    parts.push(`${palette.yellow}⬆ cc v${drift.installed}${palette.dim} stale${palette.reset}`);
  }

  // Restart-pending: the installer wrote a newer version sentinel AFTER this
  // session started. Settings/hooks/MCP/CLAUDE.md are snapshotted at launch,
  // so the running session is still on the old config — surface it here
  // (`claude -c` resumes the conversation on the new install). Inverse of the
  // ⬆ stale check above, which flags an install BEHIND the repo.
  const sessionId = input.session_id;
  const installedNow = await readInstalledVersion(claudePath());
  if (sessionId && installedNow) {
    const mapRaw = await readState<unknown>(SESSION_INSTALL_STATE, null);
    const mapParsed = SessionInstallMapSchema.safeParse(mapRaw);
    const sessionVersions = mapParsed.success ? mapParsed.data : {};
    const seen = sessionVersions[sessionId];
    if (!seen) {
      // Fallback recorder only — session-start.ts refreshes this entry on
      // every launch AND resume (same session_id survives a resume), which is
      // what lets the banner clear after a restart.
      await writeState(
        SESSION_INSTALL_STATE,
        refreshSessionInstallMap(sessionVersions, sessionId, installedNow, Date.now()),
      );
    } else if (seen.v !== installedNow) {
      parts.push(
        `${palette.green}⟳ v${installedNow} installed — restart Claude to apply${palette.reset}`,
      );
    }
  }

  // Codex bridge availability badge — reads the cached verdict written by
  // codex-verify.ts at SessionStart (no spawn here, hot-path safe).
  // "not-installed" and "unknown" → silent (no clutter for teammates without Codex).
  const codexVerdict = await readCodexVerdict();
  if (codexVerdict.state === "available") {
    parts.push(`${palette.green}codex ✓${palette.reset}`);
  } else if (codexVerdict.state === "unauthenticated" || codexVerdict.state === "no-access") {
    parts.push(`${palette.yellow}codex auth?${palette.reset}`);
  } else if (codexVerdict.state === "rate-limited") {
    parts.push(`${palette.yellow}codex ⏳${palette.reset}`);
  }
  // "not-installed" | "unknown" → push nothing

  process.stdout.write(`${parts.join(dimSep)}\n`);
}

try {
  await main();
} catch {
  // Degraded statusline — never blank, never a non-zero exit. If the error
  // struck before model/dirName were populated (e.g. Bun.stdin.text() itself
  // threw), fall back to a static label instead of an empty line.
  const parts = [model, dirName].filter((p) => p.length > 0);
  const line = parts.length > 0 ? parts.join(dimSep) : "claude";
  process.stdout.write(`${line}\n`);
  process.exit(0);
}
