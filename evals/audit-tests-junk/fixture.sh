#!/usr/bin/env bash
set -euo pipefail

mkdir -p src tests

cat > package.json <<'JSON'
{
  "name": "fixture-pricing",
  "version": "0.0.1",
  "scripts": { "test": "bun test" }
}
JSON

cat > src/price.ts <<'TS'
export function applyDiscount(cents: number, percent: number): number {
  if (percent < 0 || percent > 100) throw new RangeError("percent out of range")
  return Math.round(cents * (1 - percent / 100))
}

// Only the tests import this.
export function _debugRound(n: number): number {
  return Math.round(n)
}
TS

cat > src/checkout.ts <<'TS'
import { applyDiscount } from "./price"

export interface Gateway {
  charge(cents: number): Promise<{ ok: boolean }>
}

export async function checkout(gateway: Gateway, cents: number, percent: number) {
  const total = applyDiscount(cents, percent)
  return gateway.charge(total)
}
TS

cat > tests/price.test.ts <<'TS'
import { expect, test } from "bun:test"
import { _debugRound, applyDiscount } from "../src/price"

test("20% off 1000 cents is 800", () => {
  expect(applyDiscount(1000, 20)).toBe(800)
})

test("rejects a discount above 100%", () => {
  expect(() => applyDiscount(1000, 150)).toThrow(RangeError)
})

test("discount matches itself", () => {
  const expected = applyDiscount(999, 15)
  expect(applyDiscount(999, 15)).toBe(expected)
})

test("debug rounding", () => {
  expect(_debugRound(1.4)).toBe(1)
})

test("applyDiscount runs", () => {
  applyDiscount(500, 10)
})
TS

cat > tests/checkout.test.ts <<'TS'
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { checkout } from "../src/checkout"

test("checkout charges successfully", async () => {
  const gateway = { charge: async () => ({ ok: true }) }
  expect(await checkout(gateway, 1000, 20)).toEqual({ ok: true })
})

test("checkout imports applyDiscount", () => {
  const src = readFileSync("src/checkout.ts", "utf8")
  expect(src).toContain('import { applyDiscount } from "./price"')
})
TS
