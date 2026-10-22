---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React

> No manual memoization, composition over props drilling.

---

## DO

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

---

## DON'T

### A ref in a `useEffect` dependency array means the effect shouldn't exist
A `RefObject` never changes, so listing it only quiets `exhaustive-deps`. Handlers on an element you render go in JSX props; an element needed as a value comes from a ref callback; an effect that must call the latest function keeps its real deps and calls it through `useEffectEvent`. Never `useCallback`.

### Destructure refs carried in an object before writing
React Compiler recognizes refs by name. `refs.track.current = el` reads as mutating a prop, and the compiler silently skips the component. Name the fields with a `Ref` suffix and destructure first: `const { trackRef } = refs; trackRef.current = el`.

### Avoid client-side fetching for initial render data
Client-side fetching is correct for post-mount state (autocomplete, polling, mutations). It's wrong for the data the user sees on first paint.

## Tools

- **react-doctor** *(optional — only when it's in the project's deps)* — deterministic scan (oxlint + `eslint-plugin-react-hooks`) scoring security/perf/correctness/a11y/bundle/architecture 0–100. Use as a fast **pre-filter before** LLM review, never the authority. Run pinned with telemetry off: `npx react-doctor --diff --verbose --no-telemetry` (resolves the lockfile-pinned binary, never `@latest`). `bun run proof` auto-includes it as an advisory signal when present.
