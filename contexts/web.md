# Web Development Context

> Default context for Next.js, React, and Tailwind projects at Darkroom Engineering.

---

## Behavioral Mode

**Server-first, performance-obsessed, accessibility-aware.**

- Default to Server Components; add `'use client'` only when required
- Eliminate waterfalls before adding features
- Accessibility is not optional - check every component
- React Compiler is active - no manual memoization

---

## Priorities (Ordered)

1. **Correctness** - Does it work? Are types sound?
2. **Accessibility** - Can everyone use it?
3. **Performance** - Is it fast? Bundle size minimal?
4. **Maintainability** - Will future devs understand it?
5. **DX** - Is the code pleasant to work with?

---

## Favored Tools & Commands

| Task | Command/Tool |
|------|--------------|
| Package manager | `bun` (never npm/yarn) |
| Linting/formatting | `bun biome check --fix` |
| Type checking | `bun tsc --noEmit` |
| Dev server | `bun dev` |
| Build | `bun build` |
| Fetch docs | `/docs <library>` |
| Visual QA | `/qa` or `agent-browser` |

---

## Required Patterns

### Imports
```tsx
// CSS modules aliased as 's'
import s from './component.module.css'

// Always use wrappers, never native
import { Image } from '@/components/image'
import { Link } from '@/components/link'
```

### No Memoization
```tsx
// React Compiler handles this automatically
const value = expensiveComputation(a, b)

// Exception: object instantiation
const instance = useRef(new SomeClass())
```

### Parallel Fetching
```tsx
// Always parallel, never sequential
const [user, posts] = await Promise.all([
  fetchUser(),
  fetchPosts()
])
```

---

## Gotchas & Pitfalls

| Pitfall | Fix |
|---------|-----|
| Barrel imports (`lucide-react`) | Use direct imports or `optimizePackageImports` |
| `useMemo`/`useCallback`/`memo` | Remove - React Compiler handles it |
| Sequential awaits | Use `Promise.all()` for independent fetches |
| `h-screen` on mobile | Use `h-dvh` instead |
| `&& count` rendering `0` | Use ternary: `count > 0 ? <X /> : null` |
| Missing `alt` on images | Always provide meaningful alt text |
| `div` with `onClick` | Use semantic elements (`button`, `a`) |
| Inline styles | Use Tailwind or CSS modules |

---

## Documentation Sources

- **Next.js**: `/docs nextjs` or [nextjs.org/docs](https://nextjs.org/docs)
- **React 19**: `/docs react`
- **Tailwind v4**: `/docs tailwind`
- **Biome**: [biomejs.dev](https://biomejs.dev)
- **Lenis**: `/docs lenis`
- **GSAP**: `/docs gsap`

---

## Pre-Implementation Checklist

- [ ] Fetched latest docs for libraries used
- [ ] Checked latest package versions with `bun info`
- [ ] Using Satus conventions if applicable
- [ ] Server Component unless interactivity needed
- [ ] No sequential awaits
- [ ] Accessibility attributes present
