---
name: router
description: How routes, pages, links, preloads, head tags, API routes and prerendered reads work with @visio/router on Solid Router. Read before adding or changing a page, a layout, a link, a route's preload or meta, an API route, or a read that should be cached.
---

# @visio/router

The route table on top of Solid Router. Design and rationale: `router/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project). Solid itself is the solid-2 skill.

```ts
import {
  defineRoute,
  defineLayout,
  page,
  layout,
  index,
  catchAll,
  api,
  type PageProps,
} from "@visio/router";
```

## Routes and pages

`src/routes.ts` is the route table and `src/pages/` holds the page modules. The table owns the URL structure, a page module owns everything about its route: pattern, preload, head tags, component. `@visio/router` (`router/DESIGN.md`) checks that the two agree at build time and splits each page into an eager `route` and a lazy component chunk.

```ts
// src/routes.ts
export const routes = defineRoutes([
  page("/", () => import("./pages/home")),
  layout("/docs", () => import("./pages/docs/layout"), [
    index(() => import("./pages/docs/index")), // rendered at /docs
    page("/docs/:slug", () => import("./pages/docs/page")),
  ]),
  catchAll(() => import("./pages/not-found")), // everything else: 404, noindex
  api("/api/contact", () => import("./api/contact")), // a request handler, server only
]);
```

```tsx
// src/pages/docs/page.tsx
export const route = defineRoute("/docs/:slug", {
  preload: ({ params }) => getDoc(params.slug),
  meta: () => ({ title: "Docs · visio", description: "..." }),
});

export default function DocPage(props: PageProps<typeof route>) {
  const doc = createMemo(() => getDoc(props.params.slug));
  return <Loading fallback={<p>Loading…</p>}>{doc().body}</Loading>;
}
```

- **A page module exports `route` and a default component.** `defineRoute(pattern, { preload?, meta, matchFilters? })`; `meta` is required, so every page has a title. A layout module uses `defineLayout(pattern, { preload? })`, renders `props.children`, and has no meta: its pages set the head.
- **The pattern is written twice on purpose**: once in the table, where the URL structure reads, once in the module, where it types `params`. `page()` refuses a module whose pattern differs, in the editor and in the build.
- **The table writes `page(path, load)`, `layout(path, load, children)`, `index(load)`, `catchAll(load)` and `api(path, load)`, nothing more.** The plugin adds the module's `route` to each call itself.
- **Children carry their full patterns.** Under `layout('/docs', ...)` a child is `page('/docs/:slug', ...)`, not `page('/:slug', ...)`. `index(load)` is the page at the layout's own path; its module declares the layout's pattern.
- **Links are plain anchors** through the typed builder `paths` from `src/routes.ts`: `<a href={paths.about()}>`, `<a href={paths.docs(slug)()}>`. A param call gives the route's end, and the last call, empty or with a search object, gives the string: `paths.docs(slug)({ tab: "api" })`. A hash link to a section of another page is `paths.docs(slug)({}, "setup")`. On a site with `@visio/i18n` the builder takes the language first, `paths(props.lang).docs(slug)()` (the `i18n` skill). The router intercepts same-origin clicks and preloads on hover, focus and touch.
- `preload` runs on hover, focus, touch and navigation, before the component, and should call every `query()` the page reads; after a mutation the server reruns it to put refreshed data on the same response. **Return what it calls**, `getDoc(slug)` or `Promise.all([getUser(), getUsers()])` for several, never `void getDoc(slug)`: the route table marks the returned promise handled, and each promise of a returned object. A dropped promise that rejects before the page reads it is an unhandled rejection, and it exits the dev or hybrid server. The return is also what `meta` and a page transition wait for (see Head tags).
- **Every read a page makes starts in its preload, a read that needs the page's data too.** Solid Router holds a navigation only for the reads that start while it is in flight. A read that the preload chains on the first one starts in time. A read that a component starts once the first value has rendered comes after the commit, and its `<Loading>` shows the fallback, an empty page, until it lands. Dev warns `[QUERY_NOT_PRELOADED]` with the query's name. Chain the dependent read in the preload:

  ```ts
  export const route = defineRoute("/about", {
    preload: () => {
      const page = getAbout();
      return { page, feed: feedOf(page) };
    },
    meta: ({ data }) => ({ title: data?.page.title ?? "About" }),
  });

  async function feedOf(page: ReturnType<typeof getAbout>) {
    const { feed } = await page;
    return getFeed(feed);
  }
  ```

  `meta` and `props.data` stay typed (`Settled` awaits each property). The navigation commits once the feed has landed too, with `<PageTransitions>` or `props.children`, and the component's own `getFeed(search)` then gets the same promise from the cache. A preload reads a search parameter from the search string, `new URLSearchParams(location.search).has('chain')`, never from `location.query`: in the router's first preload call, the one the navigation waits for, `location.query` can give the query of the page the navigation leaves (lint rejects it, `visio/no-preload-query`). The cost: every read in the preload holds the new page until it lands, a slow one below the fold too. There is no way yet to stream a read on purpose after the page shows without the warning.

- **Pages read `props.params`, `props.location`, `props.data`, never `useParams()` or `useLocation()`.** The outlet keeps the old page alive while the new one enters (the transitions skill), and the hooks would show it the new URL; lint rejects them under `pages/`, `components/` and `ui/`. A shell component there (a nav, a footer) takes what it needs as a prop: the root layout has `props.location`, and `app.tsx` may call the hook and pass the value down. `useNavigate` is fine anywhere; `useSearchParams` is for the shell. `Router.match(url)` matches without rendering.
- The catch-all's module declares `'*404'` and its `meta`, nothing more: `catchAll()` answers with status 404 and `noindex`. `httpStatus` and `httpHeader` from `@solidjs/web` set any other status in a preload; they are scope-tied and retract when the scope disposes.
- Adding a page: create the module with `route` and a default export, add one line to `src/routes.ts`. The dev server terminal and the build report a page without a default export, without `route`, with a pattern that disagrees with the table, a loader that is not `() => import('...')`, a path that is not a literal, a module it cannot resolve, two routes at one path, and a table without `catchAll()`. A file under the pages folder that declares a route no line of the table loads is a warning (`ROUTE_UNUSED`) with the line to add.

## Head tags

A page's `meta` is its head: `title`, `description`, `canonical`, `image` (a URL or `{ url, width, height, alt }`), `type` (`'website'` or `'article'`), `modified` (when the content last changed, ISO 8601: `article:modified_time` and the sitemap's `lastmod`), `noindex`, `social` (a share title and text), `jsonLd`, and `tags` (more `<meta>` tags) become the title, description, Open Graph, Twitter, canonical, robots and JSON-LD tags, in the document head during SSR and kept reactive on the client. Tags are deduped by name or property; do not key your own copies of them. The site's defaults come from `visio({ site })` in `vite.config.ts`: every page gets `og:site_name` from `site.name` and `og:locale` from `site.locale` (a page cannot set either), `twitter:card` when it has an image, the social image from `site.image` unless it sets its own, and, with `PUBLIC_SITE_URL` set, a canonical and `og:url` of its own path, so a page only sets `canonical` when another address is the real one. An imported image URL works as `image`; it is made absolute against the origin. The build writes `robots.txt` unless `public/` has one, and the dev server answers `/robots.txt` with the same text, without the sitemap line. Static tags (charset, viewport, icon, font preload, the theme script, a fallback title) live in `src/document.tsx`. Anything else goes through `useHead()` from `@solidjs/web` inside the page, outside its `<Loading>` boundary if crawlers must see it. The `Router` from `defineRoutes()` turns the current page's `meta` into tags at its root, whatever renders the page: `<PageTransitions>` or `props.children`. It calls the page's `preload` once more for the data; the `query()` it returns gives the same promise, so nothing is fetched twice. A page the crawl writes without its head (its `meta()` threw, or a preload it reads rejected) stops the build with the page named.

- **A head from data: return the data from `preload` and read `meta`'s `data`.** `meta` receives the preload's return settled (a promise awaited, promise-valued properties of an object awaited together), so `preload: () => getDoc(params.slug)` with `meta: ({ data }) => ({ title: data?.headline ?? 'Docs' })` puts the real title, description and image in the prerendered document, where crawlers and link previews read them. The head waits for the data before the document flushes; `props.data` in the component is still the raw return. `data` is `undefined` when the preload failed, so read it with `data?.`. A preload that returns nothing leaves `meta` without data and the page streams with static tags.
- **A route option or a helper that reads `paths` declares its return type**: `meta: (): Meta => ({ canonical: paths.about() })`, with `import type { Meta } from '@visio/router'`, and `function canonical(): string` for a helper that `meta` or `preload` calls. The type of `paths` reads every page's `route`, so a return type that TypeScript infers from `paths` is circular, and `route`, `routes` and `paths` become `any` (TS7022). `params` and `data` keep their types. A component needs no annotation, the default export or a helper next to it: its type is `JSX.Element` whatever its links read. Read `paths` inside a function, never at the top of a page module: `src/routes.ts` imports the module, so the table does not exist yet there. `visio/meta-return-type` reports both.
- **Never fetch a page's queries before the render** (a `start.serverRenderSetup` hook, middleware) to make data available to the head: every `<Loading>` boundary that reads such a query renders empty and the page is written without an error. The build catches the result (the crawl fails naming the page); the preload is the fix.
- **Data every page needs (site settings, the footer's links) goes in a root layout's `preload`**, `layout('/', () => import('./pages/layout'), [...])` with `defineLayout('/', { preload: () => getSettings() })`. The catch-all stays at the top of the table, outside every layout (`CATCH_ALL_NESTED`), so the not-found page reads what it needs itself. A query first read inside a `<Loading>` of a page with no preload starts during the render. A prerendered or cached page waits for it and has its content in place, but a `live` page streams it in after the document, and readers without JavaScript never see it there.
- A head tag set from inside a `<Loading>` boundary is in the `<head>` of a prerendered or cached page. On a `live` page it reaches the browser only through the script appended after the document, and crawlers never see it there.
- **An absolute URL is `absoluteUrl(path)`** from `@visio/router`: `absoluteUrl(paths.docs(slug)())` is `https://example.com/docs/x`. Use it for every URL in `jsonLd`, never `` `${import.meta.env.PUBLIC_SITE_URL}${path}` ``. Without `PUBLIC_SITE_URL` it returns the path, with no warning: check the origin first where a relative URL is wrong.
- **A `<meta>` tag from data is an entry of `tags`**: `tags: [{ name: 'google-site-verification', content: data.settings.verification }]`, or `{ property, content }`. A tag that does not change goes in `src/document.tsx`. Never put a tag that a field owns in `tags` (`description`, and the `og:*` and `twitter:*` tags that a field sets): the router drops it, and dev warns `META_TAG_RESERVED` with the field to set. `robots` and `twitter:card` may go in `tags` and replace the router's, but a `robots` value without `noindex` does not lift the `noindex` of a page or a preview. Any other element is `useHead()` in the page.
- **A tag on every page:** a layout has no meta, so write one helper (`siteTags(settings)` in `src/lib/`) and spread it into the `tags` of each page's meta. Each page's preload returns the settings query beside its own data, `preload: () => ({ doc: getDoc(slug), settings: getSettings() })`, and `query()` fetches them once. A verification tag only needs the home page.
- **A preload that fails** leaves the page's `<Errored>` to show it; the head never halts: `meta` runs without data, and if that throws, the page gets no head tags of its own.

## API routes

An API route is `api('/api/x', () => import('./api/x'))` in the table plus a module exporting uppercase handlers: `export const GET: ApiHandler = ({ request, params }) => Response.json(...)`. A handler may return a `Response`, a string, JSON data, or nothing to fall through. `visio()` dispatches them in its middleware chain, after `src/middleware.ts` (`export default defineMiddleware([...])`) when the site has one; the client build drops the loaders. They run on the server, in dev and in the Vercel or Cloudflare deployment.

## Prerendered reads

- **This site is prerendered.** `prerendered(fn)` marks a read that is the same for every visitor. In the Vercel or Cloudflare build, it is a GET of the server function that the platform caches at its address, next to the cached pages, and a publish purges both. A read of per-visitor data (a session) is never `prerendered()`: only those are cached. In dev it behaves like `GET(fn)`.
- Arguments of a prerendered call are its address, so they must be JSON-safe and spelled identically on both sides.

## Live routes

- A page that reads per-visitor data (a session) or needs a server per request goes in the `live` list, the second argument of `defineRoutes([...], { live: [page(...)] })`. Its response is `private, no-store`, so it is never cached. A link to it needs no guard. Every other page is cached, for any path of its pattern: a post published after the deploy is cached from its first request.
- Data of your own that a cached page reads gets `tagCache(['product:42'])` from `@visio/router` in its server read, and the hook that changes it calls `purgeCache(['product:42'])`. Never `@vercel/functions`: the same call works on Vercel and Cloudflare, and does nothing in dev.
- **A dynamic route lists its pages with `announce`**, so a page nothing links to (a CMS document, a campaign page) is crawled, in the sitemap and in `llms.txt`: `announce: async () => { const slugs = await getLegalSlugs(); return slugs.map((slug) => ({ slug })); }`, the params of every page, typed from the pattern; with `@visio/i18n` it receives `{ lang }` and returns that language's params. It runs on the build's crawl only, once, never for a visitor. Next to the params, an entry may give the page's head facts from the same query: `title`, `description`, `modified`, `noindex`, and with `@visio/i18n` `translations`, each the value `meta()` (or `translations`) makes for that page. The crawl compares each one with the page's real head and stops the build on a difference (`ANNOUNCE_HEAD_DIFFERS`), so project the fields `meta()` reads, or leave a fact out. A param may not have one of these names (`ANNOUNCE_PARAM_RESERVED`). With a route that announces, the deployed server answers the sitemap and `llms.txt` itself, from the build's entries of the other pages and one `announce()` call per route, cached and tagged by its reads: a document published later is in both after the publish, and a deleted one is gone. A dynamic route whose pages the crawl found by links alone stays as of the build, so a route whose pages come from a CMS gets `announce`.
- A page the site links to before it is built goes in `pending`, beside `live`: `defineRoutes([...], { pending: ['/about', '/work/:slug'] })`, literal paths or patterns. The crawl and the smoke run skip links to it, the build warns for each (`ROUTE_PENDING`), and the build fails once its page is in the table or a pending pattern takes in a built page (`PENDING_HAS_PAGE`): remove it when the page ships. Write the options of `defineRoutes()` and the `live` list inline, never as a variable or a spread: the build reads them from the source (`OPTIONS_NOT_STATIC`, `LIVE_NOT_STATIC`).
- `extensions` of `defineRoutes()` and the last argument of `page()` and `layout()` belong to optional packages: each package's own call fills them, and its skill says how. Without such a package, `page()` takes no third argument (`@visio/router` DESIGN.md, Extensions).
