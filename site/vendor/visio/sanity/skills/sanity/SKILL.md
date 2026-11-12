---
name: sanity
description: Use when adding or changing anything that reads or renders Sanity content in this project - a GROQ query, `defineQuery`, `fetchQuery`, a schema type in studio/, typegen, a page backed by a CMS document, its meta or share image, an image from Sanity, Portable Text or rich text, a site in more than one language (defineStudioLanguages, locale fields, localize, translated types, TRANSLATIONS, translationParams) - or when a Sanity image comes out empty, a Portable Text type warns, the Studio at /studio misbehaves, or content is stale after a publish. Covers @visio/sanity (fetchQuery, sanityImage, shareImage and imageSize, PortableText, draft mode and visual editing), the studio workspace, the data layer pattern, publishing on Vercel or Cloudflare, and what is not built yet.
---

# Sanity with @visio/sanity

Sanity is data like any other: a `query()` around a `prerendered()` server function, returned from the route's `preload`, read inside a `<Loading>`. The solid-2 skill covers that pattern; this file covers what is particular to Sanity. `sanity/DESIGN.md` (in `packages/` of the visio repo, `vendor/visio/` in a project) explains why it is built this way.

## Rules

- Read through `fetchQuery` from `@visio/sanity/server`, inside a `'use server'` function in `src/lib/`. It is the whole server API: there is no client to create or pass around, and never fetch from a component. Middleware never fetches what a page renders; its one read is the list of pages it announces to the crawler (see Pages nothing links to).
- Write every query as `const X = defineQuery(...)` with `defineQuery` from `@visio/sanity`, in `src/lib/queries.ts`. Typegen names the result type after `X` and skips inline strings. Build queries from `const` strings and template literals, local or imported by relative path (`${IMAGE}`), and from functions of your own that return one template of their parameters, for a fragment you repeat: ``const t = (field: string) => `coalesce(${field}[$lang], ${field}.en)` ``, then `${t('title')}`. Anything else it reports instead of guessing.
- Project images with `${IMAGE}`, the projection `src/lib/queries.ts` exports (`{ ..., asset->{ url, metadata { lqip } } }`), and render them with `<Image src={sanityImage(value)} …>`. Never a raw `<img>`, never a hand-built CDN URL, never a second image component.
- Render Portable Text with `ui/rich-text`. A schema type it does not handle yet goes into its `components`; never write a second renderer.
- Tokens are server-only: the `server` block of `src/env.ts`, never a `PUBLIC_` variable.
- The schema lives in `studio/schemaTypes/`, exported as `schemaTypes` from its `index.ts`, and imports `defineType`, `defineField` and `defineArrayMember` from `@sanity/types`, never `sanity` (lint rejects it: typegen compiles these files outside the Studio). `sanity`, `@sanity/types`, `react`, `react-dom` and `styled-components` are `catalog:` in `studio/package.json`; the versions are in the root `package.json`, and `bun run visio:update` writes them. The build stops on any other range (`STUDIO_DEPENDENCY_UNCATALOGED`). The Studio is its own React workspace; never import React, `sanity` or Studio code into the site.
- The Studio's config is `defineStudio()` from `@visio/sanity/studio` ([references/studio.md](references/studio.md)). Never write `defineConfig` from `sanity`, never add `structureTool()` or `presentationTool()` yourself, and never turn on releases or tasks unless the owner asks: the Studio is for editors.
- Preview is built in: draft mode, the Presentation tool and the visual editing overlay work through the routes `sanity()` serves under `/api/sanity` and `<VisualEditing exit={...} overlay={...} />` ([references/preview.md](references/preview.md)). Never add a second draft cookie, a preview route of your own, or a check of draft mode in a component; a read through `fetchQuery` already follows it.
- A string from Sanity used as anything but visible text (an href, an id, a class, a value compared in code) goes through `stegaClean` from `@visio/sanity`. In draft mode strings carry invisible marks for the overlay. In dev, the terminal warns about each attribute of a draft page that still carries marks.
- `fetchQuery` accepts only a query typegen has registered. An inline string is a type error; there is no cast around it. There is no untyped read and no `sanity.client`: pass the values that change as params (`$slug`), and write another query shape as its own `defineQuery` (or one query with `select()`). A field with a value per language (`{ de, it }`) is `title[$lang]`, and typegen types it as one string, never a `select()` per language.

## Adding a page backed by a Sanity document

1. **Schema**, when the document type is new: a file in `studio/schemaTypes/`, listed in its `index.ts`. `page` is the example.

2. **Query**, in `src/lib/queries.ts`:

   ```ts
   export const PAGE_QUERY =
     defineQuery(`*[_type == "page" && slug.current == $slug][0]{
     title, description, body, hero{ ..., image${IMAGE} }
   }`);
   ```

   Try it against the dataset before building on it. The CLI reads the project from `studio/sanity.cli.ts` and prints JSON; it takes no parameters, so write the value in place of `$slug`:

   ```sh
   cd studio && bunx sanity documents query '*[_type == "page" && slug.current == "about"][0]{ title }' --api-version 2026-03-01
   ```

3. **Types**: they come from the dev server, which rewrites them on every save of a query or a schema file in well under a second, and from `bun run build`. Keep `bun run dev` running while you work; if a query's type is missing or stale, that is what is not running. Without a dev server, `bun run typegen` writes them once (`visio-sanity typegen` in `site/`) and exits 1 on a query it cannot type. They land in `site/sanity.types.d.ts` (commit it; CI checks it is current), and `fetchQuery(PAGE_QUERY, ...)` returns the query's type, `PAGE_QUERY_RESULT`. A required field (`rule.required()`) is non-optional in it. Type a component's props from the result (`NonNullable<PAGE_QUERY_RESULT>['hero']`): there is no `Page` type, because a document type would claim fields the query did not fetch.

4. **Read**, in `src/lib/content.ts`. `'use server'` only compiles in the site's own source:

   ```ts
   export const getPage = query(
     prerendered(async (slug: string) => {
       "use server";
       return fetchQuery(PAGE_QUERY, { slug });
     }),
     "page"
   );
   ```

5. **Page**. The preload _returns_ the query, so `meta` gets the data and the head lands in the prerendered HTML:

   ```tsx
   export const route = defineRoute("/:slug", {
     preload: ({ params }) => getPage(params.slug),
     meta: ({ data }) => ({
       title: data?.title ?? "Not found",
       description: data?.description ?? undefined,
       image: shareImage(data?.hero?.image),
     }),
   });
   ```

   A site with SEO fields in its documents builds `meta` with one function of its own ([references/meta.md](references/meta.md)).

6. **Route** in `src/routes.ts`, and make sure something links to every slug (see Pages nothing links to).

7. **Build** with `bun run build`. A slug the crawl never reached is not in the output.

Data every page needs (settings, navigation, footer) goes in a root layout's `preload` the same way, never in middleware: a query fetched before the render empties every `<Loading>` that reads it.

## More

Read the file for the task at hand:

- [references/setup.md](references/setup.md): once per project. The env pair, CORS origins, `src/env.ts`, the `IMAGE` projection, the Studio's path, and when the build rebuilds the Studio.
- [references/studio.md](references/studio.md): `defineStudio()`, singletons, a custom structure, Presentation's `resolve`, locales, releases and tasks.
- [references/languages.md](references/languages.md): `defineStudioLanguages()`, locale fields and `localize()`, translated types, `TRANSLATIONS` and `translationParams()`, and turning languages on for content that already exists.
- [references/images.md](references/images.md): `sanityImage()`, `alt`, the ratio and size of an image, `shareImage()`, `sanityImageUrl()`, and `imageSize()` in a validation rule.
- [references/meta.md](references/meta.md): the page meta function of a site with SEO fields.
- [references/portable-text.md](references/portable-text.md): `ui/rich-text`, its `components`, and excerpts.
- [references/preview.md](references/preview.md): draft mode, the Presentation tool, the publish webhook, and the draft mode controls.
- [references/troubleshooting.md](references/troubleshooting.md): a symptom or a `[@visio/sanity]` message, and its cause.

## Pages nothing links to

The crawl builds what it can reach by links. A document with no link to it (a landing page for a campaign) is listed by its route's `announce`, from a query of every published document. The query projects the head facts too, the same fields `meta()` reads, and the build checks them against each page (the `router` skill):

```ts
export const route = defineRoute("/legal/:slug", {
  preload: ({ params }) => getLegal(params.slug),
  // LEGAL_LIST: *[_type == "legal"]{ "slug": slug.current, title, "modified": _updatedAt }
  announce: async () => await getLegalList(),
  meta: ({ data }) => ({ title: data.title, modified: data.modified }),
});
```

## Not built yet

- Presentation in more than one language: `presentationTool: { resolve }` with a route for each language is the site's own.
- Live updates for visitors: a publish reaches open pages on their next load or navigation, not while they are open.
- Nothing has run against a real project and deployment yet (`sanity/DESIGN.md`, Not built yet).
- A publish purges the whole site, not only the pages that showed the change (`sanity/DESIGN.md`, Publishing).
