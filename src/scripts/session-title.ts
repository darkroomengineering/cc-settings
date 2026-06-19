#!/usr/bin/env bun
// UserPromptSubmit hook — emit hookSpecificOutput.sessionTitle so sessions
// get a human-readable title derived from the first prompt. Makes
// `claude --resume <name>` (v2.1.101) and `/recap` usable.
//
// Only fires when the session has no title yet (first meaningful prompt).
// Title is 3-6 words, alphanumerics + hyphens, lowercase.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readHookInput } from "../lib/hook-runtime.ts";
import { claudePath } from "../lib/platform.ts";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "is",
  "it",
  "this",
  "that",
  "please",
  "can",
  "could",
  "would",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
]);

async function main(): Promise<void> {
  // UserPromptSubmit delivers the prompt as stdin JSON ({ session_id, prompt });
  // older Claude Code builds set PROMPT / CLAUDE_SESSION_ID env vars instead.
  // Read stdin first, fall back to env — the same pattern delegation-detector.ts
  // (the sibling hook on this event) uses. Reading env only would silently
  // no-op whenever Claude Code delivers the prompt via stdin.
  const { session_id: SESSION_ID = "", prompt: PROMPT = "" } = await readHookInput<{
    session_id: string;
    prompt: string;
  }>({ session_id: "CLAUDE_SESSION_ID", prompt: "PROMPT" });

  if (!SESSION_ID || !PROMPT) return;

  const STATE_DIR = claudePath("session-titles");
  const STATE_FILE = join(STATE_DIR, `${SESSION_ID}.flag`);

  // Already titled this session — skip.
  if (existsSync(STATE_FILE)) return;

  const cleaned = PROMPT.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 4) return;

  const title = cleaned
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .slice(0, 5)
    .join("-")
    .slice(0, 50);

  if (!title) return;

  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, title);

  console.log(
    JSON.stringify({
      hookSpecificOutput: { sessionTitle: title },
    }),
  );
}

// Fail-open: a write failure (permissions, full disk) must not break the
// UserPromptSubmit hook. The session just doesn't get a title this run.
try {
  await main();
} catch {
  // silent
}
