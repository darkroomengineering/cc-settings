import type { RequestEvent } from "@solidjs/web";
import { llmsText } from "@visio/aeo/internal/llms";
import { announcedPages, announcersOf } from "@visio/router/internal/crawl";
import type {
  AnnouncedFacts,
  CrawledRoutes,
} from "@visio/router/internal/crawl";
import { byLoc, formatSitemap } from "@visio/router/internal/sitemap";
import type { SitemapPage } from "@visio/router/internal/sitemap";

import { listPaths, LISTS } from "./lists-facts.ts";
import type { BuildLists } from "./lists-facts.ts";

function buildLists(): BuildLists | undefined {
  // SAFETY: the deployment's entry sets this global to the build's lists (lists in deploy.ts).
  return (globalThis as { [LISTS]?: BuildLists })[LISTS];
}

function sitemapPage(origin: string, page: AnnouncedFacts): SitemapPage {
  return {
    loc: new URL(page.path, origin).href,
    lastmod: page.modified,
    alternates: (page.alternates ?? []).map(({ hreflang, path }) => ({
      hreflang,
      href: new URL(path, origin).href,
    })),
  };
}

/** The live sitemap and `llms.txt` (DESIGN.md, Live lists). */
export function listsMiddleware(routes: CrawledRoutes) {
  return async (
    event: RequestEvent,
    next: () => Promise<Response>
  ): Promise<Response> => {
    const { pathname } = new URL(event.request.url);
    const lists = buildLists();
    const { method } = event.request;

    if (
      !lists ||
      (method !== "GET" && method !== "HEAD") ||
      !listPaths(lists).some((p) => p === pathname)
    ) {
      return next();
    }

    const all = await announcedPages(announcersOf(routes));
    const announced = all.filter((page) => page.noindex !== true);

    if (pathname === "/sitemap.xml") {
      const pages = [
        ...(lists.sitemap ?? []),
        ...announced.map((page) => sitemapPage(lists.origin, page)),
      ].toSorted(byLoc);

      return new Response(formatSitemap(pages), {
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    }

    const pages = [
      ...(lists.llms ?? []),
      ...announced.map(({ path, title, description }) => ({
        path,
        title,
        description,
      })),
    ];

    return new Response(
      llmsText(pages, { hostname: lists.origin, name: lists.name }),
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  };
}
