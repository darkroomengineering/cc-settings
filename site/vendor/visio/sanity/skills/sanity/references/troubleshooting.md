# When something is wrong

| Symptom | Cause |
| --- | --- |
| `sanityImage()` returns `null`, the image renders nothing | The projection is missing `asset->`, or the URL is not Sanity's CDN. Use `${IMAGE}`. |
| `[@visio/sanity] <PortableText> has no component for the type "x"` | The schema has a type `ui/rich-text` does not handle. Add it to `components.types`. |
| `[@visio/sanity] SANITY_PROJECT_ID and SANITY_DATASET are not set` | They are missing from `.env`. |
| `[@visio/sanity] SANITY_PROJECT_ID and SANITY_DATASET are not set, and the site has N queries` | The same, seen at dev start and in the build log, before a read fails. Set them in the site's `.env` and on the host. |
| A slug page is not in the build's cached pages | Nothing links to it. Link it or announce it. |
| `Argument of type ... is not assignable to parameter of type "[@visio/sanity] Not a registered query..."` | The query is inline, built at runtime, or not registered yet. Write it as `export const X = defineQuery(...)` in `src/lib/queries.ts` and keep `bun run dev` running. A typegen warning in the dev terminal says why a `defineQuery` was skipped: a GROQ syntax error, or a string built from something typegen does not follow (a `let`, a package import, a function call). |
| The Studio says "Project not found" or "Configuration must contain `projectId`" | `SANITY_PROJECT_ID` is not set where the build ran, or names another project. Set the pair in the site's `.env` and on the host, then build again: the Studio gets it at build time. |
| The Studio loads but cannot log in | The origin is not in the project's CORS origins. On the dev server, check that it runs on port 3000. |
| `/studio/...` is a 404 on the deployed site | The host has no fallback from `/studio/*` to `/studio/index.html`. |
| Published content is not on the site | The webhook is missing, points at an old host or domain, or its secret is not the site's `SANITY_REVALIDATE_SECRET`. The webhook's attempt log in the project's API settings shows the answer: 401 is a wrong secret, 500 an unset one or a purge the host refused (the function's or the Worker's log names why), 404 a wrong path. Pages still refresh within the hour. |
| The preview in Presentation shows published content | The enable route failed: the read token is missing (the route says so), or the Studio's secret expired (reopen Presentation). |
| A link or class breaks in the preview only | A stega-marked string used as an attribute. Wrap it in `stegaClean`. |
| `[@visio/sanity] stega marks in attributes of /path (draft mode)` | The dev server found marks in an href, id, class or other attribute of a draft page. Wrap the named field's value in `stegaClean` where it becomes the attribute. |
| Build hangs, then fails with a timeout | Sanity did not answer within 20 s. Check the network and the project id. |
