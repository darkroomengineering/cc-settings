// Shared runtime for cc-settings hooks. Patterns the hooks share: stdin-JSON
// parsing (hook input and tool_input) with env fallback, ~/.claude/tmp/<name>.json
// state IO, top-level fail-open wrapper.

import { writeSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { isPlainObject } from "./merge-keyed.ts";
import { claudePath } from "./platform.ts";

const TMP_DIR = claudePath("tmp");

export { isPlainObject };

/** Normalize a parsed state value against the caller's fallback. When the
 *  fallback is an object, the caller expects object semantics, so a stored
 *  non-object (null/array/scalar) is corruption → return the fallback. Callers
 *  that pass a null/scalar fallback (e.g. readState<unknown>(…, null)) opt out
 *  and get the raw value to self-validate. Pure/exported for testing. */
export function coerceState<T>(parsed: unknown, fallback: T): T {
  if (isPlainObject(fallback) && !isPlainObject(parsed)) return fallback;
  return parsed as T;
}

// stdin is a one-shot stream; memoize so readHookInput and readToolInput can
// both run in one hook process. Handlers run by the dispatcher never touch it:
// they get a HookIO over the dispatcher's own copy of the payload (captureIO).
let stdinText: Promise<string> | undefined;
function readStdin(): Promise<string> {
  stdinText ??= Bun.stdin.text();
  return stdinText;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Parse a hook payload; on parse failure OR a non-object payload, fall back to
 *  env.
 *
 *  Subtlety: the env fallback fires when the text fails to parse as JSON, or
 *  parses to something that isn't an object (null, an array, a scalar) — none of
 *  those carry hook fields, so treating them like a parse failure keeps callers
 *  from destructuring a non-object. A valid-but-empty payload (`{}`) parses fine
 *  and intentionally skips the env fallbacks — well-formed input with missing
 *  fields means "the event really had no fields", not "look elsewhere". */
export function parseHookInput<T extends Record<string, unknown>>(
  raw: string,
  envFallbacks?: Partial<Record<keyof T & string, string>>,
): Partial<T> {
  const parsed = parseJson(raw);
  if (isPlainObject(parsed)) return parsed as Partial<T>;
  if (!envFallbacks) return {};
  const out: Record<string, unknown> = {};
  for (const [k, envVar] of Object.entries(envFallbacks)) {
    if (envVar && process.env[envVar]) out[k] = process.env[envVar];
  }
  return out as Partial<T>;
}

/** Read the stdin JSON payload through parseHookInput. */
export async function readHookInput<T extends Record<string, unknown>>(
  envFallbacks?: Partial<Record<keyof T & string, string>>,
): Promise<Partial<T>> {
  return parseHookInput<T>(await readStdin(), envFallbacks);
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

/** Parse the tool input of a PreToolUse/PostToolUse payload. Claude Code
 *  delivers it as `tool_input` in the stdin JSON payload. The `TOOL_INPUT` JSON
 *  env var plus `TOOL_INPUT_<key>` scalars are the fallback, used only when the
 *  payload is empty, unparseable, or not an object; the Codex shim
 *  (scripts/codex-hook.ts) sets them. Returns {} when neither source has input —
 *  fail-open: missing input must never produce a block. */
export function parseToolInput<T>(raw: string): Partial<T> {
  const payload = parseJson(raw);
  if (isPlainObject(payload)) {
    return (isPlainObject(payload.tool_input) ? payload.tool_input : {}) as Partial<T>;
  }
  const fromEnv = parseJson(process.env.TOOL_INPUT ?? "");
  const out: Record<string, unknown> = isPlainObject(fromEnv) ? { ...fromEnv } : {};
  const prefix = "TOOL_INPUT_";
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && key.length > prefix.length && value !== undefined) {
      out[key.slice(prefix.length)] = value;
    }
  }
  return out as Partial<T>;
}

/** Read the stdin payload's tool input through parseToolInput. */
export async function readToolInput<T>(): Promise<Partial<T>> {
  return parseToolInput<T>(await readStdin());
}

/** Emit the documented PreToolUse block decision and exit 2.
 *  Protocol (docs/hooks-reference.md): exit 2 + `{"decision":"block","reason":…}`
 *  JSON on stdout. Shared by safety-net, freeze-guard, and pre-edit-validate so
 *  the block grammar cannot drift between hooks. */
export function blockDecision(reason: string): never {
  writeSync(1, `${JSON.stringify({ decision: "block", reason })}\n`);
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

/** Emit an arbitrary hookSpecificOutput payload on stdout — the general form of
 *  emitAdditionalContext for hooks (e.g. PreModelSwitch's ask/allow decision)
 *  whose contract carries fields beyond additionalContext. */
export function emitHookSpecificOutput(
  hookEventName: string,
  fields: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName, ...fields },
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

/** What a hook handler does to the outside world: read its payload, hand
 *  context to the model, and block. A handler takes a HookIO so one function
 *  serves both launch modes: its own process (processIO) and inside
 *  src/hooks/dispatch.ts (captureIO). */
export interface HookIO {
  hookInput<T extends Record<string, unknown>>(
    envFallbacks?: Partial<Record<keyof T & string, string>>,
  ): Promise<Partial<T>>;
  toolInput<T>(): Promise<Partial<T>>;
  context(hookEventName: string, text: string): void;
  block(reason: string): never;
}

/** This process's stdin and stdout: `block` prints the block decision and exits 2. */
export const processIO: HookIO = {
  hookInput: readHookInput,
  toolInput: readToolInput,
  context: emitAdditionalContext,
  block: blockDecision,
};

/** Thrown by `captureIO(...).block`. A handler that catches it must rethrow. */
export class HookBlocked extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "HookBlocked";
  }
}

export interface CapturedIO extends HookIO {
  /** additionalContext strings in emission order. */
  readonly contexts: string[];
  /** Drop everything the handler emits from now on (it timed out). */
  close(): void;
}

/** A HookIO over an already-read payload that collects output instead of printing it. */
export function captureIO(raw: string): CapturedIO {
  let closed = false;
  const contexts: string[] = [];
  return {
    contexts,
    close: () => {
      closed = true;
    },
    hookInput: async (envFallbacks) => parseHookInput(raw, envFallbacks),
    toolInput: async () => parseToolInput(raw),
    context: (_hookEventName, text) => {
      if (!closed) contexts.push(text);
    },
    block: (reason) => {
      throw new HookBlocked(reason);
    },
  };
}
