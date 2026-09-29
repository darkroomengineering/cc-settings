#!/usr/bin/env bash
set -euo pipefail

mkdir -p app/api/comments lib tests

cat > package.json <<'JSON'
{
  "name": "fixture-shop",
  "version": "0.0.1",
  "scripts": { "test": "bun test" },
  "dependencies": { "next": "16.0.0", "react": "19.0.0" }
}
JSON

cat > app/api/comments/route.ts <<'TS'
const ADMIN_TOKEN = "sk_live_9f8a7b6c5d4e3f2a1b0c"

export async function POST(request: Request) {
  const body = await request.json()
  const html = `<p>${body.comment}</p>`
  await fetch(`https://internal.example.com/store?token=${ADMIN_TOKEN}`, {
    method: "POST",
    body: html,
  })
  return new Response(html, { headers: { "content-type": "text/html" } })
}
TS

cat > lib/price.ts <<'TS'
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
TS

cat > lib/money.ts <<'TS'
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
TS

cat > tests/price.test.ts <<'TS'
import { test } from "bun:test"
import { formatPrice } from "../lib/price"

test("formatPrice works", () => {
  formatPrice(1999)
})
TS
