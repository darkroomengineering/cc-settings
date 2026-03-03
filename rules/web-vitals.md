---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "app/**/*"
  - "components/**/*"
---

# Core Web Vitals

> LCP < 2.5s, INP < 200ms, CLS < 0.1. Concrete patterns for each metric.

---

## LCP (Largest Contentful Paint) -- Target: < 2.5s

### DO

#### Prioritize LCP Images
```tsx
// HTML
<img src="/hero.jpg" fetchpriority="high" loading="eager" decoding="sync" width={1200} height={600} />

// Next.js
<Image src="/hero.jpg" priority fill alt="Hero" />
```

#### Preload Critical Fonts
```html
<link rel="preload" href="/font.woff2" as="font" type="font/woff2" crossorigin />
```

#### Inline Critical CSS
Keep first-party CSS in initial HTML under 14 KB. Use `@next/third-parties` or manual inlining for critical-path styles.

#### LCP Element in Initial HTML
The LCP element must be present in server-rendered HTML, not injected by client JS. Use RSC or SSR for LCP content.

#### TTFB Target < 800ms
Use edge rendering, CDN caching, or streaming SSR to keep time-to-first-byte low.

### DON'T

```tsx
// WRONG: Lazy-loading above-fold image
<img src="/hero.jpg" loading="lazy" />
<Image src="/hero.jpg" alt="Hero" />  // Missing priority prop

// WRONG: LCP image without dimensions (causes CLS too)
<img src="/hero.jpg" />

// WRONG: Render-blocking JS before LCP element
<script src="/analytics.js"></script>  // Blocks parser
<img src="/hero.jpg" />

// WRONG: Client-side fetch for LCP content
'use client'
function Hero() {
  const [data, setData] = useState(null)
  useEffect(() => { fetch('/api/hero').then(r => r.json()).then(setData) }, [])
  return data ? <h1>{data.title}</h1> : null  // Empty until JS runs
}
```

---

## INP (Interaction to Next Paint) -- Target: < 200ms

### DO

#### Immediate Feedback + Deferred Work
```tsx
function handleClick() {
  setLoading(true) // Immediate feedback
  startTransition(() => {
    const result = expensiveCalculation()
    setResult(result)
    setLoading(false)
  })
}
```

#### useTransition for Non-Urgent Updates
```tsx
const [isPending, startTransition] = useTransition()

function handleSearch(query: string) {
  setQuery(query) // Urgent: update input
  startTransition(() => {
    setFilteredResults(filterItems(query)) // Deferred: filter list
  })
}
```

#### Dynamic Import Heavy Interactive Components
```tsx
const Chart = dynamic(() => import('./Chart'), { ssr: false })
```

#### Yield to Main Thread for Long Tasks (> 50ms)
```ts
async function processItems(items: Item[]) {
  const CHUNK = 100
  for (let i = 0; i < items.length; i += CHUNK) {
    items.slice(i, i + CHUNK).forEach(process)
    await new Promise(r => setTimeout(r, 0)) // yield
  }
}
```

### DON'T

```tsx
// WRONG: Synchronous work > 50ms in event handler
function handleClick() {
  const result = heavyComputation(largeDataset) // Blocks main thread
  setResult(result)
}

// WRONG: JSON.parse on large payload in main thread
const data = JSON.parse(megabyteString)

// WRONG: Layout thrashing (interleaved reads and writes)
elements.forEach(el => {
  const height = el.offsetHeight  // Read (forces layout)
  el.style.height = height + 10 + 'px' // Write (invalidates layout)
})
```

---

## CLS (Cumulative Layout Shift) -- Target: < 0.1

### DO

#### Explicit Dimensions on Media
```tsx
<img src="/photo.jpg" width={800} height={600} alt="Photo" />
<video width={1280} height={720} />

// Or use aspect-ratio
<div style={{ aspectRatio: '16/9' }}>
  <iframe src="..." />
</div>
```

#### Font Fallback Metrics
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

#### Reserve Space for Dynamic Content
```tsx
// Ads, embeds, lazy-loaded sections
<div style={{ minHeight: 250 }}>{ad && <AdUnit />}</div>
```

#### CSS Containment for Independent Widgets
```css
.widget {
  contain: layout style paint;
}
```

#### content-visibility for Long Lists
```css
.offscreen-section {
  content-visibility: auto;
  contain-intrinsic-size: 0 500px;
}
```

### DON'T

```tsx
// WRONG: Injecting content above existing content
{banner && <Banner />}  // Pushes everything down
<MainContent />

// WRONG: Web fonts without fallback metrics
@font-face {
  font-family: 'Custom';
  src: url('custom.woff2');
  /* No font-display, no size-adjust */
}

// WRONG: Dynamically resizing containers after paint
useEffect(() => {
  ref.current.style.height = calculatedHeight + 'px' // Shift!
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

#### Debug CLS Sources
```ts
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) {
      console.log('CLS:', entry.value, entry.sources?.map(s => s.node))
    }
  }
}).observe({ type: 'layout-shift', buffered: true })
```

---

## Performance Budgets

| Resource | Budget |
|----------|--------|
| Total page weight | < 1.5 MB |
| JavaScript (compressed) | < 300 KB |
| CSS (compressed) | < 100 KB |
| Images (above-fold) | < 500 KB |
| Fonts | < 100 KB |
| Third-party scripts | < 200 KB |
