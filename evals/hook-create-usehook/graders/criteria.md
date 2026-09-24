---
type: llm
weight: 1
---

PASS if the response places the hook at `lib/hooks/use-local-storage.ts`, includes a `'use client'` directive, uses a deterministic SSR-safe initial state (no branch that returns different values on server vs. first client render), and reads `localStorage` inside an effect rather than synchronously during render.

FAIL if it omits `'use client'`, uses the `~/` (novus) alias instead of `@/` (satus), or reads `localStorage` outside an effect in a way that could cause a hydration mismatch.
