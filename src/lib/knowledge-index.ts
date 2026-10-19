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
//
// The same repo's linear-map.json (repo -> Linear team and project) is cached
// the same way in ~/.claude/tmp/linear-map.json. Anyone without read access to
// the repo gets a failed fetch, no cache and no feature.

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
  // Optional so a cache written before scope existed still parses.
  scope: z.array(z.string()).optional(),
  hook: z.string(),
});

export type KnowledgeNote = z.infer<typeof KnowledgeNoteSchema>;

export const KnowledgeIndexSchema = z.object({
  notes: z.array(KnowledgeNoteSchema),
  checkedAt: z.string(),
});

export type KnowledgeIndex = z.infer<typeof KnowledgeIndexSchema>;

// A map entry is validated tightly because its values reach the model through
// the SessionStart line: no newlines, no free text beyond a short project name.
export const LinearEntrySchema = z.object({
  team: z.string().regex(/^[A-Za-z0-9]{1,16}$/),
  project: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  projectName: z
    .string()
    .regex(/^[^\r\n]{1,80}$/)
    .optional(),
});

export type LinearEntry = z.infer<typeof LinearEntrySchema>;

/** `owner/repo` -> Linear entry, or null for a repo that deliberately has no Linear. */
export const LinearMapSchema = z.record(
  z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
  LinearEntrySchema.nullable(),
);

export type LinearMap = z.infer<typeof LinearMapSchema>;

export const LinearMapCacheSchema = z.object({
  map: LinearMapSchema,
  checkedAt: z.string(),
});

export type LinearMapCache = z.infer<typeof LinearMapCacheSchema>;

// ── Pure helpers ───────────────────────────────────────────────────────────────

// One INDEX.md line:
//   `- [<kind>: <name>](<name>.md) — <hook> · scope: x, y · tags: a, b, c`
// Each ` · <field>: ...` suffix is optional (omitted when the note has no
// value). Scope precedes tags, so suffixes are stripped right to left.
// — is U+2014, · is U+00B7.
const INDEX_LINE = /^-\s*\[([^:\]]+):\s*([^\]]+)\]\([^)]+\)\s*—\s*(.*)$/;

/** Split a trailing ` · <field>: a, b` suffix off `rest`. Returns the list and
 *  the remaining text, or null when the last `·` segment is not that field. */
function takeListSuffix(rest: string, field: string): { list: string[]; rest: string } | null {
  const sep = rest.lastIndexOf("·");
  if (sep === -1) return null;
  const match = new RegExp(`^${field}:\\s*(.+)$`).exec(rest.slice(sep + 1).trim());
  if (!match) return null;
  const list = (match[1] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return { list, rest: rest.slice(0, sep).trim() };
}

/** Parse the team-knowledge corpus's INDEX.md into structured notes. Tolerates
 *  lines without the trailing scope and tags suffixes (tags = [], no scope)
 *  and skips lines that don't match the documented format (headers, blank
 *  lines, etc). */
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
    const tagsPart = takeListSuffix(rest, "tags");
    if (tagsPart) {
      tags = tagsPart.list;
      rest = tagsPart.rest;
    }

    const note: KnowledgeNote = { name, kind, tags, hook: rest };
    const scopePart = takeListSuffix(rest, "scope");
    if (scopePart && scopePart.list.length > 0) {
      note.scope = scopePart.list;
      note.hook = scopePart.rest;
    }
    notes.push(note);
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

/** Fetch one file from the corpus repo via `gh api` and return its decoded text.
 *  Null on a non-zero exit (404, no access, network). Throws on spawn errors and
 *  timeouts; callers wrap it in try/catch. */
async function fetchCorpusFile(path: string): Promise<string | null> {
  const proc = Bun.spawn(
    ["gh", "api", `repos/${KNOWLEDGE_REPO}/contents/${path}`, "--jq", ".content"],
    { stdout: "pipe", stderr: "ignore", timeout: 10_000 },
  );
  const [text, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exit !== 0) return null;
  // The API's base64 payload has embedded newlines — strip whitespace first.
  return Buffer.from(text.replace(/\s/g, ""), "base64").toString("utf8");
}

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

  // 3. Fetch INDEX.md via `gh api`; a failed fetch must not clobber a good cache.
  try {
    const md = await fetchCorpusFile("INDEX.md");
    if (md === null) return existing ?? null;

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

// ── Linear map ─────────────────────────────────────────────────────────────────

const LINEAR_CACHE_FILE = "linear-map.json";
// A failed fetch keeps the old cache, so a person who lost access to the repo
// would otherwise keep the map forever. Past this age the reader ignores it.
const LINEAR_MAP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function readLinearCache(): Promise<LinearMapCache | null> {
  const raw = await readState<unknown>(LINEAR_CACHE_FILE, null);
  const parsed = LinearMapCacheSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The cached Linear map, or null when it is missing, malformed or older than
 *  a week. Never touches the network. */
export async function readLinearMap(): Promise<LinearMap | null> {
  const cache = await readLinearCache();
  if (!cache) return null;
  const t = Date.parse(cache.checkedAt);
  if (Number.isNaN(t) || Date.now() - t > LINEAR_MAP_MAX_AGE_MS) return null;
  return cache.map;
}

/** Refresh the Linear map cache if stale. A failed fetch (no gh, no access,
 *  404, bad JSON, wrong shape, empty map) never overwrites a good cache. */
export async function refreshLinearMap(): Promise<LinearMapCache | null> {
  const existing = await readLinearCache();
  if (existing && !isStale(existing.checkedAt)) return existing;
  if (!hasCommand("gh")) return existing;

  try {
    const text = await fetchCorpusFile("linear-map.json");
    if (text === null) return existing;
    const parsed = LinearMapSchema.safeParse(JSON.parse(text));
    if (!parsed.success || Object.keys(parsed.data).length === 0) return existing;

    const cache: LinearMapCache = { map: parsed.data, checkedAt: new Date().toISOString() };
    await writeState(LINEAR_CACHE_FILE, cache);
    return cache;
  } catch {
    return existing;
  }
}
