#!/usr/bin/env bun
// Detached entrypoint for warming the team-knowledge TTL caches (the note index
// and the Linear map). Spawned fire-and-forget from session-start.ts (Phase 1
// background tasks). The TTL gate lives in each refresh function — spawning this
// every session is cheap; it only calls `gh api` when a cache is stale (>6h).

import { refreshKnowledgeIndex, refreshLinearMap } from "../lib/knowledge-index.ts";

await Promise.all([refreshKnowledgeIndex().catch(() => {}), refreshLinearMap().catch(() => {})]);
