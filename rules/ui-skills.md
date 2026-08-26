---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "components/**/*"
---

# UI Skills Reference

> Opinionated constraints for building better interfaces. Source: [ui-skills.com](https://ui-skills.com)
>
> **Foundation:** `rules/style.md` covers core patterns (CSS modules as 's', Tailwind conventions, viewport units, z-index scale, compositor-only animations). This file extends those with stack constraints, component/interaction/animation/typography/layout rules.

## Stack Constraints

### Styling
- Use **Tailwind CSS** values unless custom values already exist in the project or are explicitly requested
- Never invent custom spacing, colors, or breakpoints when Tailwind defaults suffice
- Use **CSS Modules** (`import s from './component.module.css'`) for conditional and complex class logic

### Animation Libraries
- **GSAP** for JavaScript-driven and orchestrated animations
- **Lenis** (`lenis`) for smooth scroll
- **Tempus** (`tempus`) for RAF management
- CSS transitions/animations for simple micro-interactions
- Choose based on complexity: CSS for simple, GSAP for orchestrated sequences

### Component Primitives
- Use accessible primitives from: **Base UI**, **React Aria**, or **Radix UI**
- Never mix primitive systems within the same interaction surface
- Prefer existing project component library over introducing new dependencies

### Library Picks

Curated, opinionated — from emilkowalski/skills `pick-ui-library` (MIT). Check
`package.json` first; use what's already installed before reaching for these.

| Task | Library |
| --- | --- |
| Command menus (⌘K palettes) | [cmdk](https://cmdk.paco.me) |
| Animating numbers (counters, prices, stats) | [NumberFlow](https://number-flow.barvian.me) |
| Drag and drop | [dnd kit](https://dndkit.com) |
| Virtualization (long lists, large tables) | [Virtuoso](https://virtuoso.dev) |

**Styling split:** [clsx](https://github.com/lukeed/clsx) for ad-hoc conditional
`className` strings; [cva](https://cva.style) when a component has real variants
(size, intent, state) that deserve a typed API. They compose — cva uses
clsx-style inputs internally.

---

## Component Constraints

### Accessibility

See `rules/accessibility.md` and `docs/accessibility.md` for full rules.

### Dialogs & Modals
- Use `AlertDialog` (not `Dialog`) for destructive/irreversible actions
- AlertDialogs require explicit confirmation to proceed
- Standard Dialogs for informational or non-destructive content

### Loading States
- Use structural skeletons that match the content layout
- Avoid generic spinners for content areas
- Show loading indicators adjacent to the triggering action

### Error Handling
- Display errors adjacent to their action source (near the button/input that caused them)
- Never use only toast/snackbar for form validation errors
- Errors should be visually associated with the problematic field

---

## Interaction Constraints

### Input Handling
- **NEVER block paste** in `input` or `textarea` elements
- Allow password managers to function properly
- Support autofill attributes (`autocomplete`)

---

## Animation Constraints

Curves, durations, and the should-it-animate gate below are adapted from
emilkowalski/skills (MIT) — `animate`, `emil-design-eng`. Gesture/spring physics for
drag, swipe, and pointer-driven interactions live in `rules/motion-physics.md`; the
workflows that apply these values are `/qa` (finding motion opportunities) and
`/review` (per-diff enforcement).

### Should this animate?

| Frequency | Decision |
| --- | --- |
| 100+ times/day (keyboard shortcuts, command palette toggle) | No animation. Ever. |
| Tens of times/day (hover, list navigation) | Near-imperceptible only, or nothing |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare / first-time (onboarding, success, celebration) | The delight budget lives here |

Purpose must be one of: feedback, spatial consistency, state indication, preventing a
jarring change, explanation (marketing/onboarding only), or delight (rare tier only).
"It looks cool" on a frequently-seen element is not a reason to animate.

### Easing tokens

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* entering/exiting */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* moving/morphing on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* iOS-like drawer curve */
```

Built-in CSS easings are too weak for deliberate UI motion — extend these tokens,
never invent parallel ones. Use plain `ease` for hover/color changes, `linear` for
constant motion (marquee, progress bars).

### Duration budget

| Element | Duration |
| --- | --- |
| Button press feedback | 100–160ms |
| Tooltips, small popovers | 125–200ms |
| Dropdowns, selects | 150–250ms |
| Modals, drawers | 200–500ms |
| Marketing / explanatory | Can be longer |

UI animations stay under 300ms — modals and drawers are the sanctioned exception,
up to 500ms.

### Never ship

- `ease-in` on a UI element — use `ease-out` or a token above.
- `transform: scale(0)` entrances — start `scale(0.9–0.97)` + `opacity: 0`.
- Animating anything but `transform`, `opacity`, or `clip-path` (the sanctioned
  third) — `width`/`height`/`margin`/`padding`/`top`/`left` trigger layout and paint.
  `height` is tolerated only for accordions.
- Keyframes on toasts, toggles, or anything a user can trigger rapidly — use CSS
  transitions instead, so retriggering retargets from the current value instead of
  restarting from zero.
- Ungated `:hover` motion — gate behind `@media (hover: hover) and (pointer: fine)`
  (touch fires false hovers on tap).
- Reduced motion treated as "zero" — `prefers-reduced-motion: reduce` means fewer and
  gentler animations, not none. Keep opacity/color transitions that aid
  comprehension; drop movement.

### Behavior
- Pause looping animations when off-screen (Intersection Observer)

---

## Typography Constraints

### Text Wrapping
- `text-balance` for headings (prevents orphans)
- `text-pretty` for body text (improves line breaks)
- Apply via Tailwind utilities or CSS

### Numeric Display
- `tabular-nums` for all numerical data (prices, stats, tables)
- Ensures aligned columns in data displays
- `font-variant-numeric: tabular-nums;`

---

## Layout Constraints

### Sizing
- Use `size-*` utility for square elements (same width/height)
- Example: `size-8` instead of `w-8 h-8`

---

## Design Constraints

### Color Usage
- Limit accent color to one per view/section
- Avoid multiple competing accent colors
- Exclude gradients unless explicitly requested by design

### Visual Effects
- Minimize `box-shadow` complexity
- Avoid animated shadows/glows (performance)
- Use border/outline for focus states, not shadow

---

Skeletons mirror the content's real layout (aspect boxes + text bars), and
reduced motion means gentler, not zero — e.g. keep the fade, drop the `y`
movement, shorten the duration.
