# Rules

Path-conditioned rules that Claude Code loads based on file context.

## How It Works

Rules use `paths:` frontmatter to specify when they should be loaded:

```yaml
---
paths:
  - "**/*.tsx"
  - "components/**/*"
---

# Rule content here
```

Claude Code automatically loads relevant rules based on:
- Files currently open
- Files being edited
- Files being discussed

## Available Rules

| Rule | Loaded When |
|------|-------------|
| `react.md` | Working with `.tsx`, `.jsx`, `components/`, or `app/` |
| `typescript.md` | Working with `.ts`, `.tsx` files |
| `style.md` | Working with CSS, SCSS, or any `.tsx`/`.jsx` file — CSS Modules, Tailwind, stack constraints, mobile baseline, worst-case data |
| `accessibility.md` | Working with UI components |
| `security.md` | Working with any `.ts`/`.tsx`/`.js` file, API routes, lib code, or env files |
| `performance.md` | Working with `.ts`, `.tsx`, `.js`, `components/`, or `app/` — stack forms, streaming, frame loops, budgets |
| `ui-fix.md` | Working with `.tsx`, `.jsx`, `.css`, `.scss`, `app/`, or `components/` — UI bug-fix workflow, screenshot-first |
| `motion-physics.md` | Working with `.tsx`, `.jsx`, or `components/` — should-it-animate gate, easing and duration tokens, gesture/spring physics, animation vocabulary |
| `swift-animation.md` | Working with `.swift` files — SwiftUI animation at the display's maximum frame rate (WWDC23 "Explore SwiftUI animation") |
| `swift.md` | Working with `.swift` files — concurrency (Swift 6.2 isolation settings), Sendable, Swift Testing, `Logger` |
| `git.md` | Working with `.git/`, `.gitignore`, or `.github/` files; `/ship` and `/dr-review` read it explicitly |

## Adding New Rules

1. Create `rulename.md` in `rules/`
2. Add `paths:` frontmatter with glob patterns
3. Write rule content in markdown

Rules are automatically picked up by Claude Code. This page lives in `docs/` because a file in `rules/` loads whenever its paths match; keep reference material out of `rules/`.
