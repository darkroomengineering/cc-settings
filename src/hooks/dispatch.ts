#!/usr/bin/env bun
// Hook dispatcher: one process runs every synchronous handler of an event.
// config/40-hooks.json wires `dispatch.ts <Event>` once per event instead of one
// `bun` process per handler, so a Bash call starts one PreToolUse process, not
// one per hook.
//
// Each handler exports `main(io: HookIO)` (lib/hook-runtime.ts) and still runs
// as its own script (`if (import.meta.main)`) for tests, hook-bench and Codex.
// Here a handler gets a captureIO over the payload read once from stdin, so
// nothing is printed or exited from inside a handler; the dispatcher combines
// what they collected into the single response the event expects:
//
//   block      first handler to block wins; stdout `{"decision":"block","reason":…}`
//              and exit 2, byte for byte what that handler prints when run alone
//   ask        no block, some handler asked: one hookSpecificOutput envelope with
//              permissionDecision "ask", the reasons joined by newlines, and the
//              joined additionalContext when there is any; exit 0
//   context    every handler's additionalContext joined by newlines, in one
//              hookSpecificOutput envelope on stdout, exit 0
//
// Failure policy:
//   - A handler marked failClosed (safety-net) that throws, times out or fails
//     to load blocks, as a crashed safety-net process does when run alone.
//   - Any other handler that fails is skipped; the error goes to stderr and the
//     rest still run.
//   - A failClosed handler is first in its list, gets no inner timeout, and
//     ends the run when it blocks, so advisory handlers never delay or lose its
//     verdict; the entry timeout (with `onFailure: "block"` on the Bash
//     PreToolUse entry) covers it exactly as it did alone.
//   - Every other handler gets the timeout it had as its own entry, capped by
//     what is left of the event's entry timeout (the max of its members').
//
// Handlers marked `async: true` in the config (post-edit-tsc, log-bash,
// codex-verify) and the ones gated by an `if` filter (check-docs-before-install)
// stay separate entries, as do SessionStart's verify-hooks (the integrity check
// must run before dependency-backed code loads) and session-start (plain-stdout
// script with top-level side effects).

import { writeSync } from "node:fs";
import { matchesTool } from "../lib/hook-frequency.ts";
import { captureIO, HookBlocked, type HookIO, parseHookInput } from "../lib/hook-runtime.ts";

export type DispatchEvent = "UserPromptSubmit" | "PreToolUse" | "PostToolUse";

export interface Handler {
  /** Script basename, for error lines. */
  name: string;
  /** Tool-name regex the handler's own config entry used; absent matches every call. */
  matcher?: string;
  /** Seconds the handler's own config entry allowed; absent means none was set. */
  timeoutS?: number;
  /** Label for a block when this handler fails: `[<label>] internal error, failing closed: …`. */
  failClosed?: string;
  load(): Promise<{ main(io: HookIO): Promise<void> }>;
}

/** Handlers per event in the order the config ran them. */
export const HANDLERS: Record<DispatchEvent, Handler[]> = {
  UserPromptSubmit: [
    { name: "delegation-detector", timeoutS: 3, load: () => import("./delegation-detector.ts") },
    { name: "quota-steer", timeoutS: 3, load: () => import("./quota-steer.ts") },
    { name: "escalate-model", timeoutS: 3, load: () => import("./escalate-model.ts") },
  ],
  PreToolUse: [
    {
      name: "safety-net",
      matcher: "Bash",
      timeoutS: 5,
      failClosed: "Safety Net",
      load: () => import("./safety-net.ts"),
    },
    // freeze-guard runs before pre-edit-validate so a slow validation cannot
    // spend the shared entry budget and skip the freeze boundary check.
    {
      name: "freeze-guard",
      matcher: "Edit|Write",
      timeoutS: 5,
      load: () => import("./freeze-guard.ts"),
    },
    {
      name: "test-protect",
      matcher: "Bash|Edit|Write",
      timeoutS: 5,
      load: () => import("./test-protect.ts"),
    },
    {
      name: "pre-edit-validate",
      matcher: "Edit",
      timeoutS: 5,
      load: () => import("./pre-edit-validate.ts"),
    },
    {
      name: "knowledge-hint",
      matcher: "Bash|Edit|Write",
      timeoutS: 5,
      load: () => import("./knowledge-hint.ts"),
    },
  ],
  PostToolUse: [
    { name: "post-edit", matcher: "Write|Edit", load: () => import("../scripts/post-edit.ts") },
    {
      name: "tool-cadence",
      matcher: "Bash|Agent",
      timeoutS: 3,
      load: () => import("./tool-cadence.ts"),
    },
    {
      name: "promote-memory",
      matcher: "Write|Edit",
      timeoutS: 3,
      load: () => import("./promote-memory.ts"),
    },
    {
      name: "escalate-acted",
      matcher: "Agent",
      timeoutS: 3,
      load: () => import("./escalate-acted.ts"),
    },
  ],
};

/** Timeout of the event's config entry: the max of its handlers', undefined
 *  when any handler has none (the entry then takes Claude Code's default). */
export function entryTimeoutS(handlers: readonly Handler[]): number | undefined {
  if (handlers.some((h) => h.timeoutS === undefined)) return undefined;
  return Math.max(...handlers.map((h) => h.timeoutS ?? 0));
}

// Left of the entry timeout for Bun startup, output and exit.
const ENTRY_MARGIN_MS = 400;

export interface DispatchResult {
  block?: { handler: string; reason: string };
  context: string[];
  asks: string[];
  /** One stderr line per skipped or failed handler. */
  errors: string[];
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function within(work: Promise<void>, ms: number): Promise<void> {
  // The handler cannot be cancelled; once it loses the race its late rejection
  // must not surface as an unhandled one.
  work.catch(() => {});
  if (!Number.isFinite(ms)) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Run the handlers that match the payload's tool, in order, and combine them. */
export async function runHandlers(
  raw: string,
  handlers: readonly Handler[],
  entryTimeout: number | undefined = entryTimeoutS(handlers),
): Promise<DispatchResult> {
  const startedAt = Date.now();
  const deadlineAt =
    entryTimeout === undefined ? Infinity : startedAt + entryTimeout * 1000 - ENTRY_MARGIN_MS;
  const { tool_name: toolName = "" } = parseHookInput<{ tool_name: string }>(raw, {
    tool_name: "TOOL_NAME",
  });
  const result: DispatchResult = { context: [], asks: [], errors: [] };

  for (const handler of handlers) {
    if (!matchesTool(handler.matcher ?? null, toolName)) continue;
    const io = captureIO(raw);
    try {
      const limitMs = handler.failClosed
        ? Infinity
        : Math.min((handler.timeoutS ?? Infinity) * 1000, deadlineAt - Date.now());
      if (limitMs <= 0) {
        result.errors.push(`[dispatch] ${handler.name}: skipped, no time left`);
        continue;
      }
      const { main } = await handler.load();
      await within(main(io), limitMs);
      result.context.push(...io.contexts);
      result.asks.push(...io.asks);
    } catch (err) {
      // Keep guidance emitted before the failure (quota-steer and
      // escalate-model emit before writing state); drop anything emitted later.
      io.close();
      result.context.push(...io.contexts);
      result.asks.push(...io.asks);
      if (err instanceof HookBlocked) {
        result.block ??= { handler: handler.name, reason: err.reason };
      } else if (handler.failClosed) {
        const message = `[${handler.failClosed}] internal error, failing closed: ${detail(err)}`;
        result.errors.push(message);
        result.block ??= { handler: handler.name, reason: message };
      } else {
        result.errors.push(`[dispatch] ${handler.name}: skipped, ${detail(err)}`);
      }
      // A failClosed handler only gets here by blocking. Answer at once: the
      // handlers after it are advisory and must not delay the verdict.
      if (handler.failClosed) break;
    }
  }
  return result;
}

function isDispatchEvent(value: string | undefined): value is DispatchEvent {
  return value !== undefined && Object.hasOwn(HANDLERS, value);
}

/** The single response for the event: stdout (empty for a silent allow) and exit code. */
export function respond(
  event: DispatchEvent,
  result: DispatchResult,
): { stdout: string; exit: 0 | 2 } {
  if (result.block) {
    return {
      stdout: `${JSON.stringify({ decision: "block", reason: result.block.reason })}\n`,
      exit: 2,
    };
  }
  if (result.asks.length === 0 && result.context.length === 0) return { stdout: "", exit: 0 };
  const hookSpecificOutput = {
    hookEventName: event,
    ...(result.asks.length > 0 && {
      permissionDecision: "ask",
      permissionDecisionReason: result.asks.join("\n"),
    }),
    ...(result.context.length > 0 && { additionalContext: result.context.join("\n") }),
  };
  return { stdout: `${JSON.stringify({ hookSpecificOutput })}\n`, exit: 0 };
}

async function main(): Promise<void> {
  const event = process.argv[2];
  if (!isDispatchEvent(event)) {
    throw new Error(`usage: dispatch.ts ${Object.keys(HANDLERS).join("|")}`);
  }
  const result = await runHandlers(await Bun.stdin.text(), HANDLERS[event]);
  for (const line of result.errors) writeSync(2, `${line}\n`);
  const { stdout, exit } = respond(event, result);
  if (stdout) writeSync(1, stdout);
  // Exit explicitly: a handler that timed out may still be running.
  process.exit(exit);
}

if (import.meta.main) {
  await main().catch((err) => {
    writeSync(2, `[dispatch] ${detail(err)}\n`);
    process.exit(1);
  });
}
