// Pure ranking logic for the knowledge-hint PreToolUse hook. Kept separate
// from src/hooks/knowledge-hint.ts so it's testable without spawning a
// process or touching ~/.claude/tmp.
//
// A note "qualifies" when enough of its slug words / tags appear as whole
// words in the tool's haystack (command text, file path, edited content).
// This is a coarse relevance heuristic, not search — false negatives are
// fine (fail-open), false positives are bounded by the score-3 threshold.
//
// Weighting has three tiers, not two: a generic token (GENERIC_TOKENS) scores
// 1 no matter where it comes from; a non-generic token scores 3 when it's one
// of the note's curated tags, or 2 when it only comes from the incidental
// slug split. A token present in both uses the tag weight (3) — tags are
// author-curated signal, slug words are a byproduct of the filename.

import type { KnowledgeNote } from "./knowledge-index.ts";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "no",
  "not",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "when",
  "with",
  "without",
  "only",
]);

/** Tokens common enough across notes that they carry less signal — weighted
 *  1 regardless of whether they come from a slug or a tag. Exported so tests
 *  can assert membership. */
export const GENERIC_TOKENS = new Set([
  "agents",
  "animation",
  "api",
  "app",
  "build",
  "ci",
  "cli",
  "code",
  "code-style",
  "conventions",
  "css",
  "debugging",
  "dev",
  "docs",
  "email",
  "error",
  "frontend",
  "git",
  "github",
  "hooks",
  "layout",
  "maintenance",
  "macos",
  "mcp",
  "meta",
  "models",
  "naming",
  "nextjs",
  "performance",
  "production",
  "publishing",
  "push",
  "react",
  "release",
  "rendering",
  "scroll",
  "settings",
  "testing",
  "tests",
  "tooling",
  "workflow",
]);

const QUALIFY_THRESHOLD = 3;
const MAX_SHOWN = 3;
const MAX_HAYSTACK_CHARS = 20_000;

/** Filter + normalize a raw token list: lowercase, drop stop words and
 *  tokens shorter than 3 chars, dedupe while preserving first-seen order. */
function normalizeTokens(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const tok = t.toLowerCase().trim();
    if (tok.length < 3) continue;
    if (STOP_WORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/** The note's curated-tag tokens, normalized the same way as tokensFor — used
 *  to decide the tag-vs-slug weight tier in scoreNote. */
function tagTokensFor(note: KnowledgeNote): Set<string> {
  return new Set(normalizeTokens(note.tags));
}

/** Distinct, filtered tokens for a note: slug words (split on `-`) plus tags,
 *  minus stop words and tokens shorter than 3 chars. Slug words come first,
 *  so tokensFor's order matches the note's filename before its tags. */
export function tokensFor(note: KnowledgeNote): string[] {
  return normalizeTokens([...note.name.split("-"), ...note.tags]);
}

/** Weight of a single token for a given note: 1 if generic (regardless of
 *  source), else 3 if it's one of the note's tags, else 2 (slug-only). */
function tokenWeight(token: string, tagTokens: ReadonlySet<string>): number {
  if (GENERIC_TOKENS.has(token)) return 1;
  return tagTokens.has(token) ? 3 : 2;
}

/** Whether `token` (or its naive singular, minus one trailing 's') appears as
 *  a whole word in `haystack`. Word boundary = string start/end or a
 *  non `[a-z0-9]` character on both sides. */
function tokenMatches(token: string, haystack: string): boolean {
  const candidates = new Set([token]);
  if (token.endsWith("s") && token.length > 3) {
    candidates.add(token.slice(0, -1));
  }
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
    // Pad haystack with sentinel boundaries so start/end matches work without
    // a lookbehind (broad Bun/engine compat).
    if (rx.test(` ${haystack} `)) return true;
  }
  return false;
}

/** Score a note against a haystack: sum of weights of distinct matched
 *  tokens. Weight tiers (see tokenWeight): 1 generic, 3 non-generic-from-tag,
 *  2 non-generic-slug-only. A token present in both the slug and the tags
 *  uses the tag weight. */
export function scoreNote(note: KnowledgeNote, haystack: string): number {
  const hay = haystack.toLowerCase();
  const tagTokens = tagTokensFor(note);
  let score = 0;
  for (const token of tokensFor(note)) {
    if (!tokenMatches(token, hay)) continue;
    score += tokenWeight(token, tagTokens);
  }
  return score;
}

/** Rank notes against a haystack, dropping ones already shown this session,
 *  keeping only notes scoring >= QUALIFY_THRESHOLD, sorted by score desc then
 *  name asc, capped at MAX_SHOWN. */
export function rankNotes(
  notes: KnowledgeNote[],
  haystack: string,
  shown: ReadonlySet<string> = new Set(),
): KnowledgeNote[] {
  const capped = haystack.slice(0, MAX_HAYSTACK_CHARS);
  return notes
    .filter((n) => !shown.has(n.name))
    .map((n) => ({ note: n, score: scoreNote(n, capped) }))
    .filter((r) => r.score >= QUALIFY_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.note.name.localeCompare(b.note.name))
    .slice(0, MAX_SHOWN)
    .map((r) => r.note);
}
