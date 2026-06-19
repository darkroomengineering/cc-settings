// TTL-cached index of the shared team-knowledge corpus fetched from the GitHub
// contents API via `gh api`. The cache lives in ~/.claude/tmp/knowledge-index.json
// and is warmed by refresh-knowledge-index.ts (spawned detached at SessionStart).
//
// Fail-open contract (same as codex.ts):
//   - Never throw into a hot path.
//   - A network/gh failure returns the existing cache (or null). Never clobbles
//     a good cache entry with empty/failed data.
//   - `gh` not on PATH → return existing cache silently.
//
// The corpus repo defaults to darkroomengineering/team-knowledge, overridable
// via $KNOWLEDGE_REPO env var.

import { z } from "zod";
import { readState, writeState } from "./hook-runtime.ts";
import { hasCommand } from "./platform.ts";

// Generated/meta files in the corpus that are not knowledge notes. Defined here
// (the lower-level lib) so team-knowledge.ts can re-export it without a circular
// dependency. Mirrors the SKIP_FILES set in lint-knowledge.ts.
export const NON_NOTE_FILES = new Set(["README.md", "INDEX.md", "CONTRIBUTING.md"]);

const KNOWLEDGE_INDEX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_FILE = "knowledge-index.json";
const KNOWLEDGE_REPO = process.env.KNOWLEDGE_REPO ?? "darkroomengineering/team-knowledge";

// ── Schema ─────────────────────────────────────────────────────────────────────

export const KnowledgeIndexSchema = z.object({
  notes: z.array(z.string()),
  checkedAt: z.string(),
});

export type KnowledgeIndex = z.infer<typeof KnowledgeIndexSchema>;

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** Map a GitHub contents-API listing to sorted slugs.
 *  Keeps entries where `type === "file"`, name ends with `.md`, and name is
 *  not in NON_NOTE_FILES. Returns name without the `.md` suffix, sorted. */
export function parseContentsListing(entries: Array<{ name: string; type: string }>): string[] {
  return entries
    .filter((e) => e.type === "file" && e.name.endsWith(".md") && !NON_NOTE_FILES.has(e.name))
    .map((e) => e.name.slice(0, -".md".length))
    .sort();
}

/** True when the cache is missing or older than the TTL. */
export function isStale(checkedAt: string | undefined): boolean {
  if (checkedAt === undefined) return true;
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > KNOWLEDGE_INDEX_TTL_MS;
}

// ── Cache I/O ──────────────────────────────────────────────────────────────────

/** Read the on-disk cache. Returns null on any error or schema mismatch. */
export async function readKnowledgeIndex(): Promise<KnowledgeIndex | null> {
  const raw = await readState<unknown>(CACHE_FILE, null);
  const parsed = KnowledgeIndexSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ── Refresh (TTL-gated, fail-open) ─────────────────────────────────────────────

/** Refresh the knowledge index if stale, otherwise return the cached value.
 *  Network/gh failures return the existing cache (or null) without overwriting it. */
export async function refreshKnowledgeIndex(): Promise<KnowledgeIndex | null> {
  // 1. Read current cache; return early if still fresh.
  const existing = await readKnowledgeIndex();
  if (existing && !isStale(existing.checkedAt)) {
    return existing;
  }

  // 2. `gh` required for network fetch — bail without clobbering existing cache.
  if (!hasCommand("gh")) {
    return existing ?? null;
  }

  // 3. Fetch via `gh api`.
  try {
    const proc = Bun.spawn(["gh", "api", `repos/${KNOWLEDGE_REPO}/contents`], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: 10_000,
    });

    const [text, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    if (exit !== 0) {
      // Non-zero exit — don't clobber good cache.
      return existing ?? null;
    }

    let rawEntries: unknown;
    try {
      rawEntries = JSON.parse(text);
    } catch {
      return existing ?? null;
    }

    if (!Array.isArray(rawEntries)) {
      return existing ?? null;
    }

    const notes = parseContentsListing(rawEntries as Array<{ name: string; type: string }>);
    const index: KnowledgeIndex = {
      notes,
      checkedAt: new Date().toISOString(),
    };
    await writeState(CACHE_FILE, index);
    return index;
  } catch {
    // timeout, spawn error, write error — return existing cache (or null).
    return existing ?? null;
  }
}
