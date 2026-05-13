---
name: component
description: Create UI component / widget / reusable piece. Triggers "create component", "new component", "add component", or naming a component (Button, Header, Card).
argument-hint: "[ComponentName]"
---

# Create Darkroom Component

Create a React component following Darkroom conventions. **Detect the stack first** — satus (Next.js) and novus (React Router) have different conventions for client/server boundaries, image/link wrappers, and path aliases.

## Step 1 — Detect stack

Read `package.json`:
- `dependencies.next` present → Next.js / satus conventions
- `dependencies["react-router"]` or `devDependencies["@react-router/dev"]` → React Router / novus conventions
- Neither → ask user, or assume satus if unclear

## Step 2 — Resolve target paths

| Stack | Component path | CSS module path | Image wrapper | Link wrapper | Path alias |
|---|---|---|---|---|---|
| satus (Next.js) | `components/<name>/index.tsx` | `components/<name>/<name>.module.css` | `import { Image } from '@/components/image'` | `import { Link } from '@/components/link'` | `@/` |
| novus (React Router) | `components/<name>/index.tsx` | `components/<name>/<name>.module.css` | Native `<img>` (or project's wrapper if it exists) | `import { Link } from 'react-router'` | `~/` |

## Step 3 — Emit template

### satus / Next.js

```tsx
// components/<name>/index.tsx
// 'use client' — only add if component needs:
// - useState, useEffect, or other hooks
// - Event handlers (onClick, onChange, etc.)
// - Browser APIs (window, document, etc.)

import s from './<name>.module.css'

interface <Name>Props {
  children?: React.ReactNode
  className?: string
}

export function <Name>({ children, className }: <Name>Props) {
  return (
    <div className={`${s.<name>} ${className ?? ''}`}>
      {children}
    </div>
  )
}
```

### novus / React Router

```tsx
// components/<name>/index.tsx
// React Router components are isomorphic — no directive needed.
// They run on server during SSR and on client after hydration.

import s from './<name>.module.css'

interface <Name>Props {
  children?: React.ReactNode
  className?: string
}

export function <Name>({ children, className }: <Name>Props) {
  return (
    <div className={`${s.<name>} ${className ?? ''}`}>
      {children}
    </div>
  )
}
```

### CSS module (both stacks)
```css
.<name> {
  /* Component styles */
}
```

## Before you start

If this component wraps or uses an external library (Radix, Framer Motion, GSAP, etc.):
1. **Fetch docs first** — use Context7 MCP (`mcp__context7__resolve-library-id` → `get-library-docs`) for the current API.
2. **Check version** — run `bun info <package>` before installing.

Never implement against external library APIs from memory.

## Conventions (both stacks)

1. **CSS Module as `s`** — always import as `s` for consistency.
2. **Props interface** — define explicitly, include `className` for composition.
3. **Named export** — use `export function`, not `export default`.
4. **No memoization** — React Compiler handles it.

## Conventions (satus only)

1. **Server Component by default** — only add `'use client'` if needed.
2. **Image wrapper** — `import { Image } from '@/components/image'`.
3. **Link wrapper** — `import { Link } from '@/components/link'`.

## Conventions (novus only)

1. **Components are isomorphic** — no `'use client'` directive.
2. **Path alias is `~/`**, not `@/`.
3. **Link** — `import { Link } from 'react-router'` (declarative routing).
4. **Images** — native `<img>` with explicit `width`/`height`/`fetchPriority`. No project-level wrapper unless the project added one.

## Arguments

- `$ARGUMENTS` — Component name (e.g., "Button", "Header")
- `--client` flag (Next.js only) — Force client component

## Example

```
User: "create a Button component"
→ detect stack → satus → creates components/button/index.tsx + button.module.css with @/-aliased imports

User: "create a Button component" (in novus repo)
→ detect stack → novus → creates same files but with ~/-aliased imports and no 'use client' directive
```
