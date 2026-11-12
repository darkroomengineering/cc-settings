import { addCacheTag, invalidateByTag } from "@vercel/functions";
import type { Middleware } from "@visio/router";
import { CACHE_FIELD } from "@visio/router/internal/cache";
import type { PlatformCache } from "@visio/router/internal/cache";

// Outside a Vercel function both resolve without doing anything: the dev server, the crawl.
const VERCEL: PlatformCache = { tag: addCacheTag, purge: invalidateByTag };

/** Vercel's cache on the request event, for `tagCache()` and `purgeCache()` of `@visio/router`. */
export default function vercelCache(
  ...[event, next]: Parameters<Middleware>
): ReturnType<Middleware> {
  // SAFETY: CACHE_FIELD is visio's own field, which RequestEvent does not declare.
  (event as { [CACHE_FIELD]?: PlatformCache })[CACHE_FIELD] ??= VERCEL;

  return next();
}
