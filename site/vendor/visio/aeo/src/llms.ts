import { existsSync } from "node:fs";
import path from "node:path";

import { indexable } from "prerender-crawler";
import type { PrerenderIntegration, RenderedPage } from "prerender-crawler";

import { parse } from "./html.ts";
import { llmsText } from "./llms-text.ts";
import type { LlmsOptions, LlmsPage } from "./llms-text.ts";
import { readHead } from "./markdown.ts";

/** The pages of `llms.txt`: each crawled page that answers 200 and may be indexed. */
export function llmsPages(pages: readonly RenderedPage[]): LlmsPage[] {
  return pages
    .values()
    .filter((p) => p.response.status === 200 && indexable(p))
    .map((p) => {
      const head = readHead(parse(p.html));

      return { path: p.path, title: head.title, description: head.description };
    })
    .toArray();
}

export function llmsTxt(
  pages: readonly RenderedPage[],
  options: LlmsOptions
): string {
  return llmsText(llmsPages(pages), options);
}

/**
 * `llms.txt` from the crawled pages. `options` is read when the crawl ends,
 * once the env is known; it gives none for a build that is not indexable.
 */
export function llms(
  options: () => LlmsOptions | undefined
): PrerenderIntegration {
  return {
    name: "visio:llms",
    teardown(context) {
      const facts = options();

      if (!facts) {
        return;
      }

      if (existsSync(path.join(context.outDir, "llms.txt"))) {
        return;
      }

      if (
        !context.pages.some((p) => p.response.status === 200 && indexable(p))
      ) {
        return;
      }

      context.emitFile({
        filename: "llms.txt",
        contents: llmsTxt(context.pages, facts),
      });
    },
  };
}
