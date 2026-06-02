---
name: build
description: Build feature/page/integration end-to-end with GO/NO-GO gate. For components use `/component`, hooks `/hook`. Triggers "build a feature/page", "implement feature", "add feature", "build integration".
context: fork
---

# Feature Build Workflow

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "build" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

## Phase 1: Research (GO/NO-GO Gate)

Before any implementation, complete this research phase:

1. **Detect stack** — read `package.json`. `next` dep → satus / Next.js; `react-router` dep → novus / React Router. Note any starter signal (`name` field, `darkroom.starter` marker).
2. **Understand requirements** — parse what the user actually needs.
3. **Explore codebase** — find existing patterns, similar implementations.
4. **Fetch docs** — use Context7 MCP for any external library. Never code from memory.
5. **Check versions** — run `bun info <package>` for the latest version.
6. **Assess feasibility** — can this be done cleanly within existing architecture?

**GO/NO-GO Verdict**: After research, state one of:
- **GO** — requirements are clear, approach is viable, proceed to implementation.
- **NO-GO** — requirements are ambiguous, approach has blockers, or scope is too large. Report findings and stop.

Do not proceed past this gate without an explicit GO verdict.

## Phase 2: Plan

Create a brief implementation plan:
- Files to create/modify (with stack-correct paths — `lib/hooks/` for satus, `hooks/` for novus, etc.)
- Key decisions and rationale
- Dependency order

## Phase 3: Implement

Follow standard Maestro workflow: scaffold → implement → test → review.

Use the right primitives for the stack:

| Concern | satus (Next.js) | novus (React Router) |
|---|---|---|
| Page | `app/<path>/page.tsx` | `app/routes/<path>.tsx` |
| Layout | `app/<path>/layout.tsx` | `app/root.tsx` or nested route |
| Data fetching | Server Component `async function` | `loader()` route export |
| Mutations | Server Actions (`'use server'`) | `action()` route export |
| Routing | File-based `app/` | File-based `app/routes/` |
| Image | `next/image` | `<img>` (or Vite plugin) |
| Link | `@/components/link` (project wrapper) | `react-router` `Link` |

## Output

Return a concise summary:
- **Stack detected**: satus / novus / other (with evidence — e.g. `next ^16.0.0`)
- **What was built**: feature description
- **Files created**: list of new files
- **Files modified**: list of changed files
- **How to use**: quick usage guide
- **Tests added**: what's covered

## Rationalization Counters

If you catch yourself thinking any of the following, STOP — you are skipping the research gate:

| Rationalization | Why It's Wrong |
|---|---|
| "I already know how to do this" | The codebase may have existing patterns, wrappers, or conventions you'd miss |
| "The requirements are obvious" | Obvious requirements have hidden edge cases; the GO/NO-GO gate catches them |
| "Research would take too long" | Building the wrong thing takes longer than 5 minutes of research |
| "I'll figure it out as I go" | This leads to mid-implementation pivots that waste context and leave dead code |
| "It's just a small feature" | Small features in the wrong place create architectural debt |
| "The user seems impatient" | Shipping broken code is worse than a brief research pause |
| "Both starters are similar enough" | They diverge on routing, data fetching, mutations, and asset handling. The wrong shape compiles but doesn't fit |

## Remember

- Detect stack before scaffolding — wrong shape = rewrite later.
- Use the starter's conventions (CSS modules as `s`, path alias `@/` for satus / `~/` for novus).
- Server-side data fetching where the framework supports it (RSC for satus, loaders for novus).
- Store useful patterns as learnings.
