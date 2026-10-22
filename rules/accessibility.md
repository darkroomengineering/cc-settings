---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.html"
  - "components/**/*"
---

# Accessibility

> WCAG 2.1 compliance, semantic HTML, inclusive design

---

## Patterns

```css
/* Default focus ring: scales with font size */
:focus-visible { outline: max(2px, 0.08em) solid currentColor; outline-offset: 0.25em; }
/* Custom-colored ring */
button:focus-visible { outline: 2px solid var(--focus-color); outline-offset: 2px; }
/* Box-shadow ring (alternative): keep a transparent outline so forced-colors mode still shows focus */
button:focus-visible { outline: 2px solid transparent; box-shadow: 0 0 0 2px var(--focus-color); }
```

- Never remove the focus outline (`button:focus { outline: none }`) without a replacement ring.
- State is never color-only: pair a red error with an icon and text.
- Decorative images take `alt=""` (plus `aria-hidden="true"` for SVG). Keep heading levels sequential.

---

## Requirements

Canonical copy of these thresholds. `AGENTS.md` restates a subset because it runs where this file isn't
loadable — when a threshold changes here, update it too.

| Requirement | Standard |
|------------|----------|
| Contrast — body text | 4.5:1 (AA), 7:1 (AAA) |
| Contrast — large text (18pt+/14pt+ bold) | 3:1 (AA), 4.5:1 (AAA) |
| Contrast — non-text UI (icons, borders, focus rings) | 3:1 |
| Touch targets | 44x44px minimum, with visible spacing between adjacent targets |
| Focus order | Logical flow |
| Motion | Respect `prefers-reduced-motion` |

Reduced motion means gentler, not zero. Declare movement inside the opt-in query; opacity and color fades stay outside. Scripts check `matchMedia('(prefers-reduced-motion: no-preference)')`. Never ship a global `0.01ms !important` rule.

```css
.card { transition: opacity 200ms var(--ease-out); }
@media (prefers-reduced-motion: no-preference) {
  .card { transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out); }
}
```

### Hit areas and type
- Sub-44px icon buttons grow the hit area with `position: relative` + `::after { content: ""; position: absolute; inset: min(0px, (100% - 44px) / 2); }`. It breaks under `overflow: hidden/clip`.
- Type scales with the layout, not with browser zoom. Size text with the project's type utilities, which scale in `vw` to the design frame like the rest of the layout. Never use `rem` or `rem + vw` for type in a frame-scaled layout: zoom then grows the text while its containers stay fixed, and the layout breaks.

## Tools

- **`mcp__chrome-devtools__take_snapshot`** — text-based accessibility tree with element `uid`s
