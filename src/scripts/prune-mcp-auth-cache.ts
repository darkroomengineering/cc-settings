#!/usr/bin/env bun
// TTL prune for ~/.claude/mcp-needs-auth-cache.json.
//
// Works around a Claude Code CLI behavior: when an MCP server returns a
// 401/needs-auth, the CLI records it in this file and every subsequent
// session logs `Skipping connection (cached needs-auth)` without ever
// retrying — even if the underlying token has since refreshed. The cache
// has no TTL and is only cleared by explicit re-auth via `/mcp`, which
// manifests as "figma / Sanity always needs authentication again".
//
// This pruner balances two failure modes:
//   1. A server whose token genuinely recovered stays latched "needs auth"
//      forever if we never retry it — the original bug this hook fixes.
//   2. A connector the user never authenticates at all (e.g. an optional
//      "claude.ai Granola" integration) gets retried every TTL window
//      forever, and each failed retry re-surfaces a visible "needs
//      authentication" prompt — a new nuisance this hook must not cause.
//
// The fix for (1) is unconditional: drop cache entries older than
// MCP_NEEDS_AUTH_TTL_MS so a recovered token gets picked back up. The fix
// for (2) has two parts: a keep-list of server names this hook never
// touches (for connectors the user deliberately leaves unauthenticated),
// and a per-server exponential backoff sidecar so repeat failures decay
// the retry cadence toward MCP_NEEDS_AUTH_MAX_TTL_MS instead of retrying
// (and re-prompting) every hour forever.
//
// Recovery detection: after we prune an entry (prunedAt > 0), the server
// being absent from the cache is ambiguous for one run — the CLI's connect
// attempt may not have happened yet, depending on hook-vs-connect ordering
// within the session. Two consecutive runs absent (absentRuns >= 2) proves
// recovery, because a failed retry would have re-latched the cache entry by
// the second run under either ordering. Recovery drops the sidecar entry,
// resetting the server to the base TTL.
//
// If a connection genuinely still needs auth, the CLI will repopulate the
// cache entry immediately on retry, so this is safe: worst case you get one
// extra connection attempt per effective-TTL window per previously-failed
// server (until backoff or the keep-list settle it down).
//
// Hook contract: no stdin, no args. Silent on success, prints to stderr
// on malformed cache input so it surfaces in hooks.log. The backoff sidecar
// is best-effort bookkeeping — malformed/missing sidecar content is treated
// as empty, silently, since it is not user-authored state. A missing cache
// file is treated as an empty cache (not an early exit) so sidecar cleanup
// still runs after the pruner itself unlinked the cache.
//
// Env overrides:
//   MCP_NEEDS_AUTH_TTL_MS       base prune TTL (default 3_600_000 / 1h)
//   MCP_NEEDS_AUTH_MAX_TTL_MS   backoff ceiling (default 604_800_000 / 7d)
//   MCP_NEEDS_AUTH_CACHE        cache file path (default ~/.claude/mcp-needs-auth-cache.json)
//   MCP_NEEDS_AUTH_BACKOFF      backoff sidecar path (default ~/.claude/mcp-needs-auth-backoff.json)
//   MCP_NEEDS_AUTH_PRUNE_KEEP   comma-separated server names this hook never prunes

import { readFile, unlink } from "node:fs/promises";
import { intEnv } from "../lib/hook-config.ts";
import { atomicWriteJson } from "../lib/json-io.ts";
import { claudePath } from "../lib/platform.ts";

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_PATH = process.env.MCP_NEEDS_AUTH_CACHE ?? claudePath("mcp-needs-auth-cache.json");
const BACKOFF_PATH =
  process.env.MCP_NEEDS_AUTH_BACKOFF ?? claudePath("mcp-needs-auth-backoff.json");
// An explicit MCP_NEEDS_AUTH_TTL_MS=0 must prune everything immediately, not
// silently revive the 1h default.
const TTL_MS = intEnv("MCP_NEEDS_AUTH_TTL_MS", DEFAULT_TTL_MS);
const MAX_TTL_MS = intEnv("MCP_NEEDS_AUTH_MAX_TTL_MS", DEFAULT_MAX_TTL_MS);

type CacheEntry = { timestamp?: number };
type CacheShape = Record<string, CacheEntry>;

type BackoffEntry = { strikes?: number; prunedAt?: number; absentRuns?: number };
type BackoffShape = Record<string, BackoffEntry>;

function parseKeepList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/** Malformed/missing sidecar content is not user-authored state — unlike the
 *  cache, there is nothing here worth surfacing to stderr. Treat as empty and
 *  let the normal write path re-create it. */
async function readBackoff(path: string): Promise<BackoffShape> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as BackoffShape;
  } catch {
    return {};
  }
}

/** strikes=0 (no sidecar entry) reduces to the base TTL. TTL_MS === 0 stays
 *  0 regardless of strikes (0 * 2^n === 0) — an explicit zero-TTL override
 *  must still mean "prune immediately". */
function effectiveTtl(strikes: number): number {
  return Math.min(TTL_MS * 2 ** Math.min(strikes, 30), MAX_TTL_MS);
}

async function main(): Promise<number> {
  // A missing cache file is NOT an early exit: after this pruner unlinks the
  // last entry, later runs must still walk the sidecar so recovered servers
  // shed their strikes instead of latching them forever.
  let parsedCache: CacheShape = {};
  let raw: string | null = null;
  try {
    raw = await readFile(CACHE_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (raw !== null) {
    try {
      parsedCache = JSON.parse(raw) as CacheShape;
    } catch {
      // Malformed cache — Claude Code will rewrite it on next flag. Remove so
      // we don't leave a poisoned file lying around.
      process.stderr.write(`[prune-mcp-auth-cache] malformed cache, removing: ${CACHE_PATH}\n`);
      await unlink(CACHE_PATH).catch(() => {});
      return 0;
    }
    if (!parsedCache || typeof parsedCache !== "object" || Array.isArray(parsedCache)) return 0;
  }

  const parsedSidecar = await readBackoff(BACKOFF_PATH);
  const keepSet = parseKeepList(process.env.MCP_NEEDS_AUTH_PRUNE_KEEP);

  const now = Date.now();
  const cacheNames = new Set(Object.keys(parsedCache));
  const sidecarNames = new Set(Object.keys(parsedSidecar));
  const allNames = new Set<string>([...cacheNames, ...sidecarNames]);

  const cacheOut: CacheShape = {};
  const sidecarOut: BackoffShape = {};
  let cacheChanged = false;
  let sidecarChanged = false;

  for (const name of allNames) {
    if (keepSet.has(name)) {
      // Keep-listed servers are never touched by this hook: cache entry (if
      // any) carries over untouched, and any backoff bookkeeping for them is
      // dropped — the keep-list latches them off entirely, matching upstream
      // no-TTL behavior on purpose.
      if (cacheNames.has(name)) {
        const entry = parsedCache[name];
        if (entry !== undefined) cacheOut[name] = entry;
      }
      if (sidecarNames.has(name)) sidecarChanged = true;
      continue;
    }

    const sidecarEntry = parsedSidecar[name];
    let strikes = num(sidecarEntry?.strikes);
    let prunedAt = num(sidecarEntry?.prunedAt);
    let absentRuns = num(sidecarEntry?.absentRuns);

    if (cacheNames.has(name)) {
      const entry = parsedCache[name];
      const ts = num(entry?.timestamp);

      // We pruned this server before (prunedAt > 0) and it has a newer cache
      // entry than that prune — the retry after our last prune failed again.
      if (prunedAt > 0 && ts > prunedAt) {
        strikes += 1;
        prunedAt = 0;
        absentRuns = 0;
      }

      const ttl = effectiveTtl(strikes);
      // Missing/invalid timestamp counts as infinitely old, matching the
      // pre-backoff behavior where ts defaulted to 0.
      const stale = ts <= 0 || now - ts >= ttl;

      if (stale) {
        cacheChanged = true;
        sidecarOut[name] = { strikes, prunedAt: now };
        sidecarChanged = true;
      } else {
        if (entry !== undefined) cacheOut[name] = entry;
        // The entry is live again, so any absence bookkeeping is stale —
        // rewrite without absentRuns.
        if (strikes > 0 || prunedAt > 0) {
          sidecarOut[name] = { strikes, prunedAt };
          if (
            !sidecarEntry ||
            sidecarEntry.strikes !== strikes ||
            sidecarEntry.prunedAt !== prunedAt ||
            sidecarEntry.absentRuns !== undefined
          ) {
            sidecarChanged = true;
          }
        } else if (sidecarEntry) {
          sidecarChanged = true;
        }
      }
      continue;
    }

    // Absent from cache with no prune pending: the retry after our last
    // prune succeeded (that run already recorded the strike and zeroed
    // prunedAt) — recovered, drop the sidecar entry.
    if (prunedAt === 0) {
      sidecarChanged = true;
      continue;
    }

    // Absent with a prune pending. One absent run is ambiguous (the CLI may
    // not have retried yet this session); a second consecutive absent run
    // proves recovery under either hook-vs-connect ordering. The MAX_TTL
    // bound is a backstop for sidecars written by older versions without
    // absentRuns.
    absentRuns += 1;
    if (absentRuns >= 2 || now - prunedAt > MAX_TTL_MS) {
      sidecarChanged = true;
      continue;
    }
    sidecarOut[name] = { strikes, prunedAt, absentRuns };
    sidecarChanged = true;
  }

  if (cacheChanged) {
    if (Object.keys(cacheOut).length === 0) {
      await unlink(CACHE_PATH).catch(() => {});
    } else {
      // Atomic write: Claude Code itself reads/writes this file concurrently,
      // so a plain writeFile risked a reader observing a truncated/partial JSON.
      await atomicWriteJson(CACHE_PATH, cacheOut);
    }
  }

  if (sidecarChanged) {
    if (Object.keys(sidecarOut).length === 0) {
      await unlink(BACKOFF_PATH).catch(() => {});
    } else {
      await atomicWriteJson(BACKOFF_PATH, sidecarOut);
    }
  }

  return 0;
}

process.exit(await main());
