---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "app/**/*"
  - "components/**/*"
---

# Performance

> Eliminate waterfalls, minimize bundles, defer non-critical work. Implementation
> reference (resource hints, images, fonts, cache headers, DOM, third-party, CLS
> debugging): `~/.claude/docs/performance-reference.md` — read it when doing that
> work.

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
import Check from 'lucide-react/dist/esm/icons/check'
// Next.js alternative: experimental.optimizePackageImports in next.config
```

### Dynamic imports for heavy components
```tsx
// Next.js: next/dynamic with ssr: false for browser-only libs
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })
// React Router / Vite: React.lazy() + <Suspense>
// Either: plain import() inside an event handler for true on-demand
```

### Request deduplication
```tsx
// Next.js Server Components: import { cache } from 'react'
export const getUser = cache(async (id: string) => db.user.findUnique({ where: { id } }))
// React Router: compose loaders so each piece is fetched once at the right level
// Client side (either): SWR / TanStack Query
```

### Lazy state initialization (any stack)
```tsx
const [index, setIndex] = useState(() => buildSearchIndex(items))
```

### Hoist static JSX
```tsx
const icon = <svg>...</svg>
function Icon() { return icon }  // created once
```

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
// CORRECT: [user.id]
```

## Also enforce (details in the reference doc)

- Explicit `width`/`height` (or `aspect-ratio`) on every `img`/`video`/`iframe`;
  reserve space for dynamic content. CLS target < 0.1.
- LCP image: `fetchPriority="high"` + `loading="eager"` (`priority` on
  `next/image`); below-fold media lazy. Format priority AVIF > WebP > JPEG/PNG.
- Fonts: woff2, `font-display: swap` with fallback metrics (`size-adjust`,
  `ascent-override`), variable fonts, subset, self-host.
- `preconnect` critical third-party origins; `preload` the critical font and LCP
  image.
- Static assets `Cache-Control: public, max-age=31536000, immutable`.
- Passive `touchstart`/`wheel` listeners; batch DOM reads before writes;
  `content-visibility: auto` for long offscreen sections.
- Third-party JS < 200 KB total; heavy embeds behind a facade. Page budgets:
  JS < 300 KB, CSS < 100 KB, fonts < 100 KB, above-fold images < 500 KB.

## Tools

- **Turbopack** (Next.js) / **Vite** (React Router) — fast dev builds
- **Bundle Analyzer** — `@next/bundle-analyzer` or `rollup-plugin-visualizer`
- **Lighthouse** — performance audits (any stack)
