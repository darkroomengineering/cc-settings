# SEO Reference

> Technical SEO patterns for Next.js + Shopify + Sanity projects.

---

## Meta Tags

### Required on Every Page
```tsx
// app/layout.tsx or page.tsx
export const metadata: Metadata = {
  title: 'Page Title — Brand', // 50-60 characters
  description: 'Concise page description.', // 150-160 characters
  openGraph: {
    title: 'Page Title',
    description: 'Description for social sharing.',
    images: [{ url: '/og-image.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
  },
  alternates: {
    canonical: 'https://your-site.example/page',
  },
}
```

### Dynamic Pages (Sanity/Shopify)
```tsx
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPage(params.slug)
  return {
    title: page.seo?.title || page.title,
    description: page.seo?.description || page.excerpt,
    openGraph: {
      images: page.seo?.image ? [urlFor(page.seo.image).width(1200).height(630).url()] : [],
    },
    alternates: {
      canonical: `https://your-site.example/${params.slug}`,
    },
  }
}
```

**Character Limits:**
| Tag | Limit |
|-----|-------|
| `<title>` | 50-60 characters |
| `meta description` | 150-160 characters |
| OG title | 60 characters |
| OG description | 200 characters |

---

## Structured Data (JSON-LD)

### Organization
```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Company Name',
  url: 'https://your-site.example',
  logo: 'https://your-site.example/logo.png',
  sameAs: [
    'https://twitter.com/company',
    'https://instagram.com/company',
  ],
}) }} />
```

### Product (Shopify)
```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: product.title,
  image: product.images.map(img => img.url),
  description: product.description,
  sku: product.variants[0]?.sku,
  brand: { '@type': 'Brand', name: product.vendor },
  offers: {
    '@type': 'AggregateOffer',
    lowPrice: product.priceRange.minVariantPrice.amount,
    highPrice: product.priceRange.maxVariantPrice.amount,
    priceCurrency: product.priceRange.minVariantPrice.currencyCode,
    availability: product.availableForSale
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
  },
}) }} />
```

### Article (Sanity Blog)
```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: article.title,
  image: urlFor(article.mainImage).width(1200).height(630).url(),
  datePublished: article.publishedAt,
  dateModified: article._updatedAt,
  author: { '@type': 'Person', name: article.author.name },
  publisher: {
    '@type': 'Organization',
    name: 'Company Name',
    logo: { '@type': 'ImageObject', url: 'https://your-site.example/logo.png' },
  },
}) }} />
```

### FAQ
```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(faq => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer },
  })),
}) }} />
```

### Breadcrumbs
```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: breadcrumbs.map((crumb, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: crumb.label,
    item: `https://your-site.example${crumb.href}`,
  })),
}) }} />
```

---

## Technical SEO

### Sitemap
```tsx
// app/sitemap.ts
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await getAllPages() // from Sanity
  const products = await getAllProducts() // from Shopify

  return [
    { url: 'https://your-site.example', lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    ...pages.map(page => ({
      url: `https://your-site.example/${page.slug}`,
      lastModified: new Date(page._updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    ...products.map(product => ({
      url: `https://your-site.example/products/${product.handle}`,
      lastModified: new Date(product.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })),
  ]
}
```

### Robots
```tsx
// app/robots.ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/studio/'] },
    sitemap: 'https://your-site.example/sitemap.xml',
  }
}
```

### Canonical URLs
- Every page must have a canonical URL
- Use `alternates.canonical` in metadata
- For paginated content: `?page=2` with self-referencing canonical
- For filtered Shopify collections: canonical to the unfiltered collection

### International (hreflang)
```tsx
export const metadata: Metadata = {
  alternates: {
    canonical: 'https://your-site.example/page',
    languages: {
      'en': 'https://your-site.example/page',
      'fr': 'https://fr.your-site.example/page',
      'de': 'https://de.your-site.example/page',
    },
  },
}
```

---

## SEO Checklist

### Every Page
- [ ] Unique `<title>` within character limit
- [ ] Unique `meta description` within character limit
- [ ] Canonical URL set
- [ ] OG image (1200x630)
- [ ] `lang` attribute on `<html>`
- [ ] Semantic heading hierarchy (h1 → h2 → h3)
- [ ] All images have `alt` text

### Site-Wide
- [ ] `sitemap.xml` generated and submitted
- [ ] `robots.txt` configured
- [ ] Organization structured data on homepage
- [ ] 404 page returns proper 404 status
- [ ] Redirects return 301 (not 302) for permanent moves
- [ ] No broken internal links
- [ ] HTTPS enforced

### Shopify Products
- [ ] Product structured data with price/availability
- [ ] Unique descriptions (not manufacturer copy)
- [ ] Collection pages have meta descriptions

### Sanity Content
- [ ] SEO fields in content schema (title, description, OG image)
- [ ] `generateMetadata` uses SEO fields with fallbacks
- [ ] Blog articles have Article structured data
- [ ] Published dates and modified dates are accurate
