# Darkroom Rules System

> Modular, composable coding standards for Claude Code

---

## Overview

Rules are self-contained guidelines that supplement `CLAUDE.md`. Each focuses on a single domain and can be enabled/disabled per project.

## Available Rules

| Rule | Description |
|------|-------------|
| `security.md` | Secret management, OWASP awareness, input validation |
| `typescript.md` | Strict mode, no `any`, interface vs type |
| `react.md` | Server Components, no manual memoization |
| `performance.md` | Waterfall prevention, bundle size, lazy loading |
| `accessibility.md` | WCAG 2.1, aria labels, semantic HTML |
| `git.md` | Commit conventions, PR guidelines |
| `style.md` | CSS modules, Tailwind conventions |

## Usage

### Enable All Rules (Default)
Rules are automatically loaded from `rules/`. No configuration needed.

### Disable Specific Rules
Create `.claude/rules.json` in project root:
```json
{ "disabled": ["performance", "accessibility"] }
```

### Enable Only Specific Rules
```json
{ "enabled": ["typescript", "security"], "mode": "allowlist" }
```

### Project-Specific Overrides
Override global rules with project-level files in `.claude/rules/`:
```
.claude/rules/typescript.md  # Overrides global typescript.md
```

## Rule File Structure

```markdown
# Rule Name
> One-line description

---

## DO
- Positive patterns with code examples

## DON'T
- Anti-patterns with code examples

## Tools
- Relevant tooling (Biome, etc.)
```

## Integration

1. `CLAUDE.md` - Orchestration, workflow, high-level standards
2. `rules/*.md` - Detailed, domain-specific guidance
3. `.claude/rules.json` - Per-project customization

## Adding New Rules

1. Create `rules/your-rule.md`
2. Keep under 100 lines
3. Include DO/DON'T examples
4. Update this README

## Enforcement

- **Claude Code** - Reads rules at session start
- **Biome** - TypeScript and style violations
- **Pre-commit hooks** - Blocks critical violations
- **PR review** - Agent-assisted compliance checks
