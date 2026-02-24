# Accessibility Standards (WCAG 2.1)

> Comprehensive accessibility checklist for web applications. Source: [rams.ai](https://rams.ai)
>
> **Foundation:** `rules/accessibility.md` covers core DO/DON'T patterns (semantic HTML, alt text, labels, focus, contrast, touch targets). This file extends those with severity tiers, detailed ARIA patterns, and testing checklists.

## Severity Tiers

### Critical (Must Fix Immediately)
These issues prevent users from accessing content or completing tasks.

### Serious
These issues significantly impact user experience for assistive technology users.

### Moderate
These issues create friction but don't completely block users.

---

## Critical Issues

### Images
```tsx
// ❌ Missing alt text
<img src="/hero.jpg" />

// ✅ Descriptive alt text
<img src="/hero.jpg" alt="Team collaborating in modern office" />

// ✅ Decorative images
<img src="/decoration.svg" alt="" role="presentation" />
```

### Form Inputs
```tsx
// ❌ Input without label
<input type="email" placeholder="Email" />

// ✅ With visible label
<label>
  Email
  <input type="email" />
</label>

// ✅ With aria-labelledby
<span id="email-label">Email</span>
<input type="email" aria-labelledby="email-label" />
```

### Links
```tsx
// ❌ Missing href
<a onClick={handleClick}>Click here</a>

// ✅ With href
<a href="/destination">Click here</a>

// ✅ Button styled as link (if truly an action)
<button type="button" className="link-style" onClick={handleAction}>
  Perform action
</button>
```

---

## Serious Issues

### Color-Only Indicators
```tsx
// ❌ Color-only status
<span className="text-red-500">Error</span>

// ✅ Color + icon/text
<span className="text-red-500">
  <ErrorIcon aria-hidden="true" /> Error: Invalid email
</span>
```

---

## Moderate Issues

### TabIndex
```tsx
// ❌ Positive tabindex (breaks natural order)
<button tabIndex={5}>First</button>

// ✅ Use 0 or -1 only
<button tabIndex={0}>Focusable in natural order</button>
<button tabIndex={-1}>Programmatically focusable only</button>
```

### ARIA Roles
```tsx
// ❌ Role without required attributes
<div role="checkbox">Option</div>

// ✅ Complete ARIA implementation
<div
  role="checkbox"
  aria-checked={isChecked}
  tabIndex={0}
  onKeyDown={handleKeyDown}
>
  Option
</div>

// ✅ BETTER: Use native elements
<input type="checkbox" checked={isChecked} onChange={handleChange} />
```

---

## Design Requirements

### Color Contrast

| Text Size | Minimum Ratio |
|-----------|---------------|
| Normal text (<18px) | 4.5:1 |
| Large text (≥18px bold, ≥24px) | 3:1 |
| UI components | 3:1 |

### Component States
Every interactive component needs:
- **Default**: Normal appearance
- **Hover**: Visual feedback on mouse over
- **Focus**: Keyboard focus indicator
- **Active/Pressed**: Feedback during activation
- **Disabled**: Visually distinct, `aria-disabled` or `disabled`
- **Loading**: Progress indicator
- **Error**: Error state with message

### Dark Mode
```tsx
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
```

---

## Testing Checklist

### Keyboard Testing
- [ ] All interactive elements reachable via Tab
- [ ] Focus order matches visual order
- [ ] No keyboard traps
- [ ] Escape closes modals/dropdowns
- [ ] Enter/Space activates buttons
- [ ] Arrow keys navigate within components (menus, tabs)

### Screen Reader Testing
- [ ] All content announced
- [ ] Images have appropriate alt text
- [ ] Form fields have labels
- [ ] Headings create logical outline
- [ ] Dynamic content updates announced (aria-live)
- [ ] Error messages associated with fields

### Visual Testing
- [ ] Text readable at 200% zoom
- [ ] Content reflows at 320px viewport
- [ ] Focus indicators visible
- [ ] Color not sole indicator
- [ ] Animations respect prefers-reduced-motion

---

## Quick Fixes Reference

| Issue | Fix |
|-------|-----|
| `<div onClick>` | Use `<button type="button">` |
| `<a>` without href | Add href or use `<button>` |
| Icon button | Add `aria-label` |
| Input without label | Add `<label>` or `aria-label` |
| Image without alt | Add descriptive `alt` or `alt=""` for decorative |
| outline: none | Add `focus-visible` replacement |
| Color-only status | Add icon, pattern, or text |
| Small touch target | Ensure 44x44px minimum |
| Skipped heading | Use sequential h1→h2→h3 |
| `tabIndex > 0` | Use 0 or -1 only |
