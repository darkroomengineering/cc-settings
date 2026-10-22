#!/usr/bin/env bun
// Stop hook: a turn that ends in a prose question with no AskUserQuestion call
// leaves the user a question the harness never surfaced as a prompt, so work
// stalls silently. Block that stop once and tell Claude to ask through the tool.
//
// Fail-open: unreadable transcript, malformed entries, or any error allows the stop.

import { open } from "node:fs/promises";
import { isPlainObject, readHookInput, runHook } from "../lib/hook-runtime.ts";

const TAIL_BYTES = 256 * 1024;

const REASON =
  "Your turn ends with a question in prose. If you need the user's decision, ask it through " +
  "AskUserQuestion (2-4 options, recommended first) instead of prose. If no decision is needed, " +
  "continue the work or end with a statement.";

interface StopPayload extends Record<string, unknown> {
  transcript_path: string;
  stop_hook_active: boolean;
  last_assistant_message: string;
}

async function readTail(path: string): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    // A mid-file start lands inside a line; drop the partial first line.
    return { text: start > 0 ? text.slice(text.indexOf("\n") + 1) : text, truncated: start > 0 };
  } finally {
    await handle.close();
  }
}

interface Turn {
  asksViaTool: boolean;
  text: string;
  /** False when no real user message was seen, so the turn may start before the tail. */
  complete: boolean;
}

/** Everything the assistant produced after the last real user message. */
function finalTurn(jsonl: string): Turn {
  const turn: Turn = { asksViaTool: false, text: "", complete: false };
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPlainObject(entry) || !isPlainObject(entry.message)) continue;
    const content = entry.message.content;
    const blocks = Array.isArray(content) ? content : [{ type: "text", text: content }];
    if (entry.type === "user") {
      // tool_result entries are user-role but not a new user turn.
      const isToolResult = blocks.every((b) => isPlainObject(b) && b.type === "tool_result");
      if (!isToolResult) {
        turn.asksViaTool = false;
        turn.text = "";
        turn.complete = true;
      }
    } else if (entry.type === "assistant") {
      for (const b of blocks) {
        if (!isPlainObject(b)) continue;
        if (b.type === "tool_use" && b.name === "AskUserQuestion") turn.asksViaTool = true;
        if (b.type === "text" && typeof b.text === "string") turn.text = b.text;
      }
    }
  }
  return turn;
}

/** True when the last non-empty line, outside code fences and quotes, ends in `?`. */
export function endsWithProseQuestion(text: string): boolean {
  let inFence = false;
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.startsWith(">") || line === "") continue;
    lines.push(line);
  }
  // Trailing Markdown emphasis or code marks (`**Which one?**`) still end a question.
  return (lines.at(-1) ?? "").replace(/[*_`~)\]]+$/, "").endsWith("?");
}

async function main(): Promise<void> {
  const input = await readHookInput<StopPayload>();
  if (input.stop_hook_active === true) return;
  if (typeof input.transcript_path !== "string" || !input.transcript_path) return;

  const tail = await readTail(input.transcript_path);
  const turn = finalTurn(tail.text);
  if (turn.asksViaTool) return;
  // The turn began before the tail window, so an earlier AskUserQuestion may be cut off.
  if (tail.truncated && !turn.complete) return;
  const text =
    typeof input.last_assistant_message === "string" && input.last_assistant_message
      ? input.last_assistant_message
      : turn.text;
  if (endsWithProseQuestion(text)) {
    console.log(JSON.stringify({ decision: "block", reason: REASON }));
  }
}

if (import.meta.main) await runHook(main);
