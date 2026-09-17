// TTL-cached index of the shared team-knowledge corpus, parsed from INDEX.md
// in the corpus repo (fetched via `gh api ... contents/INDEX.md`). The cache
// lives in ~/.claude/tmp/knowledge-index.json and is warmed by
// refresh-knowledge-index.ts (spawned detached at SessionStart).
//
// Fail-open contract (same as codex.ts):
//   - Never throw into a hot path.
//   - A network/gh failure returns the existing cache (or null). Never clobbers
//     a good cache entry with empty/failed data.
//   - `gh` not on PATH → return existing cache silently.
//
// The corpus repo defaults to darkroomengineering/team-knowledge, overridable
// via $KNOWLEDGE_REPO env var.

import { z } from "zod";
import { readState, writeState } from "./hook-runtime.ts";
import { hasCommand } from "./platform.ts";

// Generated/meta files in the corpus that are not knowledge notes. Defined here
// (the lower-level lib) so team-knowledge.ts and lint-knowledge.ts can import it
// without a circular dependency.
export const NON_NOTE_FILES = new Set(["README.md", "INDEX.md", "CONTRIBUTING.md"]);

const KNOWLEDGE_INDEX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_FILE = "knowledge-index.json";
const KNOWLEDGE_REPO = process.env.KNOWLEDGE_REPO ?? "darkroomengineering/team-knowledge";

// ── Schema ─────────────────────────────────────────────────────────────────────

export const KnowledgeNoteSchema = z.object({
  name: z.string(),
  kind: z.string(),
  tags: z.array(z.string()),
  hook: z.string(),
});

export type KnowledgeNote = z.infer<typeof KnowledgeNoteSchema>;

export const KnowledgeIndexSchema = z.object({
  notes: z.array(KnowledgeNoteSchema),
  checkedAt: z.string(),
});

export type KnowledgeIndex = z.infer<typeof KnowledgeIndexSchema>;

// ── Pure helpers ───────────────────────────────────────────────────────────────

// One INDEX.md line: `- [<kind>: <name>](<name>.md) — <hook> · tags: a, b, c`
// The ` · tags: ...` suffix is optional (omitted when the note has no tags).
// — is U+2014, · is U+00B7.
const INDEX_LINE = /^-\s*\[([^:\]]+):\s*([^\]]+)\]\([^)]+\)\s*—\s*(.*)$/;

/** Parse the team-knowledge corpus's INDEX.md into structured notes. Tolerates
 *  lines without the trailing tags suffix (tags = []) and skips lines that
 *  don't match the documented format (headers, blank lines, etc). */
export function parseIndexMarkdown(md: string): KnowledgeNote[] {
  const notes: KnowledgeNote[] = [];
  for (const line of md.split(/\r?\n/)) {
    const match = INDEX_LINE.exec(line.trim());
    if (!match) continue;
    const kind = (match[1] ?? "").trim();
    const name = (match[2] ?? "").trim();
    let rest = (match[3] ?? "").trim();
    if (!kind || !name) continue;

    let tags: string[] = [];
    const tagsSep = rest.lastIndexOf("·");
    if (tagsSep !== -1) {
      const tagsPart = rest.slice(tagsSep + 1).trim();
      const tagsMatch = /^tags:\s*(.+)$/.exec(tagsPart);
      if (tagsMatch) {
        tags = (tagsMatch[1] ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        rest = rest.slice(0, tagsSep).trim();
      }
    }

    notes.push({ name, kind, tags, hook: rest });
  }
  return notes;
}

/** True when the cache is missing or older than the TTL. */
export function isStale(checkedAt: string | undefined): boolean {
  if (checkedAt === undefined) return true;
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > KNOWLEDGE_INDEX_TTL_MS;
}

// ── Cache I/O ──────────────────────────────────────────────────────────────────

/** Read the on-disk cache. Returns null on any error or schema mismatch — an
 *  older cache shaped `{ notes: string[] }` fails safeParse and is treated as
 *  absent, so the next refresh re-fetches from INDEX.md. */
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

  // 3. Fetch INDEX.md via `gh api` (base64-encoded content field).
  try {
    const proc = Bun.spawn(
      ["gh", "api", `repos/${KNOWLEDGE_REPO}/contents/INDEX.md`, "--jq", ".content"],
      {
        stdout: "pipe",
        stderr: "ignore",
        timeout: 10_000,
      },
    );

    const [text, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    if (exit !== 0) {
      // Non-zero exit — don't clobber good cache.
      return existing ?? null;
    }

    let md: string;
    try {
      // The API's base64 payload has embedded newlines — strip whitespace first.
      md = Buffer.from(text.replace(/\s/g, ""), "base64").toString("utf8");
    } catch {
      return existing ?? null;
    }

    const notes = parseIndexMarkdown(md);
    if (notes.length === 0) {
      // Empty/unparseable result — never clobber a good cache with nothing.
      return existing ?? null;
    }

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
