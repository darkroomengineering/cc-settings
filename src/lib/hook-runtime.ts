// Shared runtime for cc-settings hooks. Three patterns the parallelmax hooks
// duplicate: stdin-JSON parsing with env fallback, ~/.claude/tmp/<name>.json
// state IO, top-level fail-open wrapper. Extracted in v11.1.1 — see CHANGELOG.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { claudePath } from "./platform.ts";

const TMP_DIR = claudePath("tmp");

/** True for a non-null, non-array object — the only JSON shape that carries
 *  named fields. The JSON boundary guard for readHookInput/readState so a
 *  parsed `null`, array, or scalar is never handed back typed as an object.
 *  Exported for the boundary tests. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Normalize a parsed state value against the caller's fallback. When the
 *  fallback is an object, the caller expects object semantics, so a stored
 *  non-object (null/array/scalar) is corruption → return the fallback. Callers
 *  that pass a null/scalar fallback (e.g. readState<unknown>(…, null)) opt out
 *  and get the raw value to self-validate. Pure/exported for testing. */
export function coerceState<T>(parsed: unknown, fallback: T): T {
  if (isPlainObject(fallback) && !isPlainObject(parsed)) return fallback;
  return parsed as T;
}

/** Read a stdin JSON payload; on parse failure OR a non-object payload, fall
 *  back to env.
 *
 *  Subtlety: the env fallback fires when stdin fails to parse as JSON, or parses
 *  to something that isn't an object (null, an array, a scalar) — none of those
 *  carry hook fields, so treating them like a parse failure keeps callers from
 *  destructuring a non-object. A valid-but-empty payload (`{}`) parses fine and
 *  intentionally skips the env fallbacks — well-formed input with missing fields
 *  means "the event really had no fields", not "look elsewhere". */
export async function readHookInput<T extends Record<string, unknown>>(
  envFallbacks?: Partial<Record<keyof T & string, string>>,
): Promise<Partial<T>> {
  const raw = await Bun.stdin.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (isPlainObject(parsed)) return parsed as Partial<T>;
  if (!envFallbacks) return {};
  const out: Record<string, unknown> = {};
  for (const [k, envVar] of Object.entries(envFallbacks)) {
    if (envVar && process.env[envVar]) out[k] = process.env[envVar];
  }
  return out as Partial<T>;
}

/** Read a JSON state file at ~/.claude/tmp/<name>.json. Returns fallback on any
 *  error, and (when the fallback is an object) on a stored non-object value —
 *  see coerceState.
 *
 *  `tmpDir` defaults to the real ~/.claude/tmp, which is what every hook wants.
 *  Callers that are already parameterized by an install directory (gatherStatus)
 *  pass theirs, so they don't read host state while claiming to read a fixture. */
export async function readState<T>(
  name: string,
  fallback: T,
  tmpDir: string = TMP_DIR,
): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(tmpDir, name), "utf8"));
  } catch {
    return fallback;
  }
  return coerceState(parsed, fallback);
}

/** Read + zod-validate a JSON state file in one call. Composes readState (fallback
 *  on any read/parse error) with schema.safeParse (fallback on a well-formed but
 *  invalid shape) — the idiom duplicated across quota.ts and statusline.ts before
 *  N9. `fallback` is returned in both failure cases, never a throw or raw garbage. */
export async function readValidatedState<T>(
  name: string,
  schema: z.ZodType<T>,
  fallback: T,
  tmpDir?: string,
): Promise<T> {
  const raw = await readState<unknown>(name, null, tmpDir);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
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
