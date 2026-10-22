---
name: react-router
description: React Router 7+ / Novus projects
---

# React Router Profile (v7+)

> Darkroom conventions for React Router 7+ projects with SSR via Vite.

## Novus Starter Specifics

Projects started from `novus` have these conventions:

- **Path alias.** `~/` resolves to the project root: `import { Button } from '~/components/button'`.
- **CSS Modules.** Import as `s`, same as satus: `import s from './component.module.css'`.
- **Environment validation.** t3-env + Valibot: `import { env } from '~/env.server'` gives type-safe values validated at build time.
- **Optional features.** Same idea as satus: feature flags + dynamic imports keep the initial bundle lean.

## Conventions

- Prefer loaders to component-level fetching for anything that could block first paint. Split independent fetches across nested routes or `Promise.all` them inside one loader.
- Cache headers go on the route through the `headers` export, not a config file.
- There is no built-in image component. Use native `<img>` with explicit `width`/`height` and the LCP attributes from `rules/performance.md`; add a Vite plugin (`vite-imagetools`) only when build-time resizing is needed, and document the choice in the project README.
- Stream slow data by returning unresolved promises from a loader and reading them with `<Await>` inside `<Suspense>`.
- Components are isomorphic: there is no `'use client'` boundary to police, but the loader-versus-effect split has the same shape.

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
