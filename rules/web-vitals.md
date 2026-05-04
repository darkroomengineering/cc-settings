---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "app/**/*"
  - "components/**/*"
---

# Core Web Vitals

> LCP < 2.5s, INP < 200ms, CLS < 0.1. Stack-agnostic principles first; framework-specific implementations follow.

The model picks the right implementation by reading the imports in the file you're editing. If you see `next/*` imports → use the Next.js patterns. If you see `react-router` imports or a Vite config → use the React Router patterns. Stack-agnostic patterns work everywhere.

---

## LCP (Largest Contentful Paint) — target < 2.5s

### Principles (stack-agnostic)

- **The LCP element must be in server-rendered HTML.** Don't fetch it client-side; the user sees nothing until JS runs.
- **Above-fold images get high fetch priority and eager loading.** Below-fold images lazy-load.
- **Always set explicit dimensions** on media — prevents CLS too.
- **TTFB < 800ms.** Edge rendering, CDN caching, or streaming SSR.
- **Inline critical CSS** under 14 KB (first packet).
- **Preload critical fonts** with `<link rel="preload" as="font" crossorigin>`.

### DO — works in any framework

```tsx
// Above the fold — explicit dimensions, eager, high priority
<img
  src="/hero.webp"
  alt="Hero"
  width={1200}
  height={600}
  fetchPriority="high"
  loading="eager"
  decoding="sync"
/>

// Font preload in document head
<link rel="preload" href="/font.woff2" as="font" type="font/woff2" crossorigin />
```

### Next.js-specific

```tsx
import Image from 'next/image'

<Image
  src="/hero.webp"
  alt="Hero"
  width={1200}
  height={600}
  priority           // eager + fetchpriority=high
  placeholder="blur" // optional, with static imports
/>
```

`@next/third-parties` for measured third-party loading. Streaming via Server Components + `<Suspense>`.

### React Router-specific

No built-in image component. Use the stack-agnostic `<img>` pattern. For build-time image optimization, consider `vite-imagetools`. Streaming via `defer()` + `<Await>`.

```tsx
// Font preload via the route's `links` export (handles SSR + client navigation)
export function links() {
  return [
    { rel: 'preload', href: '/fonts/custom.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  ]
}
```

### DON'T

```tsx
// WRONG: Lazy-loading above-fold image (any framework)
<img src="/hero.jpg" loading="lazy" />
<Image src="/hero.jpg" alt="Hero" />  // missing priority (Next.js)

// WRONG: LCP image without dimensions — CLS too
<img src="/hero.jpg" />

// WRONG: Render-blocking JS before LCP
<script src="/analytics.js"></script>
<img src="/hero.jpg" />

// WRONG: Client-side fetch for LCP content (any framework)
'use client'  // Next.js
function Hero() {
  const [data, setData] = useState(null)
  useEffect(() => { fetch('/api/hero').then(r => r.json()).then(setData) }, [])
  return data ? <h1>{data.title}</h1> : null  // empty until JS runs
}
```

---

## INP (Interaction to Next Paint) — target < 200ms

Stack-agnostic — the React patterns work in both Next.js and React Router.

### DO

#### Immediate feedback + deferred work
```tsx
function handleClick() {
  setLoading(true)                          // immediate visual ack
  startTransition(() => {
    const result = expensiveCalculation()   // deferred
    setResult(result)
    setLoading(false)
  })
}
```

#### useTransition for non-urgent updates
```tsx
const [isPending, startTransition] = useTransition()

function handleSearch(query: string) {
  setQuery(query)                                       // urgent: input
  startTransition(() => {
    setFilteredResults(filterItems(query))              // deferred: list
  })
}
```

#### Yield to main thread for long tasks
```ts
async function processItems(items: Item[]) {
  const CHUNK = 100
  for (let i = 0; i < items.length; i += CHUNK) {
    items.slice(i, i + CHUNK).forEach(process)
    await new Promise((r) => setTimeout(r, 0))  // yield
  }
}
```

#### Lazy-load heavy interactive components

| Stack | Pattern |
|---|---|
| Next.js | `const Chart = dynamic(() => import('./chart'), { ssr: false })` |
| React Router | `const Chart = lazy(() => import('~/components/chart'))` + `<Suspense>` |
| Either | Plain `import()` inside an event handler |

### DON'T

```tsx
// WRONG: Synchronous work > 50ms in event handler
function handleClick() {
  const result = heavyComputation(largeDataset)  // blocks main thread
  setResult(result)
}

// WRONG: JSON.parse on large payload in main thread
const data = JSON.parse(megabyteString)

// WRONG: Layout thrashing — see rules/performance.md
// WRONG: Interleaved DOM reads and writes in loops
```

---

## CLS (Cumulative Layout Shift) — target < 0.1

Stack-agnostic. The CSS-level patterns work everywhere.

### DO

#### Explicit dimensions on media
```tsx
<img src="/photo.jpg" width={800} height={600} alt="Photo" />
<video width={1280} height={720} />

<div style={{ aspectRatio: '16/9' }}>
  <iframe src="..." />
</div>
```

#### Font fallback metrics
```css
@font-face {
  font-family: 'Custom';
  src: url('custom.woff2') format('woff2');
  font-display: swap;
  size-adjust: 105%;
  ascent-override: 95%;
  descent-override: 20%;
}
```

#### Reserve space for dynamic content
```tsx
<div style={{ minHeight: 250 }}>{ad && <AdUnit />}</div>
```

#### CSS containment for independent widgets
```css
.widget { contain: layout style paint; }
```

### DON'T

```tsx
// WRONG: Injecting content above existing content
{banner && <Banner />}
<MainContent />

// WRONG: Web fonts without fallback metrics
@font-face { font-family: 'Custom'; src: url('custom.woff2'); /* nothing else */ }

// WRONG: Dynamically resizing containers after paint
useEffect(() => {
  ref.current.style.height = calculatedHeight + 'px'  // shift!
}, [calculatedHeight])
```

---

## Measuring

```ts
import { onLCP, onINP, onCLS } from 'web-vitals'

onLCP(console.log)
onINP(console.log)
onCLS(console.log)
```

#### Debug CLS sources
```ts
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) {
      console.log('CLS:', entry.value, entry.sources?.map((s) => s.node))
    }
  }
}).observe({ type: 'layout-shift', buffered: true })
```

---

## Performance Budgets

| Resource | Budget |
|---|---|
| Total page weight | < 1.5 MB |
| JavaScript (compressed) | < 300 KB |
| CSS (compressed) | < 100 KB |
| Images (above-fold) | < 500 KB |
| Fonts | < 100 KB |
| Third-party scripts | < 200 KB |
