import { getRequestEvent } from "@solidjs/web";

/** The cache a deploy output puts in front of the site, on the request event. */
export interface PlatformCache {
  tag: (tags: string[]) => void | Promise<void>;
  /** Rejects when the platform refused the purge. */
  purge: (tags: string[]) => Promise<void>;
}

export const CACHE_FIELD = "visioCache";

function current(): PlatformCache | undefined {
  // SAFETY: only a deploy output writes the field, and it writes a PlatformCache.
  return (getRequestEvent() as { [CACHE_FIELD]?: PlatformCache } | undefined)?.[
    CACHE_FIELD
  ];
}

/** Tags the response being rendered for `purgeCache()`. Without a cache (dev, the crawl) it does nothing. */
export async function tagCache(tags: string[]): Promise<void> {
  if (tags.length) {
    await current()?.tag(tags);
  }
}

/** Drops every cached response with one of the tags. Without a cache (dev) it does nothing. */
export async function purgeCache(tags: string[]): Promise<void> {
  if (tags.length) {
    await current()?.purge(tags);
  }
}
