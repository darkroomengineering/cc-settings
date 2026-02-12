# React/Next.js Performance Rules

> Condensed from Vercel Agent Skills. Focus: Critical and High priority optimizations.

## React Compiler Note

**Darkroom projects use React Compiler.** This means:
- Do NOT use `useMemo`, `useCallback`, or `React.memo` - the compiler handles this automatically
- Use `useRef` for object instantiation to prevent infinite loops
- The "Re-render Optimization" section below is for reference only (compiler handles it)

---

## CRITICAL: Eliminate Waterfalls

Waterfalls are the #1 performance killer. Each sequential `await` adds full network latency.

### Client-Side Waterfalls
```tsx
// ❌ WRONG: Sequential fetching (3 round trips)
const user = await fetchUser()
const posts = await fetchPosts()
const comments = await fetchComments()

// ✅ CORRECT: Parallel fetching (1 round trip)
const [user, posts, comments] = await Promise.all([
  fetchUser(),
  fetchPosts(),
  fetchComments()
])
```

### Server Component Waterfalls
```tsx
// ❌ WRONG: Nested async creates waterfall
async function Page() {
  const header = await fetchHeader()
  return <Layout header={header}><Sidebar /></Layout>
}

// ✅ CORRECT: Sibling composition enables parallel
function Page() {
  return (
    <Layout>
      <Header /> {/* fetches independently */}
      <Sidebar /> {/* fetches independently */}
    </Layout>
  )
}
```

### Defer Await Until Needed
```tsx
// ❌ WRONG: Always fetches even if returning early
async function handler(req) {
  const user = await getUser(req)
  if (!req.query.id) return { error: 'Missing ID' }
}

// ✅ CORRECT: Defer awaits past early exits
async function handler(req) {
  if (!req.query.id) return { error: 'Missing ID' }
  const user = await getUser(req)
}
```

---

## CRITICAL: Bundle Size Optimization

### Avoid Barrel Imports
```tsx
// ❌ WRONG: Barrel import (pulls entire icon library)
import { Check } from 'lucide-react'

// ✅ CORRECT: Direct import
import Check from 'lucide-react/dist/esm/icons/check'

// ✅ BETTER: Configure Next.js
// next.config.js
experimental: {
  optimizePackageImports: ['lucide-react', '@radix-ui/react-*']
}
```

### Dynamic Imports for Heavy Components
```tsx
// ❌ WRONG: Static import bundles 300KB+ with initial JS
import MonacoEditor from '@monaco-editor/react'

// ✅ CORRECT: Lazy load when needed
import dynamic from 'next/dynamic'
const MonacoEditor = dynamic(
  () => import('@monaco-editor/react'),
  { ssr: false }
)
```

### Defer Third-Party Libraries
```tsx
// ❌ WRONG: Loads in initial bundle
import { Analytics } from '@vercel/analytics/react'
import gsap from 'gsap'

// ✅ CORRECT: Load after hydration
const Analytics = dynamic(
  () => import('@vercel/analytics/react').then(mod => mod.Analytics),
  { ssr: false }
)
const GSAPRuntime = dynamic(
  () => import('./gsap-runtime'),
  { ssr: false }
)
```

---

## HIGH: Server-Side Performance

### React.cache() for Deduplication
```tsx
import { cache } from 'react'

// Multiple calls within same request execute query only once
export const getCurrentUser = cache(async () => {
  const session = await getSession()
  return db.user.findUnique({ where: { id: session.userId } })
})
```

### Suspense for Streaming
```tsx
// Enables immediate wrapper render while data loads
<Suspense fallback={<Skeleton />}>
  <AsyncDataComponent />
</Suspense>
```

**Avoid Suspense when:**
- Layout depends on data dimensions
- Above-fold SEO content
- Fast queries (<50ms)
- Layout shifts are unacceptable

---

## HIGH: Client-Side Data Fetching

### Use SWR for Deduplication
```tsx
// ❌ WRONG: useState + useEffect + fetch
// ✅ CORRECT: SWR handles deduplication, caching, revalidation
import useSWR from 'swr'
const { data } = useSWR('/api/users', fetcher)
```

### Deduplicate Event Listeners
```tsx
// ❌ WRONG: Each component adds listener
function useScroll() {
  useEffect(() => {
    window.addEventListener('scroll', handler) // N listeners!
    return () => window.removeEventListener('scroll', handler)
  }, [])
}

// ✅ CORRECT: Single listener, callback delegation
const callbacks = new Map<string, (e: Event) => void>()
let attached = false

function useScroll(id: string, callback: (e: Event) => void) {
  useEffect(() => {
    callbacks.set(id, callback)
    if (!attached) {
      window.addEventListener('scroll', (e) => {
        callbacks.forEach(cb => cb(e))
      })
      attached = true
    }
    return () => { callbacks.delete(id) }
  }, [id, callback])
}
```

---

## MEDIUM: Re-render Optimization

### Extract Expensive Work
```tsx
// ❌ WRONG: Expensive computation runs on early return
function Profile({ user, isLoading }: { user: User; isLoading: boolean }) {
  const avatar = processAvatar(user) // runs even when loading
  if (isLoading) return <Skeleton />
  return <img src={avatar} alt={user.name} />
}

// ✅ CORRECT: Extract to child component, skipped on early return
// React Compiler handles memoization automatically
function Profile({ user, isLoading }: { user: User; isLoading: boolean }) {
  if (isLoading) return <Skeleton />
  return <UserAvatar user={user} />
}

function UserAvatar({ user }: { user: User }) {
  return <img src={processAvatar(user)} alt={user.name} />
}
```

### Narrow Effect Dependencies
```tsx
// ❌ WRONG: Runs on any user property change
useEffect(() => { fetchPosts(user.id) }, [user])

// ✅ CORRECT: Runs only when id changes
useEffect(() => { fetchPosts(user.id) }, [user.id])

// ✅ BETTER: Derive boolean for thresholds
const isMobile = width < 768
useEffect(() => { /* ... */ }, [isMobile])
```

### Use Transitions for Non-Urgent Updates
```tsx
import { startTransition } from 'react'

// ❌ WRONG: Blocks UI on every scroll
onScroll={() => setScrollY(window.scrollY)}

// ✅ CORRECT: Defers non-urgent update
onScroll={() => startTransition(() => setScrollY(window.scrollY))}
```

### Lazy State Initialization
```tsx
// ❌ WRONG: buildIndex runs on EVERY render
const [index, setIndex] = useState(buildSearchIndex(items))

// ✅ CORRECT: Runs only on first render
const [index, setIndex] = useState(() => buildSearchIndex(items))

// Also: localStorage reads, DOM queries, data transforms
const [prefs, setPrefs] = useState(() =>
  JSON.parse(localStorage.getItem('prefs') || '{}')
)
```

---

## MEDIUM: Rendering Performance

### Hoist Static JSX
```tsx
// ❌ WRONG: Re-created every render
function Icon() {
  return <svg>...</svg>
}

// ✅ CORRECT: Created once at module level
const iconSvg = <svg>...</svg>
function Icon() {
  return iconSvg
}
```

### Explicit Conditional Rendering
```tsx
// ❌ WRONG: Renders "0" when count is 0
{count && <Badge count={count} />}

// ✅ CORRECT: Returns null when falsy
{count > 0 ? <Badge count={count} /> : null}
```

---

## LOW-MEDIUM: JavaScript Performance

- **Early returns**: Exit functions as soon as result is determined
- **Index maps**: Build lookup objects for O(1) access
- **Cache property access**: Store `obj.deeply.nested.value` in variable
- **Use Set/Map**: For membership checks (O(1) vs O(n))
- **Hoist RegExp**: Define patterns outside loops/functions

---

## LOW: Advanced Patterns

### Store Handlers in Refs
```tsx
const handlerRef = useRef(handler)
useEffect(() => { handlerRef.current = handler }, [handler])

useEffect(() => {
  const listener = (e) => handlerRef.current(e)
  window.addEventListener(eventType, listener)
  return () => window.removeEventListener(eventType, listener)
}, [eventType]) // No handler dep = stable subscription
```
