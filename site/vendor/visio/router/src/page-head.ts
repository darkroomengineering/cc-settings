import type { RenderedPage, SitemapEntry } from "prerender-crawler/vite";

import type { SitemapAlternate } from "./sitemap.ts";

/** The page's HTML up to `</head>`. */
export function headOf(page: RenderedPage): string {
  const end = page.html.indexOf("</head>");

  return end === -1 ? page.html : page.html.slice(0, end);
}

const MODIFIED =
  /<meta\s[^>]*property="article:modified_time"[^>]*\scontent="(?<modified>[^"]+)"/v;

export function modifiedEntry(
  page: RenderedPage
): Partial<SitemapEntry> | undefined {
  const modified = MODIFIED.exec(headOf(page))?.groups?.modified;

  return modified ? { lastmod: modified } : undefined;
}

const LINK = /<link\s[^>]*>/giv;

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="(?<value>[^"]*)"`, "iv").exec(tag)?.groups
    ?.value;
}

/** A page's language versions, from the `hreflang` links of its head, itself and `x-default` included. An `href` is relative without `PUBLIC_SITE_URL`. */
export function alternatesOf(page: RenderedPage): SitemapAlternate[] {
  const out: SitemapAlternate[] = [];

  for (const [tag] of headOf(page).matchAll(LINK)) {
    const hreflang = attribute(tag, "hreflang");
    const href = attribute(tag, "href");

    if (attribute(tag, "rel") === "alternate" && hreflang && href) {
      out.push({ hreflang, href: unescapeHtml(href) });
    }
  }

  return out;
}

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
} as const satisfies Record<string, string>;

/** Text or an attribute value as the server's HTML escapes it, read back. */
export function unescapeHtml(value: string): string {
  return value.replaceAll(
    /&(?:amp|lt|gt|quot|#39|#x27);/gv,
    // SAFETY: the pattern matches only the keys of ENTITIES.
    (e) => ENTITIES[e as keyof typeof ENTITIES]
  );
}
