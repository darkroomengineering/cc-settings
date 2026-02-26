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

---

## Component Constraints

### Accessibility

See `rules/accessibility.md` and `skills/accessibility.md` for full rules.

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
