---
paths:
  - "**/*.css"
  - "**/*.scss"
  - "**/*.module.css"
  - "**/*.tsx"
  - "**/*.jsx"
---

# Style

> Modern CSS patterns adapted from [good-css.com](https://good-css.com); no inline styles.

---

## DO

### Viewport Units
```tsx
<div className="min-h-svh">  {/* Documents and heroes. Never h-screen / 100vh */}
```
Use `dvh` (`h-dvh`) only for app shells that should track browser toolbar retraction.

### Full-Bleed Color Behind Mobile Safari's Toolbars
`theme-color` alone leaves Safari's status bar and bottom toolbar white in the browser, and it takes one color. Safari does extend a fixed element's background behind its controls, so pin a thin strip to each edge ([source](https://joshpuckett.me/seamless-mobile-safari)):
```css
html { background: var(--edge-top); }
body { background: var(--edge-bottom); }
.edge { position: fixed; inset-inline: 0; pointer-events: none; }
.edge[data-edge='top']    { top: 0;    height: max(12px, env(safe-area-inset-top));    background: var(--edge-top); }
.edge[data-edge='bottom'] { bottom: 0; height: max(12px, env(safe-area-inset-bottom)); background: var(--edge-bottom); }
```
- Render the strips as `aria-hidden` elements outside any transformed ancestor; a transform breaks `position: fixed`.
- Set `viewport-fit=cover`, keep content out of the strips, and sync `<meta name="theme-color">` to the top color.
- Each edge is one solid color. It can change on scroll, but gradients and images cannot extend behind the toolbars.

### Mobile Baseline
Touch-device defects that desktop emulation never shows; confirm each on a real phone ([source](https://github.com/emilkowalski/skills), MIT):
```css
html { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
input, textarea, select { font-size: max(16px, 1em); } /* under 16px, iOS zooms on focus and stays zoomed */
button, a, [role='button'] { touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.scroller { overscroll-behavior: contain; } /* inner scrollers don't chain into the page */
```
- Fix input zoom with the 16px floor, never `user-scalable=no` or `maximum-scale=1`.
- `overscroll-behavior: none` on `html, body` only for app shells; scrolling documents keep pull-to-refresh.
- `user-select: none` on controls only. Addresses, order numbers, and errors stay copyable.
- Detect touch with `(hover)` / `(pointer)` media queries, never user-agent or width sniffing.
- App shells with bottom-pinned inputs add `interactive-widget=resizes-content` to the viewport meta so Android's keyboard resizes the layout as iOS does.

### Modern CSS
- **Native `popover` + `popovertarget`** for menus, tooltips, and non-modal overlays. They render in the top layer, so they never fight the z-index scale. Style `::backdrop` and `:popover-open`.
- **`:has()`** for parent- or sibling-dependent styling instead of JS state or conditional classes.
- **`@scope` with a lower bound** (`@scope (.card) to (.content)`) when a style must not leak into nested content.
- **`text-box: trim-both cap alphabetic`** for optical text alignment instead of negative margins or line-height fudges. It degrades cleanly.
- **`sibling-index()` / `sibling-count()`** for stagger delays and count-based spacing. Enhancement only (Chrome 138, Safari 26.2, Firefox 154): always keep a working static fallback.
- **Logical properties** (`padding-inline`, `margin-block`, `inset-inline-start`) instead of left/right/top/bottom.
- **`overflow: clip`** instead of `hidden` when nothing should scroll; it keeps `position: sticky` working.
- **`justify-content: safe center`** on rows that can overflow, so the start edge stays reachable.
- **Intrinsic grids** `repeat(auto-fit, minmax(min(100%, 16rem), 1fr))`, and container queries + `cqi` before viewport breakpoints for components in variable-width slots.
- **`:user-invalid` / `:user-valid`** for form feedback (pair color with text). **`field-sizing: content`** with `min-height`/`max-height` in `lh` for growing textareas.
- **Dialogs and popovers** enter and exit with `@starting-style` + `transition: display ... allow-discrete, overlay ... allow-discrete`. **Anchor positioning** (`position-area` + `position-try-fallbacks`) for popovers tied to a trigger.
- **`light-dark()` + `color-scheme`** for two-theme color tokens. Projects with 3+ themes keep `[data-theme]` overrides.
- **Reset:** `min-width: 0` on flex/grid children and `text-wrap: balance` on headings.

### Constraints
- Interactive primitives come from **Base UI**, **React Aria**, or **Radix UI**, or from the project's own component library. Never mix primitive systems within one interaction surface, and prefer what the project already has over a new dependency.
- Loading states use structural skeletons that mirror the content's real layout (aspect boxes + text bars), not generic spinners for content areas.

### Typography
- `tabular-nums` (`font-variant-numeric: tabular-nums`) on prices, stats, and tables so columns align.

### Worst-Case Data
Components that render data get checked against the data that breaks them, not the demo copy:
- Fixed-size boxes (avatars, icons, badges, trailing actions) get `flex-shrink: 0`; the text column gets `min-width: 0`.
- Emails, URLs, and IDs get `overflow-wrap: anywhere`, never `word-break: break-all`. Truncate file names and paths in the middle; never truncate numbers, amounts, or dates.
- Truncated text stays readable some other way (tooltip, expand, detail view).
- Counts use `Intl.PluralRules` ("1 member"), numbers `Intl.NumberFormat`, and initials `Intl.Segmenter` grapheme clusters, so an emoji-first name never renders `�`.
- A missing optional field drops its line; never render an orphaned dash or separator.
- Check the component at a 320px container, 200% browser zoom, and `dir="rtl"` when the product ships RTL.

---

## DON'T

```tsx
// WRONG: Inline styles
<div style={{ padding: '20px' }}>
// OK: Dynamic values only
<div style={{ '--progress': `${percent}%` } as CSSProperties}>

// WRONG: Arbitrary z-index
<div className="z-[9999]">
// CORRECT: Scale (10=dropdown, 20=sticky, 30=modal, 40=toast)
<div className="z-30">
```
```css
/* WRONG: Animate layout */
.animate { transition: width 0.3s; }
/* CORRECT: Compositor-only */
.animate { transition: transform 0.3s, opacity 0.3s; }

/* WRONG: will-change always on */
.element { will-change: transform; }
```

- **Open every Figma-exported SVG and strip `<filter>`** before using it as a background or mask. Texture effects export as `feTurbulence` filters that re-rasterize on the main thread. If the effect matters visually, apply it to an inline SVG on a composited layer and measure before shipping.
