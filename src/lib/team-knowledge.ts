// SessionStart awareness for the shared team-knowledge corpus (the read
// counterpart to the /share-learning write path). The corpus was write-only:
// /share-learning posts notes, but nothing surfaced them at the moment an agent
// would use them, so they rarely got consulted. This emits a one-line ping when
// a local clone is configured and non-empty.
//
// Hot-path constraint: this runs inside the SessionStart hook, so it does ZERO
// network I/O (no `gh api`) and is fully fail-open — any error → no output,
// never block session start. Live retrieval stays on-demand elsewhere; this only
// makes the agent aware the corpus exists and worth an `rg`.
//
// Opt-in: keyed on KNOWLEDGE_REPO_PATH — the same env var lint:knowledge and
// new-note already use to find a local clone. If it's unset, this is a no-op.

import { readdir } from "node:fs/promises";

// Generated/meta files in the corpus that are not knowledge notes. Mirrors the
// SKIP_FILES set in lint-knowledge.ts; kept local so the hot path doesn't import
// the linter module.
const NON_NOTE_FILES = new Set(["README.md", "INDEX.md", "CONTRIBUTING.md"]);

/** Lines to print at session start advertising the shared corpus, or [] when
 *  there's nothing to surface (no clone configured, empty, or unreadable).
 *  `repoPath` defaults to $KNOWLEDGE_REPO_PATH. Never throws. */
export async function teamKnowledgeAwareness(
  repoPath: string | undefined = process.env.KNOWLEDGE_REPO_PATH,
): Promise<string[]> {
  if (!repoPath) return [];
  try {
    const entries = await readdir(repoPath);
    const notes = entries.filter((n) => n.endsWith(".md") && !NON_NOTE_FILES.has(n));
    if (notes.length === 0) return [];
    const label = notes.length === 1 ? "note" : "notes";
    return [
      "",
      `team-knowledge: ${notes.length} shared ${label} at ${repoPath}`,
      `  consult before architecture / convention / gotcha calls — rg "<topic>" "${repoPath}"`,
    ];
  } catch {
    // missing dir, permission error, etc. — stay silent, never disrupt startup.
    return [];
  }
}
