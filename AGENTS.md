# Darkroom Engineering

> Coding standards and guardrails for AI-assisted development.
> Works with Claude Code, Codex, Cursor, Copilot, Windsurf, and any AGENTS.md-compatible tool.

---

## Philosophy

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

Match output length to what was asked: a lookup gets a sentence and a `file:line`, a multi-file
change gets a brief plan and a short summary of what landed. Lead with the answer; skip the
preamble announcing what you're about to do and the recap restating the diff.

### Register

How the words are picked, independent of how long the reply is. Length is not the target — a
reply is better for being understood on the first read, not for being shorter. Never compensate
by clipping sentences or writing in fragments.

- **Subject first.** Name the thing before describing it; modifiers go after the noun, in a
  clause, not stacked in front of it. "The parser drops trailing commas — a lookahead bug, one
  line", not "a lookahead-driven trailing-comma-tolerant parse failure surfaces".
- **Use the existing name for the existing thing.** Never coin a term when one exists, and never
  capitalize an ordinary phrase into a proper noun to make it sound like a concept. "the retry
  loop", not "the retry-orchestration surface".
- **Identifiers point at code, not at ideas.** Write `parseConfig` when the reader will open that
  function; write "the config parser" when describing behavior. A sentence where most words are
  symbols is unreadable even when every symbol is correct.
- **Define jargon inline on first use.** One parenthetical is enough.
- **Say the effect, then the mechanism.** "Login survives a refresh now — the token moved to an
  httpOnly cookie", never the mechanism alone.

These rules have no exceptions, including when explaining at length. Cut jargon, never substance.

This section is the **portable** copy — for Codex, Cursor, and any other tool that reads
AGENTS.md, and for humans. Claude Code does **not** auto-load this file, so it is not what
reaches a Claude Code subagent; subagents inherit the CLAUDE.md hierarchy, which carries its own
copy of these rules. Claude Code main sessions get them from the `Darkroom` output style
(`~/.claude/output-styles/darkroom.md`) plus response shaping. All three copies say the same
thing on purpose — see `~/.claude/CLAUDE.md` for which mechanism covers which surface.

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

**Leave a receipt for corners you cut on purpose.** A deliberate simplification with a known ceiling — a global lock, an O(n²) scan, a naive heuristic, a hardcoded limit — gets a `SHORTCUT:` comment naming both the ceiling and what should trigger revisiting it:

```ts
// SHORTCUT: single global lock, not per-key.
// ceiling: contention above ~50 rps
// upgrade: shard by key hash when p99 write latency climbs
```

The upgrade trigger is the part that matters. A marker naming a ceiling but no trigger is how a deferral quietly becomes permanent — nobody knows what would make it worth fixing, so nobody ever does. `bun run lint:shortcuts` fails on a marker with no `upgrade:` line.

This is for corners cut *knowingly*. Ordinary code needs no marker, and a marker is not a license to skip anything on the "lazy, not negligent" list above — you cannot `SHORTCUT:` your way out of input validation. Run `/audit debt` to collect every marker in the repo into one ledger.

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
**Never commit code that doesn't typecheck, build, and pass tests.** Run all three and fix what
they surface before committing — not after.

### Failing Tests: Regression vs. Contract Change
A test that fails after your change is a fork in the road, not a chore to clear.
Before you touch the test, classify which case you're in:
- **Regression** — the assertion still describes correct behavior and your change
  broke it. Fix the *code*, not the test. Never relax, weaken, or delete the
  assertion to go green.
- **Intentional contract change** — the requirement explicitly supersedes what the
  test asserts. Update the implementation and the assertion *together in the same
  diff*, and say in your summary which contract changed and why.

When you can't tell which case it is, treat it as a regression and stop to
confirm. "Make the suite pass" is never a reason to edit an assertion — a green
suite that blesses wrong behavior is worse than a red one that caught it. This is
the single most common cause of the fix-broke-a-test / red-CI loop.

### Never Fake Measurements
NEVER fabricate output from Lighthouse, bundle size tools, performance profilers, test runners, or build systems. If you can't run a tool, say so.

**No savings against a run that never happened.** Report a delta only between two things that were both measured. "This saved ~400 lines" or "cut token use 60%" is unknowable when the unoptimized version was never written and the without-the-change run was never executed — there is no baseline to subtract from, so the number is invented no matter how plausible it looks. Report what you can count instead: lines deleted in this diff, the measured before and after of a benchmark you actually ran twice. Where an extrapolation genuinely helps, label it `est.` and name what it was extrapolated from. This applies hardest to the numbers that flatter the work — a savings figure is the easiest thing to fabricate and the least likely to be checked.

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

`SHORTCUT:` is the exception: it marks a corner cut deliberately, with a ceiling and an upgrade trigger already named (see `Laziness Ladder`). Leave it alone unless its trigger has actually fired — implementing it on sight is the over-build the ladder exists to prevent. If the trigger *has* fired, do the upgrade and delete the marker in the same diff.

### Plan Before Multi-File Changes
Once a change is broad enough that a wrong approach would mean a full rollback, state the plan
before executing it — which files you'll touch and what could break. **State it, don't ask
permission for it**; reversible in-scope work still proceeds without approval (see `Autonomous
Execution` and the Autonomy Contract in `~/.claude/CLAUDE.md`).

Claude Code has a specific numeric threshold for this — the delegation heuristic in
`~/.claude/CLAUDE.md` is the single source for the file/tool-call numbers.

### Every Plan Opens With a Functional DAG
Any markdown that plans work — plan files, PRDs, ADRs, issue task breakdowns,
orchestration briefs, and the plan you state before a multi-file change — starts with a
`## Functional DAG` section: inputs down the left, operations merging rightward, one
terminal verification node. Recipe-table form, in a fenced code block.

A bullet list hides the two things a plan exists to answer: what must finish before a step
can start, and what can run at the same time. The DAG shows both in its shape, and the
parallel batches are read off its columns rather than hand-maintained beside it.

Full spec, authoring rules, validity checks, and the Mermaid escape hatch:
`docs/functional-dag.md`. Not required for output that isn't a plan (reviews, audits,
retros, handoffs).

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

This is the default stack for Darkroom **web client work** — not an assumption about every repo.
Non-web and tooling repos (this one included) share the Bun/Biome/TypeScript rows and nothing else.
Framework depth lives in `profiles/` (`nextjs`, `react-router`, `react-native`, `tauri`, `webgl`).

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

## Coding Standards

Baseline for any stack. Claude Code sessions get the fuller versions from `rules/` and `profiles/`;
this section is what portable tools (Codex, Cursor, Copilot) see, so it stays self-contained.

### TypeScript
- No `any` — use `unknown` and narrow
- Prefer `interface` over `type` for objects
- Use discriminated unions for state

### React
- Server Components by default
- `'use client'` only when needed
- React Compiler enabled: do NOT use `useMemo`, `useCallback`, or `React.memo`
- Use `useRef` for object instantiation to prevent infinite loops

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
- No AI badges in PR descriptions — for the PR template itself see `rules/git.md` "PR Guidelines"
- Commit messages: conventional format, nothing else

---

## Code Review Rules

Scoping convention read by AGENTS.md-aware reviewers — Codex's GitHub integration (`@codex review`)
scopes to this exact heading, and the cc-settings review agents (`reviewer`, `codex-verifier`,
`/review`, `/codex review`) follow it too.

Report only findings that change behavior or risk. Anything a formatter or Biome already
catches is noise — skip it.

**P0 — block the merge:**
- Secrets or credentials in the diff (`.env` values, keys, tokens)
- Injection: unparameterized SQL, `dangerouslySetInnerHTML` with user content, open redirects
- Unvalidated input at a trust boundary (API routes, webhooks, form handlers)
- Data-loss paths: unhandled errors on writes/migrations, destructive operations without a guard
- Type-safety escapes that hide runtime failures: `any`, careless `as` assertions, `@ts-ignore`
- Test assertions relaxed, skipped, or deleted to make the suite pass (see `Failing Tests`)

**P1 — should fix before merge:**
- Request waterfalls (sequential awaits on independent data); barrel imports of heavy libraries
- Accessibility misses on touched UI: missing `alt`/`aria-label`/labels, `<div onClick>`, sub-44px targets
- Manual `useMemo`/`useCallback`/`React.memo` in React Compiler projects
- A new dependency where stdlib, platform, or an installed dep suffices (Laziness Ladder rungs 2–5)
- Scope creep inside a bug-fix diff (see `Bug Fix Scope`)

**Not review findings:** formatting, import order, naming taste, comment density.

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
