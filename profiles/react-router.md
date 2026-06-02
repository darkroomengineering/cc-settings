---
name: react-router
description: React Router 7+ / Novus projects
model: opus
skills: [build, component, hook]
---

# React Router Profile (v7+)

> Patterns for React Router 7+ projects with SSR via Vite.

## Novus Starter Specifics

Projects started from `novus` have these conventions:

### Path Aliases
```tsx
// `~/` resolves to project root
import { Button } from '~/components/button'
import { useFoo } from '~/hooks/use-foo'
```

### CSS Modules Convention
```tsx
// Import CSS modules as 's' (same as satus)
import s from './component.module.css'
```

### React Compiler (No Memoization)
Same as satus: React Compiler handles memoization automatically. Don't use `useMemo` / `useCallback` / `React.memo`. Use `useRef` for object instantiation.

### Environment Validation
```tsx
// Novus uses t3-env + Valibot
import { env } from '~/env.server'
const apiKey = env.API_KEY  // Type-safe, validated at build time
```

### Optional Features Pattern
Same idea as satus — feature flags + dynamic imports keep the initial bundle lean.

---

## Routes (file-based)

React Router 7 uses file-based routing in `app/routes/` with route module exports.

```
app/
├── root.tsx                    # Root layout (replaces app/layout.tsx in Next.js)
├── routes/
│   ├── _index.tsx              # /
│   ├── about.tsx               # /about
│   ├── blog.tsx                # /blog (parent layout)
│   ├── blog._index.tsx         # /blog
│   ├── blog.$slug.tsx          # /blog/:slug
│   └── ($lang).pricing.tsx     # /:lang?/pricing (optional segment)
└── routes.ts                   # Optional explicit route config
```

### Route Module Exports

A route module can export `default` (component), `loader`, `action`, `meta`, `links`, `headers`, `ErrorBoundary`, and more.

```tsx
// app/routes/blog.$slug.tsx
import type { Route } from './+types/blog.$slug'

export async function loader({ params }: Route.LoaderArgs) {
  const post = await getPost(params.slug)
  if (!post) throw new Response('Not found', { status: 404 })
  return { post }
}

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data?.post.title },
    { name: 'description', content: data?.post.excerpt },
  ]
}

export default function BlogPost({ loaderData }: Route.ComponentProps) {
  return <article>{loaderData.post.content}</article>
}
```

> Generated `+types/<route>` files give you `Route.LoaderArgs`, `Route.ComponentProps`, etc. — strongly typed without manual prop drilling.

---

## Data Fetching

Loaders run on the server (or client when `clientLoader` is exported). Prefer loaders to component-level fetching for anything that could block first paint.

### Loader (server)
```tsx
import type { Route } from './+types/products._index'

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const page = Number(url.searchParams.get('page') ?? '1')
  return {
    products: await db.product.findMany({ skip: (page - 1) * 20, take: 20 }),
    page,
  }
}

export default function Products({ loaderData }: Route.ComponentProps) {
  return <ProductList products={loaderData.products} page={loaderData.page} />
}
```

### Client loader (cache or browser-only data)
```tsx
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  const cache = sessionStorage.getItem('products')
  if (cache) return JSON.parse(cache)
  const fresh = await serverLoader()
  sessionStorage.setItem('products', JSON.stringify(fresh))
  return fresh
}
clientLoader.hydrate = true as const
```

### Parallel data via composition
```tsx
// Don't await in series inside one loader — split into independent routes
// or parallelize explicitly.
export async function loader() {
  const [products, categories] = await Promise.all([
    db.product.findMany(),
    db.category.findMany(),
  ])
  return { products, categories }
}
```

---

## Mutations (Actions)

Actions handle form submissions and mutations. Pair with `<Form>` from `react-router` to keep them progressive-enhancement friendly.

```tsx
// app/routes/posts.new.tsx
import { Form, redirect } from 'react-router'
import type { Route } from './+types/posts.new'

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const title = String(formData.get('title') ?? '')
  const content = String(formData.get('content') ?? '')

  const post = await db.post.create({ data: { title, content } })
  return redirect(`/posts/${post.id}`)
}

export default function NewPost() {
  return (
    <Form method="post">
      <input name="title" required />
      <textarea name="content" required />
      <button type="submit">Create</button>
    </Form>
  )
}
```

### useFetcher for non-navigation mutations
```tsx
import { useFetcher } from 'react-router'

function LikeButton({ postId }: { postId: string }) {
  const fetcher = useFetcher()
  const isLiking = fetcher.state !== 'idle'
  return (
    <fetcher.Form method="post" action={`/posts/${postId}/like`}>
      <button type="submit" disabled={isLiking}>
        {isLiking ? 'Liking…' : 'Like'}
      </button>
    </fetcher.Form>
  )
}
```

---

## Image Optimization

React Router projects have no built-in image component. Use native `<img>` with proper attributes, or a Vite plugin if you want optimization at build time.

```tsx
// LCP image — above the fold
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
<img
  src="/photo.webp"
  alt="Photo"
  width={800}
  height={600}
  loading="lazy"
  decoding="async"
/>

// Responsive with art direction
<picture>
  <source srcSet="/hero-wide.avif" type="image/avif" media="(min-width: 768px)" />
  <source srcSet="/hero-wide.webp" type="image/webp" media="(min-width: 768px)" />
  <source srcSet="/hero-mobile.avif" type="image/avif" />
  <img src="/hero-mobile.webp" alt="Hero" width={375} height={500} />
</picture>
```

For build-time optimization (resize, format conversion), consider `vite-imagetools` or `unplugin-imagemin`. Document the choice in the project's README.

---

## Asset Pipeline (Vite)

Static assets resolve through Vite's pipeline — no `next/image`-style CDN proxy.

```tsx
// Static asset import (Vite hashes the URL)
import logoUrl from '~/assets/logo.svg?url'

// Inline SVG as a component
import Logo from '~/assets/logo.svg?react'

// Raw file content
import schemaText from '~/db/schema.sql?raw'

<img src={logoUrl} alt="Logo" />
<Logo />
```

For remote images, configure CORS / CSP at your edge layer. There's no equivalent to `images.remotePatterns`.

---

## Streaming + Suspense

React Router 7 supports streaming with `defer()` (or by returning unresolved promises from a loader).

```tsx
import { defer } from 'react-router'
import { Suspense } from 'react'
import { Await } from 'react-router'
import type { Route } from './+types/dashboard'

export async function loader() {
  return {
    user: await getUser(),                    // critical, awaited
    stats: getStatsSlow(),                    // unresolved promise — streams in
  }
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>Hello, {loaderData.user.name}</h1>
      <Suspense fallback={<StatsSkeleton />}>
        <Await resolve={loaderData.stats}>
          {(stats) => <Stats data={stats} />}
        </Await>
      </Suspense>
    </main>
  )
}
```

---

## Performance

### Code splitting
React Router code-splits per route automatically. For heavier components within a route, use plain dynamic `import()`:

```tsx
import { lazy, Suspense } from 'react'

const HeavyChart = lazy(() => import('~/components/heavy-chart'))

function Page() {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <HeavyChart />
    </Suspense>
  )
}
```

### Vite bundle optimization
```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { reactRouter } from '@react-router/dev/vite'

export default defineConfig({
  plugins: [reactRouter()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Pin large vendors that change rarely so they cache aggressively
          three: ['three', 'three/examples/jsm/controls/OrbitControls'],
        },
      },
    },
  },
})
```

### Direct imports (no barrels)
```tsx
import Check from 'lucide-react/dist/esm/icons/check'  // not `from 'lucide-react'`
```

---

## Error Handling

### Per-route ErrorBoundary
```tsx
// app/routes/blog.$slug.tsx
import { isRouteErrorResponse, useRouteError } from 'react-router'

export function ErrorBoundary() {
  const error = useRouteError()
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return <NotFound />
    return <div>Error {error.status}: {error.statusText}</div>
  }
  return <div>Something went wrong</div>
}
```

### Throw responses from loaders/actions
```tsx
export async function loader({ params }: Route.LoaderArgs) {
  const post = await getPost(params.slug)
  if (!post) throw new Response('Not found', { status: 404 })
  return { post }
}
```

---

## Cache Headers

Configure on the route via `headers` export, not via a config file.

```tsx
import type { Route } from './+types/posts.$id'

export async function loader({ params }: Route.LoaderArgs) {
  return { post: await getPost(params.id) }
}

export function headers(): Route.HeadersArgs {
  return {
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
  }
}
```

---

## What's NOT here (vs Next.js)

If you're coming from satus / Next.js, these don't exist in React Router 7:

| Next.js | React Router 7 equivalent |
|---|---|
| `next/image` | `<img>` + Vite plugin (optional) |
| `next/link` | `<Link>` from `react-router` |
| `next/script` | Plain `<script>` in `<head>` via `links()` route export, or in `root.tsx` |
| Server Components (`'use client'` boundary) | Loaders run on server; components are isomorphic |
| Server Actions (`'use server'`) | `action()` route export |
| `app/layout.tsx` | `app/root.tsx` + nested route layouts |
| `app/page.tsx` | `app/routes/_index.tsx` |
| `generateMetadata` | `meta()` route export |
| `generateStaticParams` | Pre-render config in `react-router.config.ts` |
| `revalidatePath` / `revalidateTag` | Manual: redirect after action, or `useRevalidator()` |
| `next.config.js` `images.remotePatterns` | Edge/server CSP/CORS config |
