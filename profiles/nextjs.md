# Next.js Profile (App Router)

> Patterns for Next.js 16+ App Router projects with React Server Components.

## Satus Starter Specifics

Projects started from `satus` have these conventions:

### Required Component Wrappers
```tsx
// Always use these, never native HTML
import { Image } from '@/components/ui/image'
import { Link } from '@/components/ui/link'
```

### CSS Modules Convention
```tsx
// Import CSS modules as 's'
import s from './component.module.css'
```

### React Compiler (No Memoization)
```tsx
// ❌ Don't - React Compiler handles this
const memoizedValue = useMemo(() => compute(a, b), [a, b])

// ✅ Do - just compute directly
const value = compute(a, b)

// ✅ Exception: useRef for object instantiation
const instance = useRef(new SomeClass())
```

### Optional Features Pattern
```tsx
// Root layout conditionally loads features
import { OptionalFeatures } from '@/lib/features'
<OptionalFeatures /> // Only loads WebGL, dev tools when needed
```

---

## Server Components (Default)

Server Components are the default in App Router. Only add `'use client'` when needed.

### When to Use Server Components
- Data fetching
- Accessing backend resources directly
- Keeping sensitive data on server (API keys, tokens)
- Large dependencies (keeps them server-side)

### When to Use Client Components
- Interactivity (`onClick`, `onChange`, etc.)
- React hooks (`useState`, `useEffect`, `useContext`)
- Browser APIs (`window`, `document`, `localStorage`)
- Custom hooks that depend on state/effects

```tsx
// Server Component (default)
async function ProductList() {
  const products = await db.products.findMany()
  return <ul>{products.map(p => <li key={p.id}>{p.name}</li>)}</ul>
}

// Client Component (explicit)
'use client'
function AddToCartButton({ productId }: { productId: string }) {
  const [pending, setPending] = useState(false)
  return <button onClick={() => addToCart(productId)}>Add to Cart</button>
}
```

---

## Data Fetching

### Server Components
```tsx
// Direct database/API access
async function Page() {
  const data = await db.query('SELECT * FROM users')
  return <UserList users={data} />
}

// With fetch and caching
async function Page() {
  const res = await fetch('https://api.example.com/data', {
    next: { revalidate: 3600 } // Revalidate every hour
  })
  const data = await res.json()
  return <DataDisplay data={data} />
}
```

### React.cache() for Deduplication
```tsx
import { cache } from 'react'

export const getUser = cache(async (id: string) => {
  return db.user.findUnique({ where: { id } })
})

// Multiple components can call getUser(id) - executes once per request
```

### Client-Side Fetching
```tsx
'use client'
import useSWR from 'swr'

function UserProfile({ userId }: { userId: string }) {
  const { data, error, isLoading } = useSWR(`/api/users/${userId}`, fetcher)
  if (isLoading) return <Skeleton />
  if (error) return <Error />
  return <Profile user={data} />
}
```

---

## Server Actions

Prefer Server Actions over API routes for mutations.

```tsx
// actions.ts
'use server'

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string
  const content = formData.get('content') as string

  await db.post.create({ data: { title, content } })
  revalidatePath('/posts')
}

// Component usage
import { createPost } from './actions'

function CreatePostForm() {
  return (
    <form action={createPost}>
      <input name="title" required />
      <textarea name="content" required />
      <button type="submit">Create</button>
    </form>
  )
}
```

### With useActionState (React 19)
```tsx
'use client'
import { useActionState } from 'react'
import { createPost } from './actions'

function CreatePostForm() {
  const [state, formAction, pending] = useActionState(createPost, null)

  return (
    <form action={formAction}>
      <input name="title" disabled={pending} />
      <button type="submit" disabled={pending}>
        {pending ? 'Creating...' : 'Create'}
      </button>
      {state?.error && <p className="text-red-500">{state.error}</p>}
    </form>
  )
}
```

---

## Routing

### File-based Routing
```
app/
├── page.tsx              # /
├── about/page.tsx        # /about
├── blog/
│   ├── page.tsx          # /blog
│   └── [slug]/page.tsx   # /blog/:slug
├── (marketing)/          # Route group (no URL segment)
│   ├── pricing/page.tsx  # /pricing
│   └── features/page.tsx # /features
└── api/
    └── webhook/route.ts  # /api/webhook
```

### Dynamic Routes
```tsx
// app/blog/[slug]/page.tsx
interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function BlogPost({ params }: PageProps) {
  const { slug } = await params
  const post = await getPost(slug)
  return <article>{post.content}</article>
}

// Generate static paths
export async function generateStaticParams() {
  const posts = await getPosts()
  return posts.map(post => ({ slug: post.slug }))
}
```

---

## Performance

### Dynamic Imports
```tsx
import dynamic from 'next/dynamic'

// Heavy component - lazy load
const HeavyChart = dynamic(() => import('./HeavyChart'), {
  loading: () => <ChartSkeleton />,
  ssr: false // Skip SSR for browser-only components
})

// Code split based on condition
const AdminPanel = dynamic(() => import('./AdminPanel'))

function Page({ isAdmin }) {
  return isAdmin ? <AdminPanel /> : <UserView />
}
```

### Package Optimization
```js
// next.config.js
module.exports = {
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'date-fns',
      'lodash-es'
    ]
  }
}
```

### Streaming with Suspense
```tsx
import { Suspense } from 'react'

export default function Page() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Suspense fallback={<StatsSkeleton />}>
        <Stats /> {/* Async component streams in */}
      </Suspense>
      <Suspense fallback={<ChartSkeleton />}>
        <Chart /> {/* Streams independently */}
      </Suspense>
    </main>
  )
}
```

---

## Metadata

### Static Metadata
```tsx
// app/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Home | My App',
  description: 'Welcome to my application',
  openGraph: {
    title: 'Home | My App',
    description: 'Welcome to my application',
    images: ['/og-image.png']
  }
}
```

### Dynamic Metadata
```tsx
// app/blog/[slug]/page.tsx
import type { Metadata } from 'next'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      images: [post.coverImage]
    }
  }
}
```

---

## Error Handling

### Error Boundaries
```tsx
// app/dashboard/error.tsx
'use client'

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

### Not Found
```tsx
// app/blog/[slug]/page.tsx
import { notFound } from 'next/navigation'

export default async function BlogPost({ params }) {
  const post = await getPost(params.slug)
  if (!post) notFound()
  return <article>{post.content}</article>
}

// app/not-found.tsx
export default function NotFound() {
  return <div>Page not found</div>
}
```

---

## Image Optimization

```tsx
import Image from 'next/image'

// Local image
import heroImage from './hero.jpg'

function Hero() {
  return (
    <Image
      src={heroImage}
      alt="Hero banner"
      placeholder="blur"
      priority // Above-fold images
    />
  )
}

// Remote image
function Avatar({ user }) {
  return (
    <Image
      src={user.avatarUrl}
      alt={user.name}
      width={48}
      height={48}
      className="rounded-full"
    />
  )
}
```

Configure remote patterns in `next.config.js`:
```js
module.exports = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.example.com' }
    ]
  }
}
```
