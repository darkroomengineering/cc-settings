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
| `react.md` | Working with `.tsx`, `.jsx`, or `components/` |
| `typescript.md` | Working with `.ts`, `.tsx` files |
| `style.md` | Working with CSS, SCSS, or styled components |
| `accessibility.md` | Working with UI components |
| `security.md` | Working with API routes, lib code, or env files |
| `performance.md` | Working with app code or components |
| `git.md` | Always loaded (git operations) |

## Adding New Rules

1. Create `rulename.md` in this directory
2. Add `paths:` frontmatter with glob patterns
3. Write rule content in markdown

Rules are automatically picked up by Claude Code.
