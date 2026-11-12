import { serverFunctions } from "@solidjs/prerender/integration";
import { indexable } from "prerender-crawler";
import { prerender as crawl } from "prerender-crawler/vite";
import type {
  PrerenderIntegration,
  RenderedPage,
} from "prerender-crawler/vite";
import type { Plugin } from "vite";

import { announceCheck } from "./announce-check.ts";
import { boundaryGuard } from "./boundaries.ts";
import type { RouteFacts } from "./compiler/routes.ts";
import { headGuard } from "./heads.ts";
import { alternatesOf, modifiedEntry } from "./page-head.ts";
import { isPending } from "./pattern.ts";
import { robots } from "./robots.ts";
import type { RobotsRules } from "./robots.ts";
import { byLoc, formatSitemap } from "./sitemap.ts";
import type { SitemapPage } from "./sitemap.ts";

/** What `visio()` adds to the crawl from the facts it holds; a site never sets these. */
export interface CrawlWiring {
  /**
   * The origin for the sitemap, or undefined for none. Read when the crawl
   * ends: `visio()` learns it from the env once Vite knows the mode.
   */
  hostname?: (() => string | undefined) | undefined;
  /** The deploy output. */
  integrations?: readonly PrerenderIntegration[] | undefined;
  /** `false` for a path the crawl must not render, besides the pending ones: the Studio's. */
  filter?: ((path: string) => boolean) | undefined;
  /** More `robots.txt` rules, or none. Read when the crawl ends, like `hostname`. */
  robots?: (() => RobotsRules | undefined) | undefined;
}

/** The sitemap's entries of the crawled pages a search engine may index. */
export function sitemapEntries(
  pages: readonly RenderedPage[],
  origin: string
): SitemapPage[] {
  return pages
    .values()
    .filter((page) => indexable(page))
    .map((page) => {
      const loc = new URL(page.path, origin).href;

      return {
        loc,
        ...modifiedEntry(page),
        alternates: alternatesOf(page).map(({ hreflang, href }) => ({
          hreflang,
          href: new URL(href, loc).href,
        })),
      };
    })
    .toArray()
    .toSorted(byLoc);
}

/**
 * The sitemap, written when the origin is known by the end of the crawl.
 * prerender-crawler's has no language versions, so the router writes its own
 * from the same pages, as `sitemap()` there picks them.
 */
function lateSitemap(hostname: () => string | undefined): PrerenderIntegration {
  return {
    name: "sitemap",
    teardown(context) {
      const origin = hostname();

      if (!origin) {
        return;
      }

      context.emitFile({
        filename: "sitemap.xml",
        contents: formatSitemap(sitemapEntries(context.pages, origin)),
      });
    },
  };
}

/**
 * The crawl from `/`: the router announces every route nothing links to,
 * and links lead to the rest. It skips the pending paths, which the table
 * gives once it is read.
 */
export function prerenderPlugin(
  facts: RouteFacts,
  wiring: CrawlWiring = {}
): Plugin {
  function hostname(): string | undefined {
    return wiring.hostname?.();
  }

  return crawl({
    mode: "hybrid",
    pages: ["/"],
    filter: (path) =>
      !isPending(path, facts.pending) && (wiring.filter?.(path) ?? true),
    integrations: [
      serverFunctions(),
      boundaryGuard(),
      headGuard(),
      announceCheck(),
      lateSitemap(hostname),
      // After the sitemap, so it can name the file.
      robots({
        get hostname() {
          return hostname();
        },
        get rules() {
          return wiring.robots?.();
        },
      }),
      ...(wiring.integrations ?? []),
    ],
  });
}
