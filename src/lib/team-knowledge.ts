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
import { runGit } from "./git.ts";
import {
  type KnowledgeIndex,
  type LinearMap,
  NON_NOTE_FILES,
  readKnowledgeIndex,
  readLinearMap,
} from "./knowledge-index.ts";

const LINEAR_ORG = "darkroomengineering";

const KNOWLEDGE_REPO = process.env.KNOWLEDGE_REPO ?? "darkroomengineering/team-knowledge";

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
        `team-knowledge: ${count} shared ${label} — matching notes surface before Bash/Edit calls; ` +
          `read one with: gh api repos/${KNOWLEDGE_REPO}/contents/<name>.md --jq .content | base64 -d`,
      ];
    }
  } catch {
    // cache unreadable — fall through silently
  }

  return [];
}

/** `owner/repo` of a GitHub remote URL (https, ssh, scp-like), or null. */
export function githubSlugFrom(originUrl: string): string | null {
  const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(originUrl.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The session line for a repo and a Linear map. A mapped repo gets its team
 *  and project; an unmapped repo in the org gets a request to add it; a repo
 *  mapped to null, or outside the org, gets nothing. */
export function linearLines(slug: string, map: LinearMap): string[] {
  const key = slug.toLowerCase();
  const found = Object.entries(map).find(([k]) => k.toLowerCase() === key);
  if (found) {
    const entry = found[1];
    return entry
      ? [`Linear: team ${entry.team}, project "${entry.projectName ?? entry.project}"`]
      : [];
  }
  if (!key.startsWith(`${LINEAR_ORG}/`)) return [];
  return [
    `Linear: ${slug} has no entry in linear-map.json (${KNOWLEDGE_REPO}); ask the user to add its team and project by PR.`,
  ];
}

/** SessionStart line tying the cwd repo to its Linear team and project, from
 *  the cached map. Reads the cache before running git, and stays silent when
 *  there is no cache, no GitHub origin, or anything fails. No network, no
 *  token. `getOrigin` and `readMap` are test seams. Never throws. */
export async function linearMapAwareness(
  getOrigin: () => Promise<string> = () => runGit(["remote", "get-url", "origin"]),
  readMap: () => Promise<LinearMap | null> = readLinearMap,
): Promise<string[]> {
  try {
    const map = await readMap();
    if (!map) return [];
    const slug = githubSlugFrom(await getOrigin());
    return slug ? linearLines(slug, map) : [];
  } catch {
    return [];
  }
}
