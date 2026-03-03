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

---

## Implementation Patterns

### Skip Link
```tsx
// In layout.tsx — first child of <body>
<a href="#main-content" className="skip-link">
  Skip to main content
</a>
<nav>...</nav>
<main id="main-content">...</main>
```
```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  padding: 8px 16px;
  background: var(--color-primary);
  color: white;
  z-index: 100;
}
.skip-link:focus {
  top: 0;
}
```

### Modal Focus Trap
```tsx
function Modal({ isOpen, onClose, children }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const modal = modalRef.current
    if (!modal) return

    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first?.focus()
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null
  return (
    <div role="dialog" aria-modal="true" ref={modalRef}>
      {children}
    </div>
  )
}
```

### Live Region Announcements
```tsx
// Force screen reader re-announcement of dynamic content
function announce(message: string) {
  const el = document.getElementById('live-region')
  if (!el) return
  el.textContent = ''
  requestAnimationFrame(() => { el.textContent = message })
}

// In layout.tsx
<div id="live-region" aria-live="polite" aria-atomic="true" className="sr-only" />
```

---

## Screen Reader Quick Reference

### VoiceOver (macOS)
| Action | Keys |
|--------|------|
| Start/Stop | Cmd + F5 |
| Next element | VO + Right (Ctrl+Opt+Right) |
| Previous element | VO + Left |
| Activate | VO + Space |
| Headings list | VO + U, then Left/Right to Headings |
| Links list | VO + U, then Left/Right to Links |
| Read all | VO + A |

### NVDA (Windows)
| Action | Keys |
|--------|------|
| Start | Ctrl + Alt + N |
| Stop | Insert + Q |
| Next element | Tab / Down |
| Headings list | Insert + F7 |
| Links list | Insert + F7, Alt+L |
| Read all | Insert + Down |

---

## WCAG 2.1 Quick Reference

### Level A (Minimum)
| Criterion | Requirement |
|-----------|-------------|
| 1.1.1 Non-text Content | All images have alt text |
| 1.3.1 Info and Relationships | Semantic HTML, proper headings |
| 1.4.1 Use of Color | Color is not the only visual means |
| 2.1.1 Keyboard | All functionality keyboard-accessible |
| 2.4.1 Bypass Blocks | Skip navigation mechanism |
| 2.4.2 Page Titled | Pages have descriptive titles |
| 3.1.1 Language of Page | `lang` attribute on `<html>` |
| 3.3.1 Error Identification | Errors described in text |
| 4.1.1 Parsing | Valid HTML |
| 4.1.2 Name, Role, Value | Custom controls have accessible names |

### Level AA (Target)
| Criterion | Requirement |
|-----------|-------------|
| 1.4.3 Contrast (Minimum) | 4.5:1 text, 3:1 large text |
| 1.4.4 Resize Text | Content usable at 200% zoom |
| 1.4.11 Non-text Contrast | 3:1 for UI components |
| 2.4.6 Headings and Labels | Descriptive headings |
| 2.4.7 Focus Visible | Visible keyboard focus indicator |
| 3.2.3 Consistent Navigation | Same nav across pages |
| 3.3.3 Error Suggestion | Suggest corrections for errors |
