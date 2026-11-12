import { llmsPages } from "@visio/aeo/internal/vite";
import {
  announcedList,
  matchPath,
  sitemapEntries,
} from "@visio/router/internal/vite";
import type { PrerenderIntegration } from "prerender-crawler";

import type { BuildLists } from "./lists-facts.ts";

/** What the crawl gives the deploy output: the build's lists, or none to serve them as files. */
export interface ListsHolder {
  lists?: BuildLists | undefined;
}

/** The build's part of the live lists (DESIGN.md, Live lists). */
export function listsIntegration(
  site: {
    url?: string | undefined;
    name?: string | undefined;
    indexable: boolean;
  },
  holder: ListsHolder
): PrerenderIntegration {
  return {
    name: "visio:lists",
    teardown(context) {
      holder.lists = undefined;
      const origin = site.url;

      if (!site.indexable || !origin) {
        return;
      }

      const patterns = announcedList(context.pages)?.patterns ?? [];

      if (patterns.length === 0) {
        return;
      }

      function announced(path: string) {
        return patterns.some((p) => matchPath(p, path) !== null);
      }

      function wrote(name: string) {
        return context.files.some((file) => file.filename === name);
      }

      holder.lists = {
        origin,
        name: site.name,
        sitemap: wrote("sitemap.xml")
          ? sitemapEntries(context.pages, origin).filter(
              (entry) => !announced(new URL(entry.loc).pathname)
            )
          : undefined,
        llms: wrote("llms.txt")
          ? llmsPages(context.pages).filter((page) => !announced(page.path))
          : undefined,
      };
    },
  };
}
