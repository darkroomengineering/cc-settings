#!/usr/bin/env bun
// Stop hook — when this turn made 5+ non-Agent tool calls (the parallelmax
// counter's "warning zone"), ask Haiku whether the work should have been
// delegated. Gates the LLM call by the counter file so we don't burn Haiku
// + latency on every turn — only the suspicious ones.
//
// Fail-open: any error → silent success. Never block a Stop event.

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const COUNTER_PATH = join(homedir(), ".claude", "tmp", "parallelmax-counter.json");
const JUDGE_PATH = join(homedir(), ".claude", "tmp", "parallelmax-judge.json");
const COUNTER_THRESHOLD = 5;
const DEBOUNCE_MS = 600_000;
const HAIKU_TIMEOUT_MS = 8_000;
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

interface Counter {
  count: number;
  lastTool: string;
  firedAt?: number;
}

interface JudgeState {
  lastFiredAt?: number;
  lastReason?: string;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function transcriptExcerpt(path: string): Promise<string> {
  try {
    const raw = await readFile(path, "utf8");
    const lines = raw.trim().split("\n").slice(-50);
    const out: string[] = [];
    for (const l of lines) {
      try {
        const e = JSON.parse(l) as {
          type?: string;
          message?: { content?: unknown };
        };
        if (e.type === "user" && typeof e.message?.content === "string") {
          out.push(`USER: ${e.message.content.slice(0, 300)}`);
        } else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
          const tools = e.message.content
            .filter(
              (c): c is { type: string; name?: string } =>
                typeof c === "object" &&
                c !== null &&
                (c as { type?: unknown }).type === "tool_use",
            )
            .map((c) => c.name ?? "?");
          if (tools.length) out.push(`ASSISTANT_TOOLS: ${tools.join(", ")}`);
        }
      } catch {
        // Skip unparseable lines.
      }
    }
    return out.slice(-25).join("\n");
  } catch {
    return "";
  }
}

async function askHaiku(
  excerpt: string,
  count: number,
): Promise<{ verdict: boolean; reason: string } | null> {
  const prompt = [
    `<conversation-excerpt>`,
    excerpt,
    `</conversation-excerpt>`,
    ``,
    `The assistant's most recent turn made ${count} non-Agent tool calls.`,
    `Per cc-settings delegation rules, delegation to a subagent (Agent tool)`,
    `is required when ANY hold:`,
    `  - multi-file work spans 3+ files`,
    `  - 10+ sequential tool calls`,
    `  - multiple independent workstreams could run in parallel`,
    `  - security-sensitive code, test-writing, or dead-code cleanup`,
    ``,
    `Did the assistant self-execute work that should have been delegated?`,
    `Respond on ONE line, no preamble, no markdown:`,
    `  - If yes: "DELEGATE: <one-sentence reason, max 80 chars>"`,
    `  - If no (work was appropriately scoped, or Agent was used): "OK"`,
  ].join("\n");

  try {
    const proc = Bun.spawn(["claude", "-p", prompt, "--model", HAIKU_MODEL], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await Promise.race([
      new Response(proc.stdout).text(),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error("haiku-timeout")), HAIKU_TIMEOUT_MS),
      ),
    ]);
    const line = text.trim().split("\n").find(Boolean) ?? "";
    if (line.startsWith("DELEGATE:")) {
      return {
        verdict: true,
        reason: line.slice("DELEGATE:".length).trim().slice(0, 200),
      };
    }
    return { verdict: false, reason: "" };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const raw = await Bun.stdin.text();
  let transcriptPath = "";
  try {
    const payload = JSON.parse(raw) as { transcript_path?: string };
    transcriptPath = payload.transcript_path ?? "";
  } catch {
    transcriptPath = process.env.TRANSCRIPT_PATH ?? "";
  }
  if (!transcriptPath) return;

  const counter = await readJson<Counter>(COUNTER_PATH, { count: 0, lastTool: "" });
  if (counter.count < COUNTER_THRESHOLD) return;

  const state = await readJson<JudgeState>(JUDGE_PATH, {});
  const now = Date.now();
  if (state.lastFiredAt && now - state.lastFiredAt < DEBOUNCE_MS) return;

  const excerpt = await transcriptExcerpt(transcriptPath);
  if (!excerpt) return;

  const judgment = await askHaiku(excerpt, counter.count);
  if (!judgment || !judgment.verdict) return;
  if (state.lastReason === judgment.reason) return;

  await writeFile(JUDGE_PATH, JSON.stringify({ lastFiredAt: now, lastReason: judgment.reason }));

  const msg =
    `parallelmax-judge (Haiku verdict): your last turn ran ${counter.count} ` +
    `non-Agent tool calls without delegating. ${judgment.reason}`;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: msg,
      },
    }),
  );
}

try {
  await main();
} catch {
  // Fail open — never block a Stop event due to hook failure.
}
