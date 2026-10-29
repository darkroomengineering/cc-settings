# Performance Reference

> Moved out of `rules/performance.md` (Aug 2026 context diet): the rule keeps the
> enforcement core; this doc holds the implementation reference. Read it when
> actually doing the work it describes — resource hints, media, fonts, caching,
> DOM, third-party scripts, CLS debugging.

## Resource Hints

```html
<!-- Preconnect to critical third-party origins -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://cdn.shopify.com" crossorigin>

<!-- Preload critical resources -->
<link rel="preload" href="/fonts/custom.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/hero.webp" as="image" fetchpriority="high">

<!-- DNS prefetch for non-critical third parties -->
<link rel="dns-prefetch" href="https://www.google-analytics.com">
```

### Where to declare hints

| Stack | Pattern |
|---|---|
| Next.js | `export const metadata` in a layout/page (`other: { link: [...] }`), or raw `<link>` in `app/layout.tsx` |
| React Router | `links()` route export — runs on SSR + client navigation |

```tsx
// Next.js — app/layout.tsx
export const metadata: Metadata = {
  other: {
    link: [{ rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
  },
}

// React Router — app/root.tsx or any route
export function links() {
  return [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preload', href: '/fonts/custom.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  ]
}
```

## Image Optimization

### Stack-agnostic baseline

```tsx
// LCP (above the fold)
<img
  src="/hero.webp"
  alt="Hero"
  width={1200}
  height={600}
  fetchPriority="high"
  loading="eager"
  decoding="sync"
/>

// Below the fold
<img src="/photo.webp" alt="Photo" width={800} height={600} loading="lazy" decoding="async" />

// Responsive with art direction
<picture>
  <source srcSet="/hero-wide.avif" type="image/avif" media="(min-width: 768px)" />
  <source srcSet="/hero-wide.webp" type="image/webp" media="(min-width: 768px)" />
  <source srcSet="/hero-mobile.avif" type="image/avif" />
  <img src="/hero-mobile.webp" alt="Hero" width={375} height={500} />
</picture>
```

### Next.js: `next/image`

```tsx
import Image from 'next/image'

// LCP image
<Image src="/hero.webp" alt="..." priority fill sizes="100vw" />

// Remote — configure remotePatterns in next.config
<Image src={user.avatar} alt={user.name} width={48} height={48} />
```

### React Router: build-time tools

No built-in image component. For optimization, use a Vite plugin (`vite-imagetools`, `unplugin-imagemin`). For dynamic remote images, configure CSP/CORS at the edge.

**Format priority:** AVIF > WebP > JPEG/PNG. AVIF is 30–50% smaller than WebP. SVG for icons/logos.

## Font Loading

```css
/* Preload the critical font in <head> via your stack's link mechanism */
@font-face {
  font-family: 'Custom';
  src: url('/fonts/custom.woff2') format('woff2');
  font-display: swap;
  unicode-range: U+0000-00FF;  /* subset to latin if possible */
}
```

- Use **variable fonts** — one file replaces multiple weight files
- Subset fonts to used character ranges (`unicode-range`)
- Self-host fonts instead of Google Fonts for fewer round trips
- `font-display: optional` for non-critical fonts (prevents CLS entirely)

### Subsetting fonts without changing rendering

The goal is fewer font bytes with every page rendering exactly as before. Any
visible change is a regression until the user approves it; when a cut would
change rendering, report what it saves and what it changes, and ship the
identical version by default. Leave `font-display` and fallback fonts alone.

1. **Measure first.** Per font file: bytes, glyph count, variable axes and
   their ranges, OpenType features, hinting. Per page: font bytes transferred
   and every `preload`.
2. **Find what the site uses**, from stylesheets and inline component styles:
   - characters in the content, after `text-transform`;
   - axis values and weights per family, including one-off overrides and bold
     inside italics;
   - OpenType features switched on (`font-feature-settings`,
     `font-variant-*`);
   - CSS side effects: `hyphens: auto` draws U+2010 HYPHEN, which the content
     never contains.
3. **Cut each font to that.** Keep the used characters plus Latin-1 and
   Latin Extended-A. Leave CJK to system fonts if that is how it renders
   today. Restrict each variable axis to the range in use
   (`fonttools varLib.instancer font.ttf wght=300:700`); pin an axis to one
   value only when nothing overrides it. A range that excludes the old default
   moves the default, so match the `@font-face` `font-weight` range to the new
   axis. Drop unused layout features and hinting (`pyftsubset --unicodes=...
   --layout-features=... --no-hinting --flavor=woff2`).
4. **Split each font in two.** A core file with ASCII plus the punctuation
   most pages use (curly quotes, dashes, ellipsis) is preloaded. An extended
   file behind `unicode-range` downloads only when a page needs one of its
   characters. Each `unicode-range` lists only characters its file contains;
   a range wider than the file makes the browser fetch it and still fall back.
5. **Watch the traps.**
   - A generated fallback face between the core and extended faces draws the
     extended characters before the real font does. With `next/font/local`,
     set `adjustFontFallback: false` on the extended face (see the
     `/audit` performance playbook, step 5).
   - A font under the OFL with a Reserved Font Name must be renamed internally
     once subset: rewrite name IDs 1, 4, 6 and 16.
   - Open every generated file and check its glyph count, axes, features and
     names; font tools drop or keep things silently.
6. **Prove it.** Build a baseline from the same content, then pixel-diff
   before and after on pages with code, italics, accented characters,
   components with their own font settings, and CJK. Label every visible
   difference as a content change, a regression to fix, or sub-pixel rounding.
   Re-measure bytes per page and confirm the extended files load only where a
   page needs them.

**No build step.** The subsetting is a script the user runs by hand, and its
output is committed. Give the script a `--check` mode that collects the
characters, weights and features the site uses now and fails when the
committed files lack any of them; a repo whose content changes often can run
it in CI. Note in the script header when to rerun it: new content in another
script or language, a new weight or axis value, a new OpenType feature.

**Report:** bytes before and after per font and per page, the pixel-diff
results with each difference labelled, every deviation from the procedure and
what it cost, and the rerun command. Later options: inline the core font in
the global stylesheet, and precache the extended files after idle.

## Cache Headers

| Stack | Pattern |
|---|---|
| Next.js | `headers()` in `next.config.ts`, or `Cache-Control` returned from a Route Handler |
| React Router | `headers` route export (per-route, has access to loader data) |

```ts
// Next.js — next.config.ts
async headers() {
  return [
    {
      source: '/_next/static/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'private, max-age=0, must-revalidate' }],
    },
  ]
}
```

```tsx
// React Router — app/routes/posts.$id.tsx
export function headers() {
  return {
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
  }
}
```

## DOM Performance

### Passive event listeners

```ts
element.addEventListener('touchstart', handler, { passive: true })
element.addEventListener('wheel', handler, { passive: true })
```

### Layout thrashing prevention

```ts
// WRONG: interleaved reads and writes (forces layout per iteration)
elements.forEach((el) => {
  const h = el.offsetHeight
  el.style.height = h + 10 + 'px'
})

// CORRECT: batch reads, then batch writes
const heights = elements.map((el) => el.offsetHeight)
elements.forEach((el, i) => {
  el.style.height = heights[i] + 10 + 'px'
})
```

### Content visibility for long lists

```css
.offscreen-section {
  content-visibility: auto;
  contain-intrinsic-size: 0 500px;
}
```

## Third-Party Scripts

| Stack | Pattern |
|---|---|
| Next.js | `next/script` with `strategy="afterInteractive"` or `"lazyOnload"` |
| React Router | Plain `<script>` in `links()`/`<head>` of `root.tsx`, or load on user interaction |
| Either | Facade pattern for heavy embeds (YouTube, maps): static image until click |

- IntersectionObserver to lazy-load below-fold widgets (any stack)
- Budget: < 200 KB total third-party JS

## CLS (Cumulative Layout Shift) — target < 0.1

### DO

#### Explicit dimensions on media

```tsx
<img src="/photo.jpg" width={800} height={600} alt="Photo" />
<video width={1280} height={720} />

<div style={{ aspectRatio: '16/9' }}>
  <iframe src="..." />
</div>
```

#### Font fallback metrics

```css
@font-face {
  font-family: 'Custom';
  src: url('custom.woff2') format('woff2');
  font-display: swap;
  size-adjust: 105%;
  ascent-override: 95%;
  descent-override: 20%;
}
```

#### Reserve space for dynamic content

```tsx
<div style={{ minHeight: 250 }}>{ad && <AdUnit />}</div>
```

#### CSS containment for independent widgets

```css
.widget { contain: layout style paint; }
```

### DON'T

```tsx
// WRONG: Injecting content above existing content
{banner && <Banner />}
<MainContent />

// WRONG: Web fonts without fallback metrics
@font-face { font-family: 'Custom'; src: url('custom.woff2'); /* nothing else */ }

// WRONG: Dynamically resizing containers after paint
useEffect(() => {
  ref.current.style.height = calculatedHeight + 'px'  // shift!
}, [calculatedHeight])
```

### Measuring CLS

```ts
import { onCLS } from 'web-vitals'
onCLS(console.log)
```

#### Debug CLS sources

```ts
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) {
      console.log('CLS:', entry.value, entry.sources?.map((s) => s.node))
    }
  }
}).observe({ type: 'layout-shift', buffered: true })
```

## Performance Budgets

| Resource | Budget |
|---|---|
| Total page weight | < 1.5 MB |
| JavaScript (compressed) | < 300 KB |
| CSS (compressed) | < 100 KB |
| Images (above-fold) | < 500 KB |
| Fonts | < 100 KB |
| Third-party scripts | < 200 KB |
