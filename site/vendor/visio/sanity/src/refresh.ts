import { revalidate } from "@solidjs/router";

/** Refetches every query on the page: the reads go around the cache in draft mode. */
export function refresh() {
  return revalidate(undefined, true);
}
