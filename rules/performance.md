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
