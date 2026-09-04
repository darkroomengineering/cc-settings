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
import { readHookInput, readValidatedState, writeState } from "../lib/hook-runtime.ts";
import { claudePath } from "../lib/platform.ts";
import {
  computeBand,
  formatTimeToReset,
  mergeSessionRateLimits,
  type RateLimitsCache,
  readRateLimitsCache,
  resolveRateLimits,
  type SessionRateLimits,
  writeRateLimitsCache,
} from "../lib/quota.ts";
import {
  ageMs,
  formatAge,
  maxUnreviewed,
  type ReviewQueueState,
  ReviewQueueStateSchema,
} from "../lib/review-queue.ts";
import {
  refreshSessionModelMap,
  SESSION_MODEL_STATE,
  SessionModelMapSchema,
} from "../lib/session-model.ts";
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
    // 2.1.251, gateway-only — used_percentage can exceed 100. Type-only: no
    // visual segment reads this yet.
    spend_limit?: { used_percentage?: number; resets_at?: number | string };
  };
  // 2.1.119 — effort level + thinking flag are now in statusline stdin.
  effort?: { level?: string };
  thinking?: { enabled?: boolean };
  // 2.1.251 — prompt-cache diagnostics. Absent until the main conversation's
  // first API response; subagent requests are not counted.
  prompt_cache?: {
    warm?: boolean;
    caching_observed?: boolean;
    ttl?: "5m" | "1h" | string;
    expires_at?: number | null;
    requests?: number;
    misses?: number;
    expected_rebuilds?: number;
    hit_ratio?: number | null;
    cache_write_tokens?: number;
    miss_recache_tokens?: number;
    last_miss_at?: number | null;
    // 2.1.260 — client-side diagnosis of the most recent miss. `causes` is a
    // closed set: system_prompt_changed, tools_changed, model_changed,
    // messages_rewritten, ttl_expired_5m, ttl_expired_1h, likely_server_side,
    // unknown. Null when nothing was diagnosed.
    last_miss_cause?: {
      causes?: string[];
      tools_added?: number;
      tools_removed?: number;
      system_char_delta?: number;
    } | null;
    // 2.1.260 — misses per diagnosed cause this session (same cause names).
    miss_causes?: Record<string, number>;
    recache_tokens_if_cold?: number | null;
  };
};

function formatTokens(n: number): string {
  if (n > 500_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

// Programa renders the same 5h/7d quota numbers in its own sidebar, so the ⚡
// chip below is suppressed there — same fact twice, and the statusline is the
// more crowded of the two surfaces. Every other terminal has no second quota
// surface, so the chip is the only signal and it renders.
const IN_PROGRAMA = Boolean(process.env.PROGRAMA_SURFACE_ID);

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
  const sessionId = input.session_id;

  const used = input.context_window?.used_percentage;
  const tokensAvailable = input.context_window?.context_window_size ?? 0;
  const tokensUsed = used !== undefined ? Math.round(tokensAvailable * (used / 100)) : 0;

  const gitStatus = currentDir ? await buildGitStatus(currentDir) : null;

  // Per-session write: this hot path renders from EVERY concurrent workspace,
  // and each one only ever sees its OWN rate_limits reading in the payload.
  // A flat single-object overwrite here is a last-writer-wins clobber across
  // N workspaces — the bug this per-session map fixes. Each session's own
  // reading is stored under its session_id in `sessions`; the top-level
  // five_hour/seven_day/updated_at are then DERIVED (max-of-fresh via
  // resolveRateLimits) rather than "whoever wrote last", for Programa's
  // ClaudeQuotaSnapshotParser (programa repo, Sources/ClaudeQuotaMonitor.swift)
  // which only reads those three top-level keys and ignores `sessions`.
  // Gated on sessionId, same as the SESSION_MODEL_STATE/SESSION_INSTALL_STATE
  // writes below — a payload without one can't be keyed per-session.
  if (input.rate_limits && sessionId) {
    try {
      const sessionEntry: SessionRateLimits = {
        five_hour: input.rate_limits.five_hour
          ? {
              used_percentage: input.rate_limits.five_hour.used_percentage,
              resets_at: cacheResetValue(input.rate_limits.five_hour.resets_at),
            }
          : undefined,
        // Parsed and cached here only to feed quota-steer.ts's routing
        // guidance — no visual segment in this file consumes it.
        seven_day: input.rate_limits.seven_day
          ? {
              used_percentage: input.rate_limits.seven_day.used_percentage,
              resets_at: cacheResetValue(input.rate_limits.seven_day.resets_at),
            }
          : undefined,
        updated_at: Date.now(),
      };
      const existing = await readRateLimitsCache();
      const sessions = mergeSessionRateLimits(existing?.sessions ?? {}, sessionId, sessionEntry);
      const now = Date.now();
      const derived = resolveRateLimits(sessions, now) ?? { updated_at: now };
      const cache: RateLimitsCache = {
        five_hour: derived.five_hour,
        seven_day: derived.seven_day,
        updated_at: derived.updated_at,
        sessions,
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

  // Rate-limit headroom — rendered everywhere EXCEPT Programa (see IN_PROGRAMA).
  //
  // IMPORTANT: the gate drops only the *display*. This ⚡ chip renders straight
  // from `input.rate_limits` — THIS session's own live payload from Claude
  // Code, never the shared cache — so it can't be clobbered by another
  // workspace. The read of `input.rate_limits` and the per-session
  // `writeRateLimitsCache` call above stay unconditional regardless of
  // IN_PROGRAMA — that cache file is what Programa's sidebar and
  // quota-steer.ts both read, and statusline is what keeps it fresh between
  // sessions (session-start.ts only refreshes it on launch and resume).
  // Gating the write would leave the sidebar showing stale numbers from
  // whenever the last session started.
  // Codex bridge availability — read here (rather than at its original spot
  // near the bottom) so the ⚡ chip below can append a "→codex" routing badge
  // when quota is exhausted and Codex is available to absorb the work.
  const codexVerdict = await readCodexVerdict();

  if (!IN_PROGRAMA) {
    const rateUsed = input.rate_limits?.five_hour?.used_percentage;
    if (rateUsed !== undefined) {
      const rInt = Math.round(rateUsed);
      const color = rInt >= 80 ? palette.red : rInt >= 50 ? palette.yellow : palette.green;
      const ttr = formatTimeToReset(input.rate_limits?.five_hour?.resets_at);
      const band = computeBand(
        input.rate_limits?.five_hour?.used_percentage,
        input.rate_limits?.seven_day?.used_percentage,
      );
      const routing =
        band === "exhausted" && codexVerdict.state === "available"
          ? ` ${palette.red}→codex${palette.reset}`
          : "";
      const suffix = ttr ? `${palette.dim} ↻${ttr}${palette.reset}` : "";
      parts.push(`${color}⚡${rInt}%${palette.reset}${routing}${suffix}`);
    }
  }

  // Prompt-cache hit ratio (2.1.251) — cheapest cache diagnostic we can give
  // users, since the default model prices cache reads far below base. Shown
  // on every terminal, including Programa: it's cache stats, not quota, so
  // the IN_PROGRAMA suppression above (which is quota-specific) doesn't apply.
  // Suppressed until 3 requests have landed — too early to be meaningful.
  const cache = input.prompt_cache;
  if (
    cache &&
    cache.caching_observed === true &&
    cache.hit_ratio !== null &&
    cache.hit_ratio !== undefined &&
    (cache.requests ?? 0) >= 3
  ) {
    const pct = Math.round(cache.hit_ratio * 100);
    const color =
      cache.hit_ratio >= 0.8
        ? palette.green
        : cache.hit_ratio >= 0.5
          ? palette.yellow
          : palette.red;
    // When the prefix is cold, name the diagnosed cause (2.1.260) so the user
    // can tell a TTL expiry from a tools/system-prompt change they triggered.
    const cause = cache.warm === false ? cache.last_miss_cause?.causes?.[0] : undefined;
    const coldSuffix =
      cache.warm === false ? `${palette.dim} cold${cause ? ` ${cause}` : ""}${palette.reset}` : "";
    parts.push(`${color}♻${pct}%${palette.reset}${coldSuffix}`);
  }

  // Review-queue backpressure: agents spawned since the last commit, awaiting
  // your review (written by tool-cadence.ts). Suppressed at 0 — yellow
  // under the threshold, red at/over CC_MAX_UNREVIEWED.
  const reviewQueue: ReviewQueueState = await readValidatedState(
    "review-queue.json",
    ReviewQueueStateSchema,
    {
      awaiting: 0,
    },
  );
  if (reviewQueue.awaiting > 0) {
    const color = reviewQueue.awaiting >= maxUnreviewed() ? palette.red : palette.yellow;
    const age = ageMs(reviewQueue, Date.now());
    const ageLabel = age > 0 ? ` (${formatAge(age)})` : "";
    parts.push(`${color}⚠ ${reviewQueue.awaiting} review${ageLabel}${palette.reset}`);
  }

  // cc-settings install staleness — surfaced only when the cached SessionStart
  // drift check found the repo's packaged version ahead of what's installed.
  // Suppressed otherwise (like the review queue), so it costs nothing when current.
  const drift = await readValidatedState("version-drift.json", VersionDriftSchema, {
    stale: false,
  });
  if (drift.stale && drift.installed) {
    parts.push(`${palette.yellow}⬆ cc v${drift.installed}${palette.dim} stale${palette.reset}`);
  }

  // Restart-pending: the installer wrote a newer version sentinel AFTER this
  // session started. Settings/hooks/MCP/CLAUDE.md are snapshotted at launch,
  // so the running session is still on the old config — surface it here
  // (`claude -c` resumes the conversation on the new install). Inverse of the
  // ⬆ stale check above, which flags an install BEHIND the repo.
  // sessionId was hoisted near the top of main() — reused here.
  const installedNow = await readInstalledVersion(claudePath());
  if (sessionId && installedNow) {
    const sessionVersions = await readValidatedState(
      SESSION_INSTALL_STATE,
      SessionInstallMapSchema,
      {},
    );
    const seen = sessionVersions[sessionId];
    if (!seen) {
      // Fallback recorder only — session-start.ts refreshes this entry on
      // every launch AND resume (same session_id survives a resume), which is
      // what lets the banner clear after a restart.
      // A failed state write (unwritable/full tmp) must cost this segment only,
      // never the whole render — without the catch it would bubble to main()'s
      // outer catch and degrade the statusline to model/cwd on every render.
      await writeState(
        SESSION_INSTALL_STATE,
        refreshSessionInstallMap(sessionVersions, sessionId, installedNow, Date.now()),
      ).catch(() => {});
    } else if (seen.v !== installedNow) {
      parts.push(
        `${palette.green}⟳ v${installedNow} installed — restart Claude to apply${palette.reset}`,
      );
    }
  }

  // Session model map — lets escalate-model.ts (UserPromptSubmit) know whether
  // the session is already on Fable 5 before recommending it as the
  // escalation target. Write-on-change only: a no-op read + comparison on
  // every render, a write only when this session's entry is missing or the
  // model actually changed (a mid-session model switch), never on every
  // render of an unchanged model.
  if (sessionId && model) {
    const sessionModels = await readValidatedState(SESSION_MODEL_STATE, SessionModelMapSchema, {});
    const seenModel = sessionModels[sessionId];
    if (!seenModel || seenModel.m !== model) {
      // Same rationale as the SESSION_INSTALL_STATE catch above.
      await writeState(
        SESSION_MODEL_STATE,
        refreshSessionModelMap(sessionModels, sessionId, model, Date.now()),
      ).catch(() => {});
    }
  }

  // Codex bridge availability badge — codexVerdict was read earlier (before
  // the ⚡ chip block) so this segment reuses it. "not-installed" and
  // "unknown" → silent (no clutter for teammates without Codex).
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
