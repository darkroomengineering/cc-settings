# Web Context

Activates web development mode. See full reference: `profiles/nextjs.md`

## Quick Reference
- Next.js App Router with Server Components by default
- Tailwind CSS v4 + CSS Modules (import as `s`)
- React Compiler active (no manual memoization)
- Use `@/components/image` and `@/components/link` wrappers
- Bun for package management

## Priorities
1. Correctness - Does it work? Types sound?
2. Accessibility - Can everyone use it?
3. Performance - Fast? Bundle minimal?
4. Maintainability - Will others understand it?

## Commands
| Task | Command |
|------|---------|
| Dev server | `bun dev` |
| Lint/format | `bun biome check --fix` |
| Type check | `bun tsc --noEmit` |
| Fetch docs | `/docs <library>` |
| Visual QA | `/qa` |

For detailed patterns, data fetching, routing, and more, see the full profile.
