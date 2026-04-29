---
name: build
description: Build new feature/page/component/integration from scratch. Triggers "build a", "create a", "implement", "add feature", "add new functionality".
context: fork
---

# Feature Build Workflow

Before starting work, create a marker: `mkdir -p ~/.claude/tmp && echo "build" > ~/.claude/tmp/heavy-skill-active && date -u +"%Y-%m-%dT%H:%M:%SZ" >> ~/.claude/tmp/heavy-skill-active`

## Phase 1: Research (GO/NO-GO Gate)

Before any implementation, complete this research phase:

1. **Understand requirements** - Parse what the user actually needs
2. **Explore codebase** - Find existing patterns, similar implementations
3. **Fetch docs** - Run `/docs <library>` for any external library. Never code from memory.
4. **Check versions** - Run `bun info <package>` for latest version
5. **Assess feasibility** - Can this be done cleanly within existing architecture?

**GO/NO-GO Verdict**: After research, state one of:
- **GO** - Requirements are clear, approach is viable, proceed to implementation
- **NO-GO** - Requirements are ambiguous, approach has blockers, or scope is too large. Report findings and stop.

Do not proceed past this gate without an explicit GO verdict.

## Phase 2: Plan

Create a brief implementation plan:
- Files to create/modify
- Key decisions and rationale
- Dependency order

## Phase 3: Implement

Follow standard Maestro workflow: scaffold -> implement -> test -> review.

## Output

Return a concise summary:
- **What was built**: Feature description
- **Files created**: List of new files
- **Files modified**: List of changed files
- **How to use**: Quick usage guide
- **Tests added**: What's covered

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

## Remember

- Always use Satus conventions (Image/Link wrappers, CSS modules as 's')
- Server Components by default, Client only when needed
- Store useful patterns as learnings
