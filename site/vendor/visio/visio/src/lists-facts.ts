import type { LlmsPage } from "@visio/aeo/internal/llms";
import type { SitemapPage } from "@visio/router/internal/sitemap";

/** A global: the server bundle is built before the crawl that makes the lists. */
export const LISTS = Symbol.for("visio.lists");

/** The entries of every page the routes' `announce` do not list, as the crawl saw them. */
export interface BuildLists {
  /** The public origin, for absolute URLs. */
  origin: string;
  /** The `# heading` of `llms.txt`, `site.name` of `visio()`. */
  name?: string | undefined;
  /** Each list the crawl wrote: a site's own `public/llms.txt` stays the file. */
  sitemap?: SitemapPage[] | undefined;
  llms?: LlmsPage[] | undefined;
}

/** Each list's path and its content type. */
export const LIST_TYPES = {
  "/sitemap.xml": "application/xml; charset=utf-8",
  "/llms.txt": "text/plain; charset=utf-8",
} as const;

export type ListPath = keyof typeof LIST_TYPES;

/** The lists the server answers. */
export function listPaths(lists: BuildLists): ListPath[] {
  return [
    ...(lists.sitemap ? (["/sitemap.xml"] as const) : []),
    ...(lists.llms ? (["/llms.txt"] as const) : []),
  ];
}
