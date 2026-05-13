---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "components/**/*"
  - "app/**/*"
---

# React

> No manual memoization, composition over props drilling, server-first data fetching where the framework supports it.

The model picks the right server/client split by reading visible imports — `'use client'` directives + `next/*` imports → Next.js Server Components mental model; loader/action exports + `react-router` imports → React Router mental model.

---

## DO

### Default to server-side data fetching where supported

```tsx
// Next.js — Server Component (default)
async function Page() {
  const data = await fetchData()
  return <DataDisplay data={data} />
}

// React Router — loader (runs on server)
export async function loader() {
  return { data: await fetchData() }
}
export default function Page({ loaderData }: Route.ComponentProps) {
  return <DataDisplay data={loaderData.data} />
}
```

Both keep secrets on the server, eliminate client roundtrips, and make data part of the initial HTML.

### Client-side state only when needed
```tsx
// Next.js — Client Component (explicit)
'use client'
function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount((c) => c + 1)}>{count}</button>
}

// React Router — components are isomorphic; no directive needed
function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount((c) => c + 1)}>{count}</button>
}
```

### Composition over props drilling (any stack)
```tsx
function Page() {
  return (
    <Layout>
      <Header />
      <Content />
    </Layout>
  )
}
```

### Refs for object instantiation (any stack)
```tsx
function Animation() {
  const lenisRef = useRef<Lenis | null>(null)
  useEffect(() => {
    lenisRef.current = new Lenis({ duration: 1.2 })
    return () => lenisRef.current?.destroy()
  }, [])
}
```

### Lazy state initialization (any stack)
```tsx
const [data, setData] = useState(() => computeExpensiveValue(props))
```

---

## DON'T

### Never use manual memoization (React Compiler handles it)
```tsx
// WRONG
const memoized = useMemo(() => compute(data), [data])
// CORRECT
const result = compute(data)
```

### Never mutate state
```tsx
// WRONG: state.items.push(newItem)
// CORRECT
setItems((prev) => [...prev, newItem])
```

### Never use index as key
```tsx
// WRONG: {items.map((item, i) => <Item key={i} />)}
// CORRECT
{items.map((item) => <Item key={item.id} {...item} />)}
```

### Avoid useEffect for derived state (any stack)
```tsx
// WRONG: useEffect(() => setFullName(...), [first, last])
// CORRECT
const fullName = `${first} ${last}`
```

### Avoid client-side fetching for initial render data
- Next.js: use Server Components or Route Handlers
- React Router: use loaders (`loader` export)

Client-side fetching is correct for *post-mount* state (autocomplete, polling, mutations). It's wrong for the data the user sees on first paint.

### Don't cascade setState calls
```tsx
// WRONG: each setter schedules its own render; later state depends on earlier
function handleSubmit() {
  setLoading(true)
  setError(null)
  setStatus('submitting')
  setLastAttempt(Date.now())
}
// CORRECT: consolidate to one setter or derive
function handleSubmit() {
  setForm((f) => ({ ...f, loading: true, error: null, status: 'submitting', lastAttempt: Date.now() }))
}
```

Cascading setters fight React's batching, create stale-closure bugs in async paths, and obscure intent. One state object > four boolean toggles.

### Don't put `useState` / `useEffect` / refs in a Server Component
```tsx
// WRONG: Server Component (no 'use client') with client-only hooks
async function Page() {
  const [open, setOpen] = useState(false)  // build error
  return <Modal open={open} />
}
// CORRECT: split — Server fetches, Client owns interaction
async function Page() {
  const data = await fetchData()
  return <PageClient data={data} />
}
'use client'
function PageClient({ data }: { data: Data }) {
  const [open, setOpen] = useState(false)
  return <Modal open={open} data={data} />
}
```

Applies to Next.js App Router. React Router components are isomorphic — no directive boundary to police, but the loader-vs-effect split has the same shape.

### Don't make a Client Component `async`
```tsx
// WRONG: 'use client' + async function = runtime error
'use client'
async function Profile({ id }: { id: string }) {
  const user = await getUser(id)  // can't await in a Client Component
  return <ProfileView user={user} />
}
// CORRECT: fetch in the parent Server Component, pass data down
async function ProfilePage({ id }: { id: string }) {
  const user = await getUser(id)
  return <Profile user={user} />  // Client Component, sync, takes data as prop
}
```

Only Server Components can be async. If you find yourself reaching for `await` inside a `'use client'` file, the data fetch belongs one boundary up.

---

## Patterns

### Parallel data fetching

```tsx
// Next.js — sibling Server Components fetch in parallel
function Page() {
  return (
    <>
      <UserSection />
      <PostsSection />
    </>
  )
}

// React Router — parallel loaders via Promise.all or nested routes
export async function loader() {
  const [user, posts] = await Promise.all([getUser(), getPosts()])
  return { user, posts }
}
```

## Tools
- **React Compiler** — automatic memoization
- **React DevTools** — inspection
- **Biome** — linting
