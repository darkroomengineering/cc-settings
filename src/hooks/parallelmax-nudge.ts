#!/usr/bin/env bun
// PostToolUse hook — counter for consecutive non-Agent tool calls.
// When count reaches 8, nudges the model toward delegation.
// Fail-open: any error → silent success (never break the tool call).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".claude", "tmp");
const STATE_FILE = join(STATE_DIR, "parallelmax-counter.json");
const THRESHOLD = 8;
const DEBOUNCE_MS = 60_000;

interface State {
  count: number;
  lastTool: string;
  firedAt?: number;
}

async function readState(): Promise<State> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return JSON.parse(raw) as State;
  } catch {
    return { count: 0, lastTool: "" };
  }
}

async function writeState(state: State): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state));
}

async function main(): Promise<void> {
  const raw = await Bun.stdin.text();
  let toolName = "";
  try {
    const payload = JSON.parse(raw) as { tool_name?: string };
    toolName = payload.tool_name ?? process.env.TOOL_NAME ?? "";
  } catch {
    toolName = process.env.TOOL_NAME ?? "";
  }

  const state = await readState();

  if (toolName === "Agent") {
    await writeState({ count: 0, lastTool: toolName, firedAt: state.firedAt });
    return;
  }

  state.count += 1;
  state.lastTool = toolName;

  if (state.count >= THRESHOLD) {
    const now = Date.now();
    // Debounce: skip if we fired recently to avoid spamming.
    if (!state.firedAt || now - state.firedAt >= DEBOUNCE_MS) {
      const msg =
        `You have made ${state.count} consecutive tool calls without delegating to an Agent. ` +
        `Opus 4.7 defaults to self-execution, but CLAUDE.md requires delegation when tasks span ` +
        `3+ files or 10+ tool calls. Consider Agent(implementer), Agent(explore), or Agent(maestro) ` +
        `to parallelize work, reduce context pressure, and follow the project guardrails.`;
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: msg,
          },
        }),
      );
      state.firedAt = now;
      state.count = 0;
    }
  }

  await writeState(state);
}

try {
  await main();
} catch {
  // Fail open — never interrupt a tool call due to hook failure.
}
