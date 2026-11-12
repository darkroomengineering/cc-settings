import { indexable } from "prerender-crawler";
import type {
  PrerenderIntegration,
  RenderedPage,
} from "prerender-crawler/vite";

import { ANNOUNCED_HEADER } from "./crawl.ts";
import type { AnnouncedFacts, AnnouncedList } from "./crawl.ts";
import { alternatesOf, headOf, unescapeHtml } from "./page-head.ts";

/** What the crawl's request for `/` got from the routes' `announce`, or none. */
export function announcedList(
  pages: readonly RenderedPage[]
): AnnouncedList | undefined {
  const value = pages
    .find((page) => page.path === "/")
    ?.response.headers.get(ANNOUNCED_HEADER);

  // SAFETY: the router's crawl middleware writes this header (crawl.ts).
  return value
    ? (JSON.parse(decodeURIComponent(value)) as AnnouncedList)
    : undefined;
}

const TITLE = /<title\b[^>]*>(?<title>[^<]*)<\/title>/v;

const DESCRIPTION =
  /<meta\s[^>]*name="description"[^>]*\scontent="(?<content>[^"]*)"/v;

const MODIFIED =
  /<meta\s[^>]*property="article:modified_time"[^>]*\scontent="(?<content>[^"]*)"/v;

/** The facts of a rendered page's head, in the shape `announce` gives them. */
function pageFacts(page: RenderedPage) {
  const head = headOf(page);
  const title = TITLE.exec(head)?.groups?.title;
  const description = DESCRIPTION.exec(head)?.groups?.content;
  const modified = MODIFIED.exec(head)?.groups?.content;

  return {
    title: title === undefined ? undefined : unescapeHtml(title),
    description:
      description === undefined ? undefined : unescapeHtml(description),
    modified: modified === undefined ? undefined : unescapeHtml(modified),
    noindex: !indexable(page),
    alternates: alternatesOf(page)
      // Any origin will do: only the path is compared.
      .map(
        ({ hreflang, href }) =>
          `${hreflang} ${new URL(href, new URL(page.path, "http://x.invalid")).pathname}`
      )
      .toSorted(),
  };
}

/** Each fact the entry gives that its page's head does not have, as a line. */
function differences(facts: AnnouncedFacts, page: RenderedPage): string[] {
  const head = pageFacts(page);
  const lines: string[] = [];

  for (const key of ["title", "description", "modified", "noindex"] as const) {
    if (facts[key] !== undefined && facts[key] !== head[key]) {
      lines.push(
        `${key} ${JSON.stringify(facts[key])}, but the page has ${head[key] === undefined ? "none" : JSON.stringify(head[key])}`
      );
    }
  }

  if (facts.alternates !== undefined) {
    const given = facts.alternates
      .map(({ hreflang, path }) => `${hreflang} ${path}`)
      .toSorted();

    if (given.join(",") !== head.alternates.join(",")) {
      lines.push(
        `language versions ${JSON.stringify(given)}, but the page has ${JSON.stringify(head.alternates)}`
      );
    }
  }

  return lines;
}

/**
 * The crawl renders every announced page. Its head is what `meta()` makes,
 * so an entry of `announce` that says otherwise would put wrong facts in
 * the live sitemap and `llms.txt`: the build stops on it.
 */
export function announceCheck(): PrerenderIntegration {
  return {
    name: "visio:announce-check",
    teardown(context) {
      const list = announcedList(context.pages);
      const byPath = new Map(context.pages.map((page) => [page.path, page]));

      const found = (list?.pages ?? []).flatMap((facts) => {
        const page = byPath.get(facts.path);

        return page
          ? differences(facts, page).map(
              (line) =>
                `  ${facts.path} (announce() of ${facts.pattern}): ${line}`
            )
          : [];
      });

      if (found.length === 0) {
        return;
      }

      throw new Error(
        `[@visio/router] [ANNOUNCE_HEAD_DIFFERS] ${found.length} fact(s) of announce() differ from the page's head, which meta() makes:\n${found.join("\n")}\n` +
          "Project in the announce() query the same fields meta() reads, or leave the fact out (the router skill, .claude/skills/router/SKILL.md)."
      );
    },
  };
}
