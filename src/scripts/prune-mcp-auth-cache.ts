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
// This pruner drops entries older than MCP_NEEDS_AUTH_TTL_MS (default 1h)
// so the next session is allowed to retry. If a connection genuinely still
// needs auth, the CLI will repopulate the entry immediately on retry, so
// this is safe: worst case you get one extra connection attempt per TTL
// window per previously-failed server.
//
// Hook contract: no stdin, no args. Silent on success, prints to stderr
// on malformed input so it surfaces in hooks.log.
//
// Env overrides:
//   MCP_NEEDS_AUTH_TTL_MS   prune entries older than this (default 3_600_000)
//   MCP_NEEDS_AUTH_CACHE    cache file path (default ~/.claude/mcp-needs-auth-cache.json)

import { readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const CACHE_PATH =
  process.env.MCP_NEEDS_AUTH_CACHE ?? join(homedir(), ".claude", "mcp-needs-auth-cache.json");
const TTL_MS = Number.parseInt(process.env.MCP_NEEDS_AUTH_TTL_MS ?? "", 10) || DEFAULT_TTL_MS;

type CacheEntry = { timestamp?: number };
type CacheShape = Record<string, CacheEntry>;

async function main(): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(CACHE_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }

  let parsed: CacheShape;
  try {
    parsed = JSON.parse(raw) as CacheShape;
  } catch {
    // Malformed cache — Claude Code will rewrite it on next flag. Remove so
    // we don't leave a poisoned file lying around.
    process.stderr.write(`[prune-mcp-auth-cache] malformed cache, removing: ${CACHE_PATH}\n`);
    await unlink(CACHE_PATH).catch(() => {});
    return 0;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;

  const now = Date.now();
  const kept: CacheShape = {};
  const dropped: string[] = [];
  for (const [name, entry] of Object.entries(parsed)) {
    const ts = entry && typeof entry.timestamp === "number" ? entry.timestamp : 0;
    if (ts > 0 && now - ts < TTL_MS) {
      kept[name] = entry;
    } else {
      dropped.push(name);
    }
  }

  if (dropped.length === 0) return 0;

  if (Object.keys(kept).length === 0) {
    await unlink(CACHE_PATH).catch(() => {});
  } else {
    await writeFile(CACHE_PATH, JSON.stringify(kept), "utf8");
  }
  return 0;
}

process.exit(await main());
