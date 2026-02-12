# UI Skills Reference

> Opinionated constraints for building better interfaces. Source: [ui-skills.com](https://ui-skills.com)

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

---

## Component Constraints

### Accessibility

See `skills/accessibility.md` for full accessibility rules.

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

### Viewport & Layout
- Use `h-dvh` (dynamic viewport height) not `h-screen`
- Respect `safe-area-inset-*` for fixed/sticky positioning on mobile
- Test on devices with notches and gesture navigation

### Input Handling
- **NEVER block paste** in `input` or `textarea` elements
- Allow password managers to function properly
- Support autofill attributes (`autocomplete`)

### Touch Targets
- Minimum touch target size: **44x44px**
- Add padding/margin to meet targets, not just visual size
- Test with actual touch input, not just mouse

---

## Animation Constraints

### Performance Rules
- Restrict to compositor properties: `transform`, `opacity`
- Never animate `width`, `height`, `top`, `left`, `margin`, `padding`
- Avoid large `blur()` or `backdrop-filter` animations
- No `will-change` outside actively animating elements

### Timing & Motion
- Max **200ms** for interaction feedback (button press, toggle)
- 300-500ms for content transitions (page, modal)
- Honor `prefers-reduced-motion: reduce` media query

### Behavior
- Only animate when explicitly requested by design
- Pause looping animations when off-screen (Intersection Observer)
- Disable animations during system "reduce motion" preference

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

### Z-Index Scale
- Use fixed z-index scale, no arbitrary values
- Suggested scale: `0, 10, 20, 30, 40, 50` (or project-defined)
- Document z-index usage in project conventions

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

## Code Examples

### Good: Semantic Button with Accessible Icon
```tsx
<button
  type="button"
  aria-label="Close dialog"
  className="size-10 flex items-center justify-center"
  onClick={onClose}
>
  <XIcon className="size-5" />
</button>
```

### Bad: Div with Click Handler
```tsx
// ❌ Never do this
<div onClick={onClose} className="cursor-pointer">
  <XIcon />
</div>
```

### Good: Skeleton Loading
```tsx
function ProductCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="bg-gray-200 aspect-square rounded-lg" />
      <div className="mt-4 h-4 bg-gray-200 rounded w-3/4" />
      <div className="mt-2 h-4 bg-gray-200 rounded w-1/2" />
    </div>
  )
}
```

### Good: Respecting Reduced Motion
```tsx
import gsap from 'gsap'

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

gsap.to(elementRef.current, {
  opacity: 1,
  y: 0,
  duration: prefersReducedMotion ? 0 : 0.2,
})
```
