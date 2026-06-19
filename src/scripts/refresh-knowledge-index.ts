#!/usr/bin/env bun
// Detached entrypoint for warming the knowledge-index TTL cache.
// Spawned fire-and-forget from session-start.ts (Phase 1 background tasks).
// The TTL gate lives in refreshKnowledgeIndex — spawning this every session
// is cheap; it only calls `gh api` when the cache is stale (>6h).

import { refreshKnowledgeIndex } from "../lib/knowledge-index.ts";

await refreshKnowledgeIndex().catch(() => {});
