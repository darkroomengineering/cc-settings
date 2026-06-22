// SessionStart awareness for the shared team-knowledge corpus (the read
// counterpart to the /share-learning write path). The corpus was write-only:
// /share-learning posts notes, but nothing surfaced them at the moment an agent
// would use them, so they rarely got consulted. This emits a one-line ping when
// a local clone is configured and non-empty — or from a TTL-cached remote index
// when no local clone is available.
//
// Hot-path constraint: this runs inside the SessionStart hook, so it does ZERO
// blocking network I/O and is fully fail-open — any error → no output, never
// block session start. Network warming happens in a detached background script
// (refresh-knowledge-index.ts) and the result is read from a TTL cache.
//
// Priority:
//   1. Explicit repoPath (local clone) — used by tests and $KNOWLEDGE_REPO_PATH.
//   2. TTL cache written by refresh-knowledge-index.ts (no local clone needed).
//   3. No output.

import { readdir } from "node:fs/promises";
import { type KnowledgeIndex, NON_NOTE_FILES, readKnowledgeIndex } from "./knowledge-index.ts";

// Re-export so external consumers (lint-knowledge, tests) can import from
// team-knowledge.ts as before without knowing the source moved.
export { NON_NOTE_FILES } from "./knowledge-index.ts";

/** Lines to print at session start advertising the shared corpus, or [] when
 *  there's nothing to surface (no clone configured, empty, or unreadable).
 *  `repoPath` defaults to $KNOWLEDGE_REPO_PATH. `readIndex` defaults to the
 *  real TTL-cache reader and exists as a test seam — injecting it isolates the
 *  Branch-B path from the developer machine's real `~/.claude/tmp` cache.
 *  Never throws. */
export async function teamKnowledgeAwareness(
  repoPath: string | undefined = process.env.KNOWLEDGE_REPO_PATH,
  readIndex: () => Promise<KnowledgeIndex | null> = readKnowledgeIndex,
): Promise<string[]> {
  // Branch A: explicit repoPath — use the local clone directly (existing behavior,
  // preserves all current tests). Cache is bypassed in this branch.
  if (repoPath) {
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

  // Branch B: no local clone — try the TTL cache written by refresh-knowledge-index.ts.
  try {
    const index = await readIndex();
    if (index && index.notes.length > 0) {
      const count = index.notes.length;
      const label = count === 1 ? "note" : "notes";
      return [
        "",
        `team-knowledge: ${count} shared ${label} — consult before architecture / convention / gotcha calls`,
      ];
    }
  } catch {
    // cache unreadable — fall through silently
  }

  return [];
}
