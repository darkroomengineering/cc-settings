#!/usr/bin/env bun
// UserPromptSubmit hook — emit hookSpecificOutput.sessionTitle so sessions
// get a human-readable title derived from the first prompt. Makes
// `claude --resume <name>` (v2.1.101) and `/recap` usable.
//
// Only fires when the session has no title yet (first meaningful prompt).
// Title is 3-6 words, alphanumerics + hyphens, lowercase.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const SESSION_ID = process.env.CLAUDE_SESSION_ID ?? "";
const PROMPT = process.env.PROMPT ?? "";

if (!SESSION_ID || !PROMPT) process.exit(0);

const STATE_DIR = join(homedir(), ".claude", "session-titles");
const STATE_FILE = join(STATE_DIR, `${SESSION_ID}.flag`);

// Already titled this session — skip.
if (existsSync(STATE_FILE)) process.exit(0);

const cleaned = PROMPT.toLowerCase()
  .replace(/[^a-z0-9\s-]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

if (cleaned.length < 4) process.exit(0);

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

const title = cleaned
  .split(" ")
  .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  .slice(0, 5)
  .join("-")
  .slice(0, 50);

if (!title) process.exit(0);

await mkdir(dirname(STATE_FILE), { recursive: true });
await writeFile(STATE_FILE, title);

console.log(
  JSON.stringify({
    hookSpecificOutput: { sessionTitle: title },
  }),
);
