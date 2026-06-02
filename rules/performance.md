---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "app/**/*"
  - "components/**/*"
---

# Performance

> Eliminate waterfalls, minimize bundles, defer non-critical work. Stack-agnostic principles first; framework-specific implementations follow.

The model picks the right implementation by reading visible imports in the file you're editing.

---

## DO

### Parallel data fetching (any stack)
```tsx
const [user, posts, comments] = await Promise.all([
  fetchUser(),
  fetchPosts(),
  fetchComments(),
])
```

### Defer awaits past early exits (any stack)
```tsx
async function handler(req: Request) {
  if (!req.query.id) return { error: 'Missing ID' }  // early exit
  const user = await getUser(req)
  return user
}
```

### Direct imports over barrels (any stack)
```tsx
// any stack
import Check from 'lucide-react/dist/esm/icons/check'

// Next.js: configure once in next.config
// experimental: { optimizePackageImports: ['lucide-react'] }

// Vite/RR: rely on direct import + tree-shaking
```

### Dynamic imports for heavy components

| Stack | Pattern |
|---|---|
| Next.js | `next/dynamic` with `ssr: false` for browser-only libs |
| React Router | `React.lazy()` + `<Suspense>` |
| Either | Plain `import()` inside event handler for true on-demand |

```tsx
// Next.js
import dynamic from 'next/dynamic'
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

// React Router (or any Vite-based React app)
import { lazy, Suspense } from 'react'
const MonacoEditor = lazy(() => import('@monaco-editor/react'))
// usage: <Suspense fallback={...}><MonacoEditor /></Suspense>
```

### Request deduplication

| Stack | Pattern |
|---|---|
| Next.js | `import { cache } from 'react'` — dedupes across Server Components in one request |
| React Router | Compose loaders so each piece of data is fetched once at the right level. Use `useFetchers()` if you need to read in-flight state. |
| Either | SWR / TanStack Query for client-side dedup + revalidation |

```tsx
// Next.js — Server Component cache
import { cache } from 'react'
export const getUser = cache(async (id: string) => db.user.findUnique({ where: { id } }))
```

### Lazy state initialization (any stack)
```tsx
const [index, setIndex] = useState(() => buildSearchIndex(items))
```

---

## DON'T

```tsx
// WRONG (any stack): sequential when independent
const user = await fetchUser()
const posts = await fetchPosts()  // could've been Promise.all

// WRONG (Next.js): nested async waterfall in Server Components
async function Page() {
  const header = await fetchHeader()
  return <Layout><Sidebar /></Layout>  // Sidebar waits for header
}

// WRONG (any stack): barrel imports
import { Check } from 'lucide-react'        // 10,000+ re-exports
import { Button } from '@/components'       // barrel file

// WRONG (any stack): static import of heavy libs
import MonacoEditor from '@monaco-editor/react'  // 300KB+

// WRONG (any stack): wide effect dependencies
useEffect(() => { fetch(user.id) }, [user])      // runs on any user change
// CORRECT
useEffect(() => { fetch(user.id) }, [user.id])
```

> Conditional rendering with numbers: see `rules/react.md`.

---

## Patterns

### Hoist static JSX
```tsx
const icon = <svg>...</svg>
function Icon() { return icon }  // created once
```

## Tools
- **Turbopack** — fast dev builds (Next.js)
- **Vite** — fast dev builds (React Router and others)
- **Bundle Analyzer** — `@next/bundle-analyzer` (Next.js) or `rollup-plugin-visualizer` (Vite)
- **Lighthouse** — performance audits (any stack)

---

## Resource Hints

```html
<!-- Preconnect to critical third-party origins -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://cdn.shopify.com" crossorigin>

<!-- Preload critical resources -->
<link rel="preload" href="/fonts/custom.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/hero.webp" as="image" fetchpriority="high">

<!-- DNS prefetch for non-critical third parties -->
<link rel="dns-prefetch" href="https://www.google-analytics.com">
```

### Where to declare hints

| Stack | Pattern |
|---|---|
| Next.js | `export const metadata` in a layout/page (`other: { link: [...] }`), or raw `<link>` in `app/layout.tsx` |
| React Router | `links()` route export — runs on SSR + client navigation |

```tsx
// Next.js — app/layout.tsx
export const metadata: Metadata = {
  other: {
    link: [{ rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
  },
}

// React Router — app/root.tsx or any route
export function links() {
  return [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preload', href: '/fonts/custom.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  ]
}
```

---

## Image Optimization

### Stack-agnostic baseline
```tsx
// LCP (above the fold)
<img
  src="/hero.webp"
  alt="Hero"
  width={1200}
  height={600}
  fetchPriority="high"
  loading="eager"
  decoding="sync"
/>

// Below the fold
<img src="/photo.webp" alt="Photo" width={800} height={600} loading="lazy" decoding="async" />

// Responsive with art direction
<picture>
  <source srcSet="/hero-wide.avif" type="image/avif" media="(min-width: 768px)" />
  <source srcSet="/hero-wide.webp" type="image/webp" media="(min-width: 768px)" />
  <source srcSet="/hero-mobile.avif" type="image/avif" />
  <img src="/hero-mobile.webp" alt="Hero" width={375} height={500} />
</picture>
```

### Next.js: `next/image`
```tsx
import Image from 'next/image'

// LCP image
<Image src="/hero.webp" alt="..." priority fill sizes="100vw" />

// Remote — configure remotePatterns in next.config
<Image src={user.avatar} alt={user.name} width={48} height={48} />
```

### React Router: build-time tools
No built-in image component. For optimization, use a Vite plugin (`vite-imagetools`, `unplugin-imagemin`). For dynamic remote images, configure CSP/CORS at the edge.

**Format priority:** AVIF > WebP > JPEG/PNG. AVIF is 30–50% smaller than WebP. SVG for icons/logos.

---

## Font Loading (any stack)

```css
/* Preload the critical font in <head> via your stack's link mechanism */
@font-face {
  font-family: 'Custom';
  src: url('/fonts/custom.woff2') format('woff2');
  font-display: swap;
  unicode-range: U+0000-00FF;  /* subset to latin if possible */
}
```

- Use **variable fonts** — one file replaces multiple weight files
- Subset fonts to used character ranges (`unicode-range`)
- Self-host fonts instead of Google Fonts for fewer round trips
- `font-display: optional` for non-critical fonts (prevents CLS entirely)

---

## Cache Headers

| Stack | Pattern |
|---|---|
| Next.js | `headers()` in `next.config.ts`, or `Cache-Control` returned from a Route Handler |
| React Router | `headers` route export (per-route, has access to loader data) |

```ts
// Next.js — next.config.ts
async headers() {
  return [
    {
      source: '/_next/static/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'private, max-age=0, must-revalidate' }],
    },
  ]
}
```

```tsx
// React Router — app/routes/posts.$id.tsx
export function headers() {
  return {
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
  }
}
```

---

## DOM Performance (any stack)

### Passive event listeners
```ts
element.addEventListener('touchstart', handler, { passive: true })
element.addEventListener('wheel', handler, { passive: true })
```

### Layout thrashing prevention
```ts
// WRONG: interleaved reads and writes (forces layout per iteration)
elements.forEach((el) => {
  const h = el.offsetHeight
  el.style.height = h + 10 + 'px'
})

// CORRECT: batch reads, then batch writes
const heights = elements.map((el) => el.offsetHeight)
elements.forEach((el, i) => {
  el.style.height = heights[i] + 10 + 'px'
})
```

### Content visibility for long lists
```css
.offscreen-section {
  content-visibility: auto;
  contain-intrinsic-size: 0 500px;
}
```

---

## Third-Party Scripts

| Stack | Pattern |
|---|---|
| Next.js | `next/script` with `strategy="afterInteractive"` or `"lazyOnload"` |
| React Router | Plain `<script>` in `links()`/`<head>` of `root.tsx`, or load on user interaction |
| Either | Facade pattern for heavy embeds (YouTube, maps): static image until click |

- IntersectionObserver to lazy-load below-fold widgets (any stack)
- Budget: < 200 KB total third-party JS

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

### Measuring CLS

```ts
import { onCLS } from 'web-vitals'
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
