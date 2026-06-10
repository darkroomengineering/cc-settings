---
paths:
  - "**/*.tsx"
  - "components/**/*"
  - "app/**/*"
---

# React Performance Rules

> Critical and High priority optimizations for any React stack.
>
> **Foundation:** `rules/performance.md` covers core patterns (parallel fetching, direct imports, dynamic imports, `React.cache`, lazy state init). This file extends them with re-render and advanced patterns.

The patterns split into:
- **Stack-agnostic** — work in Next.js, React Router, or any React app.
- **Next.js** — Server Components, `next/dynamic`, etc.
- **React Router** — loaders, `lazy()`, `defer()`, etc.

The model picks the right one by reading visible imports in the file you're editing.

## React Compiler Note

**Darkroom projects use React Compiler.** This means:
- Do NOT use `useMemo`, `useCallback`, or `React.memo` — the compiler handles this automatically.
- Use `useRef` for object instantiation to prevent infinite loops.
- The "Re-render Optimization" section below is reference only (compiler handles it).
- Inline JSX literals are fine — `<Button style={{ color: 'red' }} onClick={() => doThing()} />` does NOT cause referential-identity re-renders under Compiler. Don't extract them into `useMemo` / `useCallback` to "fix" something the Compiler already handles. The classic "don't put object/function literals in JSX" advice is pre-Compiler folklore.

---

## CRITICAL: Eliminate Waterfalls

### Server-side waterfalls (Next.js Server Components)

> Nested-async WRONG/CORRECT pattern: see `rules/performance.md` (DON'T block) — prefer sibling composition so each child fetches in parallel.

### Loader waterfalls (React Router)

```tsx
// WRONG: Sequential awaits inside one loader
export async function loader() {
  const user = await getUser()
  const posts = await getPosts(user.id)  // waits for user
  return { user, posts }
}

// CORRECT: Parallelize independent fetches
export async function loader({ params }: Route.LoaderArgs) {
  const [user, posts] = await Promise.all([getUser(params.id), getPosts(params.id)])
  return { user, posts }
}

// BETTER: Split across nested routes — each loader runs in parallel by default
```

> Defer awaits past early exits: see `rules/performance.md`.

---

## CRITICAL: Bundle Size

### Defer third-party libraries

> Dynamic-import patterns: see `rules/performance.md` — this section only adds the WRONG example below.

```tsx
// WRONG (any stack): loads in initial bundle
import { Analytics } from '@vercel/analytics/react'
import gsap from 'gsap'
```

---

## HIGH: Server-Side Performance

### Suspense for streaming

| Stack | Pattern |
|---|---|
| Next.js | Server Component + `<Suspense fallback>` around an async child |
| React Router | `defer()` in loader + `<Await>` + `<Suspense>` |

```tsx
// Next.js
<Suspense fallback={<Skeleton />}>
  <AsyncDataComponent />
</Suspense>

// React Router
import { defer } from 'react-router'
import { Await } from 'react-router'
import { Suspense } from 'react'

export async function loader() {
  return {
    critical: await getCritical(),
    deferred: getSlow(),  // unresolved promise streams in
  }
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <CriticalUI data={loaderData.critical} />
      <Suspense fallback={<Skeleton />}>
        <Await resolve={loaderData.deferred}>{(data) => <SlowUI data={data} />}</Await>
      </Suspense>
    </>
  )
}
```

**Avoid streaming when:**
- Layout depends on data dimensions
- Above-fold SEO content
- Fast queries (< 50 ms)
- Layout shifts unacceptable

---

## HIGH: Client-Side Data Fetching

Both stacks support SWR for client-side cache + revalidation. Prefer route-level loaders / Server Components for initial load, then SWR for client mutations.

```tsx
// Either stack
import useSWR from 'swr'
const { data } = useSWR('/api/users', fetcher)
```

### Deduplicate event listeners (any stack)
```tsx
// WRONG: each component adds its own listener
function useScroll() {
  useEffect(() => {
    window.addEventListener('scroll', handler)
    return () => window.removeEventListener('scroll', handler)
  }, [])
}

// CORRECT: single listener, callback delegation
const callbacks = new Map<string, (e: Event) => void>()
let attached = false

function useScroll(id: string, callback: (e: Event) => void) {
  useEffect(() => {
    callbacks.set(id, callback)
    if (!attached) {
      window.addEventListener('scroll', (e) => {
        callbacks.forEach((cb) => cb(e))
      })
      attached = true
    }
    return () => {
      callbacks.delete(id)
    }
  }, [id, callback])
}
```

---

## MEDIUM: Re-render Optimization

Stack-agnostic.

### Extract expensive work
```tsx
// WRONG: expensive computation runs on early return
function Profile({ user, isLoading }: { user: User; isLoading: boolean }) {
  const avatar = processAvatar(user)
  if (isLoading) return <Skeleton />
  return <img src={avatar} alt={user.name} />
}

// CORRECT: extract to child, skipped on early return
function Profile({ user, isLoading }: { user: User; isLoading: boolean }) {
  if (isLoading) return <Skeleton />
  return <UserAvatar user={user} />
}

function UserAvatar({ user }: { user: User }) {
  return <img src={processAvatar(user)} alt={user.name} />
}
```

### Narrow effect dependencies

> Basic narrowing (`[user]` → `[user.id]`): see `rules/performance.md`.

```tsx
// BETTER: derive boolean for thresholds
const isMobile = width < 768
useEffect(() => { /* … */ }, [isMobile])
```

### Use transitions for non-urgent updates
```tsx
import { startTransition } from 'react'

// WRONG: blocks UI on every scroll
onScroll={() => setScrollY(window.scrollY)}

// CORRECT
onScroll={() => startTransition(() => setScrollY(window.scrollY))}
```

---

## MEDIUM: Rendering Performance

> Conditional rendering with numbers: see `rules/react.md`.

---

## LOW-MEDIUM: JavaScript Performance

- **Early returns** — exit functions as soon as result is determined
- **Index maps** — build lookup objects for O(1) access
- **Cache property access** — store `obj.deeply.nested.value` in variable
- **Use Set/Map** — membership checks O(1) vs O(n)
- **Hoist RegExp** — define patterns outside loops/functions

---

## LOW: Advanced Patterns

### Store handlers in refs (any stack)
```tsx
const handlerRef = useRef(handler)
useEffect(() => { handlerRef.current = handler }, [handler])

useEffect(() => {
  const listener = (e) => handlerRef.current(e)
  window.addEventListener(eventType, listener)
  return () => window.removeEventListener(eventType, listener)
}, [eventType]) // no handler dep = stable subscription
```
