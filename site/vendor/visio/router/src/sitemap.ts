// Imports nothing: the server bundle takes it for the live sitemap.

/** A page's version in one language, as the sitemap names it. */
export interface SitemapAlternate {
  hreflang: string;
  href: string;
}

/** One `<url>` of the sitemap. */
export interface SitemapPage {
  loc: string;
  lastmod?: string | Date | undefined;
  alternates: SitemapAlternate[];
}

export function byLoc(a: SitemapPage, b: SitemapPage): number {
  return a.loc < b.loc ? -1 : Number(a.loc > b.loc);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** The crawler's sitemap format, with an `xhtml:link` for each language version. */
export function formatSitemap(entries: readonly SitemapPage[]): string {
  const xhtml = entries.some((e) => e.alternates.length > 0)
    ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : "";

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtml}>`,
  ];

  for (const entry of entries) {
    lines.push("  <url>", `    <loc>${escapeXml(entry.loc)}</loc>`);

    if (entry.lastmod !== undefined) {
      const lastmod =
        entry.lastmod instanceof Date
          ? entry.lastmod.toISOString()
          : entry.lastmod;

      lines.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
    }

    for (const { hreflang, href } of entry.alternates) {
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}"/>`
      );
    }

    lines.push("  </url>");
  }

  lines.push("</urlset>");

  return `${lines.join("\n")}\n`;
}
