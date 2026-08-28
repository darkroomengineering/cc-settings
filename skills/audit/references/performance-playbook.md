# Performance playbook: mobile and slow-connection load

The systematic version of what worked on shield.fi (August 2026, three PRs,
804 KB to 443 KB cold, Slow 3G load 16.9 s to 8.4 s, Lighthouse mobile 80 to
96). Use it inside `/audit performance` Phase 1 and 3, and from `/lighthouse`
when the score gap is bytes rather than execution. Every step names its
number and its command; that is the whole method.

## 1. Measurement kit

Three tools, each answering one question. Run each at least 3 times.

| Question | Tool | Command |
|---|---|---|
| What does a cold mobile load download, and when does it paint? | `net-capture.mjs` (this folder) | `node net-capture.mjs <url> slow3g` then `3g` |
| What is the score, and which metric drags it? | Lighthouse CLI | `CHROME_PATH=<real chrome> lighthouse <url> --form-factor=mobile --throttling-method=simulate --only-categories=performance --chrome-flags='--headless=new' --output=json` |
| Where do the JS bytes come from? | `bundle-attribution.py` (this folder) | build with source maps once, then `python3 bundle-attribution.py <rendered.html> <chunk-dir>` |

Rules that keep the numbers honest:

- Production build only, same host for both sides of any comparison. A
  local `next start` has no TLS and no latency and flatters everything by
  a few hundred ms; say so when the "before" was local and the "after" is
  the live site.
- Local Lighthouse on `next start` simulates HTTP/1.1 (six connections),
  which costs about 10 score points against the same build on Vercel's
  HTTP/2. Compare local to local, or preview to production, never across.
- The `CHROME_PATH` binary must be a real Chrome (Chrome for Testing,
  Playwright's `chromium-*`). `chrome-headless-shell` returns `NO_LCP`.
- Lighthouse's LCP under `simulate` is Lantern chaining every script into
  the paint. Read `lcp-breakdown-insight` for the observed number; a hero
  paragraph often paints at 0.4 s while the score says 2.6 s. Bytes move the
  score, execution moves the observed paint.
- Map DevTools presets before quoting them: DevTools "3G" is 400 kbps with a
  2 s round trip (the old "Slow 3G"); "Slow 4G" is the old "Fast 3G". At
  400 kbps a page moves 50 KB per second, so `load` is transfer arithmetic:
  455 KB is 9 s no matter what order it arrives in. Reply to "why is Load
  10 s" with that arithmetic and the first-paint number.

## 2. Discard the artifacts first

Each of these looked like a finding and was not:

- **Browser extensions in the Network panel.** `injected.js` at 443 KB,
  loaded twice, was half the ticket's "1.1 MB". Ask for an incognito run
  with "Disable cache" before measuring anything a client sent.
- **The DevTools Lighthouse panel's CLS.** A bit-identical 0.755 on a
  `vh`-sized footer that no CLI run, CDP run, or Performance trace could
  reproduce (`screenEmulation.disabled: true` and a 124,000 px document at
  screenshot time). Report the CLI number and move on.
- **Warm-cache "after" panels.** Rows of `304` and `(memory cache)` are a
  repeat view; the "before" was cold. Not comparable.
- **Vercel preview toolbar traffic** (`feedback.js`, `jwe`, `validate?`).
  Measure production or an incognito preview.

## 3. Fix ladder, with the measured effect of each rung

Ordered by KB per unit of risk on a Next.js 16 / Turbopack marketing site.
Re-measure after every rung; stop when the remaining bytes are framework.

1. **Images to AVIF, sized to the viewport that shows them.** Hero 131 KB
   WebP to 26 KB AVIF; below-fold tier images fetched after `load`.
2. **Client code the route never runs.** Bundle-attribute first. A gsap
   chunk with no mobile consumer, a WebGL chunk behind a desktop gate:
   `next/dynamic` with a *conditional* render. `ssr: false` on an
   unconditional render still fetches at hydration.
3. **Inline the render-blocking CSS** (`experimental.inlineCss: true`).
   Slow 3G first paint 3.0 s to 1.5 s for 24 KB more on the wire: the CSS
   also rides inside the RSC payload, which is the documented cost.
4. **Scope CSS per route.** Turbopack merges CSS across routes to save
   requests; with `inlineCss` requests are free on first load, so set
   `experimental.cssChunking: { type: 'graph', requestCost: 1,
   weightDistribution: 1 }`. Home inline CSS 136 KB to 110 KB raw, blog 103
   KB to 57 KB. `'strict'` is webpack-only and fails the Turbopack build.
5. **Subset fonts to the characters rendered.** Probe every text node per
   family (computed `font-family`, `text-transform`) and collect the
   character set. Ship a Basic Latin base file (preloaded) and a Latin-1 /
   General Punctuation `-Ext` file with `unicode-range` (fetched only when a
   glyph needs it). 27 KB to 17 KB per cut, Google's "latin" Geist Mono 23
   KB to 13 KB self-hosted. Preload nothing that has zero uses in the first
   viewport. With `next/font/local`, the ext face needs
   `adjustFontFallback: false` and an inline `declarations` literal (no
   shared constants; the loader requires literals), and the stack is
   composed as `ext, base` in hand-written CSS.
6. **Replace client-only widgets with the platform element.** A Base UI
   accordion (26 KB raw, one exclusive-open list) became `<details
   name="faq">` rendered on the server: ~10 KB gz off the route and the
   section left the client bundle. Animate with `::details-content` and
   `interpolate-size: allow-keywords`; degrade to instant open.
7. **Gate WebGL on the renderer string, not only on WebGL2 support.** See
   team-knowledge `webgl-software-renderer-hangs-lighthouse`. Without it,
   GPU-less runners (PageSpeed Insights) report "the page stopped
   responding".
8. **Scroll libraries on touch devices.** Lenis, hamo, tempus on a phone
   are ~12 KB plus a RAF loop feeding values the browser already has. Gate
   the provider on the desktop breakpoint once the scroll-progress hooks can
   read `window.scrollY`. Usually a separate ticket: it touches the
   scroll-driven sections.

What does not move the needle, measured: router prefetch flags
(`cachedNavigations`, `prefetchInlining`, `partialPrefetching`) change the
client bundle by 0.3 KB; the React DOM plus App Router runtime (~135 KB gz)
is the floor and no config removes it.

## 4. Traps found on the way

- `bun test` under CI that exports CMS credentials for another script: the
  data loaders stop short-circuiting and call `cacheLife()` outside the
  Next runtime. Strip `CMS_*` env in the test preload.
- Generated CSS (`root.css` from a styles script) silently reverts hand
  edits on the next build. Put composed tokens in the hand-written file.
- Playwright's default headless Chromium reports SwiftShader as its WebGL
  renderer; new headless (`channel: 'chromium'`) uses the GPU. Any test
  that asserts a mounted canvas must know which one it runs on.
- A page that resets scroll once its scroll library mounts (a
  `ScrollToTopOnLoad`) will undo Playwright's `scrollIntoView` mid-click.
  Wait for the library's mount signal (`html.lenis`) before interacting.
- `next experimental-analyze` writes length-prefixed binary records, not
  JSON; use the source-map attribution script instead of parsing them.

## 5. Report shape

One table per PR, before and after on the same host, plus a mermaid
`xychart-beta` bar chart of the same numbers. Columns that have earned their
place: requests, transfer, first paint and `load` on Slow 3G, Lighthouse
mobile score with LCP/TBT/CLS. Close the ticket with the same table and a
one-line note on what the ticket's original numbers included that the site
did not (extensions, toolbars, warm cache).
