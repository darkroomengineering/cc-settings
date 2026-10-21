---
name: build
description: Build a feature, page, or integration end-to-end with a GO/NO-GO gate. Triggers "build a feature", "implement feature", "add feature", "build integration". Components go to /component, hooks to /hook.
context: fork
---

# Feature Build Workflow

## Standalone Codex

Use Context7 only when the user configured that
MCP. Otherwise consult official library documentation through native browsing
or inspect the pinned local package, and state which fallback supplied the API
contract. This package does not auto-run unpinned registry MCP packages.

## Phase 1: Research (GO/NO-GO Gate)

Before any implementation, complete this research phase:

1. **Detect stack** — read `package.json`. `next` dep → satus / Next.js; `react-router` dep → novus / React Router. Note any starter signal (`name` field, `darkroom.starter` marker).
2. **Understand requirements** — parse what the user actually needs. In Claude Code, when building an agent, bot, assistant, or autonomous job inside a product, read `~/.claude/profiles/durable-agents.md` before implementation.
3. **Explore codebase** — find existing patterns, similar implementations. Fetch the team-knowledge index and read any note whose title matches the libraries and integrations this feature touches; the fetch command is in docs/knowledge-system.md (fail-open — skip if `gh` is unavailable).
4. **Fetch docs** — use Context7 in Claude or when configured in Codex; otherwise use the standalone fallback above. Never code from memory.
5. **Check versions** — run `bun info <package>` for the latest version.
6. **Assess feasibility** — can this be done cleanly within existing architecture?
7. **Cold-reader check.** Write what you will build as a short spec (behavior, scope, decisions made). You wrote it, so you cannot see the gaps your own context fills. Spawn a general-purpose subagent with `model: "sonnet"` (standalone Codex: a fresh read-only `spawn_agent` worker), not `explore`, whose initial prompt maps the repo and would fill the gaps itself. Paste only the spec text into the prompt below and give it no file paths. List its questions in the verdict. Answer each from the codebase and fold the answer into the spec; a question only the user can answer makes the verdict ASK.

   ```
   You are a senior engineer handed this spec to build. You cannot talk to its author and must not open any files.

   <spec>

   List only the questions you would need answered before building it: places where you would have to guess and a wrong guess would change what gets built. For each, give the question and what changes with the answer. Rank them by importance. Skip anything the spec leaves to the builder, anything you could reasonably decide yourself, and wording nits. If nothing important is left, say "nothing important left".
   ```

**GO/ASK/NO-GO Verdict**: After research, state one of:
- **GO** — requirements are clear, every cold-reader question is answered in the spec, approach is viable, proceed to implementation.
- **ASK** — requirements have more than one plausible reading. Run clarifying rounds (AskUserQuestion in Claude, Plan mode `request_user_input` in Codex; up to 4 questions each, recommendation first) until no fork is left, then re-issue the verdict. If the user named no Linear issue, the first round also asks whether to create one now (recommended: yes); create it per the `ship` skill's "Linear issue" step and put its ID in the branch name. Never open a round only for this: `/ship` creates the issue anyway.
- **NO-GO** — approach has blockers or scope is too large. Report findings and stop.

Do not proceed past this gate without an explicit GO verdict.

## Phase 2: Plan

Create a brief implementation plan, opening with a `## Functional DAG` (recipe-table brace
diagram — inputs left, operations merging rightward, one terminal verification node; spec:
`docs/functional-dag.md`), then:
- Files to create/modify (with stack-correct paths — `lib/hooks/` for satus, `hooks/` for novus, etc.)
- Key decisions and rationale
- Dependency order — read off the DAG's columns, not restated by hand

## Phase 3: Implement

**Linear.** When the session has a Linear project (a `Linear: team ..., project ...` line at startup, or a mapping found by the `ship` skill's "Linear issue" step 2), the work needs an issue before the first commit: use the one the user named, or create it per that step. Start the branch from it (`feat/DR-123-newsletter-form`) so Linear links the PR; `/ship` then adds the ID to the PR title and `Fixes DR-123` to the body. No Linear project for the repo: skip this.

Follow standard Maestro workflow: scaffold → implement → test → review.

Use the right primitives for the stack:

| Concern | satus (Next.js) | novus (React Router) |
|---|---|---|
| Page | `app/<path>/page.tsx` | `app/routes/<path>.tsx` |
| Layout | `app/<path>/layout.tsx` | `app/root.tsx` or nested route |
| Data fetching | Server Component `async function` | `loader()` route export |
| Mutations | Server Actions (`'use server'`) | `action()` route export |
| Image | `next/image` | `<img>` (or Vite plugin) |
| Link | `@/components/link` (project wrapper) | `react-router` `Link` |

Use the starter's conventions: CSS modules as `s`, path alias `@/` (satus) or `~/` (novus).

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
