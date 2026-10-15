---
name: nextjs
description: Next.js web apps
---

# Next.js Profile (App Router)

> Darkroom conventions for Next.js 16+ App Router projects. Server-first defaults live in `AGENTS.md` and `rules/react.md`.

## Satus Starter Specifics

Projects started from `satus` have these conventions:

- **Component wrappers.** Always use `@/components/image` (`Image`) and `@/components/link` (`Link`), never the native HTML elements.
- **CSS Modules.** Import as `s`: `import s from './component.module.css'`.
- **Optional features.** The root layout renders `<OptionalFeatures />` from `@/lib/features`, which loads WebGL and dev tools only when needed.

## Conventions

- Prefer Server Actions over API routes for mutations.
- `params` and `searchParams` are Promises: `const { slug } = await params`.
- Next.js has `experimental.optimizePackageImports` as an alternative to hand-written direct imports for icon and utility packages (`lucide-react`, `date-fns`).

## `cacheComponents` (Next 16+): opt in deliberately

- **Simple sites** (marketing pages, fully static or fully dynamic routes): leave it off. Static prerendering already gives instant pages, and the dev-server validation adds a ~30 ms floor to every request (measured on satus: a `<p>floor</p>` page renders in ~54 ms on vs ~27 ms off).
- **Pages that mix a cacheable shell with per-request data** (dashboards, storefronts, instant-nav UX): turn it on; that split is the feature.
- When on, mark boundaries explicitly: `'use cache'` with `cacheLife`/`cacheTag` on cacheable functions and components; wrap `cookies()`, `headers()`, `searchParams`, and uncached fetches in Suspense so they stream instead of blocking the shell. Treat dev validator errors ("component read X but is not marked") as real bugs; unmarked reads inside a cached shell serve stale data in production silently.
- The dev validation overhead stays even with perfect marking; do not chase it.
- `cacheComponents: true` breaks AWS/SST (v4.17) builds outright. Check the deploy target before enabling on a client project.
