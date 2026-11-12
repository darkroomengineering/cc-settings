# Setup, once per project

```ts
// vite.config.ts
import { sanity } from "@visio/sanity/vite";

visio({ deploy: vercel(), extensions: [sanity()] });
```

`sanity()` serves the Studio of `../studio` at `/studio` and the draft mode and publish routes under `/api/sanity`, and keeps `sanity.types.d.ts` current in dev and in the build. A site that reads a dataset whose Studio another project owns gives `sanity({ studio: false })`: only the types, from the schema in `studio/schemaTypes/`, and no Studio, so its schema is never registered on that dataset.

```sh
# site/.env, and the host's environment (Vercel: Settings, Environment Variables)
SANITY_PROJECT_ID=abc123
SANITY_DATASET=production
```

One pair for the site and the Studio. `sanity()` passes it to `sanity dev` and `sanity build` as `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`, and `sanity` run on its own in `studio/` reads the site's `.env`. Never write a `studio/.env`. A build on Vercel or Workers Builds with the Studio on stops with `PROJECT_ID_UNSET` when `SANITY_PROJECT_ID` is not set.

In the project's settings on sanity.io, add the production origin, `http://localhost:3000` (dev) and `http://localhost:4173` (`vite preview`) to the CORS origins, with credentials, or the Studio at `/studio` cannot log in. When port 3000 is busy, the dev server takes the next free port, and the Studio there stops at "connect this Studio": stop the other server, do not add the port. To check a schema change without the browser, run `bun run schema` (`sanity schema validate` in `studio/`) and then `bun run typegen`.

Everything Sanity in the site comes from `@visio/sanity`, `defineQuery` included; the site never imports `groq` or `@sanity/client`.

Every schema type is defined in `studio/schemaTypes/`. Types read from there, not from `sanity.config.ts`, so a Studio plugin that adds schema types of its own (internationalization, code input) is not seen: define the type in `schemaTypes/` instead, which also makes it visible to anyone reading the schema.

```ts
// src/env.ts, server block
SANITY_PROJECT_ID: v.optional(v.string()),
SANITY_DATASET: v.optional(v.string()),
SANITY_READ_TOKEN: v.optional(v.string()), // a private dataset, and draft mode
SANITY_REVALIDATE_SECRET: v.optional(v.pipe(v.string(), v.minLength(32))), // the publish hook
```

The package reads these four itself; `src/env.ts` declares them so `@visio/env` validates them. There is no client file to write.

```ts
// src/lib/queries.ts
import { defineQuery } from "@visio/sanity";

export const IMAGE = `{ ..., asset->{ url, metadata { lqip } } }`;
```

The client behind `fetchQuery` has fixed defaults (published content, no API CDN, 20 s timeout); each one fixed a bug on a client site.

`bun run dev` starts the site and the Studio together; the Studio is at `localhost:3000/studio`. `sanity({ studio: { path: '/cms', api: '/api/cms' } })` moves the Studio and the routes; the call passes the paths to the Studio app, the gate, the crawl and the smoke run. A route of the site's own under either path stops the build (`ROUTE_RESERVED`).

A build runs `sanity build` only when a file in `studio/`, `bun.lock`, a `SANITY_STUDIO_` variable or a visio release changed; otherwise it copies the last one (`Studio unchanged` in the log). Keep every Studio file inside `studio/`: a change to a file it imports from elsewhere does not rebuild it.
