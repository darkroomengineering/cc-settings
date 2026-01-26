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

---

## Typography
```tsx
<h1 className="text-balance">
<p className="text-pretty">
<span className="tabular-nums">1,234.56</span>
```

## Z-Index Scale
| Layer | Value |
|-------|-------|
| Dropdown | 10 |
| Sticky | 20 |
| Modal | 30 |
| Toast | 40 |

## Tools
- **Tailwind CSS v4**
- **CSS Modules**
- **Biome**
