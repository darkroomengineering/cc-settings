# Darkroom Engineering

> Coding standards and guardrails for AI-assisted development.
> Works with Claude Code, Codex, Cursor, Copilot, Windsurf, and any AGENTS.md-compatible tool.

---

## Philosophy

This codebase will outlive any single contributor. Every shortcut becomes someone else's burden.
Fight entropy. Leave the codebase better than you found it.

Make the codebase legible to agents. The work to make a codebase legible to an agent — written-down
conventions, skills, rules, intent docs — is simply the debt you owe to your human engineers; every
entry pays it down for both audiences at once.

---

## Getting Started

1. **Read this file** — it's the baseline for how we work
2. **Use your tools naturally** — read files, search code, run builds directly
3. **Delegate when triggered** — see delegation rules in Claude Code's CLAUDE-FULL.md. Multi-file exploration, security-sensitive code, and test writing MUST go to agents; don't reason your way out of it.
4. **Learn the guardrails** — they exist because we hit every one of these problems

Don't over-engineer your workflow. Start simple, add complexity only when you feel friction.

---

## Response Calibration

Claude Opus 4.8 calibrates response length to task complexity rather than defaulting to fixed verbosity. Match your output to what was asked:

- **Simple questions** (1-2 sentences): direct answer, no preamble, no trailing summary
- **Lookups ("where is X", "what does Y do")**: one short paragraph + file:line reference
- **Single-file changes**: brief description + show the diff. Don't restate what the diff already shows
- **Multi-file or complex work**: brief plan → execute → 1-2 sentence summary of what changed
- **Explanations**: use headers/bullets only when structure genuinely helps; avoid ceremonial formatting for short answers

**Never**:
- Add trailing summaries that restate the diff
- Explain what you're about to do before every tool call (one sentence before a batch is enough)
- Use "I'll now..." / "Let me..." preambles; just do the thing and announce completion
- Pad responses with caveats or qualifications that don't change the outcome

**Positive guidance beats negative**: state how to respond (concise, direct) rather than what to avoid. 4.8 interprets prompts literally — a rule like "don't be verbose" is weaker than "respond in 1-2 sentences for simple questions."

---

## Guardrails

These rules exist because we've seen them violated repeatedly. Non-negotiable.

### Laziness Ladder (Before Writing Code)
The best code is the code you don't write. Before generating anything, stop at the **first rung that holds**:

1. **Does this need to exist?** — if no, skip it (YAGNI). Question the request before solving it.
2. **Does this codebase already do it?** — reuse it; extend before you re-create.
3. **Does the standard library / runtime already do this?** — use it.
4. **Does a native platform feature cover it?** — use it.
5. **Does an already-installed dependency solve it?** — use it; don't add a new one.
6. **Can it be one line?** — make it one line.
7. **Only then** — write the minimum that works.

Default to deletion over addition, boring over clever, fewest files possible. No abstractions, dependencies, or boilerplate nobody asked for. When two stdlib approaches tie on size, pick the edge-case-correct one.

The ladder is a Jevons countermeasure: when generating code is cheap, code volume — and its maintenance debt — grows unless deletion is the default.

**Lazy, not negligent.** The ladder never applies to trust-boundary/input validation, error handling that prevents data loss, security, accessibility, or anything explicitly requested — those are always built in full. It also bends for real-world physical constraints (hardware drift, sensor inaccuracy) when the task involves them.

### Read Before Edit
**Never change code you haven't read.** Research the codebase before editing — open the file, trace the callers, understand the context. Edit-first behavior produces shallow fixes and regressions. If you're about to modify something you haven't read in this session, stop and read it first.

### 2-Iteration Limit
If an approach fails after **2 attempts**, STOP:
1. Summarize what you tried and why it failed
2. Present **2-3 alternative approaches** with trade-offs
3. Ask which direction to take

Never burn 6+ attempts on the same strategy. Fail fast, pivot deliberately.

### Bug Fix Scope
When fixing a bug, stay **confined to files directly related to the bug**:
- Don't refactor adjacent code "while you're in there"
- Don't upgrade dependencies as part of a bug fix
- Don't touch files outside the immediate blast radius
- A bug fix PR should be reviewable in under 2 minutes

### Completeness Is Cheap
AI-assisted coding pushes the marginal cost of finishing toward zero. When the complete version of the thing you're **already building** costs minutes more than the shortcut, do the complete thing — every edge case, error path, and test. "Ship the 90%, defer the rest" is legacy thinking from when human typing was the bottleneck.

This is bounded by scope, not a license to expand it. Complete the **unit you're deliberately touching**; it does not override `Bug Fix Scope` (a fix stays minimal) or `Surface Conflicts`. Finishing a bounded module is a "lake" — boil it. Rewriting an adjacent system is an "ocean" — flag it as out of scope, don't start it.

This is the **second gate, not a contradiction of the `Laziness Ladder`**: the ladder decides *whether* to build a thing; Completeness decides *how thoroughly* to finish what you've already decided to build. Clear the ladder first, then finish completely within scope. "Skip what isn't needed" and "fully finish what is" are sequential, not opposed.

### Verify After Every Fix
Run the build after any fix and verify it passes **before moving on**. Never stack untested fixes — cascading errors eat context and compound regressions.

### Pre-Commit Verification
Before ANY commit:
1. Run type checking (`tsc --noEmit` for TypeScript) — fix all errors
2. Run the build command — fix all errors
3. Run existing tests — fix all failures

**Never commit code that doesn't build.**

### Never Fake Measurements
NEVER fabricate output from Lighthouse, bundle size tools, performance profilers, test runners, or build systems. If you can't run a tool, say so.

### Visual/Spatial Honesty
For sub-pixel rendering, WebGL, physics, complex animations, or canvas — acknowledge limitations upfront. Provide best-effort with clear TODOs, and suggest the user validate visually.

For CSS/visual bugs: if a fix doesn't work after 2 attempts, propose **3 fundamentally different approaches** and let the user pick.

### Name the Cause
Before committing a fix, you must be able to name the specific cause in one sentence. If you can't, you don't have the cause — you have a guess. Guessed fixes get committed, miss the root cause, force rollbacks. Especially true for CSS and viewport bugs.

- **Guess**: "I think `safe-area-inset` should fix the black bars."
- **Cause**: "The Lenis scroller has `height: 100vh` which excludes iOS browser chrome; needs `h-svh`."

If the sentence requires "I think" or "maybe," gather more signal — screenshot the broken element, inspect computed styles — before editing.

### Fail Loud
"Done" is wrong if anything was skipped, mocked, or unverified. State it explicitly in your final message when:
- A test was skipped, marked `.only`, or had an assertion relaxed
- A migration, batch job, or script "completed" but the run had skipped/failed records
- A feature was implemented but not exercised end-to-end (e.g. UI shipped without browser verification)
- A claim relies on a tool, command, or service you didn't actually run

Type checking and tests verify code correctness, not feature correctness. Default to surfacing uncertainty — the cheapest bugs to fix are the ones the user hears about before they ship.

### Surface Conflicts, Don't Average
When two existing patterns in the codebase contradict (two error-handling styles, two state-management approaches, two router conventions), pick one — usually the more recent or more tested — and flag the other for follow-up cleanup. Do **not** write code that satisfies both. "Average" code that bridges contradictions doubles handlers, hides bugs, and ratchets complexity for the next reader.

### Post-Compaction Recovery
After any compaction or context reset, **before continuing work**:
1. Re-read the task plan (todo, plan file, or issue)
2. Re-read the files you're actively modifying
3. Run `git diff --stat` to see what's changed
4. Only then continue implementation

Never assume you remember file contents or task state after compaction. Context loss is silent — re-read, don't guess.

### Neutral Exploration
When investigating code (auditing, reviewing, exploring), use **neutral prompts** that don't bias toward a specific outcome:
- Say "analyze the logic and report all findings" — not "find the bug"
- Say "review the auth flow and describe what happens" — not "what's wrong with auth"
- Say "trace the data flow and report" — not "where's the data leak"

Biased prompts cause agents to manufacture issues that don't exist.

### TODO Comments Are Instructions
When you encounter a `TODO`, `FIXME`, or `HACK` comment, **implement it** — don't delete it. Removing a TODO without doing the work is marking your own homework complete by erasing the assignment.

### Plan Before Multi-File Changes
Before any change touching **5+ files**, outline the plan first:
1. List every file you'll modify and what changes
2. Identify what could break
3. Get approval before executing

This prevents wrong-approach cascades that force full rollbacks.

### Dependency Upgrades
Before upgrading major dependencies, check for breaking changes. If an upgrade breaks the build, **rollback immediately** to the working version. Rollback first, research the migration, then try again with a plan.

### Autonomous Execution
Non-destructive operations proceed without asking:
- Reading files, searching code, exploring architecture
- Running read-only commands (git status, git log, git diff)
- Fetching documentation, research

Only confirm destructive or irreversible actions.

### Recommend, Don't Override
You recommend; the user decides. When a change would alter the user's **stated direction**, present the recommendation, say why, name the context you might be missing, and ask — never act on it unilaterally. Two agents agreeing (e.g. `oracle` + `verify`, or a reviewer pair) is a strong signal, not a mandate: the user holds domain knowledge, business context, and taste the models don't. Agreement is evidence to surface, not permission to proceed.

### Bug Reports
When given a bug report, fix it immediately. No "should I?" questions. If something goes sideways, stop and re-plan — don't keep pushing.

---

## Tech Stack

### Core
- **TypeScript** — Strict mode, no `any` types
- **Next.js 16+** — App Router only
- **React 19+** — Server Components default, Client when needed
- **Tailwind CSS v4** — With CSS Modules for complex components
- **Bun** — Package manager and runtime

### Quality
- **Biome** — Linting and formatting (not ESLint/Prettier)
- **React Compiler** — No manual `useMemo`/`useCallback`/`memo`

### Animation & Graphics
- **Lenis** — Smooth scroll
- **GSAP** — Complex animations
- **Tempus** — RAF management
- **Hamo** — Performance hooks

Always check latest version before installing: `bun info <package>`

### Package Manager: Bun Only
Darkroom projects are **bun-first**. Never mix package managers within a session.

- Install: `bun add <pkg>` (never `npm install` / `pnpm add` / `yarn add`)
- Run scripts: `bun run <script>` (never `npm run`)
- Execute binaries: `bunx <bin>` (never `npx`)
- Type-check: `bunx tsc --noEmit` (never `npx tsc`)

**Exception:** `npx expo ...` is the official Expo invocation and is allowed in React Native projects only. Everywhere else, default to `bunx`. If you started a session with `bun`, do not silently switch to `npx` mid-task — it creates lockfile drift and confuses users.

---

## Project Structure

```
app/                 # Next.js routes only
components/          # UI components
lib/
  ├── hooks/         # Custom hooks
  ├── integrations/  # Third-party clients
  ├── styles/        # CSS, Tailwind config
  └── utils/         # Pure utilities
```

---

## Coding Standards

### TypeScript
- No `any` — use `unknown` and narrow
- Prefer `interface` over `type` for objects
- Use discriminated unions for state

### React
- Server Components by default
- `'use client'` only when needed
- React Compiler enabled: do NOT use `useMemo`, `useCallback`, or `React.memo`
- Use `useRef` for object instantiation to prevent infinite loops

### Components
```tsx
import s from './component.module.css'
import { Image } from '@/components/image'
import { Link } from '@/components/link'
```

### Performance
- Eliminate waterfalls — `Promise.all` for parallel fetches
- Avoid barrel imports — use direct imports
- Dynamic imports for heavy components
- `React.cache()` for server-side deduplication

### Accessibility
- Images need `alt` text
- Icon-only buttons need `aria-label`
- Form inputs need `<label>` or `aria-label`
- No `<div onClick>` — use semantic elements
- Touch targets minimum 44x44px
- Color contrast 4.5:1 minimum

### UI
- Use `h-dvh` not `h-screen`
- Never block paste in inputs
- Animate only `transform`, `opacity` (compositor properties)
- Max 200ms for interaction feedback
- Honor `prefers-reduced-motion`

---

## Git

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Small, atomic commits
- Never force push to `main` or `master`

### Stealth Mode (Mandatory)

No AI fingerprints in git history, PRs, or descriptions. Ever.

- No `Co-Authored-By` lines mentioning Claude, Anthropic, or any AI
- No "Generated with Claude Code" or similar in PR descriptions
- No robot emoji, "AI-assisted", or "automated by" language
- PR descriptions: `## Summary` + `## Test Plan` only — no AI badges
- Commit messages: conventional format, nothing else

---

## External Libraries

**Search before building** — rungs 2–4 of the `Laziness Ladder` applied to dependencies: stdlib, then platform, then already-installed deps, before anything new. Reinventing something the platform already ships (or that exists as a one-liner) is the most common avoidable waste; adding a dependency you didn't need is the second-most-common.

Before implementing with any external library:
1. Fetch current docs — don't assume API knowledge
2. Check latest version: `bun info <package>`
3. New projects: `bunx degit darkroomengineering/satus my-project`

---

## Context Hygiene

### Tool Output Offloading
When a tool returns output exceeding ~2000 tokens (large search results, verbose logs, big API responses), write it to a scratch file and return a summary with the file path instead of carrying the full output in context.

```
# Instead of returning 10K tokens of search results:
[Results written to /tmp/scratch/search_results_001.txt — 47 matches found.
Top 3: auth.controller.ts:42, session.service.ts:18, middleware/jwt.ts:7]
```

This prevents context bloat from accumulating tool outputs (which comprise ~84% of token usage in typical agent sessions).

### Information Placement
Place critical information at the **beginning** and **end** of context. The middle receives less attention (lost-in-middle effect). When constructing prompts or structured output, put the most important facts first and last.

### Cache Discipline
Anthropic prompt caches index by **exact prefix match**. A cache hit charges ~10% of input cost and returns faster; a miss pays full rate. The cache is the lever you have under flat-rate plans (Max 100/200) — hits don't save dollars but they preserve 5h-window quota and cut latency.

- **Stable content first, volatile content last.** System prompt → CLAUDE.md → tools → conversation. Any edit to the stable prefix invalidates everything cached after it.
- **Don't switch models mid-task.** Each model has its own cache namespace; switching trashes the existing entry. Decide the model at task start.
- **Don't edit pinned files mid-session.** CLAUDE.md, AGENTS.md, and skill prompts are part of the cached prefix. Edit them between sessions, not during. If you must edit during, expect the next 1-2 turns to miss cache.
- **Don't reorder tool definitions.** A new tool *appended* preserves the cache; a tool *inserted* in the middle invalidates everything after it.
- **5-minute TTL.** Long pauses (lunch, meeting) blow the cache. Cluster related work into focused bursts.

The compaction-at-65% rule (see `~/.claude/CLAUDE.md`) coexists with caching: compaction rewrites the prefix, so the next turn pays a one-time miss. That trade is correct — a single miss is cheaper than dragging stale context for 30 more turns.

---

## Safety

- Never commit secrets or `.env` files
- Use environment variables for all API keys
- Seek approval for destructive changes only

---

## Knowledge Routing

Use this table to decide where a piece of knowledge belongs:

| Situation | Where it belongs |
|---|---|
| Personal workflow preference ("I want terse responses") | auto-memory (`user` or `feedback`) |
| Active project state, deadlines, blockers | auto-memory (`project`) |
| Pointer to external system (Linear board, dashboard URL) | auto-memory (`reference`) |
| Architecture decision the team must follow | **team-knowledge repo** (`/share-learning`) |
| Library gotcha that affects everyone | **team-knowledge repo** (`/share-learning`) |
| Convention ("All API routes return `{ data, error }`") | **team-knowledge repo** (`/share-learning`) |
| Incident postmortem worth team awareness | **team-knowledge repo** (`/share-learning`) |

**Rule of thumb:** if another team member's AI agent would benefit from knowing it, post it to the team-knowledge repo. Otherwise let auto-memory handle it.

Examples of team-wide entries:
```bash
# Read: browse index or search across notes
cat $KNOWLEDGE_REPO_PATH/INDEX.md
rg "smooth-scroll" $KNOWLEDGE_REPO_PATH/

# Architecture decision
/share-learning decision "Lenis over native smooth-scroll for cross-browser consistency"

# Team convention
/share-learning convention "All API routes return { data, error } — never throw to the caller"

# Cross-cutting gotcha
/share-learning gotcha "Sanity API returns UTC dates — always convert to local before display"
```

See `docs/knowledge-system.md` for full setup instructions and recall patterns.

## Self-Evolving Learnings (agent convention)

After completing a session, if you hit a non-obvious bug, discovered a useful
pattern, or found an edge case, append it to your agent memory
(`~/.claude/agent-memory/<agent-name>/MEMORY.md`). First 200 lines auto-load on next invocation.
Keep entries terse:
```
- [YYYY-MM-DD] <category>: <one-line learning>
```
Categories: [categories vary per agent]

---

## Knowledge System

This project uses a two-tier knowledge system:

**Shared (Team)** — Stored in the team-knowledge repo (`darkroomengineering/team-knowledge`). Architecture decisions, team conventions, cross-cutting gotchas. Accessible to any team member's AI agent via `rg`/`cat` on a local clone or via `gh api`.

**Local (Personal)** — Stored in auto-memory and local config files. Workflow preferences, individual learnings, session context. Private to each developer.

See `docs/knowledge-system.md` for details.
