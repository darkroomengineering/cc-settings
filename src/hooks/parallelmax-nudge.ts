#!/usr/bin/env bun
// PostToolUse hook — counter for consecutive non-Agent tool calls.
// When count reaches 8, nudges the model toward delegation.
// Fail-open: any error → silent success (never break the tool call).

import { readHookInput, readState, runHook, writeState } from "../lib/hook-runtime.ts";

const THRESHOLD = 8;
const DEBOUNCE_MS = 60_000;

interface State {
  count: number;
  lastTool: string;
  firedAt?: number;
}

async function main(): Promise<void> {
  const payload = await readHookInput<{ tool_name: string }>({ tool_name: "TOOL_NAME" });
  const toolName = payload.tool_name ?? "";

  const state = await readState<State>("parallelmax-counter.json", { count: 0, lastTool: "" });

  if (toolName === "Agent") {
    await writeState("parallelmax-counter.json", {
      count: 0,
      lastTool: toolName,
      firedAt: state.firedAt,
    });
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
        `Opus 4.8 defaults to self-execution, but CLAUDE.md requires delegation when tasks span ` +
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

  await writeState("parallelmax-counter.json", state);
}

await runHook(main);
