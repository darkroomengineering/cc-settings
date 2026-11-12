# @visio/sanity design

Sanity in a visio site. Almost every darkroom project uses Sanity, and each one copied the same Next.js kit (client, image helper, Portable Text component, draft mode routes, live refresh), redoing it at every next-sanity major. This package is that kit for Solid 2 and the route table, built on Sanity's framework-agnostic pieces.

## Goals

1. A site reads Sanity through its own data layer, the same `query(prerendered(...))` pattern as any other read, so the Vercel deployment caches the content and a publish purges it. The package adds no data layer of its own.
2. What renders content (images, Portable Text) needs no configuration beyond the query.
3. Styles stay in the site. The package renders plain elements and computes attributes; `ui/rich-text` and the site's image component decide how they look.

## The entries

`@visio/sanity/server` is the one read, `fetchQuery`, for server functions. `@visio/sanity` is what runs in the browser. The split keeps `@sanity/client` and any token out of the client bundle, the way the router keeps the API handlers out. `@visio/sanity/vite` is `sanity()`, the build part, which a site puts in `extensions` of `visio()`. `@visio/sanity/internal/middleware` is the draft mode and publish routes, which `sanity()` gives `visio()` as its `middleware`; lint bans it in the site, the lab and the studio. The helpers the plugin runs (the Studio redirect, the start of `sanity dev`, the search for Node, the warning for an unset project) are in `src/studio.ts`; the reader behind `fetchQuery` and the routes is `src/reader.ts`. Neither is on an entry. A site imports nothing Sanity from anywhere else, `defineQuery` included.

The browser entry is seventeen names, each one something a site writes with: `defineQuery`; `TRANSLATIONS` and `translationParams` (Languages, below); `sanityImage`, `sanityImageUrl` and `shareImage` (the social image); `SanityImageValue`, the input of the three, for a helper that takes images from several queries and passes them to `sanityImageUrl()` or `shareImage()` (a prop that `<Image>` renders takes the union of the query fields, so the alt check stays); `PortableText` and its `PortableTextProps`, `PortableTextComponents` (the type of the one object `ui/rich-text` writes, which types every component in it), `PortableTextBlock` (the value of a block component), `PortableTextValue` (the field a wrapper such as `ui/rich-text` passes on: typegen marks `children` and `text` optional, which `PortableTextBlock` does not accept), and `PortableTextTypeProps` and `PortableTextMarkProps` for a custom type or annotation written outside that object; `VisualEditing` and its `VisualEditingProps`; and `stegaClean`. The server entry is `fetchQuery`. The Studio has three entries of its own, which only `studio/` imports: `@visio/sanity/studio` (React-side) is `defineStudio` with its `StudioOptions`, `Studio`, `DocumentName`, `TranslatedName` and `StructureArgs` types, `@visio/sanity/studio/cli` is the whole of `sanity.cli.ts`, and `@visio/sanity/studio/schema` is what a schema file in `studio/schemaTypes/` imports: `imageSize`, for a validation rule (the site does not need it: `sanityImage()` already gives the size), and `defineStudioLanguages` with its types (Languages, below). Typegen loads the schema files outside the Studio, so that entry imports nothing but its own modules and types (`asset.test.ts` checks it). From `@visio/sanity/studio` a schema file would load all of `sanity`, and from `@visio/sanity` Solid and the router. The Vite entry, `@visio/sanity/vite`, is `sanity()` and its `SanityOptions`: the extension that `visio()` takes in `extensions` (The paths). A type the site can get from a query result or from that object, it gets there: the block style and list props and the Portable Text object types are not exported.

### What a site writes, and what it does not

A site writes its queries, its rich text components and its image `sizes`: those are its own decisions. Everything with one right answer is the package's: the client and its settings, the names of the environment variables, the draft mode and publish routes, the cache tags, the cleaning of links. Until 2026-10-06 a site wrote `src/server/sanity.ts` (`createSanity()` with four variables from `env.ts`), `src/api/sanity.ts` and its line in `src/routes.ts`, and called `safeHref` in its link mark. None of it was a choice, and each was a place to get it wrong: a route moved off the path the Studio opens broke draft mode, and a link mark that skipped `safeHref` rendered a `javascript:` link from the CMS.

What is left for the site:

- `src/env.ts` declares `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_READ_TOKEN` and `SANITY_REVALIDATE_SECRET`, so `@visio/env` validates them. The package reads them from `process.env`, which `@visio/env` fills from the decrypted `.env` file of the mode in dev and in a build off the platform, and the host fills on the platform.
- `<VisualEditing />` once in `app.tsx`. It uses the router's hooks, so it has to render inside the router, and no other package may depend on Sanity to put it there. With the Studio on, a build in which no file of the site imports it stops and says so.
- `extensions: [sanity()]` in `vite.config.ts`, and where the Studio and the routes live, if not `/studio` and `/api/sanity`: `sanity({ studio: { path, api } })`.

### `fetchQuery()`

```ts
export const getHome = query(
  prerendered(async () => {
    "use server";
    return fetchQuery(HOME_QUERY);
  }),
  "home"
);
```

The site keeps its reads in `src/lib/`, because `'use server'` is compiled in the site's source, not in a package. The client behind it is made on the first read, with the defaults the client sites arrived at one bug at a time:

- `perspective: 'published'` and no API CDN. The CDN can serve the previous version for a while after a publish; a build that reads it bakes that version (harbor turned it off for this reason, satus and lore still read it).
- A 20 second timeout, so a build fails instead of hanging on a stalled request.
- The API version pinned to `API_VERSION`, which moves with the package.

There is no client to reach and no object to pass around: a function is the whole API. A client of the site's own would read without the draft perspective and the cache tags, and a publish would not purge what it showed. The package's tests build a reader with `createReader()` from `src/reader.ts`.

- An unset `SANITY_PROJECT_ID` or `SANITY_DATASET` rejects the first read and names the variable, not at import. A site without a project yet still boots, and nothing needs the `isSanityConfigured()` null checks satus threads through every call. The first read can come late, though: a read that only a live route makes gets past the build's crawl. So the Studio plugin reads the site's environment (the `.env` files and `process.env`, as the server does) and warns in the dev terminal and the build log when the site has a query but either is unset. A warning, not an error: a host can set them for the runtime only, and a starter with no query stays quiet.

`fetchQuery(query, params)` takes only a query string typegen has registered on the global `SanityQueries` interface, and returns its type. An inline string, or a query built at runtime, is a type error, and the parameter's type is the message (`UnregisteredQuery`): write it with `defineQuery` in `src/lib/queries.ts` and keep the dev server running. The typecheck is where an agent sees it; returning `unknown` let the read compile and moved the error to wherever the result was used. It reads the registry itself instead of passing `client.fetch` through: the site never imports `@sanity/client`, and a client release that changes how its overloads are declared does not change the site's types.

There is no escape. `sanity.types.d.ts` is committed, and CI fails when it is stale, so a fresh clone has every registered query. A query written a second ago is registered on save while `bun run dev` runs, and by the build. There is no untyped read either. The values that change go in params (`$slug`), so the query stays one string typegen can type, and a different shape of query is its own `defineQuery` (or one query with `select()`). Before 2026-10-06, a query built at runtime went through `sanity.client.fetch`: no types, and no cache tags, so a publish did not purge the pages it fed. Nothing used it, and an escape next to the error is where an agent goes first. If a real query needs a pattern typegen does not follow, typegen learns the pattern.

### The paths

`sanity()` serves the Studio at `/studio` and the routes under `/api/sanity`; `sanity({ studio: { path, api } })` moves either. A path is one from the root without a trailing slash, and the two may not overlap; anything else stops the config. The paths reach every place that needs them from that one option:

- the runtime code (the stega `studioUrl`, the overlay's perspective post, the routes) through two defines, `import.meta.env.VISIO_SANITY_STUDIO` and `VISIO_SANITY_API`, which the Studio plugin sets, with the defaults where nothing defines them (a test);
- the Studio app through `SANITY_STUDIO_BASE_PATH` and `SANITY_STUDIO_API_PATH`, which the plugin sets for `sanity dev` and `sanity build`, and which `@visio/sanity/studio/cli` and `defineStudio()` read. The plugin also passes the site's `SANITY_PROJECT_ID` and `SANITY_DATASET` (from Vite's env files, the environment first) as `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`: Sanity bundles only `SANITY_STUDIO_` variables, and a project sets one pair. A second pair was set on Vercel only for the site; the build passed, and `/studio` failed in the browser with "Configuration must contain `projectId`". So a build on Vercel or Workers Builds (`VERCEL` or `WORKERS_CI` set) with the Studio on stops with `PROJECT_ID_UNSET` without `SANITY_PROJECT_ID`, and any other build warns. `sanity` run on its own reads the site's `.env` in `studio/sanity.cli.ts`;
- `visio()`, through the fields of the extension (`visio/DESIGN.md`, Extensions): `served` for the crawl, which skips both, the smoke run, which reads them from `.visio/paths.json` that the dev server writes, and the router, which stops on a route in the table under either path (`ROUTE_RESERVED`): it would never be reached; `open` for the password gate, which lets `<api>/revalidate` through; `app` for the output, which answers every path under the Studio with its `index.html`.

The publish webhook is set up in Sanity's project settings, not in the site's build, so its URL holds the API path as written there: `https://<site>/api/sanity/revalidate` by default.

### `sanityImage()`, `sanityImageUrl()`, `shareImage()` and `imageSize()`

`sanityImage(value)` returns an `ImageSource` (from `@visio/image-optimizer`): a function that takes a `sizes` value and returns an image in the shape of a `?responsive` import, plus the editor's `alt`, which `<Image>` from `@visio/image-optimizer` uses when it is given none. The type follows the value: with an `alt` field it is a `DescribedImageSource` and `alt` is optional, without one a `CdnImageSource` and `<Image>` requires `alt`, as for a local image. The function also carries `width`, `height` and `aspectRatio`, so a box can take the ratio without a `sizes`. `<Image>` calls it with its own `sizes`, so a Sanity image and a local image take the same props and `sizes` is written once. No Sanity code goes into the site's components. The project and dataset are read off the asset's CDN URL, so the browser needs no environment variables and one site can show images from two datasets.

- The `srcset` offers the widths `sizes` can make the browser pick, through the optimizer's own `selectWidths()`. A local image has these widths chosen at build time, because the compiler hands the `sizes` to the import. A Sanity image arrives as data, but the `sizes` value is a plain string at render time, so the same function runs there. A `sizes` it cannot read offers every width.
- The `srcset` never offers more than the source has (5% over, since the CDN does not upscale with `fit=max`), and ends with the source's own width when a wider step was cut, so its full resolution is on offer.
- The size comes from the CDN file name (`<asset>-3000x2000.jpg`), and the editor's crop changes it, so `width`, `height` and `aspectRatio` are the cropped size. The projection needs no dimensions, and `SanityImageValue` has none, so no code reads a field the query stopped fetching.
- `sources` is empty: the CDN picks the format per request (`auto=format`).
- An SVG comes back as is with an empty `srcset`, at its full size: the CDN does not crop an SVG, so the editor's crop is left out of its size too.
- `null` for an empty field, a projection that did not dereference the asset, or a URL off Sanity's CDN. `<Image>` renders nothing for `null`.
- No option crops to a box. The box crops with `fit="cover"`, as it does a local image, so every image takes the same props. The starter schema leaves the hotspot off: nothing on the page would follow it, and an editor control that changes nothing misleads. `sanityImageUrl()` with a height still crops around a hotspot a project's data has, as `@sanity/image-url` does. If a layout needs one, a focal point on `ImageSource` (`object-position`) is the way to add it, for local images too.

The URLs are built in the package, not with `@sanity/image-url`: they are a few query parameters, and the crop around the hotspot is thirty lines. A test checks them against `@sanity/image-url` for random crops, hotspots and sizes, so the URLs stay the ones the CDN has already cached.

`sanityImageUrl(value, { width, height })` is one fixed-size URL: a background, a poster frame.

`shareImage(value)` is the social image: the `MetaImage` that `meta` takes, 1200 by 630, cropped around the hotspot (`fit=crop`, the same URL `@sanity/image-url` builds), with the image's `alt` when it has one, without stega marks: in draft mode the alt carries them, and the head would put them in the `og:image:alt` tag. 1200 by 630 is the size that Open Graph and X show without a crop, so it is not an option. It gives `undefined` for an empty field, an SVG (link previews do not show one) and a URL off Sanity's CDN, where the size is not known. A site then chains its fallbacks with `??`, and without any image the page gets `site.image`. It is on the browser entry, not the server entry: `meta` runs on the server and in the browser, and the function only builds a URL.

`imageSize(value)` is the size after the editor's crop, the same as `sanityImage()` gives, without a fetch. It reads the asset id (`image-<hash>-1200x630-jpg`) of an unresolved reference (`asset._ref`) or of a dereferenced asset (`asset._id`), or the CDN URL. So it works in a Studio validation rule, where the value is a reference. It only reads: the limits (a share image at least 1200 wide) are the site's. It lives in `src/asset.ts` with the size and crop code, and `sanityImage()` gets its size from it, so the SVG rule (no crop) is in one place.

There is no page meta helper. The SEO fields, the image fallback order, the title rule and the place of the defaults are different on each site, so a helper would need an option for each one. The skill has an example `src/lib/seo.ts` that a site copies and changes.

There is no image component in this package. `<Image>` from `@visio/image-optimizer` renders a local import and a Sanity image alike, and a second component would drift from it.

### `<PortableText>`

`@portabletext/toolkit` does the walking: `nestLists` turns the flat list items into nested lists (HTML mode, a deeper list inside the item it follows) and `buildMarksTree` nests the marks so an overlap (a bold word inside a link) is one anchor, not two. The component maps the toolkit's nodes to Solid components. The components prop has five maps: `types`, `marks`, `block`, `list` and `listItem`, each keyed by name. These are the keys of `@portabletext/react`, so a client site's components port by changing their JSX. The rest of its shape is not here: a single component for `block`, `list` or `listItem`, `hardBreak`, and the `unknown*` fallbacks. A catch-all hides a type the site forgot, so the dev warning below is the only signal. A `\n` in the text is always a `<br>`.

- The defaults are plain elements with no classes. A site passes what it styles; anything it leaves out falls back to the default, so passing `block: { h2 }` keeps the default `h3`.
- `components` is read once. They are configuration; `value` is the reactive prop and the rendered nodes follow it.
- A type with no component renders nothing and warns once per type in dev, during the server render too, so the dev terminal shows it. The warning names the type and where to add it (`components.types`, in `ui/rich-text` in a visio site). A mark with no component renders its text. A style with no component is a paragraph. A list kind with no component is a `ul` of `li`s.
- The renderer drops the `href` of any annotation whose scheme is not `http:`, `https:`, `mailto:` or `tel:`, before a mark component gets the value; relative links and fragments pass. React 19 blocks a `javascript:` URL, Solid sets it as it is. The site's own link mark gets the cleaned value, so it has nothing to call and nothing to forget. Until 2026-10-06 the site called `safeHref()` itself.
- The default link mark opens an `http:` or `https:` link in a new tab with `rel="noopener noreferrer"`, and leaves relative, mail and phone links alone. A site styles links with a selector on its rich text (`'& a'`) and needs no link mark of its own. Until 2026-10-07 the site wrote one only to add that `target` and `rel`, with a helper borrowed from its button.
- A description or an excerpt is `"excerpt": pt::text(body)` in the query: GROQ turns the blocks into a string on Sanity's side, and typegen types it `string`. The package had `toPlainText()` for it until 2026-10-06, a second way to do what the query does.

`@portabletext/solid` exists but targets Solid 1.

## The Studio and typegen

The Studio is the `studio/` workspace next to the site: a React app built by the Sanity CLI, which `sanity()` serves at `/studio` (or its `studio.path`, see The paths); a site turns it on with `extensions: [sanity()]`. `sanity({ studio: false })` serves no Studio and no routes, and keeps only the types: for a site that reads a dataset whose Studio another project owns, and which cannot open the Studio, because opening it registers its schema on that dataset (#337). The types come from the schema in `studio/schemaTypes/` either way. Until 2026-10-26 the types came only with the Studio on, and `visio()` had the `studio` option and depended on this package, so a site without Sanity installed it too (#368). The paths are the only options: the Studio is in `../studio`, with `sanity dev` on port 3333, and the types go from `src/` into `sanity.types.d.ts`. A project that needs something else changes the package; a flag would be one more thing an agent has to guess. An embedded Studio would put React in the site's graph; this keeps the same URL and the same deploy without it. `react`, `react-dom` and `styled-components` are in its dependencies although no file imports them: they are `sanity`'s peers, Bun links peers for `sanity` alone, and `sanity build` checks for them in the project and stops. The project id falls back to `unset` because `defineConfig` throws on an empty one, and the build would fail before a project exists.

### The Studio's config

`studio/sanity.config.ts` is one `export default defineStudio({ title, types: schemaTypes })`, and `studio/sanity.cli.ts` is one `export { default } from '@visio/sanity/studio/cli'`. Until 2026-10-09 a project wrote both files itself, and nothing checked them. A linked project's config came from the `sanity init` template before it used visio: it shipped Vision to its editors and had no Presentation tool, so the site rendered `<VisualEditing />` and served the draft mode routes for a Studio that never opened them.

Typegen reads the schema from `schemaTypes`, and adds the `schema.types` of every plugin in `defineStudio({ plugins })`, nested plugins too, because a plugin's types (`sanity-plugin-internationalized-array`, a link field) are not in `schemaTypes`, and a field of one stopped typegen with `Unknown type`. It loads `sanity.config.ts` through the same Vite runner, on each Studio change, not on each save of a query. A composer function for `types` gets no types before it and no project: typegen has the site's types already. A config that throws stops typegen with `TYPEGEN_CONFIG_FAILED`.

What `defineStudio()` fixes, because each has one right answer:

- The project and dataset, from the `SANITY_STUDIO_` pair the plugin passes, and the name `default`.
- The structure tool and `presentationTool()` on the draft mode routes under the API path, which opens the site at `/`.
- The editor's Studio: releases, scheduled drafts, scheduled publishing and tasks are off. `releases: true` turns on releases with scheduled drafts, and `tasks: true` turns on tasks. The reader handles both `drafts` and `published` (`draft.test.ts`), so draft mode works the same with releases off. Vision is not added; a project that wants it installs `@sanity/vision` and passes `visionTool()` in `plugins`, and nothing warns.
- Singletons. `singletons: { homePage: 'Home' }` registers each type in Sanity's own `document.singletons` (beta in sanity 6.18), with the type's name as the document id (in the default language, for a translated type: Languages, below). Sanity then keeps the type out of the "new document" menu and the type list, and drops the duplicate action; `defineStudio()` also drops delete, unpublish and a release's unpublish (`unpublishVersion`), since a deleted or unpublished singleton leaves the site without its page. Every other action stays, a plugin's own included (a workflow, a translation): a list of the actions to keep dropped those without a word. The default structure lists the singletons, a divider, then every other document type, under Sanity's own translation key for its root title, so a locale plugin translates it. A site that needs its own passes `structureTool: { structure: (S, { singleton }) => ... }`, and lists a singleton with `singleton('homePage')`. Sanity's API is beta, so it is wrapped here: when it changes, one file changes, and `sanity` is pinned in the catalog.

The singletons are typed from `types`. `defineType` keeps each type's literal `name` and `type`, so `singletons` takes only the names of document types in `schemaTypes`, and a typo is a type error that names the closest one. `singleton()` takes only a listed singleton; Sanity's own `S.listItem().singleton(id)` takes any string and fails in the browser. A schema without `defineType` has `string` names, and the runtime check (`SINGLETON_TYPE_UNKNOWN`) is what stays.

What the site passes: `title`, `types`, `languages`, `singletons`, `structureTool`, `presentationTool`, `plugins`, and the two switches. `structureTool` and `presentationTool` are the tools' own Sanity options, so Sanity's docs apply as written, without what visio fixes: `name` and `source` of the structure tool, and `name`, `previewUrl` and the deprecated `locate` of Presentation. Sanity's tab titles ("Structure", "Presentation") are fixed strings that no locale plugin translates, so a site in another language sets `title` in both. An option of visio's own for the titles was rejected: one more name to learn for what Sanity already has. `plugins` is free. A plugin that is already in the Studio (the structure or Presentation, or a plugin passed twice) warns `STUDIO_PLUGIN_DUPLICATE` in the browser console; a singleton that is no document type in `types` throws `SINGLETON_TYPE_UNKNOWN`.

The rest of Sanity's `document` options (`productionUrl`, `newDocumentOptions`, actions of the site's own) have no option, on purpose: each is a choice an agent would make without a reason. A plugin can still set them, and that is the place a review sees.

The Studio entry also exports `DocumentName`, the document type names of a schema, literal through `defineType`, `TranslatedName`, the names of the types `translated()` returned, and `StructureArgs`, what a custom `structure` gets with the typed `singleton()` and `languageList()`.

The Studio plugin reads both files with `oxc-parser` (`src/studio-check.ts`), in the dev terminal at start and on each change, and in the build. A config whose default export is not a `defineStudio()` call stops the build with `STUDIO_CONFIG_UNMANAGED`, and a CLI config that is not the re-export with `STUDIO_CLI_UNMANAGED`; so does a missing file. The call may sit in a top-level `const` (exported or not) that the default export names, and behind `satisfies` or `as`. Both files are found as `@sanity/cli-core` finds them: the config as `.ts`, `.tsx`, `.js` or `.jsx`, the CLI config as `.ts` or `.js` only, so a `sanity.cli.mjs` the CLI never loads does not pass. The dev watcher uses the same lists, and runs the check again when a file is added, removed or renamed. A `studio/package.json` that sets its own version of `sanity`, `@sanity/types`, `react`, `react-dom` or `styled-components` stops the build with `STUDIO_DEPENDENCY_UNCATALOGED`: a release writes the catalog's version into the package, so a pin of the Studio's own installs a second copy, and `defineStudio()` types against the other one. An import of `structureTool` or `presentationTool` in the config warns `STUDIO_PLUGIN_DUPLICATE`.

The CLI config loads the site's `.env` for `sanity` run on its own, sets the base path, and dedupes `sanity`, `react`, `react-dom` and `styled-components` in the Studio's Vite build. The package imports `sanity` from its own folder, and without the dedupe a version apart from the Studio's would put two copies of the Studio in the bundle. The five are in the catalog, so the package and `studio/` resolve one copy. The Studio's `tsconfig.json` sets `allowImportingTsExtensions`, since the package's source imports with `.ts`.

### Typegen

Typegen turns the Studio's schema and the site's queries into `site/sanity.types.d.ts`: a result type per query, the schema types those results refer to, and the global `SanityQueries` registry `fetchQuery` reads. It is this package's own, in three steps, and uses no Sanity CLI and no `@sanity/codegen`:

1. **Schema** (`typegen/schema.ts`). The Studio's `schemaTypes/index.ts` is loaded with Vite's `runnerImport`, then compiled with Sanity's built-in types and extracted, with required fields enforced: `Schema.compile` and `extractSchema` from `@sanity/schema`, resolved from the Studio's own `sanity` install so the built-ins match its version. These are the two calls `sanity schema extract` makes after it has loaded the whole Studio in a mocked browser; the output is byte-identical to the CLI's `schema.json`, which a test checks against the real Studio, since `extractSchema` comes from `@sanity/schema/_internal`. It takes milliseconds where the CLI takes about seven seconds. The schema files import `defineType` and friends from `@sanity/types` (lint enforces it): from `sanity` they would load the entire Studio for an identity function. `sanity` and `@sanity/types` are pinned to exact versions in the root catalog, which `studio/` and this package both use, `@sanity/types` at the one `sanity` depends on (listed in its `package.json`), so both share one copy; on an upgrade the two move together. A range would let `bun update` move `sanity` alone, so typegen compares the two and stops with the version to set. Every schema type is defined in `schemaTypes`: a Studio plugin that adds types through `sanity.config.ts` is not seen, and its types are defined there instead. The extract gives every image field `hotspot?` and `crop?`, with or without `options: { hotspot: true }`; that is Sanity's behaviour and codegen's output, and a document edited while the option was on still carries them, so the types keep them. It reads `schemaTypes` only, so a type that a Studio plugin adds through `sanity.config.ts` is not seen.
2. **Queries** (`typegen/queries.ts`). Every `const X = defineQuery(...)`, with `defineQuery` imported from `@visio/sanity` (only there: one way to write a query), found with `oxc-parser` and evaluated to its string: string and template literals, `+`, `as const`, and `const` strings local or imported by relative path, re-exports and `export * from` included, and a call to a function of the site's own, local or imported the same way, whose body is one expression (an arrow, or a function with only a `return`) and whose parameters are plain names: the arguments are evaluated first, then the body with the parameters bound to them (`t('title')` for `coalesce(title[$lang], title.en)`). Anything else (a `let`, a package import, a function with statements, a call with the wrong number of arguments) is reported with the file and the variable. Each file records the files its queries were built from, so a change to a shared projection refinds the files that use it.
3. **Types** (`typegen/print.ts`). `groq-js` `typeEvaluate`, Sanity's type evaluation for GROQ, turns each query into a type tree, and the printer writes it as TypeScript. It follows `@sanity/codegen`'s translation (its identifiers, `ArrayOf` for arrays of inline types, the reference symbol), which a test holds it to: the same schema and queries through both, every exported type checked equal by `tsc`. Required fields are non-optional; in preview a draft can still miss one, which the preview work has to account for. There is no `declare module "@sanity/client"`: codegen always writes that bridge for old clients, and with Bun's isolated installs the site cannot resolve the client, which failed the typecheck with TS2664. Schema types are printed only when a result reaches them, directly or through another schema type, and `AllSanitySchemaTypes` is gone: a schema type describes the whole stored document, so a component typed with `Page` compiles while it reads a field its query never fetched. A result that names `RichText` or `Slug` still gets it. `field[$lang]` on an object (`{ de, it }`) is where typegen and the API disagree: the parser does not know the param, so it reads `[$lang]` as a filter and `groq-js` types an array of the object, while the API, with a string param, reads it as the attribute. `typegen/param-access.ts` evaluates the query once with each `[$param]` chain replaced by its base. When every base is an object, it renames the param in those brackets only, prints the query again with `unparse()`, and parses it with the renamed param set to each of the object's keys (`_type` and `_key` left out). Then it merges the types, so `title[$lang]` is `string | null`, and `$lang` in any other place stays a param. Three cases keep the filter's type: a param with one base that can be an array (`tags[$lang]` in the same query), a `[$param]` inside a function or an operator (`lower(title[$lang])`), and the outer param of `x[$a][$b]`. Before 2026-10-15 a site wrote `select($lang == "it" => title.it, title.de)`, which grew with each language.

The dev server keeps a `Typegen` in the Studio plugin: a changed `.ts`/`.tsx` under `src` is searched again, a changed Studio file reloads the schema (debounced), each step queued behind the last, and the file is only rewritten when the types change. A query or schema edit reaches the types in a fraction of a second. The build runs it once at the start of the client build and fails on a query it cannot type; CI then fails when the committed file differs from what the build wrote. `visio-sanity typegen` (`bun run typegen`) runs the same pass once, from the site's folder, and exits 1 on a query it cannot type. Until 2026-10-09 there was no command, and the types came only from the dev server and the build. An agent on a project with no dev server running had only the full build to get a type, and asked for a script. `sanity schema extract --watch` could not have done the schema half: `@sanity/cli` 8.13 hands glob patterns to chokidar 5, which dropped glob support, and it watches nothing.

The package is TypeScript source that a runtime loads as it is, Node's type stripping included, so it keeps to erasable syntax (no parameter properties or enums); `erasableSyntaxOnly` in `tsconfig.base.json` enforces that across the repo.

### Serving it at `/studio`

`studio()` puts the Studio workspace under the site's URL, at `/studio`. The Studio is a React app, so it stays out of the Solid graph and the site's bundles; this part runs the Sanity CLI in its folder (`node_modules/.bin/sanity`) and serves the result. The site's own `vite` and `vite build` do everything, so a host that builds from the site's folder (Vercel with `site/` as the root) needs no extra step.

- **Types:** kept current in dev and written at the start of the build, as described under Typegen.
- **Dev:** the dev server starts `sanity dev` on port 3333 (unless something already listens there) and stops it when it closes. It starts the CLI with the first `node` on `PATH` that is not Bun: the CLI fails on Bun, and `bun --bun vite` puts Bun's own `node` first on `PATH`. `sanity build` starts the same way. A restarted dev server's Studio waits for the old `sanity dev` to exit, or it would find the port taken and start nothing. The dev server itself does not wait: Vite makes the new server before it closes the old one, and only that close stops the old `sanity dev`. So a server that waited for its Studio would hang the restart (`studioForServer()`). `server.proxy` sends `/studio/` to it, websockets included for its hot reload, and `/studio` redirects to `/studio/`, where the Studio's router starts. A request in the second before `sanity dev` is up gets a proxy error; reload.
- **Build:** `sanity build` starts with the client build (the build's only; Vite calls `buildStart` in dev too, where it used to start a `sanity build` and leave its output in the temporary directory) and runs alongside the site's, into a temporary directory, since Vite empties `dist/client` when it writes the client. After the server build it is copied into `dist/client/studio/`. The copy moves the icon and manifest links of its `index.html` under the Studio's path (`studioIcons()`): `sanity build` writes them at `/static/` whatever the base path, so they were 404s, and `sanity dev` gets them right. It takes about a second and a half for the starter's Studio and about eight for a real one with plugins; in sequence it made the starter's build 3.5 s, alongside 2.1 s. A failed Studio build fails the site's with the CLI's output, and a failed site build stops the Studio's. The build in flight is kept at module scope, because a build resolves each environment's plugins afresh. Building it from the site keeps the order out of the workspace: a dependency between the two only held when the root build ran both, and `vite build` in `site/` failed.
- **Build cache:** the last Studio build is kept in `<cacheDir>/visio-studio/<key>` (`node_modules/.vite`, which Vercel restores with `node_modules`), and a build with the same key copies it instead of starting `sanity build`. The key hashes the files in `studio/` (not `node_modules`, `dist`, `.sanity` or `schema.json`), the nearest `bun.lock`, which pins `sanity` and every Studio dependency, the `SANITY_STUDIO_` variables, the site's `.env` files included, since `studio/sanity.cli.ts` loads them, and this package's files that the Studio bundles: its three Studio entries and every file they import (`ownFiles()`), since a project gets a release in `vendor/visio/` and `bun.lock` does not change. Without a lockfile nothing is cached. Only the newest build is kept. On two cores, `sanity build` competes with both of the site's builds for the CPU: in a container that matched Vercel's build timeline, a linked project built in 14.6 s with it and 6.2 s from the cache. A Studio file outside `studio/` is not in the key, so its change is missed; the skill says to keep them inside. A symlink in `studio/` counts as the file it points to. The plugin's own code is not in the key: a change to how it runs `sanity build` or builds its env bumps `CACHE_VERSION` in `src/studio-cache.ts`.
- **Crawl:** `visio()` filters paths under the Studio's path out of the crawl.
- **`vite preview`:** deeper paths without an extension get the Studio's `index.html`. The proxy is dev only; preview inherits `server.proxy` and would otherwise forward to a running `sanity dev`.
- **Host:** the Vercel output routes `/studio/*` to `/studio/index.html`, and the Cloudflare Worker serves that file for each path under the Studio.
- The Studio's `basePath` goes in the CLI config (`project.basePath`, from `SANITY_STUDIO_BASE_PATH`) only. Set in the Studio's config as well, it applies twice and the Studio lands on `/studio/studio`.
- The Studio's build links its favicons and manifest at `/static/...`, outside the base path, so they 404 under the site. Cosmetic, left alone.

## Preview

Draft mode, the Presentation tool and publishing ride on the deploy output (`packages/vercel/DESIGN.md` and `packages/cloudflare/DESIGN.md`), where every crawled page and every `prerendered()` read is cached, and one cookie, `__prerender_bypass`, skips that cache for all of them. Draft mode is that cookie, so the request that shows drafts is always the request that skips the cache. Nuxt's Sanity module set a cookie of its own instead, and editors kept seeing cached pages inside Presentation (nuxt-modules/sanity#998).

- **Routes.** `sanityRoutes` from `@visio/sanity/internal/middleware` answers `GET enable`, `GET disable`, `POST perspective` and `POST revalidate` under the API path, where `presentationTool()` from `defineStudio()` points. It is the default export, because `sanity()` gives it as the `middleware` of its extension, and `visio()` puts it on the server's middleware chain after the Markdown copies: the Solid plugin gets `node_modules/visio/src/chain.ts`, which runs it, then the site's own `src/middleware.ts`, then the API routes. Any other path under the API path is a 404, and every path outside it goes to the site. The route table does not list it, as it does not list the Studio: the path is fixed by the Studio's config, so a line in the table gave the site nothing to change, only something to break.
- **Enable.** `validatePreviewUrl` from `@sanity/preview-url-secret` checks the secret the Studio put in the URL against the dataset, with the read token, and the editor lands on the page with two cookies: the bypass cookie, `HttpOnly`, holding the deployment's token (a new one every build, `VISIO_BYPASS_TOKEN` in the Vercel function or the Worker's vars, a Preview's too; made up per process in dev and `vite preview`), and `sanity-preview-perspective`. Both are `SameSite=None; Secure`, since the preview is in the Studio's iframe, and `Partitioned`, the only cookies Safari keeps in a third-party frame. They are partitioned on every route, so the perspective and disable routes write the partition the enable route wrote. Both have `Max-Age` 8 hours, and a switch of perspective renews the perspective cookie. Until 2026-10-12 they had none, and a browser's session restore kept a draft session for ever. Presentation enables draft mode each time it opens, so an editor's next session gets new cookies. A redirect never leaves the origin.
- **Disable** expires both and goes to `?redirect=`, resolved as the browser would, so `/\evil.com` lands on `/`. A browser's speculative prefetch of the link (`Sec-Purpose: prefetch`) is turned away: on client sites a prefetch of the disable link ended draft mode inside Presentation.
- **Reads.** `fetchQuery` reads the request's cookies through the request event. In draft mode it reads the Studio's perspective (drafts, a stack of releases, or published) with the token and stega. Otherwise it reads what is published and tags the cached page or read being rendered with one tag, `sanity`, through `tagCache()` of `@visio/router`, which reaches whatever cache the deploy output put on the request event (`packages/router/DESIGN.md`, The cache). The package knows no platform: it has no `@vercel/functions`.
- **Overlay.** After mount, `<VisualEditing />` loads `@sanity/visual-editing-standalone` (React inside, 249 kB gzipped in its own chunk) only when the perspective cookie is there: at once in Presentation, and outside it when the editor turns it on (Exit, below), which is why that cookie is readable by scripts; it unlocks nothing without the bypass cookie. The Studio's navigation drives the router and the page's address drives the Studio's; an edit, or a switch of perspective (posted to `perspective`), revalidates every query, and the reads go around the cache. After a deploy the bypass token is new but the cookies stay: a switch of perspective then gets a 403 that expires the perspective cookie, and a warning in the console says to reopen the preview. An async draft check at the root would have deferred the whole app's hydration until it settled.
- **Publishing.** A GROQ webhook, set up once in the project's API settings, posts each change to `revalidate`. The route checks the `sanity-webhook-signature` header against `SANITY_REVALIDATE_SECRET`: an HMAC-SHA256 of `<timestamp>.<body>`, the check of `@sanity/webhook`, written out on `node:crypto` and compared in constant time. A missing or malformed header answers 401 before the body is read, a wrong signature 401, no secret 500. It does not use what the body says: it purges the one tag, `sanity`, through `purgeCache()` of `@visio/router` (`invalidateByTag` on Vercel, `ctx.cache.purge()` in the Worker). So a publish purges every cached page and read that ran a Sanity read, and each renders again on its next request. A purge that Cloudflare refuses answers a 500. A purged 404 at a slug renders again too, so a document published at a new slug shows at once. Cached pages also render again on their own after an hour, for anything a purge missed. A build on Vercel or Workers Builds with the Studio on warns `REVALIDATE_SECRET_UNSET` without the secret: the first real site ran for days with no refresh, and nothing said so. Until 2026-10-15 a Sanity Function (`studio/functions/revalidate`, declared in `studio/sanity.blueprint.ts`) posted the sync tags of each change, and the route purged only the pages and reads that showed it. The first real site never got it to deploy: it needed a Blueprint, a Stack and a role that may deploy Blueprints, and stopped at "Missing Stack" and "You do not have read access to project". A webhook needs no deploy on Sanity's side, and it is how our Next.js sites refresh. It cannot carry sync tags, so the purge is the whole site. On the sites visio builds now (about 50 pages) that costs a few renders and Sanity queries per publish, and an edit to what the root layout reads (settings, the navigation) already purged every page. Purging by sync tags is rejected for now, not for ever: a site with thousands of pages, slow renders or a tight Sanity quota would want it, and the way back is that Function, with each read tagged by its sync tags again (`filterResponse: false`).
- `stegaClean(value)` strips the marks from a string used as anything but text: an href, an id, a class, a comparison.
- **Exit.** The Studio is on the site's own origin, so the draft cookies that the enable route sets inside the Presentation iframe are the site's cookies. An editor who opens the site in the same browser sees it in draft mode. That is a feature: the editor sees the whole site with drafts, not only the iframe. Only Presentation called the disable route, so the session had no end but the cookie's. `<VisualEditing exit={(end) => ...} overlay={(shown, toggle) => ...} />` takes two controls from the site, in the site's own style: the way out, and a switch for the overlay. Both props are required, so a site without them fails the typecheck. It renders them only in the browser, after the page settles, in a draft session outside Presentation. It renders neither in Presentation: in the iframe and in the preview window the Studio opens (`window.opener`, the test Sanity's own code uses), Presentation has its own controls, and the overlay is always on. After a deploy the bypass token is new, so an old perspective cookie can show the controls on published content until it expires; a click on the exit clears it. Outside, the overlay starts off, so the editor sees the site as a visitor will; turned on, a click on an element opens it in the Studio. The switch does not outlive a reload. On the server and for a visitor it renders nothing, so it never touches hydration. `end()` goes to the disable route with the current path as `?redirect=`, from code. The site gets no URL, so the exit is never a link: a browser prefetches a link, and a prefetch of the disable route would end draft mode as soon as the site showed it (the route also turns a `Sec-Purpose: prefetch` away). An exit that ended the session on its own when the page was outside Presentation was rejected: it would take away the full-site view.
- **The stega check.** Nothing in the types tells a marked string from a clean one, so a missed `stegaClean` shows only in the preview, as a broken link. In dev, the Studio plugin keeps each page it renders for a draft session (the bypass cookie is set) as it streams out and, once it ends, looks for marks in any attribute but the text ones (`alt`, `title`, `placeholder`, `content`, `aria-label` and kin). It warns in the dev terminal with the page, the element and attribute, the value without the marks, and the document and field the marks point to. Script and style bodies are skipped: the hydration data carries the marks on purpose. It runs on the server's render because that is where the agent's terminal is; a check in `<VisualEditing />` would see pages reached by client navigation too, but it reaches the terminal only through Vite's browser console forwarding. A failed check logs and never breaks the page.

## Languages

This is the Sanity side of `@visio/i18n`, designed and built on 2026-10-15. The first site in two languages built all of it by hand, and the design comes from that site. Typegen types `field[$lang]` (Typegen, above).

### Words

- **Original:** the document in the default language.
- **Translation:** a document in another language that refers to its original.
- **Group:** an original and all its translations. The id of the group is the id of the original.

### The two models

A site has two kinds of translated content. Each kind has one model.

- **A field per language.** One document holds every language. Each of its words is a locale field: an object with one field per language, `{ de, it }` (`localeString`, `localeText`, or a locale type of the site's own, such as `localeRichText`). Its images, numbers and references are there once. The page exists in every language, and an empty field shows the default language's text (Fields in the query, below).
- **A document per language.** A document whose languages are separate texts, not translations of one text, has one document in each language: a legal page, whose Italian version names other registers than the German one. Each document has a `language` field. A translation has a `translationOf` reference to its original. An original has no `translationOf`. A page in a language exists only when its document does.

A field per language is the first choice. A second site (2026-10-27) started with a document per language for its pages and projects, and moved: those pages are mostly images with short words. An editor changed a photo in German, and the Italian page kept the old one; every page was listed twice; and an image's alt text was the only part of it that needed a translation. A document per language copies everything that is not words, and an editor keeps the copies the same by hand.

Both models are plain schema types in `schemaTypes`, so typegen reads them like any other type. No Sanity plugin is used. `sanity-plugin-internationalized-array` and `@sanity/document-internationalization` add their types at runtime, through `sanity.config.ts`. Typegen loads only `schemaTypes` (Typegen, step 1), so a query over those types gets no type. Typegen could load the whole Studio to see them. But that takes about seven seconds in a mocked browser, and the package removed that step. The two models above are the models of those two plugins, as types that typegen can read.

The field names and the document ids are the ones the first site uses (`language`, `translationOf`, `homePage-it`, `localeString`). So its content moves to the package with no migration.

### The languages, once in the Studio

```ts
// studio/schemaTypes/languages.ts
import { defineStudioLanguages } from "@visio/sanity/studio/schema";

export const languages = defineStudioLanguages({
  titles: { de: "Deutsch", it: "Italiano" },
  default: "de",
  fieldTitles: { language: "Sprache", translationOf: "Original" },
});
```

- **`titles`:** each key is a language tag of `defineLanguages()` in `site/src/routes.ts`. Each value is the name that an editor sees.
- **`default`:** the language of the originals.
- **`fieldTitles`:** optional. These are the titles of the two fields that `translated()` adds, in the editors' language. The default is "Language" and "Original". Sanity's locale plugins do not translate field titles, so the site sets them here.
- **`messages`:** optional. These are the two messages of the `translationOf` check, in the editors' language: `originalMissing(title)` and `translationTaken(title)`, each with a language's title. The default is English. visio holds no other language: a site in another language writes its own words here, and the Studio's locale does not choose them.

The list is in `schemaTypes`, not in `sanity.config.ts`. The schema types need the list, and typegen loads them without the config. The Studio cannot import `defineLanguages()` from the site, because that file loads Solid and the router. So the site writes the tags two times, and the build compares them:

- The Studio plugin reads `defineStudioLanguages()` from `studio/schemaTypes/languages.ts` with `oxc-parser`, as it reads `sanity.config.ts` today. The options must be literal objects. Anything else stops the build with `STUDIO_LANGUAGES_NOT_STATIC`.
- The site's languages come from `i18n()` itself, through a seam of `visio()`: a `VisioExtension` may give `languages(root)`, the tags and the default. `i18n()` gives it, from `readLanguages()` on `src/routes.ts`, the parser of its own checks. `visio()` passes it to `connect` of every extension, and `sanity()` hands it to the Studio plugin. So `@visio/sanity` and `@visio/i18n` do not depend on each other, and no plugin is found by its name: the site's `extensions: [i18n()]` is the switch (`router/DESIGN.md`, Extensions). A site table that the parser cannot read gets the router's own finding, and this check stays quiet.
- When the tags or the default are not the same, the build stops with `STUDIO_LANGUAGES_DIFFER`.
- A site with `i18n()` and a Studio, but with no `defineStudioLanguages()`, stops with `STUDIO_LANGUAGES_MISSING`. This applies also to a site that translates only interface words, so the Studio and the site cannot disagree.
- A `defineStudioLanguages()` with no `i18n()` in the site stops with `SITE_LANGUAGES_MISSING`.
- The checks run in the build, and in the dev terminal at start and on each change of `languages.ts` or `src/routes.ts` (`src/studio-languages.ts`).

`defineStudioLanguages()` returns `StudioLanguages`. It holds the tags and the helpers below, bound to the tags. So a schema file imports one value, and no helper takes the list again. A `default` that is not a key of `titles` is a type error, and throws `STUDIO_LANGUAGE_DEFAULT_UNKNOWN`.

### The schema helpers

```ts
// studio/schemaTypes/documents/project.ts
import { defineType } from "@sanity/types";

import { languages } from "../languages";

export const project = languages.translated(
  defineType({ name: "project", type: "document", fields: [/* ... */] })
);

// studio/schemaTypes/index.ts
export const schemaTypes = [...languages.types, project /* , ... */];
```

**`languages.translated(type)`** gives the document type back with two fields first:

- `language`: a radio list of `titles`, required, in the type's default group when it has groups. It is read-only when it has a value. A template sets the value (below). A change of language would break the group.
- `translationOf`: a reference to a document of the same type. The rules:
  - It is hidden on an original, and required on a translation.
  - Its filter shows only originals, and never the document itself.
  - It has `disableNew: true`, so an editor cannot make a new original from it.
  - A template writes it as a weak reference with `_strengthenOnPublish`, as Sanity's own reference input does. So a translation can start before its original is published. The Content Lake rejects a strong reference to a document that does not exist. The translation cannot be published until its original is published, and Sanity's publish button shows this.
  - A validation stops a second document in one language in one group. Two Italian translations of one original would give two hreflang links for one language. A duplicate keeps `language` and `translationOf`, so this case is easy to make.

The type keeps the literal `name` of `defineType`, so `singletons` still type-checks. `translated()` also brands the type (a phantom type and a runtime mark). So `defineStudio()` and its types know which types are translated, without a second list.

**`languages.types`** is `localeString` and `localeText`. Each is an object with one field (`string` or `text`) for each language, in the order of `titles`.

**`languages.locale({ name, of, title })`** makes a locale type of any field type: `languages.locale({ name: "localeRichText", of: "richText" })` for the site's Portable Text. The site adds it to `schemaTypes` next to `languages.types`. Every locale type puts its languages one under the other, because a column cuts off a heading. The name is `locale` and a capital, or it throws `LOCALE_NAME_INVALID`: `localize()` finds the values by that name (below). A field that is a list of short words is a list of `localeString`, not a locale list: each item then has its own translation, and a list cannot get out of step between the languages.

**The checks.** Every locale type warns when the default language has text and another language has none: "No text in Italiano yet: the site shows the Deutsch text." It is a warning and not an error, because the page still works: it shows the default language's text. So an editor can publish a German change at once and translate it later, and still sees what is missing. A field that needs text sets `validation: languages.required`, an error when the default language is empty. Text is empty when it is missing, blank, or an empty list. `messages.defaultEmpty(title)` and `messages.untranslated(titles, fallback)` give the two messages in the editors' language.

**`languages.isUniqueInLanguage`** is the `isUnique` option of a slug. A slug is unique among the documents of its type in its language. A translation can keep the slug of its original, or take its own. It reads the slug at the field's own path (`seo.handle`, not only `slug`), with the `raw` perspective, as Sanity's own unique check does. It and the check of one translation per language run with `groq-js` on a sample dataset in `languages.test.ts`.

**`languages.sameLanguage`** is the `filter` option of a reference. With it, an Italian page refers only to Italian packages and FAQs. It is for a reference to translated types only. On a reference to a type that is not translated, it would hide every document. So `defineStudio()` walks the reference fields, and throws `SAME_LANGUAGE_TARGET_UNTRANSLATED` when a target of `sameLanguage` is not translated.

These helpers go in `@visio/sanity/studio/schema`. That entry imports nothing from `sanity` (The entries, above), so typegen still loads the schema without the Studio.

### `defineStudio({ languages })`

```ts
export default defineStudio({
  title: "Example",
  types: schemaTypes,
  languages,
  singletons: { siteSettings: "Settings", homePage: "Home" },
});
```

With `languages`, `defineStudio()` does what the first site wrote by hand:

- **A singleton of a translated type is one singleton per language.**
  - The document id is the type in the default language (`homePage`, as before), and `<type>-<tag>` in the other languages (`homePage-it`). Its title is the singleton's title with the language: "Home (Italiano)".
  - Each one is in Sanity's `document.singletons`. So the actions that delete or unpublish a singleton are gone in each language.
  - Sanity 6.18 makes the template of a singleton itself, with the id of the singleton, and hides it from "new document". So `defineStudio()` makes no template for a singleton. It sets `language`, and on a translation `translationOf`, through the `initialValue` of each singleton definition.
  - The singletons of one page then form a group, as other documents do, and one query gives the translations of both kinds (below).
  - A singleton of a type that is not translated (`siteSettings`) is one document, as today.
- **A template for each language of each translated type that is not a singleton.** Its id is `<type>-<tag>`, its title the type's title with the language ("Project (Italiano)"), and it sets `language`. The type's own template is removed. So "new document" asks for the language, and no document starts without one.
- **No `schema.templates` option.** `defineStudio()` does not take it, for the same reason that it does not take the other `document` options (The Studio's config, above). A site that needs a template of its own adds it through a plugin, as today.
- **The default structure.** It lists, in this order:
  1. Each translated singleton, as one item with an entry for each language.
  2. The other singletons.
  3. A divider.
  4. Each translated type, as one item with a list for each language. Each list shows `language == $language` and uses the template of its language.
  5. The other types.
- **A custom structure** gets the same parts in `StructureArgs`:
  - `singleton(type)` gives one `ListItemBuilder`. For a translated singleton, its child is a list with an entry for each language.
  - `singleton(type, lang)` gives the entry of one language. It type-checks only for a translated singleton.
  - `languageList(type)` gives one `ListItemBuilder` whose child is a list for each language. It type-checks only for a translated type that is not a singleton.
  - Each of the three takes only names that `types` and `singletons` declare, as `singleton()` does today.
- **Errors.** `defineStudio()` throws `STUDIO_LANGUAGES_NOT_PASSED` when a type in `types` is translated and `languages` is absent. A type that `translated()` returned but that is not in `types` is not checked: it is only missing from the Studio, as any other type would be.

Presentation is not part of this. The first site writes `resolve` with a route for each language. The routes come from the site's paths, and the Studio does not have them. The Studio plugin could read the route table to write `resolve`. That is a later step, when a second site asks for it.

### Content that exists before languages

The build cannot see the dataset. On a site that turns on languages later, the existing documents have no `language`. The query `language == $lang` then finds none of them, and every page is a 404. So a site that turns on languages must set `language` on each existing document of a translated type, one time. The skill gives a script for `sanity exec` that sets each language on the documents the site lists for it. `language` is read-only once it has a value, so the script must not set the default language on a document that is a translation. The lists by language do not show a document without a language. Search still finds it, and it shows the `required` error of the field.

### The translations, in the query

A page takes its language from `props.lang`. Its preload passes the language to the query as `$lang`. A query reads the document in that language. It never reads the original as a fallback: a missing translation is a 404 (`i18n/DESIGN.md`, Where a page exists).

```ts
import { defineQuery, TRANSLATIONS } from "@visio/sanity";

export const PROJECT_QUERY =
  defineQuery(`*[_type == "project" && slug.current == $slug && language == $lang][0]{
  ...,
  ${TRANSLATIONS}
}`);
```

`TRANSLATIONS` is one GROQ projection field, exported from `@visio/sanity`:

```groq
"translations": *[_type == ^._type && defined(language) && (_id == coalesce(^.translationOf._ref, ^._id) || translationOf._ref == coalesce(^.translationOf._ref, ^._id))]{ language, "slug": slug.current }
```

- It lists the documents of the group: the original, and each document that refers to it. This also applies to a singleton, because a translated singleton refers to the singleton in the default language.
- The filter compares `_id` and `translationOf._ref` with one value. The Content Lake can use an index for that. A `coalesce()` on each document cannot use an index, and on each item of a list query it would read the whole type for each item.
- `slug` is null on a type with no slug.
- In draft mode, the perspective gives each document its published id, so the reference still matches.

Typegen follows `const` strings only by relative import (Typegen, step 2). So it learns this one constant by name: it accepts `TRANSLATIONS` only as an import from `@visio/sanity`, and reads the value from the package's own module, not from a second copy of the string. A site never writes the projection itself, so every page lists its translations in the same way. Its type is `Array<{ language: "de" | "it"; slug: string | null }>`, the tags from the `language` field's list. `translations.test.ts` runs the projection with `groq-js` on a sample dataset: a translated singleton, a translated project with its own slug, a project with no translation, and a document of another type that refers to an original.

The route's `translations` option takes the list through `translationParams()` from `@visio/sanity`:

```ts
export const route = defineRoute("/projects/:slug", {
  preload: ({ params, lang }) => getProject(params.slug, lang),
  translations: ({ data }) => translationParams(data?.translations),
  meta: ({ data }): Meta => ({ title: data?.headline ?? "" }),
});
```

- For a list with slugs, it gives `{ de: { slug: "a" }, it: { slug: "b" } }`.
- For a list with no slugs (a singleton), it gives `{ de: {}, it: {} }`.
- It drops an item that has no slug when other items have one. A translation with an empty slug has no path, so it gets no hreflang link and no switcher link.
- For an undefined list, it gives undefined, which is a 404 in every language.
- With `{ params: false }`, it gives `{}` in each language of the list, with or without a slug. This is for a route with no param whose query finds a translation through its original's slug (`coalesce(translationOf->slug.current, slug.current) == $slug`): one route per legal page, `/impressum` and `/it/note-legali`. A translation there needs no slug of its own, but without the option it is dropped, and its page answers 404. When the query finds each document by its own slug, leave the option out: a translation with no slug has no page.
- Otherwise the param is always `slug`. A route with a different param maps the list itself.

`@visio/i18n` stays without a Sanity dependency. The helper gives a plain object, and `translations` takes it as it takes any other object.

### Fields in the query: `localize()`

A query reads the whole locale object (`title`, not `title[$lang]`), and the data layer passes the result through `localize()` from `@visio/sanity`:

```ts
import { localize } from "@visio/sanity";

export const getHome = query(async (lang: Lang) => {
  "use server";
  return localize(await fetchQuery(HOME_QUERY), lang, "de");
}, "home");
```

- It walks the result once. Each object whose `_type` is `locale` and a capital becomes its value in `lang`, else the value in the fallback language, else null. Every other value is kept.
- Its type, `Localized<T>`, does the same to the query's type: each locale object becomes its value's type or null. Typegen writes a locale field as an object with its literal `_type`, so `Localized` finds it.
- A projection that renames or picks the fields of a locale object (`title{de}`) drops its `_type`, and `localize()` then keeps the object as it is. Project the whole field.
- The query fetches every language. A page's words are small next to its images, so this costs little. A sort or a filter by a word still needs GROQ: `order(name[$lang])`.
- In draft mode, each string carries its stega mark from the field it came from. A click on a word that came from the fallback opens the default language's field, where the text is.

A page of a document with locale fields exists in every language with the same params, so its route's `translations` names every language when there is data:

```ts
export const route = defineRoute("/projects/:slug", {
  preload: ({ params, lang }) => getProject(params.slug, lang),
  translations: ({ data, params }) => data && { de: params, it: params },
  meta: ({ data }): Meta => ({ title: data?.headline ?? "" }),
});
```

The slug of such a document is one slug for all languages: the page's address differs by language through the route's paths (`/projekte/:slug`, `/it/progetti/:slug`). A slug per language would need a locale slug, which is not built (Not built yet).

### Decisions

- **The languages are in `schemaTypes`, not only in `defineStudio()`.** With `defineStudio({ languages })` alone, the schema fields could not get the list.
- **One parser for `defineLanguages()`, through a seam.** `i18n()` reads the call with the parser of its own checks and gives the result as `languages` of its extension. A second parser in `@visio/sanity` could read the call in a different way. An internal entry of `@visio/i18n` that `@visio/sanity` imported, and the `visio:i18n` plugin found by its name, were rejected: both made one package know the other, and the second found a package by detection.
- **The name `localeString` stays.** In `@visio/i18n`, a locale is the `og:locale` value (`de_DE`), and a language is the tag (`de`). So `languageString` would follow that rule better. But the first site has content under `localeString`, and a rename would make a migration.
- **An original is always in the default language.** A page that exists only in a second language (an Italian project with no German one) cannot be made: each document in another language needs `translationOf`. The first site has its originals in the default language, so this keeps one rule for the group and the hreflang links.
- **An empty field falls back; a missing document is a 404.** `i18n/DESIGN.md` makes a missing translation a 404, because a German document under `/it/...` is duplicate content. A document with locale fields is one page in every language, and an empty field is a gap in it, not a missing page. Its warning in the Studio keeps the gap visible, so the fallback does not hide it.
- **The fallback is in code, not in GROQ.** `coalesce(title[$lang], title.de)` on each field would make one page's query a list of every word on it, nested fields included, and a field without it shows nothing in one language. `localize()` is one rule in one place, and a new field gets it with no change. Its cost is the other languages' words in each response.
- **The languages are one under the other, never side by side.** Most locale fields are headings, subtitles and SEO texts. In half the width, the Studio cuts them off (a home H1 shows only its first words), so `string` and `text` are stacked like any other type.
- **A locale type is found by its name.** `localize()` cannot read the schema at runtime. A `_type` prefix is the one mark that each value carries, in published data and in drafts, so the name is checked where the type is made (`LOCALE_NAME_INVALID`).
- **`defineStudioLanguages()` is required on a site with languages and a Studio,** also when only interface words are translated. Then the Studio and the site cannot disagree.

## Not built yet

**A locale slug.** A document with locale fields has one slug for every language. A slug per language would need a locale slug type, its unique check, a query that finds the document by the slug of `$lang`, and `translations` from the slugs. Built when a site asks for it.

**Presentation in more than one language.** `resolve` with a route for each language is the site's own (Languages, above).

**Live updates for visitors.** Published changes reach visitors on their next load or navigation, once the purge is through. Pushing them into open pages would take `client.live.events()` in the browser; left out until a site needs it.

**Checked against a real project and deployment.** Everything above is tested against fakes and a local run of the Vercel function. Still to confirm on Vercel: that `addCacheTag` tags an ISR response, that a `prerendered()` read is cached at its `/_server/data/` address, that a function's `Cache-Control: no-store` would have kept it out (the function drops it for cached reads), and that a publish through the webhook purges every page and read tagged `sanity`, a cached 404 at a slug included. The Cloudflare Worker is tested against fakes and in `wrangler dev`, which has no Workers Cache: still to confirm on Cloudflare that `Render` caches with the tags and that a publish purges it.
