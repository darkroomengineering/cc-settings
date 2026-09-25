---
name: hook
description: Create a reusable React hook (useX). Triggers "create hook", "new hook", "custom hook", a useX-style name, or extracting logic out of a component.
argument-hint: "[hookName]"
---

# Create Custom Hook

Create a custom React hook following Darkroom conventions. The hook itself is stack-agnostic — what differs between satus and novus is the path alias.

## Step 1 — Check existing abstractions

Apply the Laziness Ladder before scaffolding, even when the request proposes a
hook name. Search project hooks, utilities, and callers by behavior and related
terms; read matching implementations to check their contract and import path.
Prefer a matching project hook, including wrappers around `hamo`, over direct
dependency calls or a new wrapper. If one fits, use it and stop here.

For example, in Satus, search for `useDeviceDetection`, `isDesktop`, and media-query
usage before adding `useIsDesktop` or repeating a breakpoint string. When the local
contract matches the requirement, use `const { isDesktop } = useDeviceDetection()`
with the verified local import. Check breakpoint semantics and server/initial
render behavior; do not assume every media query means the same thing.

If no project abstraction fits, check runtime/platform APIs and installed
dependencies. For common hook behavior, check installed `hamo` hooks using the
documentation procedure below. Before creating a hook, name the implementations
checked and the behavior they lack; then continue only for that gap.

## Step 2 — Detect stack

Read `package.json`:
- `dependencies.next` → satus / Next.js (path alias `@/`, hooks require a `'use client'` boundary)
- `dependencies["react-router"]` → novus / React Router (path alias `~/`, components isomorphic)

## Step 3 — Choose location

| Stack | Hook path |
|---|---|
| satus | `lib/hooks/<name>.ts` |
| novus | `hooks/<name>.ts` (novus puts `hooks/` at the project root) |

Confirm by checking the existing `lib/hooks/` or `hooks/` directory structure if either pattern is unclear from package.json alone.

## Step 4 — Emit template

### satus / Next.js
```tsx
// lib/hooks/<name>.ts
'use client'
// Client Components can prerender on the server. Read browser APIs in effects
// or event handlers, with the same initial state on the server and browser.

import { useState, useEffect } from 'react'

interface Use<Name>Options {
  // Hook configuration options
}

interface Use<Name>Return {
  // Return type definition
}

export function use<Name>(options?: Use<Name>Options): Use<Name>Return {
  // Implementation
  return {
    // Return values
  }
}
```

### novus / React Router
```tsx
// hooks/<name>.ts
// No 'use client' — RR components are isomorphic; the hook runs wherever
// it's called from. Read browser APIs in effects or event handlers, with the
// same initial state on the server and browser.

import { useState, useEffect } from 'react'

interface Use<Name>Options {
  // Hook configuration options
}

interface Use<Name>Return {
  // Return type definition
}

export function use<Name>(options?: Use<Name>Options): Use<Name>Return {
  // Implementation
  return {
    // Return values
  }
}
```

## Conventions (both stacks)

1. **Type everything** — options interface, return interface.
2. **Named export** — `export function useX`, not default.
3. **Prefix with `use`** — React hook naming convention.
4. **No memoization** — React Compiler handles it automatically.
5. **Hydration-safe state** — both stacks can render on the server. Use a
   deterministic initial value for the server render and first browser render;
   `'use client'` does not disable prerendering. A `typeof window` branch in a
   lazy state initializer can still produce different markup and a hydration
   mismatch. Read `localStorage` in an effect, and finish that read before
   enabling an effect that persists state, so initial defaults cannot overwrite
   stored values.

## Stack-specific

| | satus | novus |
|---|---|---|
| Directive | `'use client'` (hooks live in client boundary) | None (isomorphic) |
| Browser APIs | SSR-safe initial state; effects or event handlers | SSR-safe initial state; effects or event handlers |
| Path alias | `@/` | `~/` |

## Before you start

If this hook uses an external library, **fetch docs first**:
1. Use Context7 MCP (`mcp__context7__resolve-library-id` → `get-library-docs`) in Claude or when the user configured it in standalone Codex. Otherwise use official docs through native browsing or inspect the pinned local package. cc-settings does not auto-run unpinned registry MCP packages in Codex.
2. Run `bun info <package>` to check the latest version.

## Example

```
User: "create a useLocalStorage hook" (in satus repo)
→ Checks project hooks, platform APIs, and installed dependencies first; only for an uncovered gap, creates lib/hooks/use-local-storage.ts with 'use client', deterministic initial state, effect-based storage read before writes

User: "create a useLocalStorage hook" (in novus repo)
→ Checks project hooks, platform APIs, and installed dependencies first; only for an uncovered gap, creates hooks/use-local-storage.ts, no directive, deterministic initial state, effect-based storage read before writes
```

## Arguments

- `$ARGUMENTS` — Hook name (e.g., "useAuth", "useLocalStorage")
