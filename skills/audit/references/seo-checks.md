# SEO / AEO check reference

Working reference for the audit skill's SEO mode. Every check is mechanical
where the surface allows it: a command to run, the output that constitutes a
finding, and the destination-shape fix. Distilled from shipped Darkroom work —
satus PRs #348/#405/#413 and darkroomengineering/website PRs #40/#65, which
independently converged on the same architecture (that convergence is the
evidence these are destination shapes, not one-off fixes).

`$BASE` below is the site under audit — a local `next build && next start`,
a preview deploy, or production. Prefer a build over `next dev` (dev skips
static generation paths that change metadata output).

Checks are ordered by impact within each group. IDs are stable — findings in
the report cite them.

---

## Group 1 — Canonical integrity

### S1. Every route's canonical is self-referential

A layout-level `alternates.canonical` is inherited by every child that does
not set its own — the whole subtree silently canonicalizes to one URL.

**Detect:**

```bash
grep -rn "canonical:" app/**/layout.tsx        # a hit outside the root layout IS the finding
for path in / /about /work /articles; do       # sample 3+ sibling routes
  curl -s "$BASE$path" | grep -o '<link rel="canonical"[^>]*>'
done                                            # two routes, same canonical → finding
```

**Fix shape:** one shared helper builds the alternates object per route
(satus `lib/seo/alternates.ts` `routeAlternates(path)`); the root layout is
the only caller passing `/`. Never a bare `canonical: '/x'` literal repeated
by hand.

### S2. Child canonicals don't drop shared alternate links

Next.js replaces a child's `metadata.alternates` object wholesale — it does
not merge. Any route that sets its own canonical silently loses every shared
entry the parent carried: hreflang, RSS, the `text/plain` pointer to
`/llms.txt`. The fix for S1 creates this bug unless both go through one
helper.

**Detect:** on a route that sets its own canonical,

```bash
curl -s "$BASE/child-route" | grep -o '<link rel="alternate"[^>]*>'
```

Canonical present but a root-layout alternate absent → finding.

**Fix shape:** the same `routeAlternates()` helper always emits the per-route
canonical AND every shared entry, so a route cannot get one without the
other.

### S3. Canonical and sitemap URLs come from one source

A canonical that disagrees with the sitemap tells the engine to crawl one URL
and index another; the engine picks, usually wrongly.

**Detect:**

```bash
curl -s "$BASE/sitemap.xml" | grep -oP '(?<=<loc>)[^<]+' | sort > /tmp/urls.txt
# curl each URL, extract its canonical, compare to the sitemap entry
```

In source: does sitemap generation and metadata generation import from one
shared route-enumeration module, or does each keep its own hardcoded path
list? Two independent lists is the smell.

**Fix shape:** one route module (satus `lib/seo/routes.ts`: `STATIC_ROUTES` +
`getCmsRoutes()`) consumed by sitemap, llms.txt, and metadata alike.

---

## Group 2 — Advertised vs rendered

### S4. Every sitemap URL returns 200

The sitemap only formats data it is given — it never checks reachability. A
CMS-backed site can enumerate documents no route renders: the editor
publishes `/about`, sees it in the sitemap, and visitors get a 404. Nothing
in CI catches it. This is the single highest-value mechanical check.

**Detect:**

```bash
curl -s "$BASE/sitemap.xml" | grep -oP '(?<=<loc>)[^<]+' | while read -r url; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
  [ "$code" != "200" ] && echo "$code $url"
done
```

**Fix shape:** a catch-all route rendering CMS documents at the exact slug
shape the enumeration uses (satus `app/(site)/[...slug]/page.tsx`), with the
catch-all also owning `notFound()` duty.

### S5. Demo/example/admin routes carry their own noindex

Sitemap exclusion is not enough — robots.txt typically allows `/` broadly,
and a crawler reaches the page via links or guessing. Starter-kit tutorial
routes, storybooks, and CMS studios all need route-level
`robots: { index: false, follow: false }`.

**Detect:**

```bash
grep -rn "robots.*index.*false" app/**/layout.tsx app/**/page.tsx
curl -s "$BASE/known-demo-route" | grep -o '<meta name="robots"[^>]*>'
```

A route absent from the sitemap with no noindex of its own → finding. For
starter kits, pruning the demo directory at project setup beats noindex.

---

## Group 3 — Per-content metadata

### S6. Every content item has its own title/description/OG image

A page with no metadata export inherits the parent layout's generic metadata
— two case studies with identical titles and identical social unfurls.

**Detect:** curl 2+ sibling content pages, diff `<title>`,
`<meta name="description">`, `og:image`. Identical output across distinct
items → finding. In source: every content route has `generateMetadata`
deriving from its own fetched data.

### S7. `og:type` / JSON-LD `@type` matches what the content is

Editorial writing is `article`/`Article`; portfolio and case-study pages are
`website`/`CreativeWork` — `Article` on client work invites news-content
treatment (recency decay, news carousel signals) that non-editorial content
should not get. Generic pages are `WebPage`.

**Detect:** curl each content type, check `<meta property="og:type">` and the
JSON-LD `@type` against what the content actually is.

### S8. One base-URL source, zero inline env reads

Hand-copied base-URL expressions drift and lose their env fallback — the
symptom is `https://undefined/...` links in llms.txt and metadata on any
environment where the var is unset.

**Detect:**

```bash
grep -rn "process\.env\..*URL\|VERCEL_URL" app/ lib/   # >1 constructor site → finding
curl -s "$BASE/llms.txt" | grep -i undefined
curl -s "$BASE/sitemap.xml" | grep -i undefined
```

**Fix shape:** one exported constant with the fallback chain and
trailing-slash normalization defined once (satus `lib/seo/site.ts`
`BASE_URL`); every absolute-URL consumer imports it.

### S9. Empty CMS descriptions fall back to derived, not site-wide

Editors leave the SEO description field blank far more often than the body.
Falling through to one site-wide string makes every such page's snippet
identical.

**Detect:** find CMS items with empty description fields; curl their pages;
`<meta name="description">` equal to the homepage's → finding.

**Fix shape:** derive from the page's own body/excerpt, truncated ~155 chars
on a word boundary (satus `lib/utils/metadata.ts` `truncateDescription`),
wired as `description || derivedDescription`.

---

## Group 4 — Structured data

### S10. Listing pages emit CollectionPage + ItemList

Without it, an answer engine asked "what has this studio built?" must crawl
the whole subtree; with it, membership and order are one fetch.

**Detect:** curl each index/listing page for a JSON-LD payload with
`"@type": "CollectionPage"` and `mainEntity` of `"@type": "ItemList"`. Also
check the builder module exists at all — its absence makes the gap
architectural. All URLs in the list must be absolute; a half-relative
ItemList validates cleanly while pointing nowhere.

### S11. JSON-LD via script tag, `<` escaped

Microdata (`itemProp`) lives on visible DOM nodes and gets lost or duplicated
across client re-renders. And an unescaped `<` in a CMS-sourced string
containing `</script>` closes the tag early — an XSS vector, not a rendering
bug.

**Detect:**

```bash
grep -rn "itemProp=\|itemScope" components/ app/    # presence → finding
grep -n "replace(/</g" lib/**/json-ld*              # absence + CMS strings → finding
```

**Fix shape:** `JSON.stringify(data).replace(/</g, '\\u003c')` into a single
`<script type="application/ld+json">` (satus `lib/seo/json-ld.tsx`).

### S12. No null/undefined/empty-array JSON-LD values

`"description": null` reads as present-but-broken; an empty `sameAs: []`
asserts the entity has no profiles. Absent reads as "not specified" — always
better.

**Detect:** extract each page's JSON-LD, `jq` for null or `[]` values. In
source: unconditional optional-field assignment in builders.

**Fix shape:** build required fields, then conditionally assign optionals one
at a time — never spread a possibly-empty value.

### S13. No fabricated entity facts

An invented founding date or publish date passes every validator and is never
caught downstream. When the value isn't sourced, omit the field and leave a
comment marking where the real value threads through once it exists.

**Detect:** review check, not mechanical — each entity fact in structured
data traces to a CMS field or a documented company fact.

---

## Group 5 — AEO surfaces

### S14. `/llms.txt` exists, is generated, and cannot drift

The cheapest AEO win: a plain-text entity summary and content list an answer
engine reads in one fetch without executing JS. Hand-written prose drifts;
generate it from the same `SITE` facts object and route enumeration the
JSON-LD and sitemap use.

**Detect:**

```bash
curl -sI "$BASE/llms.txt"                     # 200, content-type text/plain
curl -s "$BASE/llms.txt" | grep -i undefined  # any hit → finding (see S8)
```

Compare its content list against sitemap.xml — same enumeration source, same
entries. Grep the route for `SITE.` reads vs hardcoded prose.

### S15. robots.txt names AI crawlers explicitly

Several AI crawlers only honor directives addressed to them by name; a
wildcard `*` allow is not a guaranteed substitute — and named groups make the
allow/deny decision reviewable per bot.

**Detect:** `curl -s "$BASE/robots.txt"` — look for explicit groups covering
at minimum `GPTBot`, `ChatGPT-User`, `OAI-SearchBot`, `ClaudeBot`,
`Claude-User`, `Claude-SearchBot`, `PerplexityBot`, `Google-Extended`.
(`Google-Extended` controls Gemini/AI Overviews training consent, separate
from `Googlebot` search indexing.)

### S16. Visually-heavy sites ship a plain-HTML machine view

WebGL canvases and client-rendered copy give a non-JS-executing crawler
nothing to cite. The fix is one deliberately plain, server-only route
(satus `/ai`): semantic elements, entity facts as a `<dl>`, every real page
linked with bare `<a href>`, and a "for agents" footer linking `/llms.txt`,
`/sitemap.xml`, `/robots.txt`.

**Detect:** if `grep -rn "three\|<canvas" app/ components/` confirms a
canvas-heavy site, `curl -s "$BASE/" | grep -c '<p>\|<h1>\|<h2>'` near zero →
the site needs the route; then check one exists and is genuinely server-only
(no `'use client'` in its tree).

### S17. Sitemap ↔ machine-view parity

Any manually-maintained page list (the `/ai` route's link list) must stay in
sync with the sitemap — a route missing from either is invisible to the
surface it's missing from.

**Detect:** diff the machine view's hrefs against sitemap `<loc>` paths.
