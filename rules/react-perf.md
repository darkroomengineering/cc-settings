---
paths:
  - "**/*.tsx"
  - "components/**/*"
  - "app/**/*"
---

# React Performance Rules

> Critical and High priority optimizations for any React stack.
>
> **Foundation:** `rules/performance.md` covers core patterns (parallel fetching, direct imports, dynamic imports, `React.cache`, lazy state init). This file extends them with re-render and streaming patterns.

## React Compiler Note

**Darkroom projects use React Compiler.** This means:
- Do NOT use `useMemo`, `useCallback`, or `React.memo` — the compiler handles this automatically.
- Use `useRef` for object instantiation to prevent infinite loops.
- Inline JSX literals are fine — `<Button style={{ color: 'red' }} onClick={() => doThing()} />` does NOT cause referential-identity re-renders under Compiler. Don't extract them into `useMemo` / `useCallback` to "fix" something the Compiler already handles. The classic "don't put object/function literals in JSX" advice is pre-Compiler folklore.

## CRITICAL: Eliminate Waterfalls

> Nested-async Server Component waterfalls and defer-past-early-exit: see `rules/performance.md`. Prefer sibling composition so each child fetches in parallel.

```tsx
// WRONG (React Router): sequential awaits inside one loader
export async function loader() {
  const user = await getUser()
  const posts = await getPosts(user.id)  // waits for user
  return { user, posts }
}
// CORRECT: Promise.all independent fetches — or split across nested routes,
// each route's loader runs in parallel by default
```

## CRITICAL: Bundle Size

> Dynamic-import patterns: see `rules/performance.md`. Never static-import heavy libs (`gsap`, analytics, editors) into the initial bundle.

## HIGH: Server-Side Performance — Suspense streaming

| Stack | Pattern |
|---|---|
| Next.js | Server Component + `<Suspense fallback>` around an async child |
| React Router | Return unresolved promises from a loader + `<Await>` inside `<Suspense>` |

**Avoid streaming when:** layout depends on data dimensions, above-fold SEO content, fast queries (< 50 ms), or layout shifts are unacceptable.

## HIGH: Client-Side Data Fetching

- Route-level loaders / Server Components for initial load; SWR (either stack) for client-side cache, revalidation, and mutations.
- **Deduplicate window listeners** — one `scroll`/`resize` listener with a callback registry (Map keyed by subscriber id), not one listener per hook instance.

## MEDIUM: Re-render Optimization

- **Extract expensive work into the child that needs it** — computation above an early `return` still runs on every render of the parent; in a child it's skipped entirely.
- **Narrow effect dependencies** — depend on `user.id`, not `user`; derive booleans for thresholds (`const isMobile = width < 768` then depend on `isMobile`).
- **Wrap non-urgent updates in `startTransition`** — e.g. `onScroll={() => startTransition(() => setScrollY(window.scrollY))}` so scroll state can't block urgent renders.

## HIGH: Frame loops (rAF, `useFrame`, `useLenis`, ScrollTrigger `onProgress`, pointer handlers)

- **No layout reads inside a per-frame callback.** `getBoundingClientRect`, `clientWidth`, `offsetHeight`, `scrollTop` after a style write force a synchronous layout, once per read, before the frame can paint. It hides on an M-series laptop and stutters on Intel Macs, 4K externals, and low-end devices. Measure once outside the loop and cache: hamo `useRect` (element rect, updates on resize and scroll), `useWindowSize`, `useResizeObserver`. Rects that truly change every frame (sticky or transformed elements) derive from scroll progress plus the cached initial rect. If a read is unavoidable, batch every read before any write so there is at most one forced layout.
- **Per-frame CSS custom property writes are not free.** `el.style.setProperty("--x", v)` invalidates style on the element and every descendant that consumes the variable, every frame; geometry-affecting consumers reflow too. Prefer `transform` and `opacity` via direct style writes or Web Animations. When a variable is the right tool: quantize to the precision the CSS needs (whole pixels, or the step count a `clamp` resolves to), skip the write when the rounded value is unchanged, scope the variable to the smallest element that needs it, and never layer a CSS `transition` on a per-frame write.
- **Review rule:** before approving a perf or motion PR, grep the frame loops for layout reads and custom-property writes.

## MEDIUM: Rendering

> Conditional rendering with numbers (`count && ...` renders "0"): see `rules/react.md`.

## LOW-MEDIUM: JavaScript

Early returns; index maps and Set/Map for O(1) lookups; cache deep property access in a variable; hoist RegExp out of loops.

## LOW: Stable subscriptions

Store the latest handler in a ref (`handlerRef.current = handler` in an effect) and subscribe once with a wrapper that calls `handlerRef.current(e)` — the subscription effect then depends only on the event type, not the handler identity.
