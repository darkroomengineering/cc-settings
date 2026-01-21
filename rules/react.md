# React

> Server Components first, no manual memoization, composition over props

---

## DO

### Default to Server Components
```tsx
async function Page() {
  const data = await fetchData()
  return <DataDisplay data={data} />
}
```

### Client Components Only When Needed
```tsx
'use client'
function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
```

### Composition Over Props Drilling
```tsx
function Page() { return <Layout><Header /><Content /></Layout> }
```

### Refs for Object Instantiation
```tsx
'use client'
function Animation() {
  const lenisRef = useRef<Lenis | null>(null)
  useEffect(() => {
    lenisRef.current = new Lenis({ duration: 1.2 })
    return () => lenisRef.current?.destroy()
  }, [])
}
```

### Lazy State Initialization
```tsx
const [data, setData] = useState(() => computeExpensiveValue(props))
```

---

## DON'T

### Never Use Manual Memoization (React Compiler handles it)
```tsx
// WRONG
const memoized = useMemo(() => compute(data), [data])
// CORRECT
const result = compute(data)
```

### Never Mutate State
```tsx
// WRONG: state.items.push(newItem)
// CORRECT
setItems(prev => [...prev, newItem])
```

### Never Use Index as Key
```tsx
// WRONG: {items.map((item, i) => <Item key={i} />)}
// CORRECT
{items.map(item => <Item key={item.id} {...item} />)}
```

### Avoid useEffect for Derived State
```tsx
// WRONG: useEffect(() => setFullName(...), [first, last])
// CORRECT
const fullName = `${first} ${last}`
```

---

## Patterns

### Parallel Data Fetching
```tsx
function Page() {
  return (
    <>
      <UserSection />   {/* fetches user */}
      <PostsSection />  {/* fetches posts - parallel */}
    </>
  )
}
```

## Tools
- **React Compiler** - Automatic memoization
- **React DevTools** - Inspection
- **Biome** - Linting
