#!/usr/bin/env bun
// PostToolUse hook — nudges the user (once per file) when a team-relevant
// auto-memory is written. Fires on Write|Edit events where the written path
// is inside a /.claude/projects/.../memory/ directory. Only prompts for
// `project` and `feedback` memory types — the types most likely to hold
// team-wide knowledge. Deduplicates via a seen-set so it nudges at most once
// per memory file. Fail-open: any error → exit 0 silently (a hook must never
// break a tool call).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseFrontmatter } from "../lib/frontmatter.ts";
import { readHookInput, runHook } from "../lib/hook-runtime.ts";
import { claudePath } from "../lib/platform.ts";

const SEEN_SET_PATH = claudePath(".cache", "share-nudge-seen.json");

const TEAM_RELEVANT_TYPES = new Set(["project", "feedback"]);

async function readSeenSet(): Promise<string[]> {
  try {
    const raw = await readFile(SEEN_SET_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function writeSeenSet(seen: string[]): Promise<void> {
  await mkdir(claudePath(".cache"), { recursive: true });
  await writeFile(SEEN_SET_PATH, JSON.stringify(seen));
}

async function main(): Promise<void> {
  const payload = await readHookInput<{
    tool_input?: { file_path?: string };
    session_id?: string;
  }>();
  const filePath = payload.tool_input?.file_path;

  // No file_path → nothing to check.
  if (!filePath) return;

  // Gate on auto-memory path pattern.
  if (
    !filePath.includes("/.claude/projects/") ||
    !filePath.includes("/memory/") ||
    !filePath.endsWith(".md") ||
    basename(filePath) === "MEMORY.md"
  ) {
    return;
  }

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

  // Dedup: skip if already nudged for this file.
  const seen = await readSeenSet();
  if (seen.includes(filePath)) return;

  // Append and persist before emitting (best-effort; failures are swallowed by runHook).
  seen.push(filePath);
  await writeSeenSet(seen);

  const nameLabel = memName ? `\`${memName}\`` : "this memory";
  const msg =
    `Saved a \`${memType}\` learning locally (${nameLabel}). ` +
    `If another teammate's agent would benefit, promote it to the shared board: run /share-learning. Otherwise ignore.`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: msg,
      },
    }),
  );
}

await runHook(main);
