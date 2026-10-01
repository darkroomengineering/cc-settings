---
paths:
  - "**/*.css"
  - "**/*.scss"
  - "**/*.module.css"
  - "**/*.tsx"
  - "**/*.jsx"
---

# Style

> CSS modules as 's', Tailwind conventions, no inline styles

---

## DO

### CSS Module Import Convention
```tsx
import s from './component.module.css'
function Component() { return <div className={s.wrapper}>...</div> }
```

### Tailwind for Utilities
```tsx
<div className="flex items-center gap-4 p-6">
<h1 className="text-2xl font-bold text-balance">
```

### CSS Modules for Complex Components
```css
.button { /* Base */ }
.button[data-variant='primary'] { /* Variant */ }
```

### Theming with CSS Custom Properties
```css
:root { --color-primary: #0066cc; }
[data-theme='dark'] { --color-primary: #66b3ff; }
```

### Conditional Classes with cn()
```tsx
<button className={cn('px-4 py-2', variant === 'primary' && 'bg-blue-500')}>
```

### Viewport Units
```tsx
<div className="h-dvh">  {/* Not h-screen */}
```

### Modern CSS
- **Native `popover` + `popovertarget`** for menus, tooltips, and non-modal overlays. They render in the top layer, so they never fight the z-index scale. Style `::backdrop` and `:popover-open`.
- **`:has()`** for parent- or sibling-dependent styling instead of JS state or conditional classes.
- **`@scope` with a lower bound** (`@scope (.card) to (.content)`) when a style must not leak into nested content.
- **`text-box: trim-both cap alphabetic`** for optical text alignment instead of negative margins or line-height fudges. It degrades cleanly.
- **`sibling-index()` / `sibling-count()`** for stagger delays and count-based spacing. Enhancement only (Chrome 138, Safari 26.2, Firefox 154): always keep a working static fallback.

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
```tsx
// WRONG: Global styles in components
import '@/styles/globals.css'  // Only in layout.tsx
```

- **Satus routes compose in `app/**/page.tsx` as server components.** A page-level `'use client'` component under `components/` that is all `page.tsx` renders is a smell: move the ref or state that forced it into the component that renders the element.
- **Open every Figma-exported SVG and strip `<filter>`** before using it as a background or mask. Texture effects export as `feTurbulence` filters that re-rasterize on the main thread. If the effect matters visually, apply it to an inline SVG on a composited layer and measure before shipping.

---

## Typography

> Typography utilities (`text-balance`, `text-pretty`, `tabular-nums`): see `rules/ui-skills.md`.

## Tools
- **Tailwind CSS v4**
- **CSS Modules**
- **Biome**
