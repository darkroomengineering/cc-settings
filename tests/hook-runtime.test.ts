// Boundary-guard tests for hook-runtime's JSON normalization. readHookInput and
// readState previously cast a parsed null/array/scalar straight to an object
// type; these lock the guard that stops that (isPlainObject) and the
// fallback-aware coercion readState applies (coerceState).

import { describe, expect, test } from "bun:test";
import { coerceState, isPlainObject } from "../src/lib/hook-runtime.ts";

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
