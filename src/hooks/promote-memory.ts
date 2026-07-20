#!/usr/bin/env bun
// PostToolUse hook — nudges the user (once per file) when a team-relevant
// auto-memory is written. Fires on Write|Edit events where the written path
// is inside a /.claude/projects/.../memory/ directory. Only prompts for
// `project` and `feedback` memory types — the types most likely to hold
// team-wide knowledge. Deduplicates via a seen-set so it nudges at most once
// per memory file. Fail-open: any error → exit 0 silently (a hook must never
// break a tool call).
//
// The seen-set is keyed by session id and written atomically (tmp+rename via
// json-io's atomicWriteJson) so parallel sessions never race on the same
// read-modify-write file, and is capped so it can't grow unbounded across a
// long session (mirrors tool-cadence's files.slice(0, 20) pattern). (#85)

import { mkdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseFrontmatter } from "../lib/frontmatter.ts";
import { emitAdditionalContext, readHookInput, runHook } from "../lib/hook-runtime.ts";
import { atomicWriteJson, readJsonOrNull } from "../lib/json-io.ts";
import { claudePath } from "../lib/platform.ts";

const TEAM_RELEVANT_TYPES = new Set(["project", "feedback"]);

// Cap the seen-set so a long session's dedup list can't grow unbounded.
const SEEN_SET_CAP = 50;

/** ~/.claude/.cache/share-nudge-seen-<session>.json — keyed by session id so
 *  concurrent sessions never race on the same file (#85). */
function seenSetPath(sessionId: string): string {
  return claudePath(".cache", `share-nudge-seen-${sessionId}.json`);
}

/**
 * Gate check: is this file_path an auto-memory markdown file worth nudging
 * on? Pure (no I/O) so it's directly unit-testable. Normalizes the incoming
 * path to posix separators before matching — on Windows `file_path` may use
 * `\`, which would otherwise silently fail both `.includes()` checks and the
 * nudge would never fire (#98).
 */
export function isAutoMemoryPath(filePath: string): boolean {
  const posixPath = filePath.replaceAll("\\", "/");
  return (
    posixPath.includes("/.claude/projects/") &&
    posixPath.includes("/memory/") &&
    posixPath.endsWith(".md") &&
    basename(posixPath) !== "MEMORY.md"
  );
}

async function readSeenSet(path: string): Promise<string[]> {
  try {
    const parsed = await readJsonOrNull(path);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function writeSeenSet(path: string, seen: string[]): Promise<void> {
  await mkdir(claudePath(".cache"), { recursive: true });
  // Cap so the seen-set can't grow unbounded across a long session (#85).
  await atomicWriteJson(path, seen.slice(-SEEN_SET_CAP));
}

async function main(): Promise<void> {
  const payload = await readHookInput<{
    tool_input?: { file_path?: string };
    session_id?: string;
  }>({ session_id: "CLAUDE_CODE_SESSION_ID" });
  const filePath = payload.tool_input?.file_path;

  // No file_path → nothing to check.
  if (!filePath) return;

  // Gate on auto-memory path pattern.
  if (!isAutoMemoryPath(filePath)) return;

  // Read the file that was just written.
  const content = await readFile(filePath, "utf8");
  const fm = parseFrontmatter(content) as Record<string, unknown> | null;
  if (!fm) return;

  // Memory frontmatter nests type under metadata.
  const metadata = fm.metadata as Record<string, unknown> | undefined;
  const memType = metadata?.type as string | undefined;
  const memName = fm.name as string | undefined;

  // Only nudge for team-relevant types.
  if (!memType || !TEAM_RELEVANT_TYPES.has(memType)) return;

  // Dedup: skip if already nudged for this file (this session).
  const seenPath = seenSetPath(payload.session_id || "unknown");
  const seen = await readSeenSet(seenPath);
  if (seen.includes(filePath)) return;

  // Append and persist before emitting (best-effort; failures are swallowed by runHook).
  seen.push(filePath);
  await writeSeenSet(seenPath, seen);

  const nameLabel = memName ? `\`${memName}\`` : "this memory";
  const msg =
    `Saved a \`${memType}\` learning locally (${nameLabel}). ` +
    `If another teammate's agent would benefit, promote it to the shared board: run /share-learning. Otherwise ignore.`;

  emitAdditionalContext("PostToolUse", msg);
}

// Guard behind import.meta.main (same pattern as src/schemas/emit.ts and
// src/setup.ts) so tests can import isAutoMemoryPath without triggering the
// hook's stdin read / side effects.
if (import.meta.main) {
  await runHook(main);
}
