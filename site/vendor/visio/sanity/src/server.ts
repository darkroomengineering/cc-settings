import type { QueryParams } from "@sanity/client";

import { siteReader } from "./reader.ts";

declare global {
  /**
   * Filled in by the site's `sanity.types.d.ts`. Global, so the site needs no
   * import of, and no resolution to, `@sanity/client`.
   */
  interface SanityQueries {}
}

/** The result of a query typegen has seen. */
type QueryResult<Q extends string> = Q extends keyof SanityQueries
  ? SanityQueries[Q]
  : unknown;

/** The type checker prints it as the parameter's type, so the error says the fix. */
type UnregisteredQuery =
  "[@visio/sanity] Not a registered query. Write it as `export const X = defineQuery(...)` in src/lib/queries.ts and keep `bun run dev` running (or run the build): typegen registers it in sanity.types.d.ts. Pass the values that change as params ($slug), and write another query shape as its own defineQuery.";

type RegisteredQuery<Q extends string> = Q extends keyof SanityQueries
  ? Q
  : UnregisteredQuery;

/**
 * A read of a query typegen has registered. In draft mode it reads the
 * perspective the Studio shows, with stega; otherwise what is published,
 * tagged so a publish purges the pages that showed it.
 */
export function fetchQuery<const Q extends string>(
  query: RegisteredQuery<Q>,
  params?: QueryParams
): Promise<QueryResult<Q>> {
  // SAFETY: typegen wrote QueryResult<Q> from this query and the schema.
  return siteReader().read(query, params) as Promise<QueryResult<Q>>;
}
