# Accessibility

> WCAG 2.1 compliance, semantic HTML, inclusive design

---

## DO

### Images, Buttons, Forms
```tsx
// Images need alt text
<Image src="/chart.png" alt="Sales increased 40% in Q4" />
<Image src="/decoration.svg" alt="" aria-hidden="true" />  // Decorative

// Icon buttons need labels
<button aria-label="Close menu"><CloseIcon /></button>

// Form inputs need labels
<label htmlFor="email">Email</label>
<input id="email" type="email" />
```

### Semantic Elements
```tsx
<nav aria-label="Main navigation">
  <ul><li><a href="/">Home</a></li></ul>
</nav>
<main>
  <article>
    <header><h1>Title</h1></header>
    <section>...</section>
  </article>
</main>
```

### Heading Hierarchy & Focus
```tsx
<h1>Page Title</h1>
<h2>Section</h2>      {/* No skipping levels */}
<h3>Subsection</h3>
```
```css
button:focus-visible {
  outline: 2px solid var(--focus-color);
  outline-offset: 2px;
}
```

---

## DON'T

```tsx
// WRONG: div for interaction
<div onClick={handleClick}>Click me</div>
// CORRECT
<button onClick={handleClick}>Click me</button>

// WRONG: Color-only indicator
<span className="text-red-500">Error</span>
// CORRECT: Icon + text
<span className="text-red-500"><ErrorIcon /> Error: Invalid email</span>

// WRONG: Skipping heading levels
<h1>Title</h1>
<h3>Subsection</h3>  {/* Skipped h2 */}

// WRONG: Blocking paste
<input onPaste={e => e.preventDefault()} />
```
```css
/* WRONG: Removing focus outline */
button:focus { outline: none; }
```

---

## Requirements

| Requirement | Standard |
|------------|----------|
| Color contrast | 4.5:1 (text), 3:1 (large) |
| Touch targets | 44x44px minimum |
| Focus order | Logical flow |
| Motion | Respect `prefers-reduced-motion` |

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Tools

- **axe DevTools** - Browser extension
- **agent-browser snapshot** - Accessibility tree
- **Lighthouse** - Audits
