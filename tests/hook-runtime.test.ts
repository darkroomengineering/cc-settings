// Boundary-guard tests for hook-runtime's JSON normalization. readHookInput and
// readState previously cast a parsed null/array/scalar straight to an object
// type; these lock the guard that stops that (isPlainObject) and the
// fallback-aware coercion readState applies (coerceState).

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { coerceState, isPlainObject } from "../src/lib/hook-runtime.ts";
import { spawnCapture } from "./support/proc.ts";

describe("isPlainObject", () => {
  test("true only for non-null, non-array objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  test("false for null, arrays, and scalars", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2])).toBe(false);
    expect(isPlainObject("str")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
  });
});

describe("coerceState", () => {
  test("object fallback + non-object stored value → fallback (corruption guard)", () => {
    expect(coerceState(null, {})).toEqual({});
    expect(coerceState([1, 2], {})).toEqual({});
    expect(coerceState("oops", { a: 1 })).toEqual({ a: 1 });
    expect(coerceState(42, { a: 1 })).toEqual({ a: 1 });
  });

  test("object fallback + object stored value → the stored value", () => {
    expect(coerceState({ b: 2 }, {})).toEqual({ b: 2 });
  });

  test("null/scalar fallback opts out — raw value is returned to self-validate", () => {
    // Mirrors the real readState<unknown>(…, null) callers: T is unknown, so the
    // raw parse is handed back untouched for the caller to validate.
    expect(coerceState<unknown>([1, 2, 3], null)).toEqual([1, 2, 3]);
    expect(coerceState<unknown>("raw", null)).toBe("raw");
    expect(coerceState<unknown>({ x: 1 }, null)).toEqual({ x: 1 });
    expect(coerceState<unknown>(null, null)).toBe(null);
  });
});

describe("readToolInput", () => {
  const RUNTIME = resolve(import.meta.dir, "..", "src", "lib", "hook-runtime.ts");
  const PROBE = `import { readToolInput } from ${JSON.stringify(RUNTIME)}; console.log(JSON.stringify(await readToolInput()));`;

  async function read(
    stdin: string,
    env: Record<string, string | undefined> = {},
  ): Promise<unknown> {
    const r = await spawnCapture(["bun", "-e", PROBE], {
      stdin,
      env: { TOOL_INPUT: undefined, TOOL_INPUT_command: undefined, ...env },
    });
    expect(r.exit).toBe(0);
    return JSON.parse(r.stdout);
  }

  test("stdin tool_input wins over the env vars", async () => {
    const out = await read(JSON.stringify({ tool_input: { command: "from-stdin" } }), {
      TOOL_INPUT: JSON.stringify({ command: "from-env" }),
      TOOL_INPUT_command: "from-env-scalar",
    });
    expect(out).toEqual({ command: "from-stdin" });
  });

  test("a stdin object without tool_input is empty input, not a reason to read env", async () => {
    const out = await read(JSON.stringify({ session_id: "s" }), {
      TOOL_INPUT: JSON.stringify({ command: "from-env" }),
    });
    expect(out).toEqual({});
  });

  test("empty stdin falls back to the TOOL_INPUT JSON env var", async () => {
    const out = await read("", { TOOL_INPUT: JSON.stringify({ file_path: "/a.ts", n: 1 }) });
    expect(out).toEqual({ file_path: "/a.ts", n: 1 });
  });

  test("empty stdin falls back to TOOL_INPUT_<key> scalars", async () => {
    const out = await read("", { TOOL_INPUT_command: "ls -la" });
    expect(out).toEqual({ command: "ls -la" });
  });

  test("scalars overlay the TOOL_INPUT JSON env var", async () => {
    const out = await read("", {
      TOOL_INPUT: JSON.stringify({ command: "a", old_string: "keep" }),
      TOOL_INPUT_command: "b",
    });
    expect(out).toEqual({ command: "b", old_string: "keep" });
  });

  test("unparseable or non-object stdin also falls back to env", async () => {
    expect(await read("not json{{{", { TOOL_INPUT_command: "x" })).toEqual({ command: "x" });
    expect(await read("[1,2]", { TOOL_INPUT_command: "x" })).toEqual({ command: "x" });
  });

  test("no stdin and no env → {}", async () => {
    expect(await read("")).toEqual({});
    expect(await read("not json{{{", { TOOL_INPUT: "{{{ not json" })).toEqual({});
  });
});
