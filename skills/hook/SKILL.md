---
name: hook
description: Create reusable React hook (useX pattern). Triggers "create hook", "new hook", "custom hook", "useAuth"/"useScroll"-style names, extracting logic from a component.
argument-hint: "[hookName]"
---

# Create Custom Hook

Create a custom React hook following Darkroom conventions. The hook itself is stack-agnostic — what differs between satus and novus is the path alias.

## Step 1 — Detect stack

Read `package.json`:
- `dependencies.next` → satus / Next.js (path alias `@/`, no `lib/hooks/` requires `'use client'` boundary)
- `dependencies["react-router"]` → novus / React Router (path alias `~/`, components isomorphic)

## Step 2 — Choose location

| Stack | Hook path |
|---|---|
| satus | `lib/hooks/<name>.ts` |
| novus | `hooks/<name>.ts` (novus puts `hooks/` at the project root) |

Confirm by checking the existing `lib/hooks/` or `hooks/` directory structure if either pattern is unclear from package.json alone.

## Step 3 — Emit template

### satus / Next.js
```tsx
// lib/hooks/<name>.ts
'use client'

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
// it's called from. If the hook touches browser APIs, guard with
// `typeof window !== 'undefined'` or call from inside `useEffect`.

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

## Stack-specific

| | satus | novus |
|---|---|---|
| Directive | `'use client'` (hooks live in client boundary) | None (isomorphic) |
| Browser API guard | Only runs after hydration anyway | Guard with `typeof window` or use `useEffect` |
| Path alias | `@/` | `~/` |

## Before you start

If this hook uses an external library, **fetch docs first**:
1. Use Context7 MCP (`mcp__context7__resolve-library-id` → `get-library-docs`) for the current API.
2. Run `bun info <package>` to check the latest version.

## Consider Using Hamo

For common use cases, prefer `hamo` hooks (fetch `hamo` docs via Context7 first):

```tsx
import { useWindowSize, useRect, useIntersectionObserver } from 'hamo'
```

Only create custom hooks when `hamo` doesn't cover the use case.

## Example

```
User: "create a useLocalStorage hook" (in satus repo)
→ Creates lib/hooks/use-local-storage.ts with 'use client' directive

User: "create a useLocalStorage hook" (in novus repo)
→ Creates hooks/use-local-storage.ts, no directive, browser-API-guarded
```

## Arguments

- `$ARGUMENTS` — Hook name (e.g., "useAuth", "useLocalStorage")
