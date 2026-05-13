---
name: lenis
description: Set up Lenis smooth scroll. Triggers "smooth scroll", "lenis", "scroll behavior", scroll-based animations.
---

# Lenis Smooth Scroll Setup

Set up Lenis for smooth scrolling. Both satus and novus include Lenis pre-wired — only set this up manually for projects that didn't start from a Darkroom template.

## Step 1 — Detect stack

Read `package.json`:
- `dependencies.next` → Next.js / satus mount point
- `dependencies["react-router"]` → React Router / novus mount point

## Step 2 — Install (if not already)

```bash
bun add lenis@latest
```

Check first: run `bun info lenis` to get the current version, and check `package.json` to see if it's already installed.

## Step 3 — Mount

Both stacks use the same `ReactLenis` provider. The difference is *where* it's mounted.

### Provider component (both stacks)

```tsx
// components/lenis/index.tsx (satus) or components/lenis/index.tsx (novus)
'use client'  // satus only — RR doesn't need this directive

import { ReactLenis } from 'lenis/react'

interface LenisProps {
  children: React.ReactNode
}

export function Lenis({ children }: LenisProps) {
  return (
    <ReactLenis
      root
      options={{
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        orientation: 'vertical',
        smoothWheel: true,
      }}
    >
      {children}
    </ReactLenis>
  )
}
```

### Mount in satus
```tsx
// app/layout.tsx
import { Lenis } from '@/components/lenis'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Lenis>{children}</Lenis>
      </body>
    </html>
  )
}
```

### Mount in novus
```tsx
// app/root.tsx
import { Lenis } from '~/components/lenis'

export default function Root() {
  return (
    <html>
      <body>
        <Lenis>
          <Outlet />
        </Lenis>
      </body>
    </html>
  )
}
```

> Both starters already ship Lenis wired up — check `components/lenis/` and the root layout/root file before doing this manually.

## Using Lenis

### Scroll to element (any stack)
```tsx
import { useLenis } from 'lenis/react'

function Component() {
  const lenis = useLenis()
  const scrollToSection = () => lenis?.scrollTo('#section-id', { duration: 1.5 })
  return <button onClick={scrollToSection}>Scroll</button>
}
```

### Scroll events (any stack)
```tsx
useLenis(({ scroll, velocity, direction }) => {
  // React to scroll
})
```

### With GSAP ScrollTrigger (any stack)
```tsx
import { useLenis } from 'lenis/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

useLenis(() => {
  ScrollTrigger.update()
})
```

## Remember

- Always fetch current Lenis docs via Context7 MCP before implementing — APIs change.
- Both starters pre-wire this; only do it manually for non-Darkroom projects.
- Store any gotchas as learnings.
