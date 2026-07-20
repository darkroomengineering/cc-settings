// Shared runtime for cc-settings hooks. Three patterns the parallelmax hooks
// duplicate: stdin-JSON parsing with env fallback, ~/.claude/tmp/<name>.json
// state IO, top-level fail-open wrapper. Extracted in v11.1.1 — see CHANGELOG.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudePath } from "./platform.ts";

const TMP_DIR = claudePath("tmp");

/** Read a stdin JSON payload; on parse failure, fall back to env.
 *
 *  Subtlety: the env fallback fires ONLY when stdin fails to parse as JSON.
 *  A valid-but-empty payload (`{}`) parses fine and intentionally skips the
 *  env fallbacks — well-formed input with missing fields means "the event
 *  really had no fields", not "look elsewhere". */
export async function readHookInput<T extends Record<string, unknown>>(
  envFallbacks?: Partial<Record<keyof T & string, string>>,
): Promise<Partial<T>> {
  const raw = await Bun.stdin.text();
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    if (!envFallbacks) return {};
    const out: Record<string, unknown> = {};
    for (const [k, envVar] of Object.entries(envFallbacks)) {
      if (envVar && process.env[envVar]) out[k] = process.env[envVar];
    }
    return out as Partial<T>;
  }
}

/** Read a JSON state file at ~/.claude/tmp/<name>.json. Returns fallback on any error. */
export async function readState<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(join(TMP_DIR, name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write to ~/.claude/tmp/<name>.json. Creates the dir if missing.
 *  Uses a tmp-file + rename so a crash never leaves a half-written target. */
export async function writeState(name: string, data: unknown): Promise<void> {
  await mkdir(TMP_DIR, { recursive: true });
  const target = join(TMP_DIR, name);
  const tmp = join(TMP_DIR, `.${process.pid}-${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, target);
}

/** Parse the TOOL_INPUT env JSON blob (the full tool input Claude Code passes
 *  to PreToolUse hooks). Returns {} on missing or malformed JSON — fail-open:
 *  unparseable input must never produce a block. */
export function readToolInputEnv<T>(): Partial<T> {
  try {
    return JSON.parse(process.env.TOOL_INPUT ?? "{}") as Partial<T>;
  } catch {
    return {};
  }
}

/** Emit the documented PreToolUse block decision and exit 2.
 *  Protocol (docs/hooks-reference.md): exit 2 + `{"decision":"block","reason":…}`
 *  JSON on stdout. Shared by safety-net, freeze-guard, and pre-edit-validate so
 *  the block grammar cannot drift between hooks. */
export function blockDecision(reason: string): never {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
  process.exit(2);
}

/** Emit a hookSpecificOutput.additionalContext message on stdout — the
 *  non-blocking counterpart to blockDecision. Shared by every hook that
 *  surfaces a nudge/reminder to the model (tool-cadence, delegation-detector,
 *  quota-steer, promote-memory) so the JSON shape can't drift between them. */
export function emitAdditionalContext(hookEventName: string, context: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName, additionalContext: context },
    }),
  );
}

/** Run a hook main() with the cc-settings fail-open convention. Catches and
 *  swallows any error so a hook never blocks a tool call. */
export async function runHook(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch {
    // Fail open — never break a tool call due to a hook error.
  }
}
