---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
---

# Performance

> Waterfalls, barrels, dynamic imports, and `React.cache` are in `AGENTS.md`. This file holds the forms, thresholds, and frame-loop rules. Implementation reference (resource hints, images, fonts, cache headers, DOM, third-party, CLS debugging): `~/.claude/docs/performance-reference.md` — read it when doing that work.

## Forms

- **Dynamic import:** plain `import()` inside an event handler for true on-demand. Never static-import heavy libs (`gsap`, analytics, editors) into the initial bundle.
- **Direct imports:** a path import (`lucide-react/dist/esm/icons/check`).
- **Waterfalls:** defer an `await` past early exits (`if (!req.query.id) return` before `await getUser(req)`).
- **Inline JSX literals are fine under React Compiler:** `<Button style={{ color: 'red' }} onClick={() => doThing()} />` does not cause referential-identity re-renders. The "no object or function literals in JSX" advice is pre-Compiler folklore; do not extract them into `useMemo` / `useCallback`.

## Streaming

Avoid streaming when layout depends on data dimensions, for above-fold SEO content, for fast queries (< 50 ms), or where layout shifts are unacceptable.

## Client-side data and re-renders

- **Deduplicate window listeners.** One `scroll`/`resize` listener with a callback registry (Map keyed by subscriber id), not one listener per hook instance.
- **Extract expensive work into the child that needs it.** Computation above an early `return` runs on every render of the parent; in a child it is skipped entirely.
- **Narrow effect dependencies.** Depend on `user.id`, not `user`; derive booleans for thresholds (`const isMobile = width < 768`, then depend on `isMobile`).
- **Wrap non-urgent updates in `startTransition`**, e.g. `onScroll={() => startTransition(() => setScrollY(window.scrollY))}`, so scroll state cannot block urgent renders.
- **Stable subscriptions.** Store the latest handler in a ref (`handlerRef.current = handler` in an effect) and subscribe once with a wrapper that calls `handlerRef.current(e)`; the subscription effect then depends only on the event type.

## Frame loops (rAF, `useFrame`, `useLenis`, ScrollTrigger `onProgress`, pointer handlers)

- **No layout reads inside a per-frame callback.** `getBoundingClientRect`, `clientWidth`, `offsetHeight`, `scrollTop` after a style write force a synchronous layout, once per read, before the frame can paint. It hides on an M-series laptop and stutters on Intel Macs, 4K externals, and low-end devices. Measure once outside the loop and cache with `ResizeObserver` or equivalent. Rects that truly change every frame (sticky or transformed elements) derive from scroll progress plus the cached initial rect. A comment saying a read "can't be avoided" is a claim to test against the stylesheet, not a waiver; if it survives that test, batch every read before any write so there is at most one forced layout.
- **Per-frame CSS custom property writes are not free.** `el.style.setProperty("--x", v)` invalidates style on the element and every descendant that consumes the variable, every frame; geometry-affecting consumers reflow too. Prefer `transform` and `opacity` via direct style writes or Web Animations. When a variable is the right tool: quantize to the precision the CSS needs (whole pixels, or the step count a `clamp` resolves to), skip the write when the rounded value is unchanged, scope the variable to the smallest element that needs it, and never layer a CSS `transition` on a per-frame write.
- **Write `style.transform` / `style.opacity` on the moving node**, not a custom property that only feeds one of them. A variable read by `top`, `left`, `width`, `height`, `padding`, `font-size`, or `line-height` is a layout write every frame.
- **Budget 8ms per frame**, the 120Hz figure, not 16.7ms.
- **No `setState` per frame.** A rAF, `pointermove`, or scroll handler that sets React state re-renders every frame; write the node's style through a ref, or hand the animation to GSAP or Web Animations.
- **Motion that plays while the page is busy** (navigation, hydration, fetching) runs as CSS transitions or Web Animations of `transform`/`opacity`, which the compositor keeps running; a rAF or GSAP tween stalls with the main thread.
- **Animate a shadow with `filter: drop-shadow()`**, not `box-shadow`, and keep any animated `blur()` under 20px (Safari degrades first).
- **Gate infinite CSS animations and per-frame writes on visibility** (IntersectionObserver). Opacity 0 does not stop the work, and `::after` animations run on the main thread.
- **No `toDataURL()` images on `style` or custom properties.** The string is inherited and carried through every style recalculation under that element. Ship a static asset, or use a blob URL if it must be dynamic.
- **Review rule:** before approving a perf or motion PR, grep the frame loops for layout reads and custom-property writes.

## Also enforce (details in the reference doc)

- Explicit `width`/`height` (or `aspect-ratio`) on every `img`/`video`/`iframe`;
  reserve space for dynamic content. CLS target < 0.1.
- LCP image: `fetchPriority="high"` + `loading="eager"`; below-fold media lazy. Format priority AVIF > WebP > JPEG/PNG.
- Fonts: woff2, `font-display: swap` with fallback metrics (`size-adjust`,
  `ascent-override`), variable fonts, subset, self-host.
- `preconnect` critical third-party origins; `preload` the critical font and LCP
  image.
- Static assets `Cache-Control: public, max-age=31536000, immutable`.
- Passive `touchstart`/`wheel` listeners; batch DOM reads before writes;
  `content-visibility: auto` for long offscreen sections.
- Third-party JS < 200 KB total; heavy embeds behind a facade. Page budgets:
  JS < 300 KB, CSS < 100 KB, fonts < 100 KB, above-fold images < 500 KB.
