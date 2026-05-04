---
paths:
  - "**/*.tsx"
  - "**/*.ts"
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

---

## CRITICAL: Eliminate Waterfalls

### Server-side waterfalls (Next.js Server Components)

```tsx
// WRONG: Nested async creates waterfall
async function Page() {
  const header = await fetchHeader()
  return <Layout header={header}><Sidebar /></Layout>
}

// CORRECT: Sibling composition enables parallel
function Page() {
  return (
    <Layout>
      <Header />   {/* fetches independently */}
      <Sidebar />  {/* fetches independently */}
    </Layout>
  )
}
```

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

### Defer await past early exits (any stack)
```tsx
// WRONG: always fetches even if returning early
async function handler(req: Request) {
  const user = await getUser(req)
  if (!req.query.id) return { error: 'Missing ID' }
}

// CORRECT
async function handler(req: Request) {
  if (!req.query.id) return { error: 'Missing ID' }
  const user = await getUser(req)
}
```

---

## CRITICAL: Bundle Size

### Defer third-party libraries

| Stack | Pattern |
|---|---|
| Next.js | `next/dynamic` with `ssr: false` |
| React Router | `React.lazy()` + `<Suspense>` |
| Either | Plain `import()` inside an event handler |

```tsx
// Next.js
import dynamic from 'next/dynamic'
const Analytics = dynamic(
  () => import('@vercel/analytics/react').then((m) => m.Analytics),
  { ssr: false },
)

// React Router (or any Vite-based React app)
import { lazy, Suspense } from 'react'
const HeavyChart = lazy(() => import('~/components/heavy-chart'))

function Page() {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <HeavyChart />
    </Suspense>
  )
}
```

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
```tsx
// WRONG
useEffect(() => { fetchPosts(user.id) }, [user])

// CORRECT
useEffect(() => { fetchPosts(user.id) }, [user.id])

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

### Explicit conditional rendering
```tsx
// WRONG: renders "0" when count is 0
{count && <Badge count={count} />}

// CORRECT
{count > 0 ? <Badge count={count} /> : null}
```

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
