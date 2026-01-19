# Accessibility Standards (WCAG 2.1)

> Comprehensive accessibility checklist for web applications. Source: [rams.ai](https://rams.ai)

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

### Icon-Only Buttons
```tsx
// ❌ No accessible name
<button onClick={handleClose}>
  <XIcon />
</button>

// ✅ With aria-label
<button onClick={handleClose} aria-label="Close dialog">
  <XIcon />
</button>

// ✅ With visually hidden text
<button onClick={handleClose}>
  <XIcon />
  <span className="sr-only">Close dialog</span>
</button>
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

// ✅ With aria-label (when visual label not possible)
<input type="email" aria-label="Email address" placeholder="Email" />

// ✅ With aria-labelledby
<span id="email-label">Email</span>
<input type="email" aria-labelledby="email-label" />
```

### Semantic Elements
```tsx
// ❌ NEVER: div with click handler
<div onClick={handleClick} className="cursor-pointer">
  Click me
</div>

// ✅ Use button for actions
<button type="button" onClick={handleClick}>
  Click me
</button>

// ❌ NEVER: span/div as link
<span onClick={() => navigate('/about')}>About</span>

// ✅ Use anchor for navigation
<a href="/about">About</a>
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

### Focus Indicators
```tsx
// ❌ NEVER: Remove focus outline without replacement
button:focus {
  outline: none;
}

// ✅ Custom focus style
button:focus-visible {
  outline: 2px solid var(--focus-color);
  outline-offset: 2px;
}

// ✅ Tailwind
<button className="focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
```

### Keyboard Navigation
```tsx
// ❌ Mouse-only interaction
<div onMouseEnter={showTooltip} onMouseLeave={hideTooltip}>
  Hover for info
</div>

// ✅ Keyboard accessible
<button
  onMouseEnter={showTooltip}
  onMouseLeave={hideTooltip}
  onFocus={showTooltip}
  onBlur={hideTooltip}
>
  Info
</button>
```

### Color-Only Indicators
```tsx
// ❌ Color-only status
<span className="text-red-500">Error</span>
<span className="text-green-500">Success</span>

// ✅ Color + icon/text
<span className="text-red-500">
  <ErrorIcon aria-hidden="true" /> Error: Invalid email
</span>
<span className="text-green-500">
  <CheckIcon aria-hidden="true" /> Success
</span>
```

### Touch Targets
```tsx
// ❌ Too small (under 44x44px)
<button className="p-1">
  <SmallIcon className="w-4 h-4" />
</button>

// ✅ Adequate touch target
<button className="p-3 min-w-[44px] min-h-[44px]">
  <SmallIcon className="w-4 h-4" />
</button>
```

---

## Moderate Issues

### Heading Hierarchy
```tsx
// ❌ Skipping heading levels
<h1>Page Title</h1>
<h3>Section</h3>  // Skipped h2!

// ✅ Sequential headings
<h1>Page Title</h1>
<h2>Section</h2>
<h3>Subsection</h3>
```

### TabIndex
```tsx
// ❌ Positive tabindex (breaks natural order)
<button tabIndex={5}>First</button>
<button tabIndex={2}>Second</button>

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

```css
/* ❌ Insufficient contrast */
.text-gray-400 { color: #9ca3af; } /* on white: ~2.9:1 */

/* ✅ Sufficient contrast */
.text-gray-600 { color: #4b5563; } /* on white: ~5.4:1 */
```

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
// Support system preference
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">

// Or manual toggle with class strategy
<html className={theme === 'dark' ? 'dark' : ''}>
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
