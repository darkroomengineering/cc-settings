# Page meta

visio has no page meta helper. The SEO fields, the image fallback order, the title rule and the place of the defaults are different on each site. Each site writes one function in `src/lib/seo.ts`. The function below is an example: copy it, then change it to the site's schema and rules.

```ts
// src/lib/seo.ts. An example to adapt, not an API.
import type { Meta } from "@visio/router";
import { shareImage, stegaClean, type SanityImageValue } from "@visio/sanity";

interface Seo {
  title?: string | null;
  description?: string | null;
  image?: SanityImageValue | null;
  noindex?: boolean | null;
}

// A shape, not a query's type: every page query with these fields fits.
interface Doc {
  title?: string | null;
  seo?: Seo | null;
  hero?: { image?: SanityImageValue | null } | null;
}

export function pageMeta(
  page: Doc | null | undefined,
  settings: { siteName?: string | null; seo?: Seo | null } | null | undefined
): Meta {
  const title = page?.seo?.title ?? page?.title;
  const description = page?.seo?.description ?? settings?.seo?.description;
  // In draft mode the strings carry stega marks; the head would keep them.
  return {
    title: stegaClean([title, settings?.siteName].filter(Boolean).join(" | ")),
    description: stegaClean(description) ?? undefined,
    image:
      shareImage(page?.seo?.image) ??
      shareImage(page?.hero?.image) ??
      shareImage(settings?.seo?.image),
    noindex: page?.seo?.noindex ?? !page,
  };
}
```

The page preload returns both reads, and `meta` gets both, awaited. When a read fails, `meta` gets no data, so read it with `?.`:

```ts
preload: ({ params }) => ({ page: getPage(params.slug), settings: getSettings() }),
meta: ({ data }) => pageMeta(data?.page, data?.settings),
```

- Project the SEO image with `${IMAGE}`, as any other image. Without `asset->`, `shareImage()` gives `undefined`.
- Without any image, the page gets `site.image` from `visio()`.
