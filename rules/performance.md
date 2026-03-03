---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "app/**/*"
  - "components/**/*"
---

# Performance

> Eliminate waterfalls, minimize bundles, defer non-critical work

---

## DO

### Parallel Data Fetching
```tsx
const [user, posts, comments] = await Promise.all([
  fetchUser(), fetchPosts(), fetchComments()
])
```

### Defer Awaits Past Early Exits
```tsx
async function handler(req: Request) {
  if (!req.query.id) return { error: 'Missing ID' }  // Early exit
  const user = await getUser(req)                     // Then fetch
  return user
}
```

### Direct Imports Over Barrels
```tsx
import Check from 'lucide-react/dist/esm/icons/check'
// Or: next.config.js: experimental.optimizePackageImports: ['lucide-react']
```

### Dynamic Imports for Heavy Components
```tsx
import dynamic from 'next/dynamic'
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })
const Analytics = dynamic(() => import('@vercel/analytics/react').then(m => m.Analytics), { ssr: false })
```

### React.cache for Request Deduplication
```tsx
import { cache } from 'react'
export const getUser = cache(async (id: string) => db.user.findUnique({ where: { id } }))
```

### Lazy State Initialization
```tsx
const [index, setIndex] = useState(() => buildSearchIndex(items))
```

---

## DON'T

```tsx
// WRONG: Sequential (3 round trips)
const user = await fetchUser()
const posts = await fetchPosts()

// WRONG: Nested async creates waterfall
async function Page() {
  const header = await fetchHeader()
  return <Layout><Sidebar /></Layout>  // Sidebar waits for header
}

// WRONG: Barrel imports
import { Check } from 'lucide-react'        // 10,000+ re-exports
import { Button } from '@/components'       // Barrel file

// WRONG: Static import of heavy libs
import MonacoEditor from '@monaco-editor/react'  // 300KB+

// WRONG: Wide effect dependencies
useEffect(() => { fetch(user.id) }, [user])      // Runs on any user change
// CORRECT
useEffect(() => { fetch(user.id) }, [user.id])

// WRONG: && with numbers
{count && <Badge count={count} />}  // Renders "0"
// CORRECT
{count > 0 ? <Badge count={count} /> : null}
```

---

## Patterns

### Hoist Static JSX
```tsx
const icon = <svg>...</svg>
function Icon() { return icon }  // Created once
```

## Tools
- **Turbopack** - Fast dev builds
- **Bundle Analyzer** - `@next/bundle-analyzer`
- **Lighthouse** - Performance audits

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

Next.js metadata pattern:
```tsx
// app/layout.tsx
export const metadata: Metadata = {
  other: {
    'link': [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    ],
  },
}
```

## Image Optimization

```tsx
// Next.js — hero image (LCP)
<Image src="/hero.webp" alt="..." priority fill sizes="100vw" />

// Responsive with art direction
<picture>
  <source srcSet="/hero-wide.avif" type="image/avif" media="(min-width: 768px)" />
  <source srcSet="/hero-wide.webp" type="image/webp" media="(min-width: 768px)" />
  <source srcSet="/hero-mobile.avif" type="image/avif" />
  <source srcSet="/hero-mobile.webp" type="image/webp" />
  <img src="/hero-mobile.jpg" alt="..." width={375} height={500} />
</picture>
```

**Format priority:** AVIF > WebP > JPEG/PNG. Use AVIF for photos (30-50% smaller than WebP). Use SVG for icons/logos.

## Font Loading

```css
/* Preload the critical font in <head> */
/* <link rel="preload" href="/fonts/custom.woff2" as="font" type="font/woff2" crossorigin> */

@font-face {
  font-family: 'Custom';
  src: url('/fonts/custom.woff2') format('woff2');
  font-display: swap; /* swap for body text, optional for non-critical */
  unicode-range: U+0000-00FF; /* Subset to latin if possible */
}
```

- Use **variable fonts** -- one file replaces multiple weight files
- Subset fonts to used character ranges (`unicode-range`)
- Self-host fonts instead of Google Fonts for fewer round trips
- `font-display: optional` for non-critical fonts (prevents CLS entirely)

## Cache Headers

```ts
// next.config.ts — static assets with content hash
{
  source: '/_next/static/:path*',
  headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
}

// API responses
{
  source: '/api/:path*',
  headers: [{ key: 'Cache-Control', value: 'private, max-age=0, must-revalidate' }],
}

// HTML pages
{
  source: '/:path*',
  headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
}
```

## DOM Performance

### Passive Event Listeners
```ts
// Touch/wheel handlers — always passive to avoid scroll blocking
element.addEventListener('touchstart', handler, { passive: true })
element.addEventListener('wheel', handler, { passive: true })
```

### Layout Thrashing Prevention
```ts
// WRONG: Interleaved reads and writes (forces layout per iteration)
elements.forEach(el => {
  const h = el.offsetHeight      // read
  el.style.height = h + 10 + 'px' // write — triggers layout
})

// CORRECT: Batch reads, then batch writes
const heights = elements.map(el => el.offsetHeight) // all reads
elements.forEach((el, i) => {
  el.style.height = heights[i] + 10 + 'px'          // all writes
})
```

### Content Visibility for Long Lists
```css
.offscreen-section {
  content-visibility: auto;
  contain-intrinsic-size: 0 500px;
}
```

## Third-Party Scripts

- Load analytics/chat/tracking with `next/script` strategy `afterInteractive` or `lazyOnload`
- Use facade pattern for heavy embeds (YouTube, maps) -- show static image until interaction
- IntersectionObserver to lazy-load below-fold widgets
- Budget: < 200 KB total third-party JS
